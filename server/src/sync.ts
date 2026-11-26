import { Router } from "express";
import { z } from "zod";
import { db, nextSeq, currentSeq, getMeta } from "./db.js";
import { config } from "./config.js";
import { broadcastChange } from "./events.js";
import { queueDigest } from "./push.js";
import { colourMovies } from "./enrich.js";

const base = {
  id: z.string().uuid(),
  updated_at: z.number().int(),
  updated_by: z.string().min(1),
  deleted: z.boolean().default(false),
};
const str = z.string().nullable().optional();
const int = z.number().int().nullable().optional();

const MovieIn = z.object({
  ...base,
  tmdb_id: int,
  title: z.string().min(1),
  year: int,
  poster_path: str,
  overview: str,
  runtime: int,
  genres: str,
  collection_id: int,
  collection_name: str,
  certification: str,
  poster_bg: str,
  poster_accent: str,
  palette_for: str,
});

const CopyIn = z.object({
  ...base,
  movie_id: z.string().uuid(),
  format: z.enum(["dvd", "bluray", "uhd", "other"]),
  barcode: str,
  edition: str,
  location: str,
  notes: str,
  upgrade_wanted: z.boolean().default(false),
  added_by: str,
  created_at: int,
});

const HuntIn = z.object({
  ...base,
  tmdb_id: int,
  title: z.string().min(1),
  year: int,
  poster_path: str,
  notes: str,
  found: z.boolean().default(false),
  found_by: str,
  added_by: str,
});

/**
 * Every synced table is described once here: its columns (besides seq) and which
 * columns are booleans. Adding a table to sync = one entry.
 */
const TABLES = {
  movies: {
    schema: MovieIn,
    columns: ["id", "tmdb_id", "title", "year", "poster_path", "overview", "runtime", "genres", "collection_id", "collection_name", "certification", "poster_bg", "poster_accent", "palette_for", "updated_at", "updated_by", "deleted"],
    bools: ["deleted"],
  },
  copies: {
    schema: CopyIn,
    columns: ["id", "movie_id", "format", "barcode", "edition", "location", "notes", "upgrade_wanted", "added_by", "created_at", "updated_at", "updated_by", "deleted"],
    bools: ["deleted", "upgrade_wanted"],
  },
  hunts: {
    schema: HuntIn,
    columns: ["id", "tmdb_id", "title", "year", "poster_path", "notes", "found", "found_by", "added_by", "updated_at", "updated_by", "deleted"],
    bools: ["deleted", "found"],
  },
} as const;
type TableName = keyof typeof TABLES;
const NAMES = Object.keys(TABLES) as TableName[];

const SyncRequest = z.object({
  device_id: z.string().min(1),
  device_name: z.string().optional(), // e.g. "Nick" — shown in notifications and /api/devices
  cursor: z.number().int().min(0).default(0),
  changes: z
    .object({
      movies: z.array(MovieIn).default([]),
      copies: z.array(CopyIn).default([]),
      hunts: z.array(HuntIn).default([]),
    })
    .default({ movies: [], copies: [], hunts: [] }),
});

const stmts = Object.fromEntries(
  NAMES.map((t) => {
    const cols = [...TABLES[t].columns, "seq"];
    const sets = cols.filter((c) => c !== "id").map((c) => `${c}=excluded.${c}`).join(", ");
    return [
      t,
      {
        ts: db.prepare(`SELECT updated_at FROM ${t} WHERE id = ?`),
        upsert: db.prepare(`INSERT INTO ${t} (${cols.join(", ")}) VALUES (${cols.map((c) => "@" + c).join(", ")})
          ON CONFLICT(id) DO UPDATE SET ${sets}`),
        changed: db.prepare(`SELECT * FROM ${t} WHERE seq > ? ORDER BY seq`),
        all: db.prepare(`SELECT * FROM ${t} WHERE deleted = 0 ORDER BY seq`),
      },
    ];
  }),
) as Record<TableName, { ts: any; upsert: any; changed: any; all: any }>;

const getDevice = db.prepare("SELECT last_sync_at FROM devices WHERE device_id = ?");
const touchDevice = db.prepare(`
INSERT INTO devices(device_id, name, last_sync_at) VALUES (?, ?, ?)
ON CONFLICT(device_id) DO UPDATE SET last_sync_at = excluded.last_sync_at, name = COALESCE(excluded.name, devices.name)`);

