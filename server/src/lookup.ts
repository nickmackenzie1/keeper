import { Router } from "express";
import { config } from "./config.js";
import { db } from "./db.js";
import { sight } from "./sightings.js";
import { posterColors } from "./colors.js";

const TMDB = config.tmdbBase;

/**
 * fetch() for outside services with a time limit, so the app never sits on
 * "Searching…" forever, and errors that say what's actually wrong.
 */
export async function outbound(service: string, url: string | URL, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e: any) {
    const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
    console.warn(`${service} request failed:`, e?.cause?.code ?? e?.name ?? e);
    throw Object.assign(
      new Error(timedOut ? `${service} didn't answer in time — the NAS may not have internet access from Docker` : `Can't reach ${service} from the NAS (${e?.cause?.code ?? "network error"})`),
      { status: 504 },
    );
  }
}

/** TMDB accepts either the long Read Access Token (Bearer) or the short 32-character API key (query param). */
export function tmdbFetch(url: URL, timeoutMs?: number) {
  const key = config.tmdbToken;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (/^[0-9a-f]{32}$/i.test(key)) url.searchParams.set("api_key", key);
  else headers.Authorization = `Bearer ${key}`;
  return outbound("TMDB", url, { headers }, timeoutMs);
}

export async function tmdb(path: string, params: Record<string, string> = {}) {
  if (!config.tmdbToken) throw Object.assign(new Error("TMDB_READ_TOKEN not configured"), { status: 503 });
  const url = new URL(TMDB + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await tmdbFetch(url);
  if (r.status === 401) throw Object.assign(new Error("TMDB rejected the key — check TMDB_READ_TOKEN in .env"), { status: 502 });
  if (!r.ok) throw Object.assign(new Error(`TMDB ${r.status}`), { status: 502 });
  return r.json() as Promise<any>;
}

type MovieHit = {
  tmdb_id: number; title: string; year: number | null; poster_path: string | null; overview: string;
  rating: number | null; votes: number | null;
};

const toHit = (m: any): MovieHit => ({
  tmdb_id: m.id,
  title: m.title,
  year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
  poster_path: m.poster_path ?? null,
  overview: m.overview ?? "",
  rating: typeof m.vote_average === "number" ? Math.round(m.vote_average * 10) / 10 : null,
  votes: typeof m.vote_count === "number" ? m.vote_count : null,
});

/** Full details incl. genres and series (TMDB "collection"). */
export async function movieDetails(id: number) {
  const m = await tmdb(`/movie/${id}`, { append_to_response: "release_dates" });
  // Age rating: prefer Canada, then US.
  const rd = (m.release_dates?.results ?? []) as { iso_3166_1: string; release_dates: { certification: string }[] }[];
  const cert = (cc: string) => rd.find((r) => r.iso_3166_1 === cc)?.release_dates.map((d) => d.certification).find((c) => c) ?? null;
  const hit = toHit(m);
  return {
    palette: await posterColors(hit.poster_path),
    certification: cert("CA") ?? cert("US"),
    ...toHit(m),
    runtime: (m.runtime as number) || null,
    genres: ((m.genres ?? []) as { name: string }[]).map((g) => g.name).join(", ") || null,
    collection_id: (m.belongs_to_collection?.id as number) ?? null,
    collection_name: (m.belongs_to_collection?.name as string) ?? null,
  };
}

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
    ? `${config.upcBase}/prod/v1/lookup?upc=${encodeURIComponent(barcode)}`
    : `${config.upcBase}/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (config.upcItemDbKey) { headers.user_key = config.upcItemDbKey; headers.key_type = "3scale"; }

  const r = await outbound("Barcode lookup", url, { headers });
  if (r.status === 429) throw Object.assign(new Error("UPC lookup daily limit reached"), { status: 429 });
  // 400 = "not a valid UPC" (bad checksum, odd length), 404 = unknown. Either way: no product.
  if (r.status === 400 || r.status === 404) return null;
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
    res.json(await movieDetails(Number(req.params.tmdbId)));
  } catch (e) { next(e); }
});

/** GET /api/movie/:tmdbId/posters — alternative posters to choose from. */
lookupRouter.get("/movie/:tmdbId/posters", async (req, res, next) => {
  try {
    const data = await tmdb(`/movie/${Number(req.params.tmdbId)}/images`, { include_image_language: "en,null" });
    const posters = ((data.posters ?? []) as { file_path: string; vote_average: number; iso_639_1: string | null }[])
      .sort((a, b) => Number(b.iso_639_1 === "en") - Number(a.iso_639_1 === "en") || b.vote_average - a.vote_average)
      .slice(0, 40)
      .map((p) => p.file_path);
    res.json({ posters });
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
    const candidates: (Awaited<ReturnType<typeof searchMovies>>[number] & { palette?: unknown })[] = title ? await searchMovies(title) : [];
    // The reveal screen uses the top match's poster colours.
    if (candidates[0]) candidates[0].palette = await posterColors(candidates[0].poster_path);
    // Log that we saw this in a store; tells the phone if it's a rare find for you.
    // Only scans from the store screens (?store=1) count — not adding discs at home.
    const rarity = candidates[0] && req.query.store === "1" ? sight(candidates[0].tmdb_id, candidates[0].title, "barcode") : null;
    res.json({
      barcode: upc,
      product_title: product.title,
      format: detectFormat(product.title),
      candidates,
      rarity,
    });
  } catch (e) { next(e); }
});
