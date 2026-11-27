import { log } from "./log";
import { uuid } from "./uuid";
import { recordMaster } from "./api";
import {
  albumByDiscogs,
  allAlbums,
  allHunts,
  getAlbum,
  getMeta,
  markAlbumHuntsFound,
  pressingsByBarcode,
  pressingsFor,
  saveAlbum,
  savePressing,
} from "./db";
import { normalizeTitle } from "./verdict";
import type { Album, AlbumHit, Hunt, Pressing, PressingInfo, Rarity, RecordFormat, RecordLookup } from "./types";

// ---------- adding ----------

export interface AddRecordInput {
  album?: Album;
  hit?: AlbumHit;
  manual?: { artist: string; title: string; year: number | null };
  format: RecordFormat;
  pressing?: Partial<PressingInfo>;
  barcode?: string | null;
  location?: string | null;
  notes?: string | null;
}

/** Add one record. Saves at once; the album's original year and best cover fill in afterwards. */
export async function addRecord(input: AddRecordInput): Promise<{ album: Album; pressing: Pressing }> {
  let album = input.album ?? (input.hit ? await albumByDiscogs(input.hit.discogs_master_id, input.hit.discogs_release_id) : undefined);
  let fillIn = false;
  if (!album) {
    const h = input.hit;
    album = await saveAlbum({
      id: uuid(),
      discogs_master_id: h?.discogs_master_id ?? null,
      discogs_release_id: h?.discogs_release_id ?? null,
      title: input.manual?.title ?? h?.title ?? "Untitled",
      artist: input.manual?.artist ?? h?.artist ?? null,
      year: input.manual ? input.manual.year : h?.year ?? null,
      cover_url: h?.cover_url ?? null,
      genres: h?.genres ?? null,
      styles: h?.styles ?? null,
      cover_bg: h?.palette?.bg ?? null,
      cover_accent: h?.palette?.accent ?? null,
      palette_for: h?.palette ? h.cover_url ?? null : null,
      deleted: false,
    });
    fillIn = !!h?.discogs_master_id;
  }
  const p = input.pressing ?? {};
  const pressing = await savePressing({
    id: uuid(),
    album_id: album.id,
    format: input.format,
    description: p.description ?? null,
    discogs_release_id: p.discogs_release_id ?? null,
    barcode: input.barcode ?? null,
    label: p.label ?? null,
    catno: p.catno ?? null,
    country: p.country ?? null,
    year: p.year ?? null,
    location: input.location?.trim() || null,
    notes: input.notes?.trim() || null,
    added_by: (await getMeta("deviceName")) ?? null,
    created_at: Date.now(),
    deleted: false,
  });
  log("add", `Added ${album.artist ? album.artist + " – " : ""}${album.title} (${input.format})`);
  await markAlbumHuntsFound(album.discogs_master_id ?? album.discogs_release_id, album.artist, album.title);
  if (fillIn && album.discogs_master_id) void fillInAlbum(album.id, album.discogs_master_id);
  return { album, pressing };
}

async function fillInAlbum(albumId: string, master: number) {
  try {
    const m = await recordMaster(master);
    const a = await getAlbum(albumId);
    if (!a) return;
    const { updated_at: _u, updated_by: _b, dirty: _d, ...rest } = a;
    await saveAlbum({
      ...rest,
      year: m.year ?? rest.year,
      cover_url: rest.cover_url ?? m.cover_url,
      genres: rest.genres ?? m.genres,
      styles: rest.styles ?? m.styles,
      cover_bg: rest.cover_bg ?? m.palette?.bg ?? null,
      cover_accent: rest.cover_accent ?? m.palette?.accent ?? null,
      palette_for: rest.palette_for ?? (m.palette ? m.cover_url : null),
    });
  } catch {
    /* offline: the server colours it in later */
  }
}

// ---------- in the store ----------

/**
 * new      — you don't own this album
 * have     — you own this exact pressing (same barcode or Discogs release)
 * pressing — you own the album on the same format, a different pressing
 * upgrade  — it's on vinyl and you only have it on CD or tape
 * owned    — you own it on vinyl and this is a CD/tape (or the format's unknown)
 */
export type RecordKind = "new" | "have" | "pressing" | "upgrade" | "owned";

