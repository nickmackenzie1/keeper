import { log } from "./log";
import { uuid } from "./uuid";
import { tmdbDetails } from "./api";
import { copiesFor, getMeta, getMovie, markHuntsFound, movieByTmdb, saveCopy, saveMovie } from "./db";
import { FORMAT_RANK, type Copy, type Format, type Movie, type TmdbHit } from "./types";

export interface AddDiscInput {
  movie?: Movie;
  tmdb?: TmdbHit;
  manual?: { title: string; year: number | null };
  format: Format;
  barcode?: string | null;
  edition?: string | null;
  location?: string | null;
  notes?: string | null;
}

/**
 * Add one disc to the collection — used by the Add screen and by haul mode.
 * Reuses the movie if we already have it, fills in genres/series from TMDB when
 * online, clears "wants upgrade" on worse copies, and ticks off any matching hunt.
 */
export async function addDisc(input: AddDiscInput): Promise<{ movie: Movie; copy: Copy }> {
  let movie = input.movie ?? (input.tmdb ? await movieByTmdb(input.tmdb.tmdb_id) : undefined);

  let fillIn = false;
  if (!movie) {
    // Save straight away with what we already know; the rest (runtime, genres, series, age rating)
    // is filled in afterwards in the background, so adding never waits on the internet.
    const d: Partial<TmdbHit> = input.tmdb ?? {};
    fillIn = !!input.tmdb && d.genres === undefined;
    movie = await saveMovie({
      id: uuid(),
      tmdb_id: input.tmdb?.tmdb_id ?? null,
      title: input.manual?.title ?? d.title ?? "Untitled",
      year: input.manual ? input.manual.year : d.year ?? null,
      poster_path: d.poster_path ?? null,
      overview: d.overview ?? null,
      runtime: d.runtime ?? null,
      genres: d.genres ?? null,
      collection_id: d.collection_id ?? null,
      collection_name: d.collection_name ?? null,
      certification: d.certification ?? null,
      poster_bg: d.palette?.bg ?? null,
      poster_accent: d.palette?.accent ?? null,
      palette_for: d.palette ? d.poster_path ?? null : null,
      deleted: false,
    });
  }

  // Got a better version: the old ones no longer need upgrading.
  const existing = await copiesFor(movie.id);
  for (const c of existing) {
    if (c.upgrade_wanted && FORMAT_RANK[c.format] < FORMAT_RANK[input.format]) {
      const { updated_at: _u, updated_by: _b, dirty: _d, ...rest } = c;
      await saveCopy({ ...rest, upgrade_wanted: false });
    }
  }

  const copy = await saveCopy({
    id: uuid(),
    movie_id: movie.id,
    format: input.format,
    barcode: input.barcode ?? null,
    edition: input.edition?.trim() || null,
    location: input.location?.trim() || null,
    notes: input.notes?.trim() || null,
    upgrade_wanted: false,
    added_by: (await getMeta("deviceName")) ?? null,
    created_at: Date.now(),
    deleted: false,
  });

  await markHuntsFound(movie.tmdb_id, movie.title);
  log("add", `Added ${movie.title} (${input.format})`);
  if (fillIn && input.tmdb) void fillInDetails(movie.id, input.tmdb.tmdb_id);
  return { movie, copy };
}

/** After an add: fetch the full details and update the movie (only the gaps; never overwrites edits). */
async function fillInDetails(movieId: string, tmdbId: number) {
  try {
    const d = await tmdbDetails(tmdbId);
    const m = await getMovie(movieId);
    if (!m || m.tmdb_id !== tmdbId) return;
    const { updated_at: _u, updated_by: _b, dirty: _d, ...rest } = m;
    await saveMovie({
      ...rest,
      poster_path: rest.poster_path ?? d.poster_path ?? null,
      overview: rest.overview ?? d.overview ?? null,
      runtime: rest.runtime ?? d.runtime ?? null,
      genres: rest.genres ?? d.genres ?? null,
      collection_id: rest.collection_id ?? d.collection_id ?? null,
      collection_name: rest.collection_name ?? d.collection_name ?? null,
      certification: rest.certification ?? d.certification ?? null,
      poster_bg: rest.poster_bg ?? d.palette?.bg ?? null,
      poster_accent: rest.poster_accent ?? d.palette?.accent ?? null,
      palette_for: rest.palette_for ?? (d.palette ? d.poster_path ?? null : null),
    });
  } catch (e) {
    log("info", `Details for a new movie will fill in later (${e instanceof Error ? e.message : "offline"})`);
  }
}
