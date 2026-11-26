import { allHunts, allMovies, copiesByBarcode, copiesFor, getMovie, movieByTmdb } from "./db";
import { ApiError, lookupBarcode } from "./api";
import { isUpgradeOver, type BarcodeLookup, type Copy, type Format, type Hunt, type Movie, type Rarity, type ShelfSpine } from "./types";

export type VerdictKind = "not_owned" | "upgrade" | "have" | "owned";

export interface Verdict {
  kind: VerdictKind;
  movie: Movie | null;
  copies: Copy[];
  /** Format of the disc in your hand, if known. */
  scanned: Format | null;
  /** Online barcode lookup, when we had to do one. */
  lookup?: BarcodeLookup;
  /** We couldn't identify the disc at all (offline + unknown barcode). */
  unknown?: boolean;
  /** It's on the hunt list! */
  hunt?: Hunt;
  /** This exact barcode is already in the collection. */
  exact?: boolean;
  /** How often you've seen it on store trips. */
  rarity?: Rarity | null;
}

/** Core rule: compare the disc in hand with what we own. */
export function judge(movie: Movie | null, copies: Copy[], scanned: Format | null): Verdict {
  if (!movie || copies.length === 0) return { kind: "not_owned", movie, copies, scanned };
  if (!scanned || scanned === "other") return { kind: "owned", movie, copies, scanned };
  return { kind: isUpgradeOver(scanned, copies.map((c) => c.format)) ? "upgrade" : "have", movie, copies, scanned };
}

export const normalizeTitle = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/^(the|a|an)\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Offline title search over the local collection. */
export async function searchLocal(q: string): Promise<Movie[]> {
  const n = normalizeTitle(q);
  if (!n) return [];
  const words = n.split(" ");
  const movies = await allMovies();
  return movies
    .map((m) => {
      const t = normalizeTitle(m.title);
      const score = t === n ? 3 : t.startsWith(n) ? 2 : words.every((w) => t.includes(w)) ? 1 : 0;
      return { m, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.m.title.localeCompare(b.m.title))
    .map((x) => x.m);
}

/** Open (not yet found) hunts matching any of these TMDB ids or this title. */
export async function matchHunt(tmdbIds: number[], title?: string | null): Promise<Hunt | undefined> {
  const want = title ? normalizeTitle(title) : null;
  return (await allHunts()).find(
    (h) => !h.found && ((h.tmdb_id != null && tmdbIds.includes(h.tmdb_id)) || (want && normalizeTitle(h.title) === want)),
  );
}

/** Hunts whose title matches a typed search (offline). */
export async function searchHunts(q: string): Promise<Hunt[]> {
  const n = normalizeTitle(q);
  if (!n) return [];
  return (await allHunts()).filter((h) => !h.found && normalizeTitle(h.title).includes(n));
}

/**
 * Barcode → verdict.
 * 1) Exact barcode already in our collection: instant, offline.
 * 2) Online: ask the server what the barcode is, then match by TMDB id or title.
 * 3) Offline and unknown: say so, suggest typing the title.
 */
export async function verdictForBarcode(code: string, opts: { store?: boolean } = {}): Promise<Verdict> {
  const exact = await copiesByBarcode(code);
  if (exact.length) {
    const movie = (await getMovie(exact[0].movie_id)) ?? null;
    const copies = movie ? await copiesFor(movie.id) : exact;
    const v = judge(movie, copies, exact[0].format);
    // Same barcode = this exact disc edition; it's never an upgrade.
    return { ...v, kind: "have", exact: true };
  }

  let lookup: BarcodeLookup;
  try {
    lookup = await lookupBarcode(code, opts.store);
  } catch (e) {
    if (e instanceof ApiError) return { kind: "not_owned", movie: null, copies: [], scanned: null, unknown: true };
    throw e;
  }
  // Records arrive in the next update; until then a record barcode is just "unknown".
  if (!Array.isArray(lookup.candidates)) return { kind: "not_owned", movie: null, copies: [], scanned: null, unknown: true };

  let movie: Movie | null = null;
  for (const c of lookup.candidates.slice(0, 3)) {
    movie = (await movieByTmdb(c.tmdb_id)) ?? null;
    if (movie) break;
  }
  if (!movie && lookup.candidates[0]) {
    const want = normalizeTitle(lookup.candidates[0].title);
    movie = (await allMovies()).find((m) => normalizeTitle(m.title) === want) ?? null;
  }
  const copies = movie ? await copiesFor(movie.id) : [];
  const v: Verdict = { ...judge(movie, copies, lookup.format), lookup, unknown: !lookup.product_title, rarity: lookup.rarity };
  if (v.kind === "not_owned" || v.kind === "upgrade") {
    v.hunt = await matchHunt(lookup.candidates.slice(0, 3).map((c) => c.tmdb_id), lookup.candidates[0]?.title);
  }
  return v;
}

/** Cover photo → verdict, same shape as a barcode check. */
export async function verdictForCover(spine: ShelfSpine | null): Promise<Verdict> {
  if (!spine) return { kind: "not_owned", movie: null, copies: [], scanned: null, unknown: true };
  const fmt = spine.format === "unknown" ? null : (spine.format as Format);
  let movie: Movie | null = spine.match ? ((await movieByTmdb(spine.match.tmdb_id)) ?? null) : null;
  if (!movie) {
    const want = normalizeTitle(spine.match?.title ?? spine.title);
    movie = (await allMovies()).find((m) => normalizeTitle(m.title) === want) ?? null;
  }
  const copies = movie ? await copiesFor(movie.id) : [];
  const lookup: BarcodeLookup = { barcode: "", product_title: spine.title, format: fmt, candidates: spine.match ? [spine.match] : [] };
  const v: Verdict = { ...judge(movie, copies, fmt), lookup, unknown: !spine.match && !movie, rarity: spine.rarity };
  if (v.kind === "not_owned" || v.kind === "upgrade") v.hunt = await matchHunt(spine.match ? [spine.match.tmdb_id] : [], spine.match?.title ?? spine.title);
  return v;
}
