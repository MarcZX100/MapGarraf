import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { after, before, test } from "node:test";
import Database from "better-sqlite3";
import { isPlausibleMovement, isWithinRouteCorridor } from "../server/routeValidation.mjs";

let tempDirectory;
let databasePath;
let baseUrl;
let server;

async function unusedPort() {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

before(async () => {
  tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mapgarraf-security-test-"));
  databasePath = path.join(tempDirectory, "synthetic.sqlite");
  const port = await unusedPort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["server/index.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_PATH: databasePath,
      TRUST_PROXY: "0",
      NODE_ENV: "production",
      MAX_ACTIVE_REPORTS_PER_DIRECTION: "1",
    },
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Temporary API exited with code ${server.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch { /* wait for the isolated server to bind */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Temporary API did not become ready");
});

after(async () => {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([once(server, "exit"), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  }
  if (tempDirectory) fs.rmSync(tempDirectory, { recursive: true, force: true });
});

test("route corridor and speed checks reject implausible synthetic points", () => {
  assert.equal(isWithinRouteCorridor(41.22038084744236, 1.7305158618556, "to-tarragona"), true);
  assert.equal(isWithinRouteCorridor(41.06, 1.19, "to-tarragona"), false);
  assert.equal(isPlausibleMovement(
    { latitude: 41.2204, longitude: 1.7305, accuracy: 50 },
    { latitude: 41.1183, longitude: 1.2444, accuracy: 50 },
    1,
  ), false);
  assert.equal(isPlausibleMovement(
    { latitude: 41.2204, longitude: 1.7305, accuracy: 50 },
    { latitude: 41.1183, longitude: 1.2444, accuracy: 50 },
    6 * 60,
  ), false);
});

test("API validates contributions, protects owner actions, limits active reports and rounds stale GPS", async () => {
  const start = { latitude: 41.22038084744236, longitude: 1.7305158618556 };
  const payload = {
    direction: "to-tarragona",
    ...start,
    accuracy: 50,
    departureTime: "08:15",
    occupancy: null,
    reinforcement: false,
  };

  let response = await fetch(`${baseUrl}/api/vehicles`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, latitude: 41.06, longitude: 1.19 }),
  });
  assert.equal(response.status, 400, "off-route coordinate is rejected");

  response = await fetch(`${baseUrl}/api/vehicles`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, accuracy: 1_001 }),
  });
  assert.equal(response.status, 400, "poor GPS accuracy is rejected");

  response = await fetch(`${baseUrl}/api/vehicles`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(response.status, 201);
  const created = await response.json();
  const { id } = created.report;
  const token = created.shareToken;
  assert.equal(typeof token, "string");
  assert.equal(token.length, 43);
  assert.equal("token_hash" in created.report, false);

  response = await fetch(`${baseUrl}/api/vehicles?direction=to-tarragona`);
  let listing = await response.json();
  const liveReport = listing.reports.find((report) => report.id === id);
  assert.equal(liveReport.latitude, start.latitude, "live position stays precise");
  assert.equal(JSON.stringify(listing).includes(token), false, "public API does not expose share token");

  response = await fetch(`${baseUrl}/api/vehicles`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(response.status, 429, "active report quota prevents unbounded visible rows");

  response = await fetch(`${baseUrl}/api/vehicles/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-share-token": "wrong-synthetic-token" },
    body: JSON.stringify({ reinforcement: true }),
  });
  assert.equal(response.status, 404, "wrong token cannot update");

  response = await fetch(`${baseUrl}/api/vehicles/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-share-token": token },
    body: JSON.stringify({ latitude: 41.11827071362793, longitude: 1.2444282045126236, accuracy: 50 }),
  });
  assert.equal(response.status, 400, "impossible location jump is rejected");

  response = await fetch(`${baseUrl}/api/vehicles/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-share-token": token },
    body: JSON.stringify({ reinforcement: true, occupancy: "medium" }),
  });
  assert.equal(response.status, 200, "owner can update optional fields");

  const testDb = new Database(databasePath);
  testDb.prepare("UPDATE bus_reports SET updated_at = ? WHERE id = ?").run(Date.now() - 61_000, id);
  testDb.close();
  response = await fetch(`${baseUrl}/api/vehicles?direction=to-tarragona`);
  listing = await response.json();
  const staleReport = listing.reports.find((report) => report.id === id);
  assert.equal(staleReport.ageSeconds >= 60, true);
  assert.equal(staleReport.latitude, Number(start.latitude.toFixed(3)));
  assert.equal(staleReport.longitude, Number(start.longitude.toFixed(3)));
  assert.equal(staleReport.accuracy, null);

  response = await fetch(`${baseUrl}/api/vehicles/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "x-share-token": "wrong-synthetic-token" },
  });
  assert.equal(response.status, 404, "wrong token cannot delete");
  response = await fetch(`${baseUrl}/api/vehicles/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "x-share-token": token },
  });
  assert.equal(response.status, 204, "owner can delete immediately");
});

test("withdrawing analytics consent queues a denied state and disables measurement", () => {
  const dataLayer = [];
  const stored = new Map([["mapgarraf-analytics-consent-v1", JSON.stringify({ choice: "accepted", updatedAt: Date.now() })]]);
  const deletedCookies = [];
  const appendedScripts = [];
  const window = {
    dataLayer,
    dispatchEvent() {},
  };
  window.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init.detail; } };
  const document = {
    readyState: "complete",
    head: { appendChild: (node) => appendedScripts.push(node) },
    body: { appendChild() {} },
    createElement: () => ({ dataset: {}, setAttribute() {}, addEventListener() {}, querySelector: () => ({ focus() {} }) }),
    getElementById: () => ({ remove() {} }),
    addEventListener() {},
    get cookie() { return "_ga=synthetic; _ga_G-QGHZ9BZ1EF=synthetic"; },
    set cookie(value) { deletedCookies.push(value); },
  };
  const localStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: (key) => stored.delete(key),
  };
  const context = vm.createContext({
    window,
    document,
    localStorage,
    location: { hostname: "bus.nekokoneko.org" },
    CustomEvent: window.CustomEvent,
  });
  vm.runInContext(fs.readFileSync("public/cookie-consent.js", "utf8"), context);
  window.MapGarrafCookieConsent.setChoice("rejected");

  const consentUpdates = dataLayer
    .map((entry) => Array.from(entry))
    .filter((entry) => entry[0] === "consent" && entry[1] === "update");
  assert.equal(consentUpdates.at(-1)[2].analytics_storage, "denied");
  assert.equal(consentUpdates.at(-1)[2].ad_storage, "denied");
  assert.equal(window["ga-disable-G-QGHZ9BZ1EF"], true);
  assert.equal(JSON.parse(stored.get("mapgarraf-analytics-consent-v1")).choice, "rejected");
  assert.equal(appendedScripts.length, 1, "the tag loads only after prior acceptance");
  assert.ok(deletedCookies.length > 0, "accessible Analytics cookies are cleared");
});
