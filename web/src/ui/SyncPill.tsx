import { useEffect, useState } from "preact/hooks";
import { getMeta } from "../lib/db";
import { onSyncStatus, sync } from "../lib/live";
import { timeAgo } from "./util";

/** "Synced 2 min ago" / "Offline copy · synced 3 days ago" — tap to sync. */
export function SyncPill() {
  const [st, setSt] = useState<{ syncing: boolean; last?: { ok: boolean; error?: string } }>({ syncing: false });
  const [lastAt, setLastAt] = useState<number>();
  const [, tick] = useState(0);

  useEffect(() => onSyncStatus((s) => {
    setSt(s);
    getMeta("lastSyncAt").then(setLastAt);
  }) as () => void, []);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const stale = lastAt ? Date.now() - lastAt > 7 * 86_400_000 : true;
  let label: string;
  let state: string;
  if (st.syncing) {
    label = "Syncing…";
    state = "busy";
  } else if (st.last && !st.last.ok) {
    label = st.last.error === "login_required" ? "Sign in needed" : `Offline copy · ${timeAgo(lastAt)}`;
    state = st.last.error === "login_required" ? "warn" : stale ? "warn" : "off";
  } else {
    label = `Synced ${timeAgo(lastAt)}`;
    state = stale ? "warn" : "ok";
  }

  return (
    <button
      class={`sync-pill sync-${state}`}
      onClick={() => (st.last?.error === "login_required" ? location.reload() : void sync())}
      aria-label={`${label}. Tap to sync now.`}
    >
      <span class="dot" aria-hidden="true" />
      {label}
    </button>
  );
}
