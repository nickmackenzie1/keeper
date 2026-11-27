import { useState } from "preact/hooks";
import { ZoneTitle } from "./Zone";
import { Cover } from "./Cover";
import { Person } from "./Person";
import { tint } from "./util";
import { addHunt } from "../lib/db";
import { RECORD_LABEL, RECORD_SHORT, type AlbumHit } from "../lib/types";
import type { RecordKind, RecordVerdict } from "../lib/records";

export const RECORD_WORD: Record<RecordKind | "hunt", string> = {
  new: "Grab it",
  have: "Got it",
  pressing: "Other pressing",
  upgrade: "Vinyl upgrade",
  owned: "You own it",
  hunt: "Found it",
};

const kindOf = (v: RecordVerdict) => (v.hunt ? "hunt" : v.kind);

function display(v: RecordVerdict) {
  const a = v.album ?? v.hit;
  return a ? { title: a.title, artist: a.artist ?? null, year: a.year ?? null, cover_url: a.cover_url ?? null, cover_bg: v.album?.cover_bg ?? v.hit?.palette?.bg ?? null } : null;
}

function subline(v: RecordVerdict): string {
  const owned = [...new Set(v.pressings.map((p) => RECORD_LABEL[p.format]))].join(" + ");
  switch (kindOf(v)) {
    case "hunt": return `On ${v.hunt?.added_by ? `${v.hunt.added_by}'s` : "the"} hunt list`;
    case "have": return v.exact ? "This exact copy is yours" : "You own this pressing";
    case "pressing": return `You have a different ${RECORD_LABEL[v.scanned?.format ?? "vinyl"]} pressing`;
    case "upgrade": return `You only have it on ${owned}`;
    case "owned": return `You own it on ${owned}`;
    default: return "Not in your records";
  }
}

export function addRecordHref(v: RecordVerdict) {
  const q = new URLSearchParams();
  if (v.album) q.set("album", v.album.id);
  const id = v.hit?.discogs_master_id ?? null;
  if (id) q.set("master", String(id));
  if (v.scanned?.discogs_release_id) q.set("release", String(v.scanned.discogs_release_id));
  if (v.scanned?.format) q.set("format", v.scanned.format);
  if (v.barcode) q.set("barcode", v.barcode);
  return `#/add-record?${q}`;
}

function HuntRecord({ hit }: { hit: AlbumHit }) {
  const [done, setDone] = useState(false);
  return (
    <button
      class="btn"
      disabled={done}
      onClick={async () => {
        await addHunt({ kind: "album", tmdb_id: null, title: hit.title, artist: hit.artist, year: hit.year, poster_path: null, cover_url: hit.cover_url, discogs_id: hit.discogs_master_id ?? hit.discogs_release_id });
        setDone(true);
      }}
    >
      {done ? "On hunt list" : "Hunt it"}
    </button>
  );
}

function Pressings({ v, cls }: { v: RecordVerdict; cls: string }) {
  if (!v.pressings.length) return null;
  return (
    <ul class={cls}>
      {v.pressings.map((p) => (
        <li key={p.id}>
          <span class="chip" data-format={p.format}>{RECORD_SHORT[p.format]}</span>
          <span class="grow">{[p.description, p.label, p.country, p.year].filter(Boolean).join(" · ") || RECORD_LABEL[p.format]}</span>
          {p.added_by && <Person name={p.added_by} size={22} />}
        </li>
      ))}
    </ul>
  );
}

function Actions({ v, onNext }: { v: RecordVerdict; onNext: () => void }) {
  const k = v.kind;
  return (
    <div class="row">
      {(k === "new" || k === "upgrade" || k === "pressing") && <a class="btn primary grow" href={addRecordHref(v)}>Bought it</a>}
      {v.album && k !== "new" && <a class="btn grow" href={`#/record/${v.album.id}`}>Details</a>}
      {k === "new" && !v.hunt && v.hit && <HuntRecord hit={v.hit} />}
      <button class="btn" onClick={onNext}>Next</button>
    </div>
  );
}

/** Marquee: a record announced over its own sleeve. */
export function RecordReveal({ v, onNext, onClose }: { v: RecordVerdict; onNext: () => void; onClose: () => void }) {
  const [skip, setSkip] = useState(false);
  const d = display(v);
  const k = kindOf(v);
  const word = RECORD_WORD[k];
  const kicker = d ? [d.artist, d.title, v.scanned?.format ? RECORD_LABEL[v.scanned.format] : null].filter(Boolean).join(" · ") : "Record";
  const accent = v.album?.cover_accent ?? v.hit?.palette?.accent ?? undefined;
  const map: Record<string, string> = { new: "not_owned", have: "have", pressing: "owned", upgrade: "upgrade", owned: "have", hunt: "hunt" };
  return (
    <div class={`reveal reveal-${map[k]} reveal-record ${skip ? "reveal-skip" : ""}`} role="dialog" aria-label={`${word}: ${kicker}`} onClick={() => setSkip(true)} style={accent ? ({ "--rv": accent } as Record<string, string>) : undefined}>
      <div class="reveal-bg" aria-hidden="true" style={{ background: d?.cover_bg ?? (d ? tint(d.title) : "#111") }}>
        {d?.cover_url && <img src={d.cover_url} alt="" referrerpolicy="no-referrer" />}
      </div>
      <button class="reveal-close icon-btn" aria-label="Close" onClick={(e) => { e.stopPropagation(); onClose(); }}>×</button>
      <div class="reveal-center" aria-live="polite">
        {d && <Cover album={d} class="reveal-sleeve" />}
        <ZoneTitle size="reveal" play kicker={kicker} title={word} sub={subline(v)} fontSize={`min(96px, ${Math.floor(78 / (word.length * 0.68))}vw)`} />
        {v.rarity?.rare && k !== "have" && <span class="reveal-rare">Rare find · first time in {v.rarity.trips} trips</span>}
      </div>
      <div class="reveal-panel" onClick={(e) => e.stopPropagation()}>
        <Pressings v={v} cls="reveal-copies" />
        {k === "hunt" && v.hunt?.notes && <p class="reveal-note">{v.hunt.notes}</p>}
        <Actions v={v} onNext={onNext} />
      </div>
    </div>
  );
}

/** Other skins: the same answer as a card. */
export function RecordCard({ v, onNext }: { v: RecordVerdict; onNext: () => void }) {
  const d = display(v);
  const k = kindOf(v);
  const cls = { new: "not_owned", have: "have", pressing: "owned", upgrade: "upgrade", owned: "owned", hunt: "not_owned" }[k];
  return (
    <section class={`verdict verdict-${cls}`} aria-live="polite">
      <div class="stack">
        <span class="eyebrow">{v.scanned?.format ? `Record · ${RECORD_LABEL[v.scanned.format]}` : "Record"}</span>
        <h2 class="verdict-title">{RECORD_WORD[k]}</h2>
      </div>
      <div class="verdict-head">
        {d && <Cover album={d} class="verdict-poster" />}
        <div class="stack">
          <p class="verdict-sub"><b>{d?.artist ? `${d.artist} – ` : ""}{d?.title}</b>{d?.year ? ` (${d.year})` : ""}</p>
          <p class="verdict-sub">{subline(v)}</p>
        </div>
      </div>
      <Pressings v={v} cls="owned" />
      <Actions v={v} onNext={onNext} />
    </section>
  );
}

export const recordWord = (v: RecordVerdict) => RECORD_WORD[kindOf(v)];
export const recordDisplay = display;
