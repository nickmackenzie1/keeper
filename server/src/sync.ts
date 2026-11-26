import { Router } from "express";
import { z } from "zod";
import { db, nextSeq, currentSeq, getMeta } from "./db.js";
import { config } from "./config.js";
import { broadcastChange } from "./events.js";
import { queueDigest } from "./push.js";

const base = {
  id: z.string().uuid(),
  updated_at: z.number().int(),
  updated_by: z.string().min(1),
  deleted: z.boolean().default(false),
};

const MovieIn = z.object({
  ...base,
  tmdb_id: z.number().int().nullable().optional(),
  title: z.string().min(1),
  year: z.number().int().nullable().optional(),
  poster_path: z.string().nullable().optional(),
  overview: z.string().nullable().optional(),
  runtime: z.number().int().nullable().optional(),
});

const CopyIn = z.object({
  ...base,
  movie_id: z.string().uuid(),
  format: z.enum(["dvd", "bluray", "uhd", "other"]),
  barcode: z.string().nullable().optional(),
  edition: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  upgrade_wanted: z.boolean().default(false),
  added_by: z.string().nullable().optional(),
});

const SyncRequest = z.object({
  device_id: z.string().min(1),
  device_name: z.string().optional(), // e.g. "Nick's iPhone" — shown in /api/devices
  cursor: z.number().int().min(0).default(0),
  changes: z
    .object({
      movies: z.array(MovieIn).default([]),
      copies: z.array(CopyIn).default([]),
    })
    .default({ movies: [], copies: [] }),
});

type Movie = z.infer<typeof MovieIn>;
type Copy = z.infer<typeof CopyIn>;

const getMovieTs = db.prepare("SELECT updated_at FROM movies WHERE id = ?");
const getCopyTs = db.prepare("SELECT updated_at FROM copies WHERE id = ?");

const upsertMovie = db.prepare(`
INSERT INTO movies (id, tmdb_id, title, year, poster_path, overview, runtime, updated_at, updated_by, deleted, seq)
VALUES (@id, @tmdb_id, @title, @year, @poster_path, @overview, @runtime, @updated_at, @updated_by, @deleted, @seq)
ON CONFLICT(id) DO UPDATE SET
  tmdb_id=excluded.tmdb_id, title=excluded.title, year=excluded.year, poster_path=excluded.poster_path,
  overview=excluded.overview, runtime=excluded.runtime, updated_at=excluded.updated_at,
  updated_by=excluded.updated_by, deleted=excluded.deleted, seq=excluded.seq`);

const upsertCopy = db.prepare(`
INSERT INTO copies (id, movie_id, format, barcode, edition, location, notes, upgrade_wanted, added_by, updated_at, updated_by, deleted, seq)
VALUES (@id, @movie_id, @format, @barcode, @edition, @location, @notes, @upgrade_wanted, @added_by, @updated_at, @updated_by, @deleted, @seq)
ON CONFLICT(id) DO UPDATE SET
  movie_id=excluded.movie_id, format=excluded.format, barcode=excluded.barcode, edition=excluded.edition,
  location=excluded.location, notes=excluded.notes, upgrade_wanted=excluded.upgrade_wanted,
  added_by=excluded.added_by, updated_at=excluded.updated_at, updated_by=excluded.updated_by,
  deleted=excluded.deleted, seq=excluded.seq`);

const changedMovies = db.prepare("SELECT * FROM movies WHERE seq > ? ORDER BY seq");
const changedCopies = db.prepare("SELECT * FROM copies WHERE seq > ? ORDER BY seq");
const allMovies = db.prepare("SELECT * FROM movies WHERE deleted = 0 ORDER BY seq");
const allCopies = db.prepare("SELECT * FROM copies WHERE deleted = 0 ORDER BY seq");
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

const applyChanges = db.transaction((movies: Movie[], copies: Copy[]) => {
  let accepted = 0;
  let rejected = 0;
  for (const m of movies) {
    const existing = getMovieTs.get(m.id) as { updated_at: number } | undefined;
    if (existing && existing.updated_at >= m.updated_at) { rejected++; continue; }
    upsertMovie.run({
      tmdb_id: null, year: null, poster_path: null, overview: null, runtime: null,
      ...m, deleted: m.deleted ? 1 : 0, seq: nextSeq(),
    });
    accepted++;
  }
  for (const c of copies) {
    const existing = getCopyTs.get(c.id) as { updated_at: number } | undefined;
    if (existing && existing.updated_at >= c.updated_at) { rejected++; continue; }
    upsertCopy.run({
      barcode: null, edition: null, location: null, notes: null, added_by: null,
      ...c, deleted: c.deleted ? 1 : 0, upgrade_wanted: c.upgrade_wanted ? 1 : 0, seq: nextSeq(),
    });
    accepted++;
  }
  return { accepted, rejected };
});

const toBool = <T extends Record<string, unknown>>(row: T, keys: string[]) => {
  const out: Record<string, unknown> = { ...row };
  for (const k of keys) out[k] = Boolean(out[k]);
  return out;
};

export const syncRouter = Router();

/**
 * POST /api/sync
 * Body: { device_id, device_name?, cursor, changes: { movies: [...], copies: [...] } }
 * Returns: { full, reason, cursor, server_time, applied, changes: { movies, copies } }
 *
 * The phone sends everything it changed locally since its last successful sync,
 * then stores the returned cursor.
 *
 * full = false → `changes` is a delta: upsert each row locally, drop rows with deleted = true.
 * full = true  → `changes` is the ENTIRE collection: replace local data with it.
 *               (Sent on first sync, or if the phone hasn't synced in FULL_RESYNC_DAYS.)
 *               The phone's own pending edits were already applied above, so nothing is lost.
 */
syncRouter.post("/sync", (req, res) => {
  const parsed = SyncRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    return;
  }
  const { cursor, changes, device_id, device_name } = parsed.data;
  const reason = fullCopyReason(device_id, cursor); // decide BEFORE touching last_sync_at
  const applied = applyChanges(changes.movies, changes.copies);
  if (applied.accepted > 0) {
    broadcastChange(device_id);
    queueDigest(device_id);
  }

  const full = reason !== null;
  const movieRows = (full ? allMovies.all() : changedMovies.all(cursor)) as Record<string, unknown>[];
  const copyRows = (full ? allCopies.all() : changedCopies.all(cursor)) as Record<string, unknown>[];

  const now = Date.now();
  touchDevice.run(device_id, device_name ?? null, now);

  res.json({
    full,
    reason,
    cursor: currentSeq(),
    server_time: now,
    applied,
    changes: {
      movies: movieRows.map((r) => toBool(r, ["deleted"])),
      copies: copyRows.map((r) => toBool(r, ["deleted", "upgrade_wanted"])),
    },
  });
});

/** GET /api/devices — when each phone last synced (handy for "is her phone up to date?"). */
syncRouter.get("/devices", (_req, res) => {
  const rows = db.prepare("SELECT device_id, name, last_sync_at FROM devices ORDER BY last_sync_at DESC").all() as any[];
  res.json({
    devices: rows.map((d) => ({ ...d, days_since_sync: Math.floor((Date.now() - d.last_sync_at) / 86_400_000) })),
  });
});
