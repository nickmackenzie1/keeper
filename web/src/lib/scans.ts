import { uuid } from "./uuid";
import type { Verdict } from "./verdict";

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
  work().then(
    (verdict) => {
      scans = scans.map((x) => (x.id === s.id ? { ...x, verdict } : x));
      emit();
      then?.(verdict);
    },
    (e) => {
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
