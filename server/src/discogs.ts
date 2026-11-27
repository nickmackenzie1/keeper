import { Router } from "express";
import { config } from "./config.js";
import { db } from "./db.js";
import { outbound } from "./lookup.js";
import { cachedColors, coverColors } from "./colors.js";
import { sight } from "./sightings.js";

/**
 * Records come from Discogs: the best database for vinyl pressings.
 * A "master" is the album (all its versions); a "release" is one pressing.
 */

const UA = "Keeper/1.0 +https://github.com/nickmackenzie1/keeper";

export async function discogs(path: string, params: Record<string, string> = {}) {
  if (!config.discogsToken) throw Object.assign(new Error("Records aren't set up — add DISCOGS_TOKEN to .env"), { status: 503 });
  const url = new URL(config.discogsBase + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await outbound("Discogs", url, { headers: { Authorization: `Discogs token=${config.discogsToken}`, "User-Agent": UA, Accept: "application/json" } });
  if (r.status === 401) throw Object.assign(new Error("Discogs rejected the token — check DISCOGS_TOKEN in .env"), { status: 502 });
  if (r.status === 404) return null;
  if (r.status === 429) throw Object.assign(new Error("Discogs is busy — try again in a minute"), { status: 429 });
  if (!r.ok) throw Object.assign(new Error(`Discogs ${r.status}`), { status: 502 });
  return r.json() as Promise<any>;
}

export type RecordFormat = "vinyl" | "cd" | "cassette" | "other";

export interface AlbumHit {
  discogs_master_id: number | null;
  discogs_release_id: number | null;
  title: string;
  artist: string | null;
  year: number | null;
  cover_url: string | null;
  genres: string | null;
  styles: string | null;
  palette?: { bg: string; accent: string } | null;
}

export interface PressingInfo {
  format: RecordFormat;
  description: string | null;
  discogs_release_id: number | null;
  label: string | null;
  catno: string | null;
  country: string | null;
  year: number | null;
}

/** "Pink Floyd - The Dark Side Of The Moon" → artist + title. Strips Discogs' "(2)" disambiguators. */
export function splitTitle(s: string): { artist: string | null; title: string } {
  const i = s.indexOf(" - ");
  const clean = (t: string) => t.replace(/\s*\(\d+\)$/, "").replace(/\*$/, "").trim();
  return i > 0 ? { artist: clean(s.slice(0, i)), title: s.slice(i + 3).trim() } : { artist: null, title: s.trim() };
}

export function formatFrom(formats: string[] | { name: string }[] | undefined): RecordFormat {
  const names = (formats ?? []).map((f) => (typeof f === "string" ? f : f.name).toLowerCase());
  if (names.some((n) => n.includes("vinyl") || n === "lp" || n.includes("lathe"))) return "vinyl";
  if (names.some((n) => n === "cd" || n.includes("cdr") || n.includes("sacd"))) return "cd";
  if (names.some((n) => n.includes("cassette"))) return "cassette";
  return "other";
}

const year = (y: unknown) => (Number(y) > 1800 ? Number(y) : null);
const artistsName = (a: { name: string; join?: string }[] | undefined) =>
  a?.length ? a.map((x, i) => x.name.replace(/\s*\(\d+\)$/, "") + (i < a.length - 1 ? ` ${x.join || "&"} ` : "")).join("").replace(/\s+,/g, ",").trim() : null;

/** A search result (master or release) → album. */
function hitFrom(r: any): AlbumHit {
  const { artist, title } = splitTitle(String(r.title ?? ""));
  const isMaster = r.type === "master";
  return {
    discogs_master_id: isMaster ? r.id : r.master_id || null,
    discogs_release_id: isMaster ? r.main_release ?? null : r.id,
    title,
    artist,
    year: year(r.year),
    cover_url: r.cover_image && !String(r.cover_image).includes("spacer.gif") ? r.cover_image : null,
    genres: (r.genre ?? []).join(", ") || null,
    styles: (r.style ?? []).join(", ") || null,
  };
}

/** Typed search: albums (masters) first, then single releases nobody grouped into a master. */
export async function searchAlbums(q: string): Promise<AlbumHit[]> {
  const masters = await discogs("/database/search", { q, type: "master", per_page: "15" });
  const out = (masters?.results ?? []).map(hitFrom) as AlbumHit[];
  if (out.length < 5) {
    const rel = await discogs("/database/search", { q, type: "release", per_page: "15" });
    const seen = new Set(out.map((h) => h.discogs_master_id));
    for (const r of rel?.results ?? []) {
      if (r.master_id && seen.has(r.master_id)) continue;
      if (r.master_id) seen.add(r.master_id);
      out.push(hitFrom(r));
    }
  }
  return out.slice(0, 20);
}

/** One pressing's details (format, label, country…). */
export async function releaseDetails(id: number): Promise<{ album: AlbumHit; pressing: PressingInfo } | null> {
  const r = await discogs(`/releases/${id}`);
  if (!r) return null;
  const fmts = (r.formats ?? []) as { name: string; qty?: string; descriptions?: string[]; text?: string }[];
  const description = fmts
    .map((f) => [Number(f.qty) > 1 ? `${f.qty}×${f.name}` : f.name, ...(f.descriptions ?? []), f.text].filter(Boolean).join(", "))
    .join(" + ") || null;
  const img = (r.images ?? []).find((i: any) => i.type === "primary") ?? r.images?.[0];
  return {
    album: {
      discogs_master_id: r.master_id || null,
      discogs_release_id: r.id,
      title: r.title,
      artist: artistsName(r.artists),
      year: year(r.year),
      cover_url: img?.uri ?? r.thumb ?? null,
      genres: (r.genres ?? []).join(", ") || null,
      styles: (r.styles ?? []).join(", ") || null,
    },
    pressing: {
      format: formatFrom(fmts),
      description,
      discogs_release_id: r.id,
      label: r.labels?.[0]?.name?.replace(/\s*\(\d+\)$/, "") ?? null,
      catno: r.labels?.[0]?.catno ?? null,
      country: r.country ?? null,
      year: year(r.year),
    },
  };
}

/** The album as a whole: original year and the nicest cover. */
export async function masterDetails(id: number): Promise<AlbumHit | null> {
  const m = await discogs(`/masters/${id}`);
  if (!m) return null;
  const img = (m.images ?? []).find((i: any) => i.type === "primary") ?? m.images?.[0];
  return {
    discogs_master_id: m.id,
    discogs_release_id: m.main_release ?? null,
    title: m.title,
    artist: artistsName(m.artists),
    year: year(m.year),
    cover_url: img?.uri ?? null,
    genres: (m.genres ?? []).join(", ") || null,
    styles: (m.styles ?? []).join(", ") || null,
  };
}

/** Barcode → the exact pressing. Cached like movie barcodes (Discogs allows 60 calls a minute). */
export async function albumByBarcode(barcode: string): Promise<{ album: AlbumHit; pressing: PressingInfo } | null> {
  if (!config.discogsToken) return null;
  const key = `discogs:${barcode}`;
  const cached = db.prepare("SELECT payload FROM barcode_cache WHERE barcode = ?").get(key) as { payload: string } | undefined;
  if (cached) return JSON.parse(cached.payload);
  const res = await discogs("/database/search", { barcode, type: "release", per_page: "5" });
  const hit = res?.results?.[0];
  let out: { album: AlbumHit; pressing: PressingInfo } | null = null;
  if (hit) {
    const base = hitFrom(hit);
    out = {
      album: base,
      pressing: {
        format: formatFrom(hit.format),
        description: (hit.format ?? []).join(", ") || null,
        discogs_release_id: hit.id,
        label: hit.label?.[0] ?? null,
        catno: hit.catno ?? null,
        country: hit.country ?? null,
        year: year(hit.year),
      },
    };
    // The album's original year (not this reissue's) when it's part of a master.
    if (base.discogs_master_id) {
      const m = await masterDetails(base.discogs_master_id).catch(() => null);
      if (m) out.album = { ...m, cover_url: m.cover_url ?? base.cover_url };
    }
  }
  db.prepare("INSERT OR REPLACE INTO barcode_cache(barcode, payload, fetched_at) VALUES (?, ?, ?)").run(key, JSON.stringify(out), Date.now());
  return out;
}

/** Sightings are keyed by a number; records use negative ids so they never clash with TMDB's. */
export const sightKey = (a: AlbumHit) => -(a.discogs_master_id ?? a.discogs_release_id ?? 0);

export const recordsRouter = Router();

/** GET /api/records/search?q=rumours */
recordsRouter.get("/records/search", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) { res.status(400).json({ error: "missing q" }); return; }
    res.json({ results: await searchAlbums(q) });
  } catch (e) { next(e); }
});

