/**
 * End-to-end smoke test: boots the server on a temp DB and simulates two phones.
 * Run: npm test
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const PORT = 18787;
const TOKEN = "test-token";
const BASE = `http://127.0.0.1:${PORT}/api`;
const H = { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` };

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "keeper-"));
const server = spawn("node", ["dist/index.js"], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR, KEEPER_API_TOKEN: TOKEN, BONJOUR: "off" },
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise<void>((ok) => server.stdout!.on("data", (d) => String(d).includes("listening") && ok()));

const sync = async (device_id: string, cursor: number, movies: any[] = [], copies: any[] = []) => {
  const r = await fetch(`${BASE}/sync`, { method: "POST", headers: H, body: JSON.stringify({ device_id, cursor, changes: { movies, copies } }) });
  assert.equal(r.status, 200, await r.clone().text());
  return r.json() as Promise<any>;
};

let pass = 0;
const ok = (name: string) => { pass++; console.log("✔", name); };

try {
  // health is open, everything else needs the token
  assert.equal((await fetch(`${BASE}/health`)).status, 200); ok("health reachable without token");
  assert.equal((await fetch(`${BASE}/stats`)).status, 401); ok("API rejects missing token");

  // Phone B listens for live updates
  const events: string[] = [];
  const ctrl = new AbortController();
  fetch(`${BASE}/events?device_id=phoneB`, { headers: H, signal: ctrl.signal }).then(async (r) => {
    const reader = r.body!.getReader();
    for (;;) { const { value, done } = await reader.read(); if (done) break; events.push(new TextDecoder().decode(value)); }
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));

  // Phone A adds Jaws on DVD
  const t0 = Date.now();
  const jaws = { id: randomUUID(), tmdb_id: 578, title: "Jaws", year: 1975, updated_at: t0, updated_by: "phoneA" };
  const dvd = { id: randomUUID(), movie_id: jaws.id, format: "dvd", barcode: "025192012920", updated_at: t0, updated_by: "phoneA" };
  const a1 = await sync("phoneA", 0, [jaws], [dvd]);
  assert.equal(a1.applied.accepted, 2); ok("phone A pushes a movie + copy");

  await new Promise((r) => setTimeout(r, 200));
  assert.ok(events.join("").includes("event: changed")); ok("phone B gets a live 'changed' event");

  // Phone B pulls from scratch
  const b1 = await sync("phoneB", 0);
  assert.equal(b1.changes.movies.length, 1);
  assert.equal(b1.changes.copies[0].format, "dvd");
  assert.equal(b1.changes.copies[0].upgrade_wanted, false); ok("phone B pulls them (booleans intact)");
  assert.equal(b1.full, true); assert.equal(b1.reason, "first_sync"); ok("first sync is a full copy");

  // Phone B marks the DVD as "want upgrade"; Phone A edits the same copy with an OLDER timestamp
  await sync("phoneB", b1.cursor, [], [{ ...dvd, upgrade_wanted: true, updated_at: t0 + 2000, updated_by: "phoneB" }]);
  const late = await sync("phoneA", a1.cursor, [], [{ ...dvd, location: "basement", updated_at: t0 + 1000, updated_by: "phoneA" }]);
  assert.equal(late.applied.rejected, 1);
  const win = late.changes.copies.find((c: any) => c.id === dvd.id);
  assert.equal(win.upgrade_wanted, true); assert.equal(win.updated_by, "phoneB"); ok("last-write-wins on conflicting edits");

  // Cursor means nothing new comes back
  const again = await sync("phoneA", late.cursor);
  assert.equal(again.changes.movies.length + again.changes.copies.length, 0); ok("cursor returns only new changes");

  // Soft delete propagates
  await sync("phoneA", again.cursor, [], [{ ...dvd, deleted: true, updated_at: t0 + 3000, updated_by: "phoneA" }]);
  const b2 = await sync("phoneB", b1.cursor);
  assert.equal(b2.changes.copies.find((c: any) => c.id === dvd.id).deleted, true); ok("deletes propagate to the other phone");

  assert.equal(b2.full, false); ok("recent phone gets a delta, not a full copy");

  // Wife's phone hasn't synced in 30 days → gets the whole collection, no deleted rows
  const raw = new Database(path.join(DATA_DIR, "keeper.db"));
  raw.prepare("UPDATE devices SET last_sync_at = ? WHERE device_id = 'phoneB'").run(Date.now() - 30 * 86_400_000);
  const ridley = { id: randomUUID(), title: "Alien", year: 1979, updated_at: Date.now(), updated_by: "phoneA" };
  await sync("phoneA", 0, [ridley]);
  const stale = await sync("phoneB", b2.cursor);
  assert.equal(stale.full, true); assert.equal(stale.reason, "stale");
  assert.equal(stale.changes.movies.length, 2);
  assert.equal(stale.changes.copies.length, 0); ok("stale phone (30 days) gets a full fresh copy");

  const devs = await (await fetch(`${BASE}/devices`, { headers: H })).json() as any;
  assert.equal(devs.devices.length, 2); ok("/devices lists both phones");

  // Tombstones older than the window are purged; a phone behind that point gets a full copy
  raw.prepare("UPDATE copies SET updated_at = ? WHERE deleted = 1").run(Date.now() - 90 * 86_400_000);
  raw.close();

  const stats = await (await fetch(`${BASE}/stats`, { headers: H })).json() as any;
  assert.equal(stats.movies, 2); assert.equal(stats.copies, 0); ok("stats exclude deleted copies");

  // Hunt list syncs to the other phone, with booleans intact
  const hunt = { id: randomUUID(), tmdb_id: 679, title: "Aliens", year: 1986, found: false, updated_at: Date.now(), updated_by: "phoneA" };
  const h1 = await fetch(`${BASE}/sync`, { method: "POST", headers: H, body: JSON.stringify({ device_id: "phoneA", cursor: 0, changes: { hunts: [hunt] } }) }).then((r) => r.json()) as any;
  assert.equal(h1.applied.accepted, 1);
  const hb = await sync("phoneB", stale.cursor);
  const got = hb.changes.hunts.find((h: any) => h.id === hunt.id);
  assert.equal(got.title, "Aliens"); assert.equal(got.found, false); ok("hunt list syncs between phones");

  // Bad payload
  assert.equal((await fetch(`${BASE}/sync`, { method: "POST", headers: H, body: JSON.stringify({ cursor: 0 }) })).status, 400); ok("invalid payload rejected");

  ctrl.abort();
  console.log(`\nAll ${pass} checks passed.`);
} finally {
  server.kill();
}