export interface RecordVerdict {
  kind: RecordKind;
  album: Album | null;
  pressings: Pressing[];
  hit: AlbumHit | null;
  scanned: Partial<PressingInfo> | null;
  hunt?: Hunt;
  rarity?: Rarity | null;
  exact?: boolean;
  barcode?: string | null;
}

export function judgeRecord(album: Album | null, pressings: Pressing[], scanned: Partial<PressingInfo> | null): RecordKind {
  if (!album || !pressings.length) return "new";
  if (scanned?.discogs_release_id && pressings.some((p) => p.discogs_release_id === scanned.discogs_release_id)) return "have";
  const fmt = scanned?.format;
  if (!fmt || fmt === "other") return "owned";
  const hasVinyl = pressings.some((p) => p.format === "vinyl");
  if (fmt === "vinyl" && !hasVinyl) return "upgrade";
  if (pressings.some((p) => p.format === fmt)) return "pressing";
  return "owned";
}

const albumKey = (artist: string | null | undefined, title: string) => `${normalizeTitle(artist ?? "")}|${normalizeTitle(title)}`;

async function findAlbum(hit: AlbumHit | null): Promise<Album | null> {
  if (!hit) return null;
  const byId = await albumByDiscogs(hit.discogs_master_id, hit.discogs_release_id);
  if (byId) return byId;
  const want = albumKey(hit.artist, hit.title);
  return (await allAlbums()).find((a) => albumKey(a.artist, a.title) === want) ?? null;
}

export async function matchAlbumHunt(hit: AlbumHit | null, artist?: string | null, title?: string | null): Promise<Hunt | undefined> {
  const id = hit?.discogs_master_id ?? hit?.discogs_release_id ?? null;
  const want = albumKey(artist ?? hit?.artist, title ?? hit?.title ?? "");
  return (await allHunts()).find((h) => !h.found && h.kind === "album" && ((id && h.discogs_id === id) || albumKey(h.artist, h.title) === want));
}

/** A record barcode we already own: answered offline, instantly. */
export async function recordVerdictForOwnedBarcode(code: string): Promise<RecordVerdict | null> {
  const exact = await pressingsByBarcode(code);
  if (!exact.length) return null;
  const album = (await getAlbum(exact[0].album_id)) ?? null;
  const pressings = album ? await pressingsFor(album.id) : exact;
  return { kind: "have", album, pressings, hit: null, scanned: exact[0], exact: true };
}

/** The server said this barcode is a record. */
export async function recordVerdictFromLookup(r: RecordLookup): Promise<RecordVerdict> {
  const album = await findAlbum(r.album);
  const pressings = album ? await pressingsFor(album.id) : [];
  const kind = judgeRecord(album, pressings, r.pressing);
  const v: RecordVerdict = { kind, album, pressings, hit: r.album, scanned: r.pressing, rarity: r.rarity, barcode: r.barcode };
  if (kind === "new" || kind === "upgrade") v.hunt = await matchAlbumHunt(r.album);
  return v;
}

/** A cover photo the AI read as an album. */
export async function recordVerdictFromCover(hit: AlbumHit | null, read: { artist?: string | null; title: string; format?: string }, rarity?: Rarity | null): Promise<RecordVerdict> {
  const album = (await findAlbum(hit)) ?? (await allAlbums()).find((a) => albumKey(a.artist, a.title) === albumKey(read.artist, read.title)) ?? null;
  const pressings = album ? await pressingsFor(album.id) : [];
  const fmt = (["vinyl", "cd", "cassette"].includes(read.format ?? "") ? read.format : null) as RecordFormat | null;
  const scanned = fmt ? { format: fmt } : null;
  const kind = judgeRecord(album, pressings, scanned);
  const v: RecordVerdict = { kind, album, pressings, hit, scanned, rarity };
  if (kind === "new" || kind === "upgrade") v.hunt = await matchAlbumHunt(hit, read.artist, read.title);
  return v;
}

/** Offline search over your records by artist or title. */
export async function searchLocalAlbums(q: string): Promise<Album[]> {
  const n = normalizeTitle(q);
  if (!n) return [];
  const words = n.split(" ");
  return (await allAlbums())
    .map((a) => {
      const hay = `${normalizeTitle(a.artist ?? "")} ${normalizeTitle(a.title)}`;
      return { a, score: words.every((w) => hay.includes(w)) ? (normalizeTitle(a.title).startsWith(n) ? 2 : 1) : 0 };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || x.a.title.localeCompare(y.a.title))
    .map((x) => x.a);
}
