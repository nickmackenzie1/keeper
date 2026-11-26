import { allMovies, copiesByBarcode, copiesFor, getMovie, movieByTmdb } from "./db";
import { ApiError, lookupBarcode } from "./api";
import { FORMAT_RANK, type BarcodeLookup, type Copy, type Format, type Movie } from "./types";

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
}

/** Core rule: compare the disc in hand with what we own. */
export function judge(movie: Movie | null, copies: Copy[], scanned: Format | null): Verdict {
  if (!movie || copies.length === 0) return { kind: "not_owned", movie, copies, scanned };
  if (!scanned || scanned === "other") return { kind: "owned", movie, copies, scanned };
  const best = Math.max(...copies.map((c) => FORMAT_RANK[c.format]));
  return { kind: FORMAT_RANK[scanned] > best ? "upgrade" : "have", movie, copies, scanned };
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

/**
 * Barcode → verdict.
 * 1) Exact barcode already in our collection: instant, offline.
 * 2) Online: ask the server what the barcode is, then match by TMDB id or title.
 * 3) Offline and unknown: say so, suggest typing the title.
 */
export async function verdictForBarcode(code: string): Promise<Verdict> {
  const exact = await copiesByBarcode(code);
  if (exact.length) {
    const movie = (await getMovie(exact[0].movie_id)) ?? null;
    const copies = movie ? await copiesFor(movie.id) : exact;
    const v = judge(movie, copies, exact[0].format);
    // Same barcode = this exact disc edition; it's never an upgrade.
    return v.kind === "upgrade" ? { ...v, kind: "have" } : v;
  }

  let lookup: BarcodeLookup;
  try {
    lookup = await lookupBarcode(code);
  } catch (e) {
    if (e instanceof ApiError) return { kind: "not_owned", movie: null, copies: [], scanned: null, unknown: true };
    throw e;
  }

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
  return { ...judge(movie, copies, lookup.format), lookup, unknown: !lookup.product_title };
}
