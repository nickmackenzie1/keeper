import { log } from "./log";
import { deviceId, getMeta, onChanged } from "./db";
import { syncNow, type SyncResult } from "./sync";

/**
 * Keeps the page in sync while it's open:
 * - sync on launch, when the app comes back to the foreground, and when the network returns
 * - push local edits shortly after they're made
 * - hold a live connection so the other phone's changes arrive within a second
 */

type Status = { syncing: boolean; last?: SyncResult };
const subs = new Set<(s: Status) => void>();
let status: Status = { syncing: false };
const emit = (s: Partial<Status>) => {
  status = { ...status, ...s };
  subs.forEach((fn) => fn(status));
};

export function onSyncStatus(fn: (s: Status) => void) {
  subs.add(fn);
  fn(status);
  return () => subs.delete(fn);
}

export async function sync() {
  emit({ syncing: true });
  const last = await syncNow();
  emit({ syncing: false, last });
  if (!last.ok) log("sync", `Sync failed: ${last.error ?? "unknown"}`);
  else if (last.full || last.pulled || last.pushed) log("sync", `Synced${last.full ? " (full copy)" : ""}: sent ${last.pushed ?? 0}, got ${last.pulled ?? 0}`);
  return last;
}

let es: EventSource | null = null;

async function openLive() {
  if (es || document.visibilityState !== "visible") return;
  const token = await getMeta("token");
  if (!token) return;
  const url = `/api/events?device_id=${encodeURIComponent(await deviceId())}&token=${encodeURIComponent(token)}`;
  es = new EventSource(url);
  es.addEventListener("changed", () => void sync());
  es.onerror = () => {
    // Browser retries on its own; if we're offline it just keeps quiet.
  };
}

function closeLive() {
  es?.close();
  es = null;
}

let started = false;
export function startLiveSync() {
  if (started) return;
  started = true;

  let lastForeground = 0;
  const foreground = () => {
    if (document.visibilityState === "visible") {
      if (Date.now() - lastForeground > 15_000) void sync();
      lastForeground = Date.now();
      void openLive();
    } else {
      closeLive();
    }
  };
  document.addEventListener("visibilitychange", foreground);
  window.addEventListener("online", () => void sync());
  window.addEventListener("pageshow", foreground);

  // Push our own edits a moment after they happen (debounced).
  let t: ReturnType<typeof setTimeout> | undefined;
  onChanged((src) => {
    if (src !== "local") return;
    clearTimeout(t);
    t = setTimeout(() => void sync(), 1500);
  });

  foreground();
}
