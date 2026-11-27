/**
 * A light activity log for Settings: syncs, scans, adds, updates and anything that went wrong.
 * Kept on this phone only (last 120 lines), never sent anywhere.
 */
export interface LogLine { t: number; kind: "sync" | "scan" | "add" | "update" | "error" | "info"; text: string }

const KEY = "library-log";
// The service worker has no localStorage; there the log quietly does nothing.
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
const store = () => (globalThis as { localStorage?: Store }).localStorage;
const MAX = 120;
const listeners = new Set<() => void>();

export function readLog(): LogLine[] {
  try {
    return JSON.parse(store()?.getItem(KEY) ?? "[]") as LogLine[];
  } catch {
    return [];
  }
}

export function log(kind: LogLine["kind"], text: string) {
  try {
    const lines = [{ t: Date.now(), kind, text: text.slice(0, 300) }, ...readLog()].slice(0, MAX);
    store()?.setItem(KEY, JSON.stringify(lines));
  } catch {
    /* storage full or unavailable (service worker): skip */
  }
  listeners.forEach((f) => f());
}

export function clearLog() {
  try {
    store()?.removeItem(KEY);
  } catch { /* ignore */ }
  listeners.forEach((f) => f());
}

export function onLog(f: () => void) {
  listeners.add(f);
  return () => void listeners.delete(f);
}

/** Catch crashes too, so "it just went back" has an explanation. */
export function watchErrors() {
  addEventListener("error", (e) => log("error", `${e.message}${e.filename ? ` (${e.filename.split("/").pop()}:${e.lineno})` : ""}`));
  addEventListener("unhandledrejection", (e) => log("error", `Unhandled: ${(e.reason as Error)?.message ?? String(e.reason)}`));
}
