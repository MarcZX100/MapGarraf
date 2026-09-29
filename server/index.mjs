import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { z } from "zod";
import { isPlausibleMovement, isWithinRouteCorridor } from "./routeValidation.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const port = Number(process.env.PORT || 4174);
const dbPath = path.resolve(root, process.env.DATABASE_PATH || "./data/busgarraf.sqlite");
const liveForMs = 60 * 1000;
// Keep a stale fix long enough to estimate a full 75-minute trip, including a delay buffer.
// The client stops drawing it once the timetable says the bus should have reached the terminus.
const estimateForMs = 105 * 60 * 1000;
const maxGpsAccuracyMeters = positiveInteger(process.env.MAX_GPS_ACCURACY_METERS, 1_000);
const maxNewReportsPerMinutePerIp = positiveInteger(process.env.MAX_NEW_REPORTS_PER_MINUTE_PER_IP, 30);
const maxWritesPerMinutePerIp = positiveInteger(process.env.MAX_WRITES_PER_MINUTE_PER_IP, 300);
const maxActiveReportsPerDirection = positiveInteger(process.env.MAX_ACTIVE_REPORTS_PER_DIRECTION, 60);
const directionSchema = z.enum(["to-tarragona", "to-vilanova"]);
const occupancySchema = z.enum(["low", "medium", "high"]).nullable().optional();
const reinforcementSchema = z.boolean().optional();

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS bus_reports (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    delete_token_hash TEXT,
    direction TEXT NOT NULL CHECK (direction IN ('to-tarragona', 'to-vilanova')),
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    accuracy REAL,
    departure_time TEXT,
    vehicle_label TEXT,
    occupancy TEXT CHECK (occupancy IS NULL OR occupancy IN ('low', 'medium', 'high')),
    reinforcement INTEGER NOT NULL DEFAULT 0 CHECK (reinforcement IN (0, 1)),
    delay_minutes INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS bus_reports_direction_updated
    ON bus_reports(direction, updated_at);
`);
if (!db.prepare("PRAGMA table_info(bus_reports)").all().some((column) => column.name === "reinforcement")) {
  db.exec("ALTER TABLE bus_reports ADD COLUMN reinforcement INTEGER NOT NULL DEFAULT 0 CHECK (reinforcement IN (0, 1))");
}
if (!db.prepare("PRAGMA table_info(bus_reports)").all().some((column) => column.name === "delete_token_hash")) {
  db.exec("ALTER TABLE bus_reports ADD COLUMN delete_token_hash TEXT");
}

const app = express();
const trustedProxies = Number(process.env.TRUST_PROXY || 0);
if (Number.isFinite(trustedProxies) && trustedProxies > 0) app.set("trust proxy", trustedProxies);
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'", "https://www.googletagmanager.com", "https://*.google-analytics.com", "https://*.google.com"],
        fontSrc: ["'self'", "data:"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", "https://www.googletagmanager.com"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        ...(process.env.NODE_ENV === "production" ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }),
);
app.use(express.json({ limit: "8kb", type: "application/json" }));
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Permissions-Policy", "geolocation=(self)");
  next();
});

function rateLimitHandler(message) {
  return (req, res, _next, options) => {
    const resetTime = req.rateLimit?.resetTime;
    const retryAfterSeconds = resetTime ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000)) : 60;
    res.setHeader("Retry-After", String(retryAfterSeconds));
    res.status(options.statusCode).json({ error: message, retryAfterSeconds });
  };
}

// Many mobile carriers put several travelers behind one public IP. Keep IP-level
// limits high enough for normal map polling and GPS updates from those shared IPs.
const readLimiter = rateLimit({
  windowMs: 60_000,
  limit: 1_200,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitHandler("Se han recibido demasiadas consultas del mapa desde esta conexión. Espera unos segundos e inténtalo de nuevo."),
});
const writeLimiter = rateLimit({
  windowMs: 60_000,
  limit: maxWritesPerMinutePerIp,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitHandler("Se han recibido demasiadas actualizaciones desde esta conexión. Espera unos segundos e inténtalo de nuevo."),
});
const createLimiter = rateLimit({
  windowMs: 60_000,
  limit: maxNewReportsPerMinutePerIp,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitHandler("Se han creado demasiadas señales desde esta conexión. Espera un minuto antes de intentarlo de nuevo."),
});
app.use("/api", readLimiter);

const reportInput = z.object({
  direction: directionSchema,
  // Broad corridor bounds discard clearly unrelated/spoofed coordinates.
  latitude: z.number().finite().min(41.05).max(41.28),
  longitude: z.number().finite().min(1.18).max(1.8),
  accuracy: z.number().finite().min(0).max(maxGpsAccuracyMeters).optional(),
  departureTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  occupancy: occupancySchema,
  reinforcement: reinforcementSchema,
});
const createReportInput = reportInput.extend({
  accuracy: z.number().finite().min(0).max(maxGpsAccuracyMeters),
  departureTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

function publicReport(row, now = Date.now()) {
  const ageSeconds = Math.max(0, Math.floor((now - row.updated_at) / 1000));
  const isLive = ageSeconds < liveForMs / 1000;
  const publicCoordinate = (coordinate) => isLive ? coordinate : Number(coordinate.toFixed(3));
  return {
    id: row.id,
    direction: row.direction,
    latitude: publicCoordinate(row.latitude),
    longitude: publicCoordinate(row.longitude),
    accuracy: isLive ? row.accuracy : null,
    departureTime: row.departure_time,
    // Kept as null for API compatibility; punctuality is calculated by clients.
    occupancy: row.occupancy,
    reinforcement: Boolean(row.reinforcement),
    delayMinutes: null,
    lastSeen: new Date(row.updated_at).toISOString(),
    ageSeconds,
  };
}

function parseBody(schema, req, res) {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const fields = result.error.flatten().fieldErrors;
    const error = fields.accuracy
      ? `El GPS debe indicar una precisión de ${maxGpsAccuracyMeters} metros o mejor.`
      : "Datos no válidos.";
    res.status(400).json({ error, fields });
    return null;
  }
  return result.data;
}

function authorized(req, report) {
  const supplied = req.get("x-share-token") || "";
  if (!supplied) return false;
  const suppliedHash = crypto.createHash("sha256").update(supplied).digest("hex");
  const left = Buffer.from(report.token_hash, "hex");
  const right = Buffer.from(suppliedHash, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function authorizedWithToken(req, report, hashField, headerName = "x-share-token") {
  const supplied = req.get(headerName) || "";
  if (!supplied || !report[hashField]) return false;
  const suppliedHash = crypto.createHash("sha256").update(supplied).digest("hex");
  const left = Buffer.from(report[hashField], "hex");
  const right = Buffer.from(suppliedHash, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

app.get("/health", (_req, res) => {
  try {
    db.prepare("SELECT 1").get();
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.get("/api/vehicles", (req, res) => {
  const direction = directionSchema.safeParse(req.query.direction);
  if (!direction.success) return res.status(400).json({ error: "Indica un sentido válido." });
  const now = Date.now();
  db.prepare("DELETE FROM bus_reports WHERE updated_at < ?").run(now - 24 * 60 * 60 * 1000);
  const rows = db
    .prepare("SELECT * FROM bus_reports WHERE direction = ? AND updated_at >= ? ORDER BY updated_at DESC LIMIT 60")
    .all(direction.data, now - estimateForMs);
  res.json({ reports: rows.map((row) => publicReport(row, now)), liveForSeconds: liveForMs / 1000, estimateForSeconds: estimateForMs / 1000 });
});

app.post("/api/vehicles", createLimiter, writeLimiter, (req, res) => {
  const input = parseBody(createReportInput, req, res);
  if (!input) return;
  if (!isWithinRouteCorridor(input.latitude, input.longitude, input.direction)) {
    return res.status(400).json({ error: "La ubicación no está cerca del recorrido del bus." });
  }
  const now = Date.now();
  db.prepare("DELETE FROM bus_reports WHERE updated_at < ?").run(now - 24 * 60 * 60 * 1000);
  const activeCount = db.prepare("SELECT COUNT(*) AS count FROM bus_reports WHERE direction = ? AND updated_at >= ?")
    .get(input.direction, now - estimateForMs).count;
  if (activeCount >= maxActiveReportsPerDirection) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "Hay demasiadas señales activas en este sentido. Inténtalo de nuevo dentro de un minuto." });
  }
  const id = crypto.randomUUID();
  const shareToken = crypto.randomBytes(32).toString("base64url");
  const deleteToken = crypto.randomBytes(32).toString("base64url");
  db.prepare(`
    INSERT INTO bus_reports
      (id, token_hash, delete_token_hash, direction, latitude, longitude, accuracy, departure_time, vehicle_label, occupancy, reinforcement, delay_minutes, created_at, updated_at)
    VALUES
      (@id, @token_hash, @delete_token_hash, @direction, @latitude, @longitude, @accuracy, @departure_time, @vehicle_label, @occupancy, @reinforcement, @delay_minutes, @created_at, @updated_at)
  `).run({
    id,
    token_hash: crypto.createHash("sha256").update(shareToken).digest("hex"),
    delete_token_hash: crypto.createHash("sha256").update(deleteToken).digest("hex"),
    direction: input.direction,
    latitude: input.latitude,
    longitude: input.longitude,
    accuracy: input.accuracy ?? null,
    departure_time: input.departureTime ?? null,
    vehicle_label: null,
    occupancy: input.occupancy ?? null,
    reinforcement: input.reinforcement ? 1 : 0,
    delay_minutes: null,
    created_at: now,
    updated_at: now,
  });
  const row = db.prepare("SELECT * FROM bus_reports WHERE id = ?").get(id);
  res.status(201).json({ report: publicReport(row, now), shareToken, deleteToken });
});

app.patch("/api/vehicles/:id", writeLimiter, (req, res) => {
  const report = db.prepare("SELECT * FROM bus_reports WHERE id = ?").get(req.params.id);
  if (!report || !authorized(req, report)) return res.status(404).json({ error: "La sesión de ubicación ya no está disponible." });
  const partialInput = reportInput.omit({ direction: true }).partial();
  const input = parseBody(partialInput, req, res);
  if (!input) return;
  if (input.departureTime === null) return res.status(400).json({ error: "Selecciona la hora de salida del bus." });
  if ((input.latitude === undefined) !== (input.longitude === undefined)) {
    return res.status(400).json({ error: "Envía latitud y longitud juntas." });
  }
  const now = Date.now();
  if (input.latitude !== undefined) {
    if (!isWithinRouteCorridor(input.latitude, input.longitude, report.direction)) {
      return res.status(400).json({ error: "La ubicación no está cerca del recorrido del bus." });
    }
    if (!isPlausibleMovement(
      { latitude: report.latitude, longitude: report.longitude, accuracy: report.accuracy },
      { latitude: input.latitude, longitude: input.longitude, accuracy: input.accuracy ?? report.accuracy },
      (now - report.updated_at) / 1000,
    )) {
      return res.status(400).json({ error: "El cambio de ubicación es demasiado rápido para un autobús." });
    }
  }
  const fields = {
    latitude: input.latitude ?? report.latitude,
    longitude: input.longitude ?? report.longitude,
    accuracy: input.accuracy ?? report.accuracy,
    departure_time: input.departureTime === undefined ? report.departure_time : input.departureTime,
    vehicle_label: null,
    occupancy: input.occupancy === undefined ? report.occupancy : input.occupancy,
    reinforcement: input.reinforcement === undefined ? report.reinforcement : (input.reinforcement ? 1 : 0),
    delay_minutes: null,
    updated_at: input.latitude === undefined ? report.updated_at : now,
    id: report.id,
  };
  db.prepare(`
    UPDATE bus_reports SET latitude = @latitude, longitude = @longitude, accuracy = @accuracy,
      departure_time = @departure_time, vehicle_label = @vehicle_label, occupancy = @occupancy, reinforcement = @reinforcement,
      delay_minutes = @delay_minutes, updated_at = @updated_at WHERE id = @id
  `).run(fields);
  res.json({ report: publicReport(db.prepare("SELECT * FROM bus_reports WHERE id = ?").get(report.id), now) });
});

app.delete("/api/vehicles/:id", writeLimiter, (req, res) => {
  const report = db.prepare("SELECT * FROM bus_reports WHERE id = ?").get(req.params.id);
  if (!report || (!authorizedWithToken(req, report, "delete_token_hash", "x-delete-token") && !authorized(req, report))) {
    return res.status(404).json({ error: "La sesión de ubicación ya no está disponible." });
  }
  db.prepare("DELETE FROM bus_reports WHERE id = ?").run(report.id);
  res.status(204).end();
});

// Old coordinates are removed on startup and are never shown after three minutes without a refresh.
db.prepare("DELETE FROM bus_reports WHERE updated_at < ?").run(Date.now() - 24 * 60 * 60 * 1000);
const cleanupTimer = setInterval(() => {
  db.prepare("DELETE FROM bus_reports WHERE updated_at < ?").run(Date.now() - 24 * 60 * 60 * 1000);
}, 60 * 1000);
cleanupTimer.unref();

const dist = path.join(root, "dist");
if (fs.existsSync(path.join(dist, "index.html"))) {
  app.use(express.static(dist, { index: false, maxAge: "1h", setHeaders: (res, filename) => {
    if (filename.endsWith("index.html") || filename.endsWith("sw.js") || filename.endsWith("manifest.webmanifest")) {
      res.setHeader("Cache-Control", "no-cache");
    }
  } }));
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path === "/health") return next();
    res.sendFile(path.join(dist, "index.html"));
  });
}

app.use((error, _req, res, _next) => {
  console.error("Request failed", error?.message || error);
  if (res.headersSent) return;
  const status = error?.type === "entity.parse.failed" ? 400 : 500;
  res.status(status).json({ error: status === 400 ? "El cuerpo de la petición no es JSON válido." : "No se pudo completar la petición." });
});

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`BusGarraf community server listening on port ${port}`);
  console.log(`SQLite database: ${dbPath}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
