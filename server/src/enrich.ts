import { Router } from "express";
import { config } from "./config.js";
import { db } from "./db.js";
import { movieDetails, tmdb } from "./lookup.js";
import { upsertRow } from "./sync.js";
import { broadcastChange } from "./events.js";

/**
 * Background enrichment: fills in genres + series (TMDB collection) for movies that
 * don't have them yet — including everything added before this feature existed.
 * Changes go out through normal sync (updated_by = "server").
 */
let running = false;
export async function enrichMovies(limit = 40) {
  if (running || !config.tmdbToken) return 0;
  running = true;
  let n = 0;
  try {
    const rows = db
      .prepare("SELECT * FROM movies WHERE deleted = 0 AND tmdb_id IS NOT NULL AND enriched = 0 LIMIT ?")
      .all(limit) as Record<string, any>[];
    for (const m of rows) {
      try {
        const d = await movieDetails(m.tmdb_id);
        const changed =
          d.genres !== m.genres || d.collection_id !== m.collection_id || d.certification !== m.certification ||
          (d.runtime && !m.runtime) || (d.poster_path && !m.poster_path);
        if (changed) {
          upsertRow("movies", {
            ...m,
            genres: d.genres,
            collection_id: d.collection_id,
            collection_name: d.collection_name,
            certification: d.certification,
            runtime: m.runtime ?? d.runtime,
            poster_path: m.poster_path ?? d.poster_path,
            updated_at: Math.max(Date.now(), m.updated_at + 1),
            updated_by: "server",
          });
          n++;
        }
        db.prepare("UPDATE movies SET enriched = 1 WHERE id = ?").run(m.id);
      } catch (e: any) {
        if (e?.status === 503) break; // no token
        console.warn("enrich failed for", m.title, e?.message);
      }
      await new Promise((r) => setTimeout(r, 250)); // be gentle with TMDB
    }
  } finally {
    running = false;
  }
  if (n > 0) broadcastChange("server");
  return n;
}

type Part = { tmdb_id: number; title: string; year: number | null; poster_path: string | null; released: boolean };

async function seriesParts(collectionId: number): Promise<{ name: string; parts: Part[] }> {
  const cached = db.prepare("SELECT payload, fetched_at FROM series_cache WHERE collection_id = ?").get(collectionId) as
    | { payload: string; fetched_at: number }
    | undefined;
  if (cached && Date.now() - cached.fetched_at < 30 * 86_400_000) return JSON.parse(cached.payload);
  const c = await tmdb(`/collection/${collectionId}`);
  const today = new Date().toISOString().slice(0, 10);
  const parts: Part[] = ((c.parts ?? []) as any[])
    .map((p) => ({
      tmdb_id: p.id,
      title: p.title,
      year: p.release_date ? Number(p.release_date.slice(0, 4)) : null,
      poster_path: p.poster_path ?? null,
      released: !!p.release_date && p.release_date <= today,
    }))
    .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
  const payload = { name: c.name as string, parts };
  db.prepare("INSERT OR REPLACE INTO series_cache(collection_id, payload, fetched_at) VALUES (?, ?, ?)")
    .run(collectionId, JSON.stringify(payload), Date.now());
  return payload;
}

export const seriesRouter = Router();

/**
 * GET /api/series — every series you own at least one movie of, with which parts
 * you have and which you're missing. Phones cache the answer for offline use.
 */
seriesRouter.get("/series", async (_req, res, next) => {
  try {
    const owned = db
      .prepare(`SELECT DISTINCT m.tmdb_id, m.collection_id FROM movies m
                JOIN copies c ON c.movie_id = m.id AND c.deleted = 0
                WHERE m.deleted = 0 AND m.collection_id IS NOT NULL`)
      .all() as { tmdb_id: number; collection_id: number }[];
    const ownedIds = new Set(owned.map((o) => o.tmdb_id));
    const series = [];
    for (const cid of [...new Set(owned.map((o) => o.collection_id))]) {
      try {
        const { name, parts } = await seriesParts(cid);
        const released = parts.filter((p) => p.released);
        series.push({
          collection_id: cid,
          name,
          parts: released.map((p) => ({ ...p, owned: ownedIds.has(p.tmdb_id) })),
          owned: released.filter((p) => ownedIds.has(p.tmdb_id)).length,
          total: released.length,
        });
      } catch (e: any) {
        if (e?.status === 503) throw e;
      }
    }
    series.sort((a, b) => (a.total - a.owned) - (b.total - b.owned) || a.name.localeCompare(b.name));
    res.json({ series });
  } catch (e) {
    next(e);
  }
});
