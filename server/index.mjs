import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { z } from "zod";
import { isWithinRouteCorridor } from "./routeValidation.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const port = Number(process.env.PORT || 4174);
const dbPath = path.resolve(root, process.env.DATABASE_PATH || "./data/busgarraf.sqlite");
const liveForMs = 60 * 1000;
// Keep a stale fix long enough to estimate a full 75-minute trip, including a delay buffer.
// The client stops drawing it once the timetable says the bus should have reached the terminus.
const estimateForMs = 105 * 60 * 1000;
// Absolute safety boundary: never accept or expose a fix more than 50 km from the route geometry.
const maxLocationDistanceFromRouteMeters = 50_000;
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
  CREATE TABLE IF NOT EXISTS delay_reports (
    id TEXT PRIMARY KEY,
    direction TEXT NOT NULL CHECK (direction IN ('to-tarragona', 'to-vilanova')),
    departure_time TEXT NOT NULL,
    delay_minutes INTEGER NOT NULL CHECK (delay_minutes BETWEEN 1 AND 180),
    indefinite INTEGER NOT NULL DEFAULT 0 CHECK (indefinite IN (0, 1)),
    stage TEXT NOT NULL CHECK (stage IN ('not-arrived', 'in-route')),
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS delay_reports_direction_created
    ON delay_reports(direction, created_at);
  CREATE TABLE IF NOT EXISTS bus_share_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('to-tarragona', 'to-vilanova')),
    departure_time TEXT,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    recorded_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS bus_share_history_session_time
    ON bus_share_history(report_id, recorded_at);
  CREATE INDEX IF NOT EXISTS bus_share_history_direction_time
    ON bus_share_history(direction, recorded_at);
  CREATE TABLE IF NOT EXISTS report_flags (
    id TEXT PRIMARY KEY,
    target_type TEXT NOT NULL CHECK (target_type IN ('vehicle', 'delay')),
    target_id TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('inaccurate', 'not-real', 'outdated', 'other')),
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS report_flags_target_time
    ON report_flags(target_type, target_id, created_at);
  CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'moderator', 'analyst')),
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS admin_sessions_expiry ON admin_sessions(expires_at);
  CREATE TABLE IF NOT EXISTS admin_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS analytics_sessions (
    session_hash TEXT PRIMARY KEY,
    visitor_hash TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    landing_path TEXT NOT NULL,
    referrer TEXT NOT NULL,
    campaign_source TEXT NOT NULL,
    campaign_medium TEXT NOT NULL,
    campaign_name TEXT NOT NULL,
    device TEXT NOT NULL,
    browser TEXT NOT NULL,
    operating_system TEXT NOT NULL,
    language TEXT NOT NULL,
    pageviews INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS analytics_sessions_seen ON analytics_sessions(last_seen);
  CREATE INDEX IF NOT EXISTS analytics_sessions_visitor_started ON analytics_sessions(visitor_hash, started_at);
  CREATE TABLE IF NOT EXISTS analytics_pageviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_hash TEXT NOT NULL,
    visitor_hash TEXT NOT NULL,
    path TEXT NOT NULL,
    viewed_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS analytics_anonymous_daily (
    day TEXT NOT NULL,
    path TEXT NOT NULL,
    pageviews INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, path)
  );
  CREATE TABLE IF NOT EXISTS analytics_anonymous_hourly (
    hour INTEGER NOT NULL,
    path TEXT NOT NULL,
    pageviews INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (hour, path)
  );
  CREATE TABLE IF NOT EXISTS analytics_page_transitions_daily (
    day TEXT NOT NULL,
    from_path TEXT NOT NULL,
    to_path TEXT NOT NULL,
    transitions INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, from_path, to_path)
  );
  CREATE INDEX IF NOT EXISTS analytics_pageviews_time ON analytics_pageviews(viewed_at);
  CREATE INDEX IF NOT EXISTS analytics_pageviews_path_time ON analytics_pageviews(path, viewed_at);
