import { api, ApiError } from "./api";
import { deviceId, getMeta, notifyChanged, openKeeper, setMeta } from "./db";
import type { Copy, Hunt, Movie } from "./types";

/**
 * Two-way sync with the Keeper server. Used by the page AND the service worker
 * (when a push wakes it), so it has no DOM dependencies.
 *
 * 1. Send every local row marked dirty.
 * 2. Server answers with either a delta (rows changed since our cursor) or, if we've
 *    been away too long, the FULL collection.
 * 3. Apply it, never clobbering a local edit that's newer than what came back.
 */

export interface SyncResult {
  ok: boolean;
  full?: boolean;
  pulled?: number;
  pushed?: number;
  error?: ApiError["kind"] | "no_token";
}

interface SyncResponse {
  full: boolean;
  reason: string | null;
  cursor: number;
  server_time: number;
  applied: { accepted: number; rejected: number };
  changes: { movies: Omit<Movie, "dirty">[]; copies: Omit<Copy, "dirty">[]; hunts?: Omit<Hunt, "dirty">[] };
}

const strip = <T extends { dirty: number }>({ dirty: _d, ...rest }: T) => rest;

async function runSync(): Promise<SyncResult> {
  const token = await getMeta("token");
  if (!token) return { ok: false, error: "no_token" };

  const db = await openKeeper();
  const id = await deviceId();
  const name = (await getMeta("deviceName")) ?? undefined;
  const forceFull = (await getMeta("forceFull")) ?? false;
  const cursor = forceFull ? 0 : ((await getMeta("cursor")) ?? 0);

  const dirtyMovies = await db.getAllFromIndex("movies", "dirty", 1);
  const dirtyCopies = await db.getAllFromIndex("copies", "dirty", 1);
  const dirtyHunts = await db.getAllFromIndex("hunts", "dirty", 1);

  let res: SyncResponse;
  try {
    res = await api<SyncResponse>("/sync", {
      method: "POST",
      body: JSON.stringify({
        device_id: id,
        device_name: name,
        cursor,
        changes: { movies: dirtyMovies.map(strip), copies: dirtyCopies.map(strip), hunts: dirtyHunts.map(strip) },
      }),
    }, token);
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.kind : "offline" };
  }

  // What we sent, by id → updated_at, so we can clear `dirty` only if it wasn't edited again meanwhile.
  const sent = new Map<string, number>();
  for (const r of [...dirtyMovies, ...dirtyCopies, ...dirtyHunts]) sent.set(r.id, r.updated_at);

  const tx = db.transaction(["movies", "copies", "hunts"], "readwrite");
  const stores = { movies: tx.objectStore("movies"), copies: tx.objectStore("copies"), hunts: tx.objectStore("hunts") } as const;

  for (const table of ["movies", "copies", "hunts"] as const) {
    const store = stores[table];
    const incoming = (res.changes[table] ?? []) as (Movie | Copy | Hunt)[];

    if (res.full) {
      // Keep local edits made after we sent this request; replace everything else.
      const keep = (await store.getAll()).filter((r) => r.dirty && r.updated_at > (sent.get(r.id) ?? 0));
      await store.clear();
      for (const r of incoming) await store.put({ ...r, dirty: 0 } as never);
      for (const r of keep) await store.put(r as never);
    } else {
      for (const r of incoming) {
        const local = await store.get(r.id);
        if (local?.dirty && local.updated_at > r.updated_at) continue; // newer local edit wins
        await store.put({ ...r, dirty: 0 } as never); // deleted rows stay as hidden tombstones
      }
    }
    // Anything we sent and haven't touched since is now settled.
    for (const [rid, ts] of sent) {
      const local = await store.get(rid);
      if (local?.dirty && local.updated_at === ts) await store.put({ ...local, dirty: 0 } as never);
    }
  }
  await tx.done;

  await setMeta("cursor", res.cursor);
  await setMeta("lastSyncAt", res.server_time);
  // If the server rejected one of our edits (someone edited it later), resync fully next time.
  await setMeta("forceFull", res.applied.rejected > 0);

  const pulled = res.changes.movies.length + res.changes.copies.length + (res.changes.hunts?.length ?? 0);
  if (pulled > 0 || res.full) notifyChanged("remote");
  return { ok: true, full: res.full, pulled, pushed: dirtyMovies.length + dirtyCopies.length + dirtyHunts.length };
}

let inFlight: Promise<SyncResult> | null = null;

/** Safe to call often: concurrent calls share one run, and page + service worker never overlap. */
export function syncNow(): Promise<SyncResult> {
  if (inFlight) return inFlight;
  const locks = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
  const run = locks ? locks.request("keeper-sync", () => runSync()) : runSync();
  inFlight = (run as Promise<SyncResult>).finally(() => (inFlight = null));
  return inFlight;
}
