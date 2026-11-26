import { Router } from "express";
import { config } from "./config.js";
import { db } from "./db.js";
import { cleanTitle, movieDetails, searchMovies, tmdb } from "./lookup.js";
import { upsertRow } from "./sync.js";
import { coverColors, posterColors } from "./colors.js";
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
    n += await linkManualEntries(limit);
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

/** Give every movie its poster colours (again, whenever its poster changes). */
let colouring = false;
export async function colourMovies(limit = 60) {
  if (colouring) return 0;
  colouring = true;
  let n = 0;
  try {
    const rows = db
      .prepare("SELECT * FROM movies WHERE deleted = 0 AND poster_path IS NOT NULL AND (palette_for IS NULL OR palette_for != poster_path) LIMIT ?")
      .all(limit) as Record<string, any>[];
    for (const m of rows) {
      const p = await posterColors(m.poster_path);
      if (!p) continue; // offline or no image; try again next round
      upsertRow("movies", {
        ...m,
        poster_bg: p.bg,
        poster_accent: p.accent,
        palette_for: m.poster_path,
        updated_at: Math.max(Date.now(), m.updated_at + 1),
        updated_by: "server",
      });
      n++;
    }
  } finally {
    colouring = false;
  }
  if (n > 0) broadcastChange("server");
  return n;
}

const norm = (t: string) =>
  t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/^(the|a|an)\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Movies typed in by hand (e.g. added offline) have no TMDB link, so no poster or genres.
 * Look them up by title (+ year if given) and link them when the match is unambiguous;
 * the normal enrichment then fills in genres, series and age rating.
 */
async function linkManualEntries(limit: number): Promise<number> {
  const rows = db
    .prepare("SELECT * FROM movies WHERE deleted = 0 AND tmdb_id IS NULL AND enriched = 0 LIMIT ?")
    .all(limit) as Record<string, any>[];
  let n = 0;
  for (const m of rows) {
    try {
      const want = norm(m.title);
      const hits = await searchMovies(cleanTitle(m.title) || m.title, m.year ?? undefined);
      const exact = hits.filter((h) => norm(h.title) === want && (!m.year || !h.year || Math.abs(h.year - m.year) <= 1));
      // Without a year, two same-named films (e.g. remakes) are ambiguous: prefer the best-known one only if it's clearly ahead.
      const pick = exact.length === 1 ? exact[0] : exact.length > 1 && !m.year && (exact[0].votes ?? 0) > 5 * (exact[1].votes ?? 0) ? exact[0] : m.year ? exact[0] : undefined;
      const taken = pick && db.prepare("SELECT 1 FROM movies WHERE tmdb_id = ? AND deleted = 0 AND id != ?").get(pick.tmdb_id, m.id);
      if (pick && !taken) {
        upsertRow("movies", {
          ...m,
          tmdb_id: pick.tmdb_id,
          year: m.year ?? pick.year,
          poster_path: m.poster_path ?? pick.poster_path,
          overview: m.overview ?? (pick.overview || null),
          updated_at: Math.max(Date.now(), m.updated_at + 1),
          updated_by: "server",
        });
        n++; // enriched stays 0, so genres/series/rating are filled in next
      } else {
        db.prepare("UPDATE movies SET enriched = 1 WHERE id = ?").run(m.id); // no confident match; don't keep asking
      }
    } catch (e: any) {
      if (e?.status === 503) break;
      console.warn("link failed for", m.title, e?.message);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
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

let colouringAlbums = false;
/** Same as colourMovies, for record covers. */
export async function colourAlbums(limit = 60) {
  if (colouringAlbums) return 0;
  colouringAlbums = true;
  let n = 0;
  try {
    const rows = db
      .prepare("SELECT * FROM albums WHERE deleted = 0 AND cover_url IS NOT NULL AND (palette_for IS NULL OR palette_for != cover_url) LIMIT ?")
      .all(limit) as Record<string, any>[];
    for (const a of rows) {
      const p = await coverColors(a.cover_url);
      if (!p) continue;
      upsertRow("albums", {
        ...a,
        cover_bg: p.bg,
        cover_accent: p.accent,
        palette_for: a.cover_url,
        updated_at: Math.max(Date.now(), a.updated_at + 1),
        updated_by: "server",
      });
      n++;
    }
  } finally {
    colouringAlbums = false;
  }
  if (n > 0) broadcastChange("server");
  return n;
}
