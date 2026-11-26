import { db } from "./db.js";

/**
 * Every disc you two look at in a store (barcode check, haul, shelf photo) is logged.
 * Over time Keeper learns what's common at your thrift stores and what's rare.
 * A "trip" = a day with at least one sighting.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS sightings (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  tmdb_id  INTEGER NOT NULL,
  title    TEXT,
  day      TEXT NOT NULL,     -- YYYY-MM-DD (local to the NAS)
  seen_at  INTEGER NOT NULL,
  source   TEXT NOT NULL      -- barcode | shelf
);
CREATE INDEX IF NOT EXISTS sightings_tmdb ON sightings(tmdb_id);
`);

export interface Rarity {
  /** Times seen on earlier trips (today's sightings don't count). */
  seen_before: number;
  /** Trips logged so far (incl. today). */
  trips: number;
  /** Never seen on an earlier trip, once Keeper has seen enough to judge (5+ trips, 150+ movies). */
  rare: boolean;
}

const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD

export function rarityFor(tmdbId: number): Rarity {
  const d = today();
  const seen = db.prepare("SELECT COUNT(DISTINCT day) n FROM sightings WHERE tmdb_id = ? AND day < ?").get(tmdbId, d) as { n: number };
  const trips = db.prepare("SELECT COUNT(DISTINCT day) n FROM sightings").get() as { n: number };
  const tripsInclToday = trips.n + ((db.prepare("SELECT 1 FROM sightings WHERE day = ? LIMIT 1").get(d)) ? 0 : 1);
  const pool = db.prepare("SELECT COUNT(DISTINCT tmdb_id) n FROM sightings").get() as { n: number };
  return { seen_before: seen.n, trips: tripsInclToday, rare: seen.n === 0 && tripsInclToday >= 5 && pool.n >= 150 };
}

/** Log a sighting (once per movie per day) and return how rare it is. */
export function sight(tmdbId: number, title: string, source: "barcode" | "shelf"): Rarity {
  const r = rarityFor(tmdbId);
  const d = today();
  const already = db.prepare("SELECT 1 FROM sightings WHERE tmdb_id = ? AND day = ? LIMIT 1").get(tmdbId, d);
  if (!already) db.prepare("INSERT INTO sightings(tmdb_id, title, day, seen_at, source) VALUES (?, ?, ?, ?, ?)").run(tmdbId, title, d, Date.now(), source);
  return r;
}
