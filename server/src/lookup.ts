import { Router } from "express";
import { config } from "./config.js";
import { db } from "./db.js";

const TMDB = "https://api.themoviedb.org/3";

async function tmdb(path: string, params: Record<string, string> = {}) {
  if (!config.tmdbToken) throw Object.assign(new Error("TMDB_READ_TOKEN not configured"), { status: 503 });
  const url = new URL(TMDB + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${config.tmdbToken}`, Accept: "application/json" } });
  if (!r.ok) throw Object.assign(new Error(`TMDB ${r.status}`), { status: 502 });
  return r.json() as Promise<any>;
}

type MovieHit = { tmdb_id: number; title: string; year: number | null; poster_path: string | null; overview: string };

const toHit = (m: any): MovieHit => ({
  tmdb_id: m.id,
  title: m.title,
  year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
  poster_path: m.poster_path ?? null,
  overview: m.overview ?? "",
});

export async function searchMovies(query: string, year?: number): Promise<MovieHit[]> {
  const params: Record<string, string> = { query, include_adult: "false" };
  if (year) params.year = String(year);
  const data = await tmdb("/search/movie", params);
  return (data.results ?? []).slice(0, 10).map(toHit);
}

/** Guess the disc format from a retail product title like "The Matrix [Blu-ray + Digital]". */
export function detectFormat(text: string): "dvd" | "bluray" | "uhd" | "other" {
  const t = text.toLowerCase();
  if (/4k|uhd|ultra hd/.test(t)) return "uhd";
  if (/blu[\s-]?ray|\bbd\b/.test(t)) return "bluray";
  if (/\bdvd\b/.test(t)) return "dvd";
  return "other";
}

/** Strip retail noise so the title searches cleanly on TMDB. */
export function cleanTitle(text: string): string {
  return text
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ") // [Blu-ray], (Widescreen Edition)
    .replace(/\b(4k|uhd|ultra hd|blu[\s-]?ray|dvd|digital( copy| hd)?|combo pack|widescreen|full ?screen|special edition|collector'?s edition|steelbook|\d+[\s-]?disc|includes.*$)\b/gi, " ")
    .replace(/[+\-–:|,/]+\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function upcLookup(barcode: string): Promise<{ title: string; raw: any } | null> {
  const cached = db.prepare("SELECT payload FROM barcode_cache WHERE barcode = ?").get(barcode) as { payload: string } | undefined;
  if (cached) return JSON.parse(cached.payload);

  const url = config.upcItemDbKey
    ? `https://api.upcitemdb.com/prod/v1/lookup?upc=${encodeURIComponent(barcode)}`
    : `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (config.upcItemDbKey) { headers.user_key = config.upcItemDbKey; headers.key_type = "3scale"; }

  const r = await fetch(url, { headers });
  if (r.status === 429) throw Object.assign(new Error("UPC lookup daily limit reached"), { status: 429 });
  if (!r.ok) throw Object.assign(new Error(`UPC lookup ${r.status}`), { status: 502 });
  const data = (await r.json()) as any;
  const item = data.items?.[0];
  const result = item ? { title: String(item.title), raw: { brand: item.brand, category: item.category } } : null;
  db.prepare("INSERT OR REPLACE INTO barcode_cache(barcode, payload, fetched_at) VALUES (?, ?, ?)")
    .run(barcode, JSON.stringify(result), Date.now());
  return result;
}

export const lookupRouter = Router();

/** GET /api/search?q=jaws&year=1975 — TMDB title search (typed entry or text read off a cover photo). */
lookupRouter.get("/search", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) { res.status(400).json({ error: "missing q" }); return; }
    const year = req.query.year ? Number(req.query.year) : undefined;
    res.json({ results: await searchMovies(cleanTitle(q) || q, year) });
  } catch (e) { next(e); }
});

/** GET /api/movie/:tmdbId — full details (runtime etc.) once the user picks a match. */
lookupRouter.get("/movie/:tmdbId", async (req, res, next) => {
  try {
    const m = await tmdb(`/movie/${Number(req.params.tmdbId)}`);
    res.json({ ...toHit(m), runtime: m.runtime ?? null });
  } catch (e) { next(e); }
});

/**
 * GET /api/barcode/:upc — barcode → product title → detected format + TMDB candidates.
 * Used when adding at home; in-store "do we own it?" checks happen offline on the phone
 * by matching the barcode/tmdb_id against its local copy of the collection.
 */
lookupRouter.get("/barcode/:upc", async (req, res, next) => {
  try {
    const upc = req.params.upc.replace(/\D/g, "");
    if (upc.length < 8) { res.status(400).json({ error: "invalid barcode" }); return; }
    const product = await upcLookup(upc);
    if (!product) { res.json({ barcode: upc, product_title: null, format: null, candidates: [] }); return; }
    const title = cleanTitle(product.title);
    res.json({
      barcode: upc,
      product_title: product.title,
      format: detectFormat(product.title),
      candidates: title ? await searchMovies(title) : [],
    });
  } catch (e) { next(e); }
});
