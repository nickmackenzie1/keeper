import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Copy, Movie } from "./types";

/**
 * The phone's own copy of the collection (IndexedDB). Everything in the app reads
 * from here, so the in-store check works with no signal at all.
 */
interface KeeperDB extends DBSchema {
  movies: { key: string; value: Movie; indexes: { tmdb_id: number; dirty: number } };
  copies: { key: string; value: Copy; indexes: { movie_id: string; barcode: string; dirty: number } };
  meta: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<KeeperDB>> | null = null;

export function openKeeper() {
  if (!dbPromise) {
    dbPromise = openDB<KeeperDB>("keeper", 1, {
      upgrade(db) {
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
    id = crypto.randomUUID();
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
  return (await db.countFromIndex("movies", "dirty", 1)) + (await db.countFromIndex("copies", "dirty", 1));
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
