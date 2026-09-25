import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const port = Number(process.env.PORT || 4174);
const dbPath = path.resolve(root, process.env.DATABASE_PATH || "./data/busgarraf.sqlite");
const liveForMs = 3 * 60 * 1000;
const directionSchema = z.enum(["to-tarragona", "to-vilanova"]);
const occupancySchema = z.enum(["low", "medium", "high"]).nullable().optional();

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS bus_reports (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('to-tarragona', 'to-vilanova')),
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    accuracy REAL,
    departure_time TEXT,
    vehicle_label TEXT,
    occupancy TEXT CHECK (occupancy IS NULL OR occupancy IN ('low', 'medium', 'high')),
    delay_minutes INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS bus_reports_direction_updated
    ON bus_reports(direction, updated_at);
`);

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
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
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

const readLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false });
const writeLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });
app.use("/api", readLimiter);

const reportInput = z.object({
  direction: directionSchema,
  // Broad corridor bounds discard clearly unrelated/spoofed coordinates.
  latitude: z.number().finite().min(41.05).max(41.28),
  longitude: z.number().finite().min(1.18).max(1.8),
  accuracy: z.number().finite().min(0).max(100_000).optional(),
  departureTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  vehicleLabel: z.string().trim().max(30).nullable().optional(),
  occupancy: occupancySchema,
  delayMinutes: z.number().int().min(-30).max(240).nullable().optional(),
});

function publicReport(row, now = Date.now()) {
  const ageSeconds = Math.max(0, Math.floor((now - row.updated_at) / 1000));
  return {
    id: row.id,
    direction: row.direction,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracy: row.accuracy,
    departureTime: row.departure_time,
    vehicleLabel: row.vehicle_label,
    occupancy: row.occupancy,
    delayMinutes: row.delay_minutes,
    lastSeen: new Date(row.updated_at).toISOString(),
    ageSeconds,
  };
}

function parseBody(schema, req, res) {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: "Datos no válidos.", fields: result.error.flatten().fieldErrors });
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
    .all(direction.data, now - liveForMs);
  res.json({ reports: rows.map((row) => publicReport(row, now)), liveForSeconds: liveForMs / 1000 });
});

app.post("/api/vehicles", writeLimiter, (req, res) => {
  const input = parseBody(reportInput, req, res);
  if (!input) return;
  const id = crypto.randomUUID();
  const shareToken = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  db.prepare(`
    INSERT INTO bus_reports
      (id, token_hash, direction, latitude, longitude, accuracy, departure_time, vehicle_label, occupancy, delay_minutes, created_at, updated_at)
    VALUES
      (@id, @token_hash, @direction, @latitude, @longitude, @accuracy, @departure_time, @vehicle_label, @occupancy, @delay_minutes, @created_at, @updated_at)
  `).run({
    id,
    token_hash: crypto.createHash("sha256").update(shareToken).digest("hex"),
    direction: input.direction,
    latitude: input.latitude,
    longitude: input.longitude,
    accuracy: input.accuracy ?? null,
    departure_time: input.departureTime ?? null,
    vehicle_label: input.vehicleLabel || null,
    occupancy: input.occupancy ?? null,
    delay_minutes: input.delayMinutes ?? null,
    created_at: now,
    updated_at: now,
  });
  const row = db.prepare("SELECT * FROM bus_reports WHERE id = ?").get(id);
  res.status(201).json({ report: publicReport(row, now), shareToken });
});

app.patch("/api/vehicles/:id", writeLimiter, (req, res) => {
  const report = db.prepare("SELECT * FROM bus_reports WHERE id = ?").get(req.params.id);
  if (!report || !authorized(req, report)) return res.status(404).json({ error: "La sesión de ubicación ya no está disponible." });
  const partialInput = reportInput.omit({ direction: true }).partial();
  const input = parseBody(partialInput, req, res);
  if (!input) return;
  if ((input.latitude === undefined) !== (input.longitude === undefined)) {
    return res.status(400).json({ error: "Envía latitud y longitud juntas." });
  }
  const now = Date.now();
  const fields = {
    latitude: input.latitude ?? report.latitude,
    longitude: input.longitude ?? report.longitude,
    accuracy: input.accuracy ?? report.accuracy,
    departure_time: input.departureTime === undefined ? report.departure_time : input.departureTime,
    vehicle_label: input.vehicleLabel === undefined ? report.vehicle_label : input.vehicleLabel,
    occupancy: input.occupancy === undefined ? report.occupancy : input.occupancy,
    delay_minutes: input.delayMinutes === undefined ? report.delay_minutes : input.delayMinutes,
    updated_at: input.latitude === undefined ? report.updated_at : now,
    id: report.id,
  };
  db.prepare(`
    UPDATE bus_reports SET latitude = @latitude, longitude = @longitude, accuracy = @accuracy,
      departure_time = @departure_time, vehicle_label = @vehicle_label, occupancy = @occupancy,
      delay_minutes = @delay_minutes, updated_at = @updated_at WHERE id = @id
  `).run(fields);
  res.json({ report: publicReport(db.prepare("SELECT * FROM bus_reports WHERE id = ?").get(report.id), now) });
});

app.delete("/api/vehicles/:id", writeLimiter, (req, res) => {
  const report = db.prepare("SELECT * FROM bus_reports WHERE id = ?").get(req.params.id);
  if (!report || !authorized(req, report)) return res.status(404).json({ error: "La sesión de ubicación ya no está disponible." });
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
