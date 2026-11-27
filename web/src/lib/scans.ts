import { uuid } from "./uuid";
import type { Verdict } from "./verdict";
import { log } from "./log";

/**
 * Scans run in the background. Scanning never waits for the internet: each scan becomes a card
 * straight away ("Checking…") and fills in when its answer arrives, while you keep scanning.
 * Kept outside the screens so a lookup that finishes after you switch tabs still lands.
 */
export interface Scan {
  id: string;
  label: string; // the barcode, or "Cover photo"
  at: number;
  verdict?: Verdict;
  error?: string;
}

let scans: Scan[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

export const allScans = () => scans;

export function onScans(f: () => void) {
  listeners.add(f);
  return () => void listeners.delete(f);
}

/** Start a lookup; returns its id immediately. `then` runs when the answer lands. */
export function queueScan(label: string, work: () => Promise<Verdict>, then?: (v: Verdict) => void): string {
  const s: Scan = { id: uuid(), label, at: Date.now() };
  scans = [s, ...scans].slice(0, 30);
  emit();
  const started = Date.now();
  work().then(
    (verdict) => {
      const W: Record<string, string> = { not_owned: "new", have: "you own it", owned: "you own it", upgrade: "upgrade", new: "new", pressing: "other pressing" };
      const what = verdict.record ? `${verdict.record.album?.title ?? verdict.record.hit?.title ?? "record"} → ${W[verdict.record.kind] ?? verdict.record.kind}` : verdict.unknown ? "no match" : `${verdict.movie?.title ?? verdict.lookup?.candidates?.[0]?.title ?? "?"} → ${W[verdict.kind] ?? verdict.kind}`;
      log("scan", `${label}: ${what} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
      scans = scans.map((x) => (x.id === s.id ? { ...x, verdict } : x));
      emit();
      then?.(verdict);
    },
    (e) => {
      log("error", `${label}: ${e instanceof Error ? e.message : String(e)}`);
      scans = scans.map((x) => (x.id === s.id ? { ...x, error: e instanceof Error ? e.message : "Couldn't check that one" } : x));
      emit();
    },
  );
  return s.id;
}

export function clearScans() {
  scans = [];
  emit();
}
