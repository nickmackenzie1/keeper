import type { TmdbHit } from "./types";

/** Movies we've already seen in search results or scans, so picking one opens instantly. */
const hits = new Map<number, TmdbHit>();
export function rememberHits(list: TmdbHit[] | undefined) {
  for (const h of list ?? []) if (h?.tmdb_id) hits.set(h.tmdb_id, { ...hits.get(h.tmdb_id), ...h });
  if (hits.size > 600) hits.delete(hits.keys().next().value!);
}
export const knownHit = (id: number) => hits.get(id);