`);
if (!db.prepare("PRAGMA table_info(delay_reports)").all().some((column) => column.name === "indefinite")) {
  db.exec("ALTER TABLE delay_reports ADD COLUMN indefinite INTEGER NOT NULL DEFAULT 0 CHECK (indefinite IN (0, 1))");
}
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
const delayLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitHandler("Has enviado varios avisos de retraso. Espera un minuto antes de volver a enviar otro."),
});
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitHandler("Demasiados intentos de acceso. Espera 15 minutos y vuelve a intentarlo."),
});
const adminPasswordLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitHandler("Demasiados intentos de cambio de contraseña. Espera 15 minutos y vuelve a intentarlo."),
});
const analyticsLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitHandler("Demasiados eventos de analítica desde esta conexión."),
});
const flagLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitHandler("Has enviado varios reportes. Espera un minuto antes de volver a intentarlo."),
});
app.use("/api", readLimiter);

const reportInput = z.object({
  direction: directionSchema,
  // Broad corridor bounds discard clearly unrelated/spoofed coordinates.
  // Keep the whole 50 km detour radius inside these geographic sanity bounds.
  latitude: z.number().finite().min(40.55).max(41.75),
  longitude: z.number().finite().min(0.55).max(2.4),
  accuracy: z.number().finite().min(0).max(maxGpsAccuracyMeters).optional(),
  departureTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  occupancy: occupancySchema,
  reinforcement: reinforcementSchema,
  routeDeviationConfirmed: z.boolean().optional(),
});
const createReportInput = reportInput.extend({
  accuracy: z.number().finite().min(0).max(maxGpsAccuracyMeters),
  departureTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});
const delayReportInput = z.object({
  direction: directionSchema,
  departureTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  delayMinutes: z.number().int().min(1).max(180).nullable(),
  stage: z.enum(["not-arrived", "in-route"]),
});
const flagInput = z.object({
  targetType: z.enum(["vehicle", "delay"]),
  targetId: z.string().uuid(),
  reason: z.enum(["inaccurate", "not-real", "outdated", "other"]),
});
const adminLoginInput = z.object({ username: z.string().trim().min(1).max(100), password: z.string().min(1).max(256) });
const analyticsEventInput = z.object({
  visitorId: z.string().uuid(),
  sessionId: z.string().uuid(),
  type: z.enum(["pageview", "heartbeat"]),
  path: z.string().trim().max(120),
  fromPath: z.string().trim().max(120).optional().default(""),
  referrer: z.string().max(2048).optional().default(""),
  campaignSource: z.string().max(64).optional().default(""),
  campaignMedium: z.string().max(64).optional().default(""),
  campaignName: z.string().max(64).optional().default(""),
  language: z.enum(["es", "ca", "en"]).optional().default("es"),
});
const anonymousAnalyticsInput = z.object({ path: z.string().trim().max(120), fromPath: z.string().trim().max(120).optional().default("") });
const adminPasswordInput = z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(12).max(256), confirmPassword: z.string().min(12).max(256) })
  .refine((input) => input.newPassword === input.confirmPassword, { message: "Las contraseñas nuevas no coinciden.", path: ["confirmPassword"] });
const adminResolveInput = z.object({ targetType: z.enum(["vehicle", "delay"]), targetId: z.string().uuid(), action: z.enum(["dismiss", "remove"]) });
const adminUserInput = z.object({ username: z.string().trim().min(3).max(40).regex(/^[\p{L}\p{N}._-]+$/u), role: z.enum(["admin", "moderator", "analyst"]) });
const adminRoleInput = z.object({ role: z.enum(["admin", "moderator", "analyst"]) });

function passwordHash(password, salt = crypto.randomBytes(16)) {
  return `${salt.toString("hex")}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyAdminPassword(password, stored) {
  const [saltHex, hashHex] = String(stored || "").split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const supplied = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

function adminCookieToken(req) {
  const cookies = (req.get("cookie") || "").split(";");
  const field = cookies.map((part) => part.trim()).find((part) => part.startsWith("mapgarraf-admin="));
  return field ? decodeURIComponent(field.slice("mapgarraf-admin=".length)) : "";
}

function adminSessionUser(req) {
  const token = adminCookieToken(req);
  if (!token) return null;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return db.prepare(`SELECT u.id, u.username, u.role FROM admin_sessions s
    JOIN admin_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`).get(tokenHash, Date.now()) || null;
}

function requireAdminRole(role) {
  return (req, res, next) => {
    const user = adminSessionUser(req);
    if (!user) return res.status(401).json({ error: "Inicia sesión en el área de administración." });
    const allowedRoles = Array.isArray(role) ? role : [role];
    if (user.role !== "admin" && !allowedRoles.includes(user.role)) return res.status(403).json({ error: "Tu rol no permite esta acción." });
    req.adminUser = user;
    next();
  };
}

function setAdminCookie(res, token, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `mapgarraf-admin=${token}; Path=/api/admin; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Strict${secure}`);
}

function flagCount(targetType, targetId, now = Date.now()) {
  return db.prepare("SELECT COUNT(*) AS count FROM report_flags WHERE target_type = ? AND target_id = ? AND created_at >= ?")
    .get(targetType, targetId, now - 24 * 60 * 60 * 1000).count;
}

