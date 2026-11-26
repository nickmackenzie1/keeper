export type Format = "dvd" | "bluray" | "uhd" | "other";

export const FORMATS: Format[] = ["dvd", "bluray", "uhd", "other"];

export const FORMAT_LABEL: Record<Format, string> = {
  dvd: "DVD",
  bluray: "Blu-ray",
  uhd: "4K UHD",
  other: "Other",
};

export const FORMAT_SHORT: Record<Format, string> = {
  dvd: "DVD",
  bluray: "BD",
  uhd: "4K",
  other: "?",
};

/** Higher = better. `other` is unranked. */
export const FORMAT_RANK: Record<Format, number> = { dvd: 1, bluray: 2, uhd: 3, other: 0 };

/** Only DVDs get upgraded: once you own it on Blu-ray or 4K, you're set. */
export const isUpgradeOver = (scanned: Format, owned: Format[]) =>
  scanned !== "other" && FORMAT_RANK[scanned] >= FORMAT_RANK.bluray && !owned.some((f) => FORMAT_RANK[f] >= FORMAT_RANK.bluray);

/** Field names match the server's rows exactly, plus a local `dirty` flag (1 = not yet synced). */
export interface Movie {
  id: string;
  tmdb_id: number | null;
  title: string;
  year: number | null;
  poster_path: string | null;
  overview: string | null;
  runtime: number | null;
  genres: string | null; // "Horror, Science Fiction"
  collection_id: number | null; // TMDB collection = series
  collection_name: string | null;
  certification: string | null; // age rating, e.g. "PG", "14A"
  poster_bg?: string | null; // colours picked from the poster (by the server)
  poster_accent?: string | null;
  palette_for?: string | null;
  updated_at: number;
  updated_by: string;
  deleted: boolean;
  dirty: 0 | 1;
}

export interface Copy {
  id: string;
  movie_id: string;
  format: Format;
  barcode: string | null;
  edition: string | null;
  location: string | null;
  notes: string | null;
  upgrade_wanted: boolean;
  added_by: string | null;
  created_at: number | null; // when it was added to the collection
  updated_at: number;
  updated_by: string;
  deleted: boolean;
  dirty: 0 | 1;
}

/** A movie or album one of you is hunting for (shared between phones). */
export interface Hunt {
  kind?: "movie" | "album" | null; // null = movie (older rows)
  artist?: string | null;
  discogs_id?: number | null; // album master id (or release id)
  cover_url?: string | null;
  id: string;
  tmdb_id: number | null;
  title: string;
  year: number | null;
  poster_path: string | null;
  notes: string | null;
  found: boolean;
  found_by: string | null;
  added_by: string | null;
  updated_at: number;
  updated_by: string;
  deleted: boolean;
  dirty: 0 | 1;
}

export interface Series {
  collection_id: number;
  name: string;
  owned: number;
  total: number;
  parts: { tmdb_id: number; title: string; year: number | null; poster_path: string | null; owned: boolean }[];
}

export interface TmdbHit {
  tmdb_id: number;
  title: string;
  year: number | null;
  poster_path: string | null;
  overview: string;
  runtime?: number | null;
  rating?: number | null;
  votes?: number | null;
  genres?: string | null;
  certification?: string | null;
  palette?: { bg: string; accent: string } | null;
  collection_id?: number | null;
  collection_name?: string | null;
}

export interface BarcodeLookup {
  kind?: "movie";
  barcode: string;
  product_title: string | null;
  format: Format | null;
  candidates: TmdbHit[];
  rarity?: Rarity | null;
}

/** How often you've seen this movie on store trips (logged by the server). */
export interface Rarity {
  seen_before: number;
  trips: number;
  rare: boolean;
}

export interface ShelfSpine {
  kind?: "movie" | "album";
  artist?: string | null;
  album?: AlbumHit | null;
  title: string;
  year: number | null;
  format: Format | RecordFormat | "unknown";
  label: string | null;
  edition: string | null;
  collector: boolean;
  collector_reason: string | null;
  confidence: "high" | "medium" | "low";
  match: (TmdbHit & { collection_id: number | null; collection_name: string | null }) | null;
  rarity: Rarity | null;
}

export const posterUrl = (path: string | null, size: "w185" | "w342" | "w500" = "w342") =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null;

// ---------- Records ----------

export type RecordFormat = "vinyl" | "cd" | "cassette" | "other";
export const RECORD_FORMATS: RecordFormat[] = ["vinyl", "cd", "cassette", "other"];
export const RECORD_LABEL: Record<RecordFormat, string> = { vinyl: "Vinyl", cd: "CD", cassette: "Cassette", other: "Other" };
export const RECORD_SHORT: Record<RecordFormat, string> = { vinyl: "LP", cd: "CD", cassette: "TAPE", other: "?" };

export interface Album {
  id: string;
  discogs_master_id: number | null;
  discogs_release_id: number | null;
  title: string;
  artist: string | null;
  year: number | null;
  cover_url: string | null;
  genres: string | null;
  styles: string | null;
  cover_bg?: string | null;
  cover_accent?: string | null;
  palette_for?: string | null;
  updated_at: number;
  updated_by: string;
  deleted: boolean;
  dirty: 0 | 1;
}

/** One physical copy of an album: a specific pressing on vinyl, CD or tape. */
export interface Pressing {
  id: string;
  album_id: string;
  format: RecordFormat;
  description: string | null; // "2×Vinyl, LP, Reissue, Red"
  discogs_release_id: number | null;
  barcode: string | null;
  label: string | null;
  catno: string | null;
  country: string | null;
  year: number | null;
  location: string | null;
  notes: string | null;
  added_by: string | null;
  created_at: number | null;
  updated_at: number;
  updated_by: string;
  deleted: boolean;
  dirty: 0 | 1;
}

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

/** /api/barcode answer when the barcode is a record. */
export interface RecordLookup {
  kind: "album";
  barcode: string;
  album: AlbumHit;
  pressing: PressingInfo;
  rarity?: Rarity | null;
}
