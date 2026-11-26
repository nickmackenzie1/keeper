import { allCopies, allHunts, allMovies, getMeta, setMeta } from "./db";
import { FORMAT_RANK, type Copy, type Hunt, type Movie, type Series } from "./types";

export interface Achievement {
  id: string;
  title: string;
  desc: string;
  unlocked: boolean;
  /** For locked ones with a count: how far along. */
  progress?: { have: number; need: number };
}

export interface CollectionData {
  movies: Movie[];
  copies: Copy[];
  hunts: Hunt[];
  series: Series[];
  bestHaul: number;
}

export async function loadCollection(): Promise<CollectionData> {
  return {
    movies: await allMovies(),
    copies: await allCopies(),
    hunts: await allHunts(),
    series: (await getMeta("series")) ?? [],
    bestHaul: (await getMeta("bestHaul")) ?? 0,
  };
}

const count = (id: string, title: string, desc: string, have: number, need: number): Achievement => ({
  id,
  title,
  desc,
  unlocked: have >= need,
  progress: { have: Math.min(have, need), need },
});

export function computeAchievements(d: CollectionData): Achievement[] {
  const discs = d.copies.length;
  const byFormat = (f: Copy["format"]) => d.copies.filter((c) => c.format === f).length;
  const ownedMovieIds = new Set(d.copies.map((c) => c.movie_id));
  const owned = d.movies.filter((m) => ownedMovieIds.has(m.id));
  const decades = new Set(owned.filter((m) => m.year).map((m) => Math.floor(m.year! / 10)));

  // A movie that has a DVD and something better = an upgrade done.
  const byMovie = new Map<string, Copy[]>();
  for (const c of d.copies) byMovie.set(c.movie_id, [...(byMovie.get(c.movie_id) ?? []), c]);
  const upgradesDone = [...byMovie.values()].filter(
    (cs) => cs.some((c) => c.format === "dvd") && cs.some((c) => FORMAT_RANK[c.format] > FORMAT_RANK.dvd),
  ).length;

  const genreCounts = new Map<string, number>();
  for (const m of owned) for (const g of (m.genres ?? "").split(",").map((s) => s.trim()).filter(Boolean)) genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
  const topGenre = [...genreCounts.entries()].sort((a, b) => b[1] - a[1])[0];

  const list: Achievement[] = [
    count("first_disc", "Opening Night", "Add your first disc", discs, 1),
    count("discs_10", "Shelf Starter", "10 discs", discs, 10),
    count("discs_50", "Collector", "50 discs", discs, 50),
    count("discs_100", "Century Club", "100 discs", discs, 100),
    count("discs_250", "Video Store", "250 discs", discs, 250),
    count("discs_500", "Megaplex", "500 discs", discs, 500),
    count("first_bluray", "High Def", "Your first Blu-ray", byFormat("bluray"), 1),
    count("first_4k", "First 4K", "Your first 4K UHD", byFormat("uhd"), 1),
    count("uhd_10", "4K Club", "10 discs in 4K", byFormat("uhd"), 10),
    count("upgrade_1", "Upgraded!", "Own a movie on DVD and something better", upgradesDone, 1),
    count("upgrade_10", "Glow Up", "Upgrade 10 movies", upgradesDone, 10),
    count("decades_5", "Time Traveller", "Movies from 5 different decades", decades.size, 5),
    { id: "golden_age", title: "Golden Age", desc: "Own a movie from before 1960", unlocked: owned.some((m) => (m.year ?? 9999) < 1960) },
    count("genre_10", topGenre ? `${topGenre[0]} Fan` : "Genre Fan", "10 movies in one genre", topGenre?.[1] ?? 0, 10),
    count("hunter", "The Hunt Is Over", "Find something from the hunt list", d.hunts.filter((h) => h.found).length, 1),
    count("hunter_10", "Bounty Hunter", "Find 10 hunted movies", d.hunts.filter((h) => h.found).length, 10),
    count("haul_10", "Haul Hero", "Add 10+ discs from one haul", d.bestHaul, 10),
  ];

  // One per series you've completed (2+ movies), e.g. "Completed the Back to the Future Collection".
  for (const s of d.series) {
    if (s.total >= 2 && s.owned >= s.total) {
      list.push({ id: `series_${s.collection_id}`, title: `Completed ${s.name.replace(/ Collection$/, "")}`, desc: `All ${s.total} movies`, unlocked: true });
    }
  }
  return list;
}

/**
 * Returns achievements unlocked since last check. The first run on a phone just
 * records what's already unlocked, so existing collections don't get a flood.
 */
export async function newlyUnlocked(): Promise<Achievement[]> {
  const all = computeAchievements(await loadCollection()).filter((a) => a.unlocked);
  const seen = await getMeta("seenAchievements");
  await setMeta("seenAchievements", all.map((a) => a.id));
  if (!seen) return [];
  const s = new Set(seen);
  return all.filter((a) => !s.has(a.id));
}
