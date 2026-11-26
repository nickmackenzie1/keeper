import { useEffect, useState } from "preact/hooks";
import { myName } from "../lib/db";

// Colours with white text at 4.5:1+.
const COLOURS = ["#1D4ED8", "#B91C1C", "#047857", "#7C3AED", "#B45309", "#0E7490", "#BE185D", "#4D7C0F"];

// Everyone in the family gets their own colour: people are sorted by name and handed
// colours in order, so two people never share one and both phones agree.
let assigned = new Map<string, string>();
export function setPeople(names: Iterable<string | null | undefined>) {
  const sorted = [...new Set([...names].filter(Boolean).map((n) => n!.trim()))].sort((a, b) => a.localeCompare(b));
  assigned = new Map(sorted.map((n, i) => [n.toLowerCase(), COLOURS[i % COLOURS.length]]));
}

export function personColour(name: string) {
  const known = assigned.get(name.trim().toLowerCase());
  if (known) return known;
  let h = 0;
  for (const ch of name.trim().toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLOURS[h % COLOURS.length];
}

/** A small round badge with someone's initial, always the same colour for the same name. */
export function Person({ name, size = 22, label = false }: { name: string | null | undefined; size?: number; label?: boolean }) {
  if (!name) return null;
  return (
    <span class="person">
      <span
        class="person-badge"
        style={{ background: personColour(name), width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.5)}px` }}
        aria-hidden={label ? "true" : undefined}
        title={name}
        aria-label={label ? undefined : name}
        role={label ? undefined : "img"}
      >
        {name.trim().charAt(0).toUpperCase()}
      </span>
      {label && <span class="person-name">{name}</span>}
    </span>
  );
}

/** This phone's person name. */
export function useMe() {
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => void myName().then(setMe), []);
  return me;
}

export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return "Late night";
  if (h < 12) return "Morning";
  if (h < 17) return "Afternoon";
  return "Evening";
}
