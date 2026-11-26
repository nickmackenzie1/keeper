import { useEffect, useState } from "preact/hooks";
import { onChanged } from "../lib/db";

/** Re-run an async loader whenever local data changes (edits here, or a sync). */
export function useData<T>(load: () => Promise<T>, deps: unknown[] = []): T | undefined {
  const [val, setVal] = useState<T>();
  useEffect(() => {
    let alive = true;
    const run = () => load().then((v) => alive && setVal(v));
    run();
    const off = onChanged(() => run());
    return () => {
      alive = false;
      off();
    };
  }, deps);
  return val;
}

/** Minimal hash router: "#/movie/abc?x=1" → { path: ["movie","abc"], query } */
export function useRoute() {
  const parse = () => {
    const raw = location.hash.replace(/^#\/?/, "");
    const [p, q = ""] = raw.split("?");
    return { path: p.split("/").filter(Boolean), query: new URLSearchParams(q) };
  };
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export const go = (hash: string) => {
  location.hash = hash;
};

export function timeAgo(ms?: number) {
  if (!ms) return "never";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** Stable colour for poster placeholders. */
export function tint(seed: string) {
  const palette = ["#1F3D2B", "#9A3412", "#7F1D1D", "#1E3A8A", "#0F3B5F", "#854D0E", "#334155", "#4C1D95", "#3F3F46", "#155E75"];
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}
