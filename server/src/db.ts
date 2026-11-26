import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new Database(path.join(config.dataDir, "keeper.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = OFF"); // phones may push a copy before its movie in the same batch

/**
 * Sync model
 * - Every row has a client-generated UUID, `updated_at` (ms epoch, set by the phone
 *   that made the edit) and `updated_by` (device id).
 * - Deletes are soft (`deleted = 1`) so they propagate to the other phone.
 * - Conflicts: last write wins, compared on `updated_at`.
 * - The server stamps every accepted write with a monotonically increasing `seq`.
 *   Phones pull "everything with seq > my cursor", so client clock skew can never
 *   make a change get skipped.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS movies (
  id           TEXT PRIMARY KEY,
  tmdb_id      INTEGER,
  title        TEXT NOT NULL,
  year         INTEGER,
  poster_path  TEXT,
  overview     TEXT,
  runtime      INTEGER,
  updated_at   INTEGER NOT NULL,
  updated_by   TEXT NOT NULL,
  deleted      INTEGER NOT NULL DEFAULT 0,
  seq          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS movies_seq ON movies(seq);
CREATE INDEX IF NOT EXISTS movies_tmdb ON movies(tmdb_id);

CREATE TABLE IF NOT EXISTS copies (
  id             TEXT PRIMARY KEY,
  movie_id       TEXT NOT NULL,
  format         TEXT NOT NULL CHECK (format IN ('dvd','bluray','uhd','other')),
  barcode        TEXT,
  edition        TEXT,
  location       TEXT,
  notes          TEXT,
  upgrade_wanted INTEGER NOT NULL DEFAULT 0,
  added_by       TEXT,
  updated_at     INTEGER NOT NULL,
  updated_by     TEXT NOT NULL,
  deleted        INTEGER NOT NULL DEFAULT 0,
  seq            INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS copies_seq ON copies(seq);
CREATE INDEX IF NOT EXISTS copies_movie ON copies(movie_id);
CREATE INDEX IF NOT EXISTS copies_barcode ON copies(barcode);

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO meta(key, value) VALUES ('seq', '0');
-- Highest seq of any deleted row we've purged. A phone whose cursor is below this
-- might have missed a delete, so it gets a full fresh copy instead of a change list.
INSERT OR IGNORE INTO meta(key, value) VALUES ('purged_through_seq', '0');

CREATE TABLE IF NOT EXISTS devices (
  device_id    TEXT PRIMARY KEY,
  name         TEXT,
  last_sync_at INTEGER NOT NULL
);

-- Cache barcode → title lookups so we don't burn the UPC API quota twice.
CREATE TABLE IF NOT EXISTS barcode_cache (
  barcode    TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hunts (
  id           TEXT PRIMARY KEY,
  tmdb_id      INTEGER,
  title        TEXT NOT NULL,
  year         INTEGER,
  poster_path  TEXT,
  notes        TEXT,
  found        INTEGER NOT NULL DEFAULT 0,
  added_by     TEXT,
  updated_at   INTEGER NOT NULL,
  updated_by   TEXT NOT NULL,
  deleted      INTEGER NOT NULL DEFAULT 0,
  seq          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hunts_seq ON hunts(seq);

-- TMDB collection ("series") contents, cached for the series-gaps view.
CREATE TABLE IF NOT EXISTS series_cache (
  collection_id INTEGER PRIMARY KEY,
  payload       TEXT NOT NULL,
  fetched_at    INTEGER NOT NULL
);
`);

// ---- Migrations for columns added after v0.1 ----
function addColumn(table: string, column: string, type: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
addColumn("movies", "genres", "TEXT");          // "Horror, Sci-Fi"
addColumn("movies", "collection_id", "INTEGER"); // TMDB collection = series
addColumn("movies", "collection_name", "TEXT");
addColumn("movies", "enriched", "INTEGER NOT NULL DEFAULT 0");
addColumn("copies", "created_at", "INTEGER");   // when the disc was added (for "biggest month")
addColumn("hunts", "found_by", "TEXT");          // who found it (credit!)
{
  // certification (G/PG/14A…) arrived later: re-enrich everything once to fill it.
  const cols = db.prepare("PRAGMA table_info(movies)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "certification")) {
    db.exec("ALTER TABLE movies ADD COLUMN certification TEXT");
    db.exec("UPDATE movies SET enriched = 0");
  }
}
db.exec("UPDATE copies SET created_at = updated_at WHERE created_at IS NULL");

export function nextSeq(): number {
  const row = db
    .prepare("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'seq' RETURNING value")
    .get() as { value: string | number };
  return Number(row.value);
}

export function currentSeq(): number {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'seq'").get() as { value: string };
  return Number(row.value);
}

export function getMeta(key: string): number {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return Number(row?.value ?? 0);
}

/**
 * Permanently remove soft-deleted rows older than `days`. Phones that synced recently
 * already know about those deletes; any phone that's further behind gets a full copy.
 */
export function purgeTombstones(days: number) {
  const cutoff = Date.now() - days * 86_400_000;
  const tx = db.transaction(() => {
    let maxSeq = getMeta("purged_through_seq");
    for (const table of ["movies", "copies", "hunts"]) {
      const r = db.prepare(`SELECT MAX(seq) m FROM ${table} WHERE deleted = 1 AND updated_at < ?`).get(cutoff) as { m: number | null };
      if (r.m) maxSeq = Math.max(maxSeq, r.m);
      db.prepare(`DELETE FROM ${table} WHERE deleted = 1 AND updated_at < ?`).run(cutoff);
    }
    db.prepare("UPDATE meta SET value = ? WHERE key = 'purged_through_seq'").run(String(maxSeq));
  });
  tx();
}
