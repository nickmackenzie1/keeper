import { uuid } from "./uuid";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Album, Copy, Hunt, Movie, Pressing, Series } from "./types";

/**
 * The phone's own copy of the collection (IndexedDB). Everything in the app reads
 * from here, so the in-store check works with no signal at all.
 */
interface KeeperDB extends DBSchema {
  movies: { key: string; value: Movie; indexes: { tmdb_id: number; dirty: number } };
  copies: { key: string; value: Copy; indexes: { movie_id: string; barcode: string; dirty: number } };
  hunts: { key: string; value: Hunt; indexes: { dirty: number } };
  albums: { key: string; value: Album; indexes: { dirty: number } };
  pressings: { key: string; value: Pressing; indexes: { album_id: string; barcode: string; dirty: number } };
  meta: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<KeeperDB>> | null = null;

export function openKeeper() {
  if (!dbPromise) {
    dbPromise = openDB<KeeperDB>("keeper", 3, {
      upgrade(db, oldVersion) {
        if (oldVersion < 3) {
          // Records (v3): albums and their pressings.
          db.createObjectStore("albums", { keyPath: "id" }).createIndex("dirty", "dirty");
          const p = db.createObjectStore("pressings", { keyPath: "id" });
          p.createIndex("album_id", "album_id");
          p.createIndex("barcode", "barcode");
          p.createIndex("dirty", "dirty");
        }
        if (oldVersion < 2) {
          const hunts = db.createObjectStore("hunts", { keyPath: "id" });
          hunts.createIndex("dirty", "dirty");
        }
        if (oldVersion >= 1) return;
        const movies = db.createObjectStore("movies", { keyPath: "id" });
        movies.createIndex("tmdb_id", "tmdb_id");
        movies.createIndex("dirty", "dirty");
        const copies = db.createObjectStore("copies", { keyPath: "id" });
        copies.createIndex("movie_id", "movie_id");
        copies.createIndex("barcode", "barcode");
        copies.createIndex("dirty", "dirty");
        db.createObjectStore("meta");
      },
    });
  }
  return dbPromise;
}

// ---------- meta ----------

export interface Meta {
  token: string;
  deviceId: string;
  deviceName: string;
  cursor: number;
  lastSyncAt: number; // server time of last successful sync (ms)
  forceFull: boolean;
  theme: string;
  series: Series[]; // last /api/series answer, for offline
  seenAchievements: string[];
  bestHaul: number;
}

export async function getMeta<K extends keyof Meta>(key: K): Promise<Meta[K] | undefined> {
  return (await (await openKeeper()).get("meta", key)) as Meta[K] | undefined;
}

export async function setMeta<K extends keyof Meta>(key: K, value: Meta[K]) {
  await (await openKeeper()).put("meta", value, key);
}

export async function deviceId(): Promise<string> {
  let id = await getMeta("deviceId");
  if (!id) {
    id = uuid();
    await setMeta("deviceId", id);
  }
  return id;
}

// ---------- reads ----------

export async function allMovies(): Promise<Movie[]> {
  const rows = await (await openKeeper()).getAll("movies");
  return rows.filter((m) => !m.deleted);
}

export async function allCopies(): Promise<Copy[]> {
  const rows = await (await openKeeper()).getAll("copies");
  return rows.filter((c) => !c.deleted);
}

export async function getMovie(id: string) {
  const m = await (await openKeeper()).get("movies", id);
  return m && !m.deleted ? m : undefined;
}

export async function copiesFor(movieId: string): Promise<Copy[]> {
  const rows = await (await openKeeper()).getAllFromIndex("copies", "movie_id", movieId);
  return rows.filter((c) => !c.deleted);
}

export async function copiesByBarcode(barcode: string): Promise<Copy[]> {
  const rows = await (await openKeeper()).getAllFromIndex("copies", "barcode", barcode);
  return rows.filter((c) => !c.deleted);
}

export async function movieByTmdb(tmdbId: number): Promise<Movie | undefined> {
  const rows = await (await openKeeper()).getAllFromIndex("movies", "tmdb_id", tmdbId);
  return rows.find((m) => !m.deleted);
}

export async function pendingCount(): Promise<number> {
  const db = await openKeeper();
  return (
    (await db.countFromIndex("movies", "dirty", 1)) +
    (await db.countFromIndex("copies", "dirty", 1)) +
    (await db.countFromIndex("hunts", "dirty", 1)) +
    (await db.countFromIndex("albums", "dirty", 1)) +
    (await db.countFromIndex("pressings", "dirty", 1))
  );
}

export async function allHunts(): Promise<Hunt[]> {
  const rows = await (await openKeeper()).getAll("hunts");
  return rows.filter((h) => !h.deleted);
}

// ---------- records ----------

export async function allAlbums(): Promise<Album[]> {
  return (await (await openKeeper()).getAll("albums")).filter((a) => !a.deleted);
}
export async function allPressings(): Promise<Pressing[]> {
  return (await (await openKeeper()).getAll("pressings")).filter((p) => !p.deleted);
}
export async function getAlbum(id: string) {
  const a = await (await openKeeper()).get("albums", id);
  return a && !a.deleted ? a : undefined;
}
export async function pressingsFor(albumId: string): Promise<Pressing[]> {
  return (await (await openKeeper()).getAllFromIndex("pressings", "album_id", albumId)).filter((p) => !p.deleted);
}
export async function pressingsByBarcode(barcode: string): Promise<Pressing[]> {
  return (await (await openKeeper()).getAllFromIndex("pressings", "barcode", barcode)).filter((p) => !p.deleted);
}
/** Find an album we own by its Discogs master (or release) id. */
export async function albumByDiscogs(master: number | null, release: number | null): Promise<Album | undefined> {
  return (await allAlbums()).find(
    (a) => (master != null && a.discogs_master_id === master) || (release != null && a.discogs_master_id == null && a.discogs_release_id === release),
  );
}

// ---------- writes (always mark dirty so the next sync pushes them) ----------

const stamp = async () => ({ updated_at: Date.now(), updated_by: await deviceId(), dirty: 1 as const });

export async function saveMovie(m: Omit<Movie, "updated_at" | "updated_by" | "dirty">) {
  const row: Movie = { ...m, ...(await stamp()) };
  await (await openKeeper()).put("movies", row);
  notifyChanged();
  return row;
}

export async function saveCopy(c: Omit<Copy, "updated_at" | "updated_by" | "dirty">) {
  const row: Copy = { ...c, ...(await stamp()) };
  await (await openKeeper()).put("copies", row);
  notifyChanged();
  return row;
}

export async function saveHunt(h: Omit<Hunt, "updated_at" | "updated_by" | "dirty">) {
  const row: Hunt = { ...h, ...(await stamp()) };
  await (await openKeeper()).put("hunts", row);
  notifyChanged();
  return row;
}

export async function addHunt(
  hit: { tmdb_id: number | null; title: string; year: number | null; poster_path: string | null; kind?: "movie" | "album"; artist?: string | null; discogs_id?: number | null; cover_url?: string | null },
  notes: string | null = null,
) {
  const existing = (await allHunts()).find(
    (h) => !h.found && ((hit.tmdb_id && h.tmdb_id === hit.tmdb_id) || (hit.discogs_id && h.discogs_id === hit.discogs_id) || (h.title === hit.title && (h.artist ?? null) === (hit.artist ?? null))),
  );
  if (existing) return existing;
  return saveHunt({
    id: uuid(),
    tmdb_id: hit.tmdb_id,
    title: hit.title,
    year: hit.year,
    poster_path: hit.poster_path,
    notes,
    found: false,
    found_by: null,
    added_by: (await getMeta("deviceName")) ?? null,
    kind: hit.kind ?? "movie",
    artist: hit.artist ?? null,
    discogs_id: hit.discogs_id ?? null,
    cover_url: hit.cover_url ?? null,
    deleted: false,
  });
}

/** Adding an album you were hunting for marks the hunt found. */
export async function markAlbumHuntsFound(discogsId: number | null, artist: string | null, title: string) {
  const norm = (t: string | null | undefined) => (t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for (const h of await allHunts()) {
    if (h.found || h.kind !== "album") continue;
    if ((discogsId && h.discogs_id === discogsId) || (norm(h.title) === norm(title) && norm(h.artist) === norm(artist))) {
      const { updated_at: _u, updated_by: _b, dirty: _d, ...rest } = h;
      await saveHunt({ ...rest, found: true, found_by: (await getMeta("deviceName")) ?? null });
    }
  }
}

/** Adding a movie you were hunting for marks the hunt found. */
export async function markHuntsFound(tmdbId: number | null, title: string) {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for (const h of await allHunts()) {
    if (h.found) continue;
    if ((tmdbId && h.tmdb_id === tmdbId) || (!h.tmdb_id && norm(h.title) === norm(title))) {
      const { updated_at: _u, updated_by: _b, dirty: _d, ...rest } = h;
      await saveHunt({ ...rest, found: true, found_by: (await getMeta("deviceName")) ?? null });
    }
  }
}

export async function saveAlbum(a: Omit<Album, "updated_at" | "updated_by" | "dirty">) {
  const row: Album = { ...a, ...(await stamp()) };
  await (await openKeeper()).put("albums", row);
  notifyChanged();
  return row;
}
export async function savePressing(p: Omit<Pressing, "updated_at" | "updated_by" | "dirty">) {
  const row: Pressing = { ...p, ...(await stamp()) };
  await (await openKeeper()).put("pressings", row);
  notifyChanged();
  return row;
}
export async function deletePressing(p: Pressing) {
  const { updated_at: _u, updated_by: _b, dirty: _d, ...rest } = p;
  await savePressing({ ...rest, deleted: true });
}
export async function deleteAlbum(a: Album) {
  for (const p of await pressingsFor(a.id)) await deletePressing(p);
  const { updated_at: _u, updated_by: _b, dirty: _d, ...rest } = a;
  await saveAlbum({ ...rest, deleted: true });
}

export async function deleteCopy(c: Copy) {
  await saveCopy({ ...c, deleted: true });
}

export async function deleteMovie(m: Movie) {
  for (const c of await copiesFor(m.id)) await deleteCopy(c);
  await saveMovie({ ...m, deleted: true });
}

// ---------- change notifications (UI refresh + kick a sync) ----------

const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("keeper") : null;
export type ChangeSource = "local" | "remote";
const listeners = new Set<(src: ChangeSource) => void>();

/**
 * Tell this tab and every other context (other tabs, the service worker) that data changed.
 * "local" = an edit made on this phone (needs pushing); "remote" = a sync brought new data.
 */
export function notifyChanged(src: ChangeSource = "local") {
  listeners.forEach((fn) => fn(src));
  channel?.postMessage(src);
}

export function onChanged(fn: (src: ChangeSource) => void) {
  listeners.add(fn);
  const handler = (e: MessageEvent) => (e.data === "local" || e.data === "remote") && fn(e.data);
  channel?.addEventListener("message", handler);
  return () => {
    listeners.delete(fn);
    channel?.removeEventListener("message", handler);
  };
}

/** The name this phone uses (shown on badges and in notifications). */
export async function myName(): Promise<string> {
  return (await getMeta("deviceName")) || "Me";
}