/** GET /api/records/master/:id — album details once picked (with cover colours). */
recordsRouter.get("/records/master/:id", async (req, res, next) => {
  try {
    const m = await masterDetails(Number(req.params.id));
    if (!m) { res.status(404).json({ error: "not found" }); return; }
    res.json({ ...m, palette: await coverColors(m.cover_url) });
  } catch (e) { next(e); }
});

/** GET /api/records/release/:id — one pressing (album + pressing info). */
recordsRouter.get("/records/release/:id", async (req, res, next) => {
  try {
    const r = await releaseDetails(Number(req.params.id));
    if (!r) { res.status(404).json({ error: "not found" }); return; }
    if (r.album.discogs_master_id) {
      const m = await masterDetails(r.album.discogs_master_id).catch(() => null);
      if (m) r.album = { ...m, cover_url: m.cover_url ?? r.album.cover_url };
    }
    res.json({ ...r, album: { ...r.album, palette: await coverColors(r.album.cover_url) } });
  } catch (e) { next(e); }
});

/** Used by /api/barcode when a barcode turns out to be a record. */
export async function recordBarcodeAnswer(barcode: string, store: boolean) {
  const found = await albumByBarcode(barcode).catch((e) => {
    console.warn("Discogs barcode lookup failed:", e?.message);
    return null;
  });
  if (!found) return null;
  const palette = cachedColors(found.album.cover_url);
  if (!palette) void coverColors(found.album.cover_url);
  const rarity = store ? sight(sightKey(found.album), [found.album.artist, found.album.title].filter(Boolean).join(" – "), "barcode") : null;
  return { kind: "album" as const, barcode, album: { ...found.album, palette }, pressing: found.pressing, rarity };
}