function saveShareHistory(report, now) {
  const previous = db.prepare("SELECT latitude, longitude, recorded_at FROM bus_share_history WHERE report_id = ? ORDER BY recorded_at DESC LIMIT 1").get(report.id);
  if (previous) {
    const age = now - previous.recorded_at;
    const distance = Math.hypot((report.latitude - previous.latitude) * 111_320, (report.longitude - previous.longitude) * 82_000);
    if (age < 30_000 || (age < 5 * 60_000 && distance < 100)) return;
  }
  db.prepare(`INSERT INTO bus_share_history (report_id, direction, departure_time, latitude, longitude, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(report.id, report.direction, report.departure_time, Number(report.latitude.toFixed(3)), Number(report.longitude.toFixed(3)), now);
  db.prepare(`DELETE FROM bus_share_history WHERE id IN (
    SELECT id FROM bus_share_history WHERE report_id = ? ORDER BY recorded_at DESC LIMIT -1 OFFSET 240
  )`).run(report.id);
}

function publicReport(row, now = Date.now(), communityFlagCount = flagCount("vehicle", row.id, now)) {
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
    communityFlagCount,
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

app.post("/api/admin/login", adminLoginLimiter, (req, res) => {
  const input = parseBody(adminLoginInput, req, res);
  if (!input) return;
  const user = db.prepare("SELECT id, username, password_hash, role FROM admin_users WHERE username = ?").get(input.username);
  if (!user || !verifyAdminPassword(input.password, user.password_hash)) {
    return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const now = Date.now();
  const maxAge = 12 * 60 * 60;
  db.prepare("INSERT INTO admin_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(tokenHash, user.id, now + maxAge * 1000, now);
  setAdminCookie(res, token, maxAge);
  res.json({ user: { id: user.id, username: user.username, role: user.role } });
});

app.get("/api/admin/session", (req, res) => {
  const user = adminSessionUser(req);
  if (!user) return res.status(401).json({ error: "Inicia sesión en el área de administración." });
  res.json({ user });
});

app.post("/api/admin/password", adminPasswordLimiter, requireAdminRole(["analyst", "moderator"]), (req, res) => {
  const input = parseBody(adminPasswordInput, req, res);
  if (!input) return;
  const user = db.prepare("SELECT password_hash FROM admin_users WHERE id = ?").get(req.adminUser.id);
  if (!user || !verifyAdminPassword(input.currentPassword, user.password_hash)) {
    return res.status(400).json({ error: "La contraseña actual no es correcta." });
  }
  const token = adminCookieToken(req);
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const now = Date.now();
  db.prepare("UPDATE admin_users SET password_hash = ? WHERE id = ?").run(passwordHash(input.newPassword), req.adminUser.id);
  db.prepare("DELETE FROM admin_sessions WHERE user_id = ? AND token_hash != ?").run(req.adminUser.id, tokenHash);
  db.prepare("INSERT INTO admin_audit_log (actor_id, action, target_type, target_id, created_at) VALUES (?, 'password-change', 'user', ?, ?)")
    .run(req.adminUser.id, req.adminUser.id, now);
  res.json({ message: "Contraseña actualizada." });
});

app.delete("/api/admin/session", (req, res) => {
  const token = adminCookieToken(req);
  if (token) db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(crypto.createHash("sha256").update(token).digest("hex"));
  setAdminCookie(res, "", 0);
  res.status(204).end();
});

function classifyAnalyticsDevice(userAgent) {
  if (/ipad|tablet|kindle|silk/i.test(userAgent)) return "tablet";
  if (/mobile|iphone|ipod|android/i.test(userAgent)) return "mobile";
  return "desktop";
}

function classifyAnalyticsBrowser(userAgent) {
  if (/edg\//i.test(userAgent)) return "Edge";
  if (/firefox\//i.test(userAgent)) return "Firefox";
  if (/samsungbrowser/i.test(userAgent)) return "Samsung Internet";
  if (/opr\//i.test(userAgent)) return "Opera";
  if (/chrome\//i.test(userAgent) && !/chromium/i.test(userAgent)) return "Chrome";
  if (/safari\//i.test(userAgent)) return "Safari";
  return "Other";
}

function classifyAnalyticsOs(userAgent) {
  if (/android/i.test(userAgent)) return "Android";
  if (/iphone|ipad|ipod/i.test(userAgent)) return "iOS";
  if (/windows/i.test(userAgent)) return "Windows";
  if (/macintosh|mac os/i.test(userAgent)) return "macOS";
  if (/linux/i.test(userAgent)) return "Linux";
  return "Other";
}

function cleanAnalyticsLabel(value, fallback = "") {
  return String(value || "").trim().toLowerCase().replace(/[^\p{L}\p{N}._-]/gu, "").slice(0, 64) || fallback;
}

app.post("/api/analytics/events", analyticsLimiter, (req, res) => {
  const input = parseBody(analyticsEventInput, req, res);
  if (!input) return;
  const pathValue = new URL(input.path, "https://mapgarraf.invalid").pathname.replace(/\/+$/, "") || "/";
  const allowedPaths = new Set(["/", "/horarios", "/mapa", "/paradas", "/busgarraf-vilanova-tarragona.html", "/terms.html", "/privacy.html", "/cookies.html"]);
  if (pathValue === "/admin") return res.status(204).end();
  const safePath = allowedPaths.has(pathValue) ? pathValue : "/otros";
  const fromPathValue = input.fromPath ? new URL(input.fromPath, "https://mapgarraf.invalid").pathname.replace(/\/+$/, "") || "/" : "";
  const safeFromPath = allowedPaths.has(fromPathValue) ? fromPathValue : "";
  const visitorHash = crypto.createHash("sha256").update(input.visitorId).digest("hex");
  const sessionHash = crypto.createHash("sha256").update(input.sessionId).digest("hex");
  const userAgent = req.get("user-agent") || "";
  let referrer = "";
  if (input.referrer) {
    try {
      const host = new URL(input.referrer).hostname.toLowerCase().replace(/^www\./, "");
      if (host && host !== (req.hostname || "").toLowerCase()) referrer = host.slice(0, 120);
    } catch { /* Do not retain malformed referrers. */ }
  }
  const campaignSource = cleanAnalyticsLabel(input.campaignSource, referrer || "direct");
  const campaignMedium = cleanAnalyticsLabel(input.campaignMedium, "none");
  const campaignName = cleanAnalyticsLabel(input.campaignName, "none");
  const now = Date.now();
  db.prepare(`INSERT INTO analytics_sessions (
    session_hash, visitor_hash, started_at, last_seen, landing_path, referrer,
    campaign_source, campaign_medium, campaign_name, device, browser, operating_system, language, pageviews
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  ON CONFLICT(session_hash) DO UPDATE SET last_seen = excluded.last_seen`)
    .run(sessionHash, visitorHash, now, now, safePath, referrer || "direct", campaignSource, campaignMedium, campaignName,
      classifyAnalyticsDevice(userAgent), classifyAnalyticsBrowser(userAgent), classifyAnalyticsOs(userAgent), input.language);
  if (input.type === "pageview") {
    db.prepare("INSERT INTO analytics_pageviews (session_hash, visitor_hash, path, viewed_at) VALUES (?, ?, ?, ?)")
      .run(sessionHash, visitorHash, safePath, now);
    if (safeFromPath && safeFromPath !== safePath) {
      db.prepare(`INSERT INTO analytics_page_transitions_daily (day, from_path, to_path, transitions) VALUES (?, ?, ?, 1)
        ON CONFLICT(day, from_path, to_path) DO UPDATE SET transitions = transitions + 1`)
        .run(new Date(now).toISOString().slice(0, 10), safeFromPath, safePath);
    }
    db.prepare("UPDATE analytics_sessions SET pageviews = pageviews + 1, last_seen = ? WHERE session_hash = ?").run(now, sessionHash);
  }
  res.status(204).end();
});

// Minimal audience counting for visitors who decline optional analytics: only a
// page path and UTC day are retained, with no visitor/session identifiers.
app.post("/api/analytics/anonymous-pageview", analyticsLimiter, (req, res) => {
  const input = parseBody(anonymousAnalyticsInput, req, res);
  if (!input) return;
  const pathValue = new URL(input.path, "https://mapgarraf.invalid").pathname.replace(/\/+$/, "") || "/";
  if (pathValue === "/admin") return res.status(204).end();
  const allowedPaths = new Set(["/", "/horarios", "/mapa", "/paradas", "/busgarraf-vilanova-tarragona.html", "/terms.html", "/privacy.html", "/cookies.html"]);
  const safePath = allowedPaths.has(pathValue) ? pathValue : "/otros";
  const fromPathValue = input.fromPath ? new URL(input.fromPath, "https://mapgarraf.invalid").pathname.replace(/\/+$/, "") || "/" : "";
  const safeFromPath = allowedPaths.has(fromPathValue) ? fromPathValue : "";
  const day = new Date().toISOString().slice(0, 10);
  const hour = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  db.prepare(`INSERT INTO analytics_anonymous_daily (day, path, pageviews) VALUES (?, ?, 1)
    ON CONFLICT(day, path) DO UPDATE SET pageviews = pageviews + 1`).run(day, safePath);
  db.prepare(`INSERT INTO analytics_anonymous_hourly (hour, path, pageviews) VALUES (?, ?, 1)
    ON CONFLICT(hour, path) DO UPDATE SET pageviews = pageviews + 1`).run(hour, safePath);
  if (safeFromPath && safeFromPath !== safePath) {
    db.prepare(`INSERT INTO analytics_page_transitions_daily (day, from_path, to_path, transitions) VALUES (?, ?, ?, 1)
      ON CONFLICT(day, from_path, to_path) DO UPDATE SET transitions = transitions + 1`)
      .run(day, safeFromPath, safePath);
  }
  res.status(204).end();
});

app.post("/api/analytics/anonymize/:visitorId", analyticsLimiter, (req, res) => {
  const parsed = z.string().uuid().safeParse(req.params.visitorId);
  if (!parsed.success) return res.status(400).json({ error: "Identificador de analítica no válido." });
  const visitorHash = crypto.createHash("sha256").update(parsed.data).digest("hex");
  const hourMs = 60 * 60 * 1000;
  const anonymizeVisitor = db.transaction(() => {
    const sessions = db.prepare("SELECT session_hash, started_at, last_seen FROM analytics_sessions WHERE visitor_hash = ?").all(visitorHash);
    const updateSession = db.prepare(`UPDATE analytics_sessions SET session_hash = ?, visitor_hash = '',
      started_at = ?, last_seen = ?, landing_path = '/otros', referrer = 'anonymized',
      campaign_source = 'anonymized', campaign_medium = 'anonymized', campaign_name = 'anonymized',
      device = 'anonymized', browser = 'anonymized', operating_system = 'anonymized', language = 'unknown'
      WHERE session_hash = ?`);
    const updatePageview = db.prepare(`UPDATE analytics_pageviews SET session_hash = ?, visitor_hash = '',
      path = '/otros', viewed_at = ? WHERE id = ?`);
    for (const session of sessions) {
      const roundedStart = Math.floor(session.started_at / hourMs) * hourMs;
      const durationMs = Math.max(0, session.last_seen - session.started_at);
      const roundedDuration = Math.round(durationMs / (15 * 60 * 1000)) * 15 * 60 * 1000;
      updateSession.run(crypto.randomBytes(32).toString("hex"), roundedStart, roundedStart + roundedDuration, session.session_hash);
      const pageviews = db.prepare("SELECT id, viewed_at FROM analytics_pageviews WHERE session_hash = ?").all(session.session_hash);
      for (const pageview of pageviews) {
        updatePageview.run(crypto.randomBytes(32).toString("hex"), Math.floor(pageview.viewed_at / hourMs) * hourMs, pageview.id);
      }
    }
    // Legacy/orphan events are retained too, but no longer linked to the browser or each other.
    const orphanPageviews = db.prepare("SELECT id, viewed_at FROM analytics_pageviews WHERE visitor_hash = ?").all(visitorHash);
    for (const pageview of orphanPageviews) {
      updatePageview.run(crypto.randomBytes(32).toString("hex"), Math.floor(pageview.viewed_at / hourMs) * hourMs, pageview.id);
    }
  });
  anonymizeVisitor();
  res.status(204).end();
});

app.get("/api/admin/analytics", requireAdminRole("analyst"), (_req, res) => {
  const now = Date.now();
  const cutoffs = { h24: now - 24 * 60 * 60 * 1000, d7: now - 7 * 24 * 60 * 60 * 1000, d30: now - 30 * 24 * 60 * 60 * 1000 };
  const visitors = Object.fromEntries(Object.entries(cutoffs).map(([key, cutoff]) => [key,
    db.prepare("SELECT COUNT(DISTINCT visitor_hash) AS count FROM analytics_sessions WHERE last_seen >= ? AND visitor_hash <> ''").get(cutoff).count]));
  const sessions = Object.fromEntries(Object.entries(cutoffs).map(([key, cutoff]) => [key,
    db.prepare("SELECT COUNT(*) AS count FROM analytics_sessions WHERE started_at >= ?").get(cutoff).count]));
  const pageviews = Object.fromEntries(Object.entries(cutoffs).map(([key, cutoff]) => [key,
    db.prepare("SELECT (SELECT COUNT(*) FROM analytics_pageviews WHERE viewed_at >= ?) + (SELECT COALESCE(SUM(pageviews), 0) FROM analytics_anonymous_hourly WHERE hour >= ?) AS count")
      .get(cutoff, cutoff).count]));
  const online = db.prepare("SELECT COUNT(DISTINCT visitor_hash) AS visitors, COUNT(*) AS sessions FROM analytics_sessions WHERE last_seen >= ? AND visitor_hash <> ''")
    .get(now - 2 * 60 * 1000);
  const averages = db.prepare(`SELECT ROUND(AVG(pageviews), 1) AS pagesPerSession,
      ROUND(AVG(MIN(MAX(last_seen - started_at, 0) / 1000, 7200))) AS avgSessionSeconds,
      ROUND(100.0 * SUM(CASE WHEN pageviews <= 1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS onePageSessions
    FROM analytics_sessions WHERE started_at >= ?`).get(cutoffs.d30);
  const dailyOptIn = db.prepare(`SELECT date(viewed_at / 1000, 'unixepoch') AS day, COUNT(*) AS pageviews,
      COUNT(DISTINCT CASE WHEN visitor_hash <> '' THEN visitor_hash END) AS visitors FROM analytics_pageviews WHERE viewed_at >= ?
    GROUP BY day ORDER BY day`).all(cutoffs.d30);
  const dailyAnonymous = db.prepare("SELECT day, SUM(pageviews) AS pageviews FROM analytics_anonymous_daily WHERE day >= date(? / 1000, 'unixepoch') GROUP BY day").all(cutoffs.d30);
  const dailyByDate = new Map(dailyOptIn.map((item) => [item.day, { ...item }]));
  for (const item of dailyAnonymous) {
    const aggregate = dailyByDate.get(item.day) || { day: item.day, pageviews: 0, visitors: 0 };
    aggregate.pageviews += item.pageviews;
    dailyByDate.set(item.day, aggregate);
  }
  const daily = [...dailyByDate.values()].sort((a, b) => a.day.localeCompare(b.day));
  const topPagesOptIn = db.prepare(`SELECT path, COUNT(*) AS views, COUNT(DISTINCT CASE WHEN visitor_hash <> '' THEN visitor_hash END) AS visitors
    FROM analytics_pageviews WHERE viewed_at >= ? GROUP BY path ORDER BY views DESC LIMIT 12`).all(cutoffs.d30);
  const topPagesAnonymous = db.prepare("SELECT path, pageviews AS views, 0 AS visitors FROM analytics_anonymous_daily WHERE day >= date(? / 1000, 'unixepoch')").all(cutoffs.d30);
  const topPagesByPath = new Map();
  for (const item of [...topPagesOptIn, ...topPagesAnonymous]) {
    const aggregate = topPagesByPath.get(item.path) || { path: item.path, views: 0, visitors: 0 };
    aggregate.views += item.views;
    aggregate.visitors += item.visitors;
    topPagesByPath.set(item.path, aggregate);
  }
  const topPages = [...topPagesByPath.values()].sort((a, b) => b.views - a.views).slice(0, 12);
  const transitions = db.prepare(`SELECT from_path AS fromPath, to_path AS toPath, SUM(transitions) AS count
    FROM analytics_page_transitions_daily WHERE day >= date(? / 1000, 'unixepoch')
    GROUP BY from_path, to_path ORDER BY count DESC LIMIT 20`).all(cutoffs.d30);
  const sources = db.prepare(`SELECT campaign_source AS source, campaign_medium AS medium, COUNT(*) AS sessions,
      COUNT(DISTINCT CASE WHEN visitor_hash <> '' THEN visitor_hash END) AS visitors FROM analytics_sessions WHERE started_at >= ?
    GROUP BY source, medium ORDER BY sessions DESC LIMIT 12`).all(cutoffs.d30);
  const breakdown = (field) => db.prepare(`SELECT ${field} AS name, COUNT(*) AS sessions,
      COUNT(DISTINCT CASE WHEN visitor_hash <> '' THEN visitor_hash END) AS visitors FROM analytics_sessions WHERE started_at >= ?
    GROUP BY ${field} ORDER BY sessions DESC LIMIT 10`).all(cutoffs.d30);
  const hours = db.prepare(`SELECT CAST(strftime('%H', viewed_at / 1000, 'unixepoch') AS INTEGER) AS hour,
      COUNT(*) AS views FROM analytics_pageviews WHERE viewed_at >= ? GROUP BY hour ORDER BY hour`).all(cutoffs.d30);
  res.json({
    retentionDays: 30,
    online: { visitors: online.visitors, sessions: online.sessions, activeWindowSeconds: 120 },
    visitors, sessions, pageviews,
    averages: { pagesPerSession: averages.pagesPerSession ?? 0, avgSessionSeconds: averages.avgSessionSeconds ?? 0, onePageSessions: averages.onePageSessions ?? 0 },
    daily, topPages, transitions, sources, devices: breakdown("device"), browsers: breakdown("browser"), operatingSystems: breakdown("operating_system"), languages: breakdown("language"), hours,
  });
});

app.get("/api/admin/dashboard", requireAdminRole(["analyst", "moderator"]), (req, res) => {
  const now = Date.now();
  const last24h = now - 24 * 60 * 60 * 1000;
  const activeVehicles = db.prepare("SELECT COUNT(*) AS count FROM bus_reports WHERE updated_at >= ?").get(now - estimateForMs).count;
  const liveVehicles = db.prepare("SELECT COUNT(*) AS count FROM bus_reports WHERE updated_at >= ?").get(now - liveForMs).count;
  const delayAlerts = db.prepare("SELECT COUNT(*) AS count FROM delay_reports WHERE created_at >= ?").get(now - 120 * 60 * 1000).count;
  const busShares24h = db.prepare("SELECT COUNT(*) AS count FROM bus_reports WHERE created_at >= ?").get(last24h).count;
  const delayReports24h = db.prepare("SELECT COUNT(*) AS count FROM delay_reports WHERE created_at >= ?").get(last24h).count;
  const locationPoints24h = db.prepare("SELECT COUNT(*) AS count FROM bus_share_history WHERE recorded_at >= ?").get(last24h).count;
  const openFlagGroups = db.prepare(`SELECT COUNT(*) AS count FROM (
    SELECT 1 FROM report_flags WHERE created_at >= ? GROUP BY target_type, target_id
  )`).get(last24h).count;
  const audit = db.prepare(`SELECT action, target_type AS targetType, target_id AS targetId, created_at AS createdAt
    FROM admin_audit_log ORDER BY created_at DESC LIMIT 20`).all()
    .map((item) => ({ ...item, createdAt: new Date(item.createdAt).toISOString() }));
  res.json({ stats: { activeVehicles, liveVehicles, delayAlerts, busShares24h, delayReports24h, locationPoints24h, openFlagGroups }, audit });
});

app.get("/api/admin/users", requireAdminRole("admin"), (_req, res) => {
  const users = db.prepare("SELECT id, username, role, created_at AS createdAt FROM admin_users ORDER BY created_at ASC")
    .all().map((user) => ({ ...user, createdAt: new Date(user.createdAt).toISOString() }));
  res.json({ users });
});

app.post("/api/admin/users", requireAdminRole("admin"), (req, res) => {
  const input = parseBody(adminUserInput, req, res);
  if (!input) return;
  const id = crypto.randomUUID();
  const initialPassword = crypto.randomBytes(32).toString("base64url");
  try {
    db.prepare("INSERT INTO admin_users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, input.username, passwordHash(initialPassword), input.role, Date.now());
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "Ya existe una cuenta con ese usuario." });
    throw error;
  }
  db.prepare("INSERT INTO admin_audit_log (actor_id, action, target_type, target_id, created_at) VALUES (?, 'user-create', 'user', ?, ?)")
    .run(req.adminUser.id, id, Date.now());
  res.status(201).json({ user: { id, username: input.username, role: input.role }, initialPassword });
});

app.patch("/api/admin/users/:id", requireAdminRole("admin"), (req, res) => {
  const input = parseBody(adminRoleInput, req, res);
  if (!input) return;
  const target = db.prepare("SELECT id, role FROM admin_users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "La cuenta no existe." });
  if (target.role === "admin" && input.role !== "admin") {
    const adminCount = db.prepare("SELECT COUNT(*) AS count FROM admin_users WHERE role = 'admin'").get().count;
    if (adminCount <= 1) return res.status(409).json({ error: "Debe quedar al menos una cuenta administradora." });
  }
  db.prepare("UPDATE admin_users SET role = ? WHERE id = ?").run(input.role, target.id);
  db.prepare("INSERT INTO admin_audit_log (actor_id, action, target_type, target_id, created_at) VALUES (?, 'user-role', 'user', ?, ?)")
    .run(req.adminUser.id, target.id, Date.now());
  res.json({ ok: true, role: input.role });
});

app.delete("/api/admin/users/:id", requireAdminRole("admin"), (req, res) => {
  const target = db.prepare("SELECT id, role FROM admin_users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "La cuenta no existe." });
  if (target.id === req.adminUser.id) return res.status(400).json({ error: "No puedes eliminar la cuenta con la que has iniciado sesión." });
  if (target.role === "admin" && db.prepare("SELECT COUNT(*) AS count FROM admin_users WHERE role = 'admin'").get().count <= 1) {
    return res.status(409).json({ error: "Debe quedar al menos una cuenta administradora." });
  }
  db.prepare("DELETE FROM admin_users WHERE id = ?").run(target.id);
  db.prepare("INSERT INTO admin_audit_log (actor_id, action, target_type, target_id, created_at) VALUES (?, 'user-delete', 'user', ?, ?)")
    .run(req.adminUser.id, target.id, Date.now());
  res.status(204).end();
});

app.get("/api/admin/flags", requireAdminRole("moderator"), (req, res) => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const groups = db.prepare(`SELECT target_type AS targetType, target_id AS targetId, COUNT(*) AS flagCount,
    GROUP_CONCAT(reason) AS reasons, MAX(created_at) AS lastFlagAt
    FROM report_flags WHERE created_at >= ? GROUP BY target_type, target_id
    ORDER BY lastFlagAt DESC LIMIT 200`).all(cutoff);
  const flags = groups.map((group) => {
    if (group.targetType === "delay") {
      const delay = db.prepare(`SELECT id, direction, departure_time AS departureTime,
        CASE WHEN indefinite = 1 THEN NULL ELSE delay_minutes END AS delayMinutes, stage, created_at AS createdAt
        FROM delay_reports WHERE id = ?`).get(group.targetId) || null;
      return { ...group, reasons: group.reasons.split(","), target: delay };
    }
    const vehicle = db.prepare("SELECT * FROM bus_reports WHERE id = ?").get(group.targetId);
    const history = db.prepare(`SELECT direction, departure_time AS departureTime, latitude, longitude, recorded_at AS recordedAt
      FROM bus_share_history WHERE report_id = ? ORDER BY recorded_at DESC LIMIT 1`).get(group.targetId) || null;
    return { ...group, reasons: group.reasons.split(","), target: vehicle ? publicReport(vehicle) : history };
  });
  res.json({ flags });
});

app.post("/api/admin/flags/resolve", requireAdminRole("moderator"), (req, res) => {
  const input = parseBody(adminResolveInput, req, res);
  if (!input) return;
  const now = Date.now();
  if (input.action === "remove") {
    if (input.targetType === "vehicle") {
      db.prepare("DELETE FROM bus_reports WHERE id = ?").run(input.targetId);
      db.prepare("DELETE FROM bus_share_history WHERE report_id = ?").run(input.targetId);
    } else db.prepare("DELETE FROM delay_reports WHERE id = ?").run(input.targetId);
  }
  db.prepare("DELETE FROM report_flags WHERE target_type = ? AND target_id = ?").run(input.targetType, input.targetId);
  db.prepare(`INSERT INTO admin_audit_log (actor_id, action, target_type, target_id, created_at)
    VALUES (?, ?, ?, ?, ?)`)
    .run(req.adminUser.id, input.action, input.targetType, input.targetId, now);
  res.json({ ok: true });
});

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
  const reports = rows
    .filter((row) => isWithinRouteCorridor(row.latitude, row.longitude, row.direction, maxLocationDistanceFromRouteMeters))
    .map((row) => publicReport(row, now));
  res.json({ reports, liveForSeconds: liveForMs / 1000, estimateForSeconds: estimateForMs / 1000 });
});

app.get("/api/share-history", (req, res) => {
  const direction = directionSchema.safeParse(req.query.direction);
  if (!direction.success) return res.status(400).json({ error: "Indica un sentido válido." });
  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;
  const sessions = db.prepare(`SELECT report_id AS reportId, departure_time AS departureTime,
    MIN(recorded_at) AS firstSeen, MAX(recorded_at) AS lastSeen
    FROM bus_share_history WHERE direction = ? AND recorded_at >= ?
    GROUP BY report_id ORDER BY lastSeen DESC LIMIT 40`).all(direction.data, cutoff);
  const points = sessions.length ? db.prepare(`SELECT report_id AS reportId, latitude, longitude, recorded_at AS recordedAt
    FROM bus_share_history WHERE recorded_at >= ? AND report_id IN (${sessions.map(() => "?").join(",")})
    ORDER BY recorded_at ASC`).all(cutoff, ...sessions.map((session) => session.reportId)) : [];
  const bySession = new Map();
  for (const point of points) {
    const list = bySession.get(point.reportId) || [];
    list.push({ latitude: point.latitude, longitude: point.longitude, recordedAt: new Date(point.recordedAt).toISOString() });
    bySession.set(point.reportId, list);
  }
  const visibleSessions = sessions.map((session) => {
    const visiblePoints = (bySession.get(session.reportId) || []).filter((point) =>
      isWithinRouteCorridor(point.latitude, point.longitude, direction.data, maxLocationDistanceFromRouteMeters));
    if (!visiblePoints.length) return null;
    return {
      ...session,
      firstSeen: visiblePoints[0].recordedAt,
      lastSeen: visiblePoints[visiblePoints.length - 1].recordedAt,
      communityFlagCount: flagCount("vehicle", session.reportId, now),
      points: visiblePoints,
    };
  }).filter(Boolean);
  res.json({ retentionHours: 24, sessions: visibleSessions });
});

app.post("/api/flags", flagLimiter, writeLimiter, (req, res) => {
  const input = parseBody(flagInput, req, res);
  if (!input) return;
  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;
  const exists = input.targetType === "vehicle"
    ? Boolean(db.prepare("SELECT 1 FROM bus_reports WHERE id = ? UNION SELECT 1 FROM bus_share_history WHERE report_id = ? AND recorded_at >= ? LIMIT 1").get(input.targetId, input.targetId, cutoff))
    : Boolean(db.prepare("SELECT 1 FROM delay_reports WHERE id = ? AND created_at >= ?").get(input.targetId, cutoff));
  if (!exists) return res.status(404).json({ error: "Este aviso ya no está disponible para reportarlo." });
  db.prepare("INSERT INTO report_flags (id, target_type, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(crypto.randomUUID(), input.targetType, input.targetId, input.reason, now);
  res.status(201).json({ communityFlagCount: flagCount(input.targetType, input.targetId, now) });
});

app.get("/api/delays", (req, res) => {
  const direction = directionSchema.safeParse(req.query.direction);
  if (!direction.success) return res.status(400).json({ error: "Indica un sentido válido." });
  const now = Date.now();
  const maxAge = 120 * 60 * 1000;
  db.prepare("DELETE FROM delay_reports WHERE created_at < ?").run(now - 24 * 60 * 60 * 1000);
  const reports = db.prepare(`
    SELECT id, direction, departure_time AS departureTime, CASE WHEN indefinite = 1 THEN NULL ELSE delay_minutes END AS delayMinutes, stage, created_at AS createdAt,
      (SELECT COUNT(*) FROM report_flags f WHERE f.target_type = 'delay' AND f.target_id = delay_reports.id AND f.created_at >= ?) AS communityFlagCount
    FROM delay_reports WHERE direction = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 300
  `).all(now - 24 * 60 * 60 * 1000, direction.data, now - maxAge).map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() }));
  res.json({ reports, activeForSeconds: maxAge / 1000 });
});

app.post("/api/delays", delayLimiter, writeLimiter, (req, res) => {
  const input = parseBody(delayReportInput, req, res);
  if (!input) return;
  const now = Date.now();
  db.prepare("DELETE FROM delay_reports WHERE created_at < ?").run(now - 24 * 60 * 60 * 1000);
  const activeCount = db.prepare("SELECT COUNT(*) AS count FROM delay_reports WHERE created_at >= ?").get(now - 120 * 60 * 1000).count;
  if (activeCount >= 500) return res.status(429).json({ error: "Hay muchos avisos activos. Inténtalo de nuevo más tarde." });
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO delay_reports (id, direction, departure_time, delay_minutes, indefinite, stage, created_at)
    VALUES (@id, @direction, @departure_time, @delay_minutes, @indefinite, @stage, @created_at)`)
    .run({ id, direction: input.direction, departure_time: input.departureTime, delay_minutes: input.delayMinutes ?? 1, indefinite: input.delayMinutes === null ? 1 : 0, stage: input.stage, created_at: now });
  res.status(201).json({ report: { id, direction: input.direction, departureTime: input.departureTime, delayMinutes: input.delayMinutes, stage: input.stage, createdAt: new Date(now).toISOString() } });
});

app.post("/api/vehicles", createLimiter, writeLimiter, (req, res) => {
  const input = parseBody(createReportInput, req, res);
  if (!input) return;
  if (!isWithinRouteCorridor(input.latitude, input.longitude, input.direction, maxLocationDistanceFromRouteMeters)) {
    return res.status(400).json({ error: "No se acepta una ubicación a más de 50 km del recorrido del bus.", code: "LOCATION_TOO_FAR" });
  }
  const withinRoute = isWithinRouteCorridor(input.latitude, input.longitude, input.direction);
  const withinConfirmedDetour = input.routeDeviationConfirmed && isWithinRouteCorridor(input.latitude, input.longitude, input.direction, maxLocationDistanceFromRouteMeters);
  if (!withinRoute && !withinConfirmedDetour) {
    return res.status(400).json({ error: input.routeDeviationConfirmed ? "La ubicación queda a más de 50 km del recorrido y no se puede mostrar." : "La ubicación queda fuera del recorrido habitual.", code: input.routeDeviationConfirmed ? "LOCATION_TOO_FAR" : "LOCATION_OFF_ROUTE" });
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
  saveShareHistory(row, now);
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
    if (!isWithinRouteCorridor(input.latitude, input.longitude, report.direction, maxLocationDistanceFromRouteMeters)) {
      return res.status(400).json({ error: "No se acepta una ubicación a más de 50 km del recorrido del bus.", code: "LOCATION_TOO_FAR" });
    }
    const withinRoute = isWithinRouteCorridor(input.latitude, input.longitude, report.direction);
    const withinConfirmedDetour = input.routeDeviationConfirmed && isWithinRouteCorridor(input.latitude, input.longitude, report.direction, maxLocationDistanceFromRouteMeters);
    if (!withinRoute && !withinConfirmedDetour) {
      return res.status(400).json({ error: input.routeDeviationConfirmed ? "La ubicación queda a más de 50 km del recorrido y no se puede mostrar." : "La ubicación queda fuera del recorrido habitual.", code: input.routeDeviationConfirmed ? "LOCATION_TOO_FAR" : "LOCATION_OFF_ROUTE" });
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
  const updated = db.prepare("SELECT * FROM bus_reports WHERE id = ?").get(report.id);
  if (input.latitude !== undefined) saveShareHistory(updated, now);
  res.json({ report: publicReport(updated, now) });
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
db.prepare("DELETE FROM delay_reports WHERE created_at < ?").run(Date.now() - 24 * 60 * 60 * 1000);
db.prepare("DELETE FROM bus_share_history WHERE recorded_at < ?").run(Date.now() - 24 * 60 * 60 * 1000);
db.prepare("DELETE FROM report_flags WHERE created_at < ?").run(Date.now() - 24 * 60 * 60 * 1000);
db.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").run(Date.now());
db.prepare("DELETE FROM admin_audit_log WHERE created_at < ?").run(Date.now() - 180 * 24 * 60 * 60 * 1000);
const cleanupTimer = setInterval(() => {
  db.prepare("DELETE FROM bus_reports WHERE updated_at < ?").run(Date.now() - 24 * 60 * 60 * 1000);
  db.prepare("DELETE FROM delay_reports WHERE created_at < ?").run(Date.now() - 24 * 60 * 60 * 1000);
  db.prepare("DELETE FROM bus_share_history WHERE recorded_at < ?").run(Date.now() - 24 * 60 * 60 * 1000);
  db.prepare("DELETE FROM report_flags WHERE created_at < ?").run(Date.now() - 24 * 60 * 60 * 1000);
  db.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").run(Date.now());
  db.prepare("DELETE FROM admin_audit_log WHERE created_at < ?").run(Date.now() - 180 * 24 * 60 * 60 * 1000);
  db.prepare("DELETE FROM analytics_pageviews WHERE viewed_at < ?").run(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const analyticsCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  db.prepare("DELETE FROM analytics_sessions WHERE started_at < ? OR last_seen < ?").run(analyticsCutoff, analyticsCutoff);
  db.prepare("DELETE FROM analytics_anonymous_daily WHERE day < date(? / 1000, 'unixepoch')").run(analyticsCutoff);
  db.prepare("DELETE FROM analytics_anonymous_hourly WHERE hour < ?").run(analyticsCutoff);
  db.prepare("DELETE FROM analytics_page_transitions_daily WHERE day < date(? / 1000, 'unixepoch')").run(analyticsCutoff);
}, 60 * 1000);
cleanupTimer.unref();

const dist = path.join(root, "dist");
const legalSeo = {
  terms: {
    title: "Condiciones de uso | MapGarraf",
    description: "Condiciones de uso de MapGarraf, herramienta comunitaria independiente para viajeros del BusGarraf.",
  },
  privacy: {
    title: "Política de privacidad | MapGarraf",
    description: "Información sobre los datos de ubicación y los avisos comunitarios tratados por MapGarraf.",
  },
  cookies: {
    title: "Política de cookies | MapGarraf",
    description: "Información sobre las cookies necesarias y las cookies analíticas opcionales de MapGarraf.",
  },
};
const sectionSeo = {
  "/horarios": {
    title: "Horarios BusGarraf Vilanova–Tarragona | MapGarraf",
    description: "Consulta los horarios publicados del autobús BusGarraf entre Vilanova i la Geltrú y Tarragona y las horas de paso por parada.",
  },
  "/mapa": {
    title: "Mapa BusGarraf Vilanova–Tarragona | MapGarraf",
    description: "Consulta en el mapa las últimas ubicaciones compartidas, los avisos de retraso y las llegadas estimadas del BusGarraf. Información comunitaria no oficial.",
  },
  "/paradas": {
    title: "Paradas BusGarraf: Vilanova, Cubelles y Tarragona | MapGarraf",
    description: "Explora las 16 paradas del autobús BusGarraf entre Vilanova, Cubelles, Cunit, Calafell, El Vendrell y Tarragona.",
  },
};

function htmlAttribute(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

if (fs.existsSync(path.join(dist, "index.html"))) {
  app.get("/busgarraf-vilanova-tarragona.html", (_req, res, next) => {
    const guidePath = path.join(dist, "busgarraf-vilanova-tarragona.html");
    const assetsPath = path.join(dist, "assets");
    if (!fs.existsSync(guidePath) || !fs.existsSync(assetsPath)) return next();
    const stylesheet = fs.readdirSync(assetsPath).find((file) => file.endsWith(".css"));
    if (!stylesheet) return next();
    const cssLink = `<link rel="stylesheet" href="/assets/${stylesheet}">`;
    const html = fs.readFileSync(guidePath, "utf8").replace("<!-- MAPGARRAF-STYLES -->", cssLink);
    res.setHeader("Cache-Control", "no-cache");
    return res.type("html").send(html);
  });
  app.use(express.static(dist, { index: false, maxAge: "1h", setHeaders: (res, filename) => {
    if (filename.endsWith("index.html") || filename.endsWith("sw.js") || filename.endsWith("manifest.webmanifest") || filename.endsWith("cookie-consent.js")) {
      res.setHeader("Cache-Control", "no-cache");
    }
  } }));
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path === "/health") return next();
    const routePath = req.path.replace(/\/+$/, "") || "/";
    if (routePath === "/admin") res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    const legalKey = routePath.match(/^\/(terms|privacy|cookies)(?:\.html)?$/)?.[1];
    const seo = legalKey ? legalSeo[legalKey] : sectionSeo[routePath];
    if (seo) {
      const canonicalPath = legalKey ? `/${legalKey}.html` : routePath;
      const canonical = `https://bus.nekokoneko.org${canonicalPath}`;
      let html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
      html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${htmlAttribute(seo.title)}</title>`);
      html = html.replace(/<meta name="description" content="[^"]*"\s*\/?\s*>/i, `<meta name="description" content="${htmlAttribute(seo.description)}" />`);
      html = html.replace(/<link rel="canonical" href="[^"]*"\s*\/?\s*>/i, `<link rel="canonical" href="${canonical}" />`);
      html = html.replace(/<meta property="og:url" content="[^"]*"\s*\/?\s*>/i, `<meta property="og:url" content="${canonical}" />`);
      html = html.replace(/<meta property="og:title" content="[^"]*"\s*\/?\s*>/i, `<meta property="og:title" content="${htmlAttribute(seo.title)}" />`);
      html = html.replace(/<meta property="og:description" content="[^"]*"\s*\/?\s*>/i, `<meta property="og:description" content="${htmlAttribute(seo.description)}" />`);
      html = html.replace(/<meta name="twitter:title" content="[^"]*"\s*\/?\s*>/i, `<meta name="twitter:title" content="${htmlAttribute(seo.title)}" />`);
      html = html.replace(/<meta name="twitter:description" content="[^"]*"\s*\/?\s*>/i, `<meta name="twitter:description" content="${htmlAttribute(seo.description)}" />`);
      res.setHeader("Cache-Control", "no-cache");
      return res.type("html").send(html);
    }
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
