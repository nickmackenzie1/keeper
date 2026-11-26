import { useState } from "preact/hooks";
import { addDisc } from "../lib/collection";
import { celebrate, chime, confetti, toast } from "../lib/celebrate";
import { getMeta, setMeta } from "../lib/db";
import { verdictForBarcode, type Verdict } from "../lib/verdict";
import { FORMATS, FORMAT_LABEL, FORMAT_SHORT, type Format } from "../lib/types";
import { Poster } from "./Poster";
import { Scanner } from "./Scanner";

type Item = {
  code: string;
  verdict?: Verdict;
  include: boolean;
  format: Format;
  added?: boolean;
};

const kindOf = (v?: Verdict) =>
  !v ? "loading" : v.unknown ? "unknown" : v.kind === "not_owned" ? "new" : v.kind === "upgrade" ? "upgrade" : "have";

const LABEL: Record<string, string> = { loading: "…", unknown: "Unknown", new: "New", upgrade: "Upgrade", have: "Own it" };

function tally(items: Item[]) {
  const t = { new: 0, upgrade: 0, have: 0, unknown: 0, loading: 0 } as Record<string, number>;
  for (const i of items) t[kindOf(i.verdict)]++;
  return t;
}

export function summaryLine(items: Item[]) {
  const t = tally(items);
  const parts = [
    t.new && `${t.new} new`,
    t.upgrade && `${t.upgrade} upgrade${t.upgrade === 1 ? "" : "s"}`,
    t.have && `${t.have} you already own`,
    t.unknown && `${t.unknown} unknown`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "Nothing scanned yet";
}

/** Scan a whole stack, then decide what to keep. */
export function Haul({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [scanning, setScanning] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addedCount, setAddedCount] = useState(0);

  const update = (code: string, patch: Partial<Item>) =>
    setItems((list) => list.map((i) => (i.code === code ? { ...i, ...patch } : i)));

  const onCode = async (code: string) => {
    let dupe = false;
    setItems((list) => {
      if (list.some((i) => i.code === code)) {
        dupe = true;
        return list;
      }
      return [{ code, include: false, format: "dvd" }, ...list];
    });
    if (dupe) return;
    chime("blip");
    const v = await verdictForBarcode(code, { store: true });
    const k = kindOf(v);
    update(code, {
      verdict: v,
      include: (k === "new" || k === "upgrade") && !!(v.lookup?.candidates[0] || v.movie),
      format: v.scanned && v.scanned !== "other" ? v.scanned : "dvd",
    });
    if (v.hunt) {
      celebrate();
      toast(`${v.hunt.title} is on your hunt list!`);
    }
  };

  const toAdd = items.filter((i) => i.include && !i.added && i.verdict);

  const addAll = async () => {
    setAdding(true);
    let n = 0;
    for (const i of toAdd) {
      const v = i.verdict!;
      try {
        await addDisc({ movie: v.movie ?? undefined, tmdb: v.movie ? undefined : v.lookup?.candidates[0], format: i.format, barcode: i.code });
        update(i.code, { added: true, include: false });
        n++;
      } catch {
        /* leave it ticked so they can retry */
      }
    }
    setAdding(false);
    setAddedCount((c) => c + n);
    const best = (await getMeta("bestHaul")) ?? 0;
    const total = addedCount + n;
    if (total > best) await setMeta("bestHaul", total);
    if (n >= 5) confetti();
    toast(`Added ${n} disc${n === 1 ? "" : "s"} to the collection`);
  };

  const t = tally(items);
  const last = items[0];
  const lastTitle = last?.verdict?.movie?.title ?? last?.verdict?.lookup?.candidates[0]?.title;

  if (scanning) {
    return (
      <Scanner
        continuous
        onCode={(c) => void onCode(c)}
        onClose={() => setScanning(false)}
        hint="Scan each case — tap Done when the stack's finished"
        status={
          <div class="haul-tally" aria-live="polite">
            <b>{items.length} scanned</b>
            <span>
              {t.new} new · {t.upgrade} upgrade · {t.have} own{t.unknown ? ` · ${t.unknown} unknown` : ""}
            </span>
            {last && (
              <span class={`haul-last haul-${kindOf(last.verdict)}`}>
                {LABEL[kindOf(last.verdict)]}: {lastTitle ?? last.code}
              </span>
            )}
          </div>
        }
      />
    );
  }

  return (
    <div class="haul" role="dialog" aria-label="Haul summary">
      <header class="screen-head">
        <div class="row between">
          <h1>Haul</h1>
          <button class="btn ghost" onClick={onClose}>Close</button>
        </div>
        <p class="haul-summary">{summaryLine(items)}</p>
      </header>
      <div class="screen-body">
        {items.length === 0 && <p class="muted center">Nothing scanned.</p>}
        <ul class="list">
          {items.map((i) => {
            const v = i.verdict;
            const k = kindOf(v);
            const cand = v?.movie ?? v?.lookup?.candidates[0];
            const canAdd = (k === "new" || k === "upgrade") && !!cand && !i.added;
            return (
              <li key={i.code} class="haul-row">
                <label class="list-row">
                  {canAdd ? (
                    <input type="checkbox" checked={i.include} onChange={(e) => update(i.code, { include: (e.target as HTMLInputElement).checked })} aria-label={`Add ${cand?.title}`} />
                  ) : (
                    <span class="haul-check-spacer" />
                  )}
                  {cand ? <Poster movie={cand} size="w185" class="thumb" /> : <span class="thumb poster thumb-empty" aria-hidden="true">?</span>}
                  <span class="stack grow">
                    <b>{cand?.title ?? `Barcode ${i.code}`}</b>
                    <span class="muted">
                      {i.added ? "Added ✓" : v?.hunt ? "On your hunt list!" : v?.rarity?.rare && k !== "have" ? `Rare find · first in ${v.rarity.trips} trips` : k === "unknown" ? "Couldn't identify — add by title later" : cand && "year" in cand && cand.year ? String(cand.year) : ""}
                    </span>
                  </span>
                  <span class={`tag tag-${k}`}>{LABEL[k]}</span>
                </label>
                {canAdd && (
                  <button
                    class="chip haul-format"
                    data-format={i.format}
                    aria-label={`Format: ${FORMAT_LABEL[i.format]}. Tap to change.`}
                    onClick={() => update(i.code, { format: FORMATS[(FORMATS.indexOf(i.format) + 1) % FORMATS.length] })}
                  >
                    {FORMAT_SHORT[i.format]} ▾
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {items.some((i) => kindOf(i.verdict) === "new" || kindOf(i.verdict) === "upgrade") && (
          <p class="muted">Tick the ones you bought. Tap a format tag to change it.</p>
        )}
        <button class="btn primary block" disabled={adding || toAdd.length === 0} onClick={() => void addAll()}>
          {adding ? "Adding…" : toAdd.length ? `Add ${toAdd.length} to collection` : "Nothing ticked to add"}
        </button>
        <button class="btn block" onClick={() => setScanning(true)}>Scan more</button>
      </div>
    </div>
  );
}
