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

/** Field names match the server's rows exactly, plus a local `dirty` flag (1 = not yet synced). */
export interface Movie {
  id: string;
  tmdb_id: number | null;
  title: string;
  year: number | null;
  poster_path: string | null;
  overview: string | null;
  runtime: number | null;
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
  updated_at: number;
  updated_by: string;
  deleted: boolean;
  dirty: 0 | 1;
}

export interface TmdbHit {
  tmdb_id: number;
  title: string;
  year: number | null;
  poster_path: string | null;
  overview: string;
  runtime?: number | null;
}

export interface BarcodeLookup {
  barcode: string;
  product_title: string | null;
  format: Format | null;
  candidates: TmdbHit[];
}

export const posterUrl = (path: string | null, size: "w185" | "w342" | "w500" = "w342") =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