/**
 * GET /api/share/records — read-only list of the record collection for other apps
 * (CRATE DIGGER). Uses SHARE_TOKEN, so the other app never gets Keeper's main code.
 */
export function shareRecords() {
  const albums = db.prepare("SELECT * FROM albums WHERE deleted = 0 ORDER BY artist, year").all() as any[];
  const pressings = db.prepare("SELECT * FROM pressings WHERE deleted = 0").all() as any[];
  const by = new Map<string, any[]>();
  for (const p of pressings) by.set(p.album_id, [...(by.get(p.album_id) ?? []), p]);
  return albums
    .filter((a) => by.has(a.id))
    .map((a) => ({
      id: a.id,
      artist: a.artist,
      title: a.title,
      year: a.year,
      cover_url: a.cover_url,
      genres: a.genres,
      styles: a.styles,
      discogs_master_id: a.discogs_master_id,
      discogs_release_id: a.discogs_release_id,
      copies: by.get(a.id)!.map((p) => ({
        format: p.format,
        description: p.description,
        label: p.label,
        catno: p.catno,
        country: p.country,
        year: p.year,
        barcode: p.barcode,
        discogs_release_id: p.discogs_release_id,
        location: p.location,
        added_by: p.added_by,
        added_at: p.created_at,
      })),
    }));
}