/** Why (if at all) this phone should get the whole collection instead of a change list. */
function fullCopyReason(deviceId: string, cursor: number): string | null {
  if (cursor === 0) return "first_sync";
  const dev = getDevice.get(deviceId) as { last_sync_at: number } | undefined;
  if (!dev) return "unknown_device";
  if (cursor < getMeta("purged_through_seq")) return "missed_purged_deletes";
  if (Date.now() - dev.last_sync_at > config.fullResyncDays * 86_400_000) return "stale";
  if (cursor > currentSeq()) return "server_restored"; // e.g. NAS restored from backup
  return null;
}

/** Write one row coming from a phone (or the server's own enrichment), last-write-wins. */
export function upsertRow(table: TableName, row: Record<string, unknown>): boolean {
  const s = stmts[table];
  const existing = s.ts.get(row.id) as { updated_at: number } | undefined;
  if (existing && existing.updated_at >= (row.updated_at as number)) return false;
  const params: Record<string, unknown> = {};
  for (const c of TABLES[table].columns) params[c] = row[c] ?? null;
  for (const b of TABLES[table].bools) params[b] = row[b] ? 1 : 0;
  params.seq = nextSeq();
  s.upsert.run(params);
  return true;
}

const applyChanges = db.transaction((changes: Record<TableName, Record<string, unknown>[]>) => {
  let accepted = 0;
  let rejected = 0;
  for (const t of NAMES) for (const row of changes[t]) upsertRow(t, row) ? accepted++ : rejected++;
  // Hand-typed movies (no TMDB link yet) get another lookup attempt after every edit.
  for (const m of changes.movies) if (m.tmdb_id == null) db.prepare("UPDATE movies SET enriched = 0 WHERE id = ?").run(m.id);
  return { accepted, rejected };
});

const toBool = (table: TableName, row: Record<string, unknown>) => {
  const out: Record<string, unknown> = { ...row };
  delete out.seq;
  delete out.enriched;
  for (const k of TABLES[table].bools) out[k] = Boolean(out[k]);
  return out;
};

export const syncRouter = Router();

/**
 * POST /api/sync
 * Body: { device_id, device_name?, cursor, changes: { movies, copies, hunts } }
 * Returns: { full, reason, cursor, server_time, applied, changes: { movies, copies, hunts } }
 *
 * full = false → `changes` is a delta: upsert each row locally (deleted = true rows are tombstones).
 * full = true  → `changes` is the ENTIRE collection: replace local data with it.
 *               (Sent on first sync, or if the phone hasn't synced in FULL_RESYNC_DAYS.)
 */
syncRouter.post("/sync", (req, res) => {
  const parsed = SyncRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    return;
  }
  const { cursor, changes, device_id, device_name } = parsed.data;
  const reason = fullCopyReason(device_id, cursor); // decide BEFORE touching last_sync_at
  const applied = applyChanges(changes as Record<TableName, Record<string, unknown>[]>);
  if (applied.accepted > 0) {
    broadcastChange(device_id);
    queueDigest(device_id);
    if (changes.movies.length) setTimeout(() => void colourMovies(), 500); // new/changed posters get their colours
  }

  const full = reason !== null;
  const out = {} as Record<TableName, unknown[]>;
  for (const t of NAMES) {
    const rows = (full ? stmts[t].all.all() : stmts[t].changed.all(cursor)) as Record<string, unknown>[];
    out[t] = rows.map((r) => toBool(t, r));
  }

  const now = Date.now();
  touchDevice.run(device_id, device_name ?? null, now);

  res.json({ full, reason, cursor: currentSeq(), server_time: now, applied, changes: out });
});

/** GET /api/devices — when each phone last synced (handy for "is her phone up to date?"). */
syncRouter.get("/devices", (_req, res) => {
  const rows = db.prepare("SELECT device_id, name, last_sync_at FROM devices ORDER BY last_sync_at DESC").all() as any[];
  res.json({
    devices: rows.map((d) => ({ ...d, days_since_sync: Math.floor((Date.now() - d.last_sync_at) / 86_400_000) })),
  });
});
