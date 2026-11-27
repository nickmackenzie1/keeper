import type { Album, Copy, Movie, Pressing } from "./types";

/**
 * Catalogue numbers, like a boutique label's spine numbers: every movie and record gets a number
 * in the order it joined the collection (No. 0001 is the first thing you ever added).
 */
export function catalogue(movies: Movie[], copies: Copy[], albums: Album[], pressings: Pressing[]): Map<string, number> {
  const first = new Map<string, number>();
  const note = (id: string, t: number | null | undefined) => {
    if (t == null) return;
    const cur = first.get(id);
    if (cur == null || t < cur) first.set(id, t);
  };
  for (const c of copies) note(c.movie_id, c.created_at ?? c.updated_at);
  for (const p of pressings) note(p.album_id, p.created_at ?? p.updated_at);
  const items = [
    ...movies.filter((m) => first.has(m.id)).map((m) => ({ id: m.id, t: first.get(m.id)! })),
    ...albums.filter((a) => first.has(a.id)).map((a) => ({ id: a.id, t: first.get(a.id)! })),
  ].sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
  return new Map(items.map((x, i) => [x.id, i + 1]));
}

export const fmtNo = (n: number | undefined) => (n ? `No. ${String(n).padStart(4, "0")}` : "");
