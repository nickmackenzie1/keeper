import { ScreenTitle, ZoneTitle } from "./Zone";
import { currentSkin } from "./skins";
import { posterUrl } from "../lib/types";
import { tint } from "./util";
import { useEffect, useRef, useState } from "preact/hooks";
import { copiesFor } from "../lib/db";
import { searchHunts, searchLocal, verdictForBarcode, verdictForCover, type Verdict } from "../lib/verdict";
import { ApiError, coverScan } from "../lib/api";
import { preparePhoto } from "../lib/photo";
import { celebrate, primeAudio } from "../lib/celebrate";
import { addHunt, allHunts } from "../lib/db";
import { Person, greeting, useMe } from "./Person";
import { useData } from "./util";
import { Haul } from "./Haul";
import { ShelfScan } from "./ShelfScan";
import { FORMAT_LABEL, FORMAT_SHORT, FORMAT_RANK, type Copy, type Hunt, type Movie } from "../lib/types";
import { Scanner } from "./Scanner";
import { Poster } from "./Poster";
import { IconCamera, IconScan, IconSearch, IconShelfPhoto, IconStack } from "./icons";
import { SyncPill } from "./SyncPill";

const HEADLINE: Record<Verdict["kind"], string> = {
  not_owned: "Not in your collection",
  upgrade: "Upgrade!",
  have: "Already on the shelf",
  owned: "You own this",
};

function summary(v: Verdict): string {
  const title = v.movie ? `${v.movie.title}${v.movie.year ? ` (${v.movie.year})` : ""}` : "";
  const owned = [...new Set(v.copies.map((c) => FORMAT_LABEL[c.format]))].join(" + ");
  switch (v.kind) {
    case "upgrade":
      return `You have ${title} on ${owned}. This one's ${FORMAT_LABEL[v.scanned!]}.`;
    case "have":
      if (v.exact) return `This exact ${FORMAT_LABEL[v.scanned ?? "dvd"]} of ${title} is already yours.`;
      return `You own ${title} on ${owned}${v.scanned ? ` — this ${FORMAT_LABEL[v.scanned]} isn't better` : ""}.`;
    case "owned":
      return `You own ${title} on ${owned}. Check the case to see if this one's better.`;
    default:
      if (v.unknown) return "Couldn't identify this disc. Try typing the title.";
      if (v.lookup?.candidates[0]) {
        const c = v.lookup.candidates[0];
        return `${c.title}${c.year ? ` (${c.year})` : ""}${v.scanned && v.scanned !== "other" ? ` · ${FORMAT_LABEL[v.scanned]}` : ""}`;
      }
      return "Grab it if you want it.";
  }
}

function addHrefFor(v: Verdict) {
  const cand = v.lookup?.candidates[0];
  const q = new URLSearchParams();
  if (v.lookup?.barcode) q.set("barcode", v.lookup.barcode);
  if (v.scanned) q.set("format", v.scanned);
  const tmdb = v.movie?.tmdb_id ?? cand?.tmdb_id;
  if (tmdb) q.set("tmdb", String(tmdb));
  if (v.movie) q.set("movie", v.movie.id);
  return `#/add?${q}`;
}

/** Marquee: the result announced like entering a new zone, over the movie's own poster. */
function VerdictReveal({ v, onNext, onClose }: { v: Verdict; onNext: () => void; onClose: () => void }) {
  const [skip, setSkip] = useState(false);
  const cand = v.lookup?.candidates[0];
  const display = v.movie ?? (cand ? { title: cand.title, year: cand.year, poster_path: cand.poster_path } : null);
  const kind = v.unknown ? "unknown" : v.hunt ? "hunt" : v.kind;
  const WORD: Record<string, string> = { not_owned: "Grab it", upgrade: "Upgrade", have: "Got it", owned: "You own it", hunt: "Found it", unknown: "No match" };
  const owned = [...new Set(v.copies.map((c) => FORMAT_LABEL[c.format]))].join(" + ");
  const sub =
    kind === "hunt" ? `On ${v.hunt?.added_by ? `${v.hunt.added_by}'s` : "the"} hunt list`
    : kind === "upgrade" ? `You own the ${owned}`
    : kind === "have" ? (v.exact ? "This exact disc is yours" : `You own the ${owned}`)
    : kind === "owned" ? `You own the ${owned} — check the case`
    : kind === "unknown" ? "Try typing the title"
    : "Not in your collection";
  const kicker = display
    ? [display.title, display.year, v.scanned && v.scanned !== "other" ? FORMAT_LABEL[v.scanned] : null].filter(Boolean).join(" · ")
    : "Scanned";
  const bg = display ? posterUrl(display.poster_path, "w500") : null;
  // The screen takes its colours from the movie's poster (falls back to the verdict colour).
  const accent = v.movie?.poster_accent ?? cand?.palette?.accent ?? undefined;
  const tone = v.movie?.poster_bg ?? cand?.palette?.bg ?? (display ? tint(display.title) : "#111");

  return (
    <div
      class={`reveal reveal-${kind} ${skip ? "reveal-skip" : ""}`}
      role="dialog"
      aria-label={`${WORD[kind]}: ${kicker}`}
      onClick={() => setSkip(true)}
      style={accent ? ({ "--rv": accent } as Record<string, string>) : undefined}
    >
      <div class="reveal-bg" aria-hidden="true" style={{ background: tone }}>
        {bg && <img src={bg} alt="" />}
        {!bg && display && <span class="reveal-ghost">{display.title}</span>}
      </div>
      <button class="reveal-close icon-btn" aria-label="Close" onClick={(e) => { e.stopPropagation(); onClose(); }}>×</button>
      <div class="reveal-center" aria-live="polite">
        <ZoneTitle
          size="reveal"
          play
          kicker={kicker}
          title={WORD[kind]}
          sub={sub}
          // Long words shrink so the rules always fit either side.
          fontSize={`min(96px, ${Math.floor(78 / (WORD[kind].length * 0.47))}vw)`}
        />
        {v.rarity?.rare && kind !== "have" && <span class="reveal-rare">Rare find · first time in {v.rarity.trips} trips</span>}
      </div>
      <div class="reveal-panel" onClick={(e) => e.stopPropagation()}>
        {v.copies.length > 0 && (
          <ul class="reveal-copies">
            {v.copies
              .slice()
              .sort((a, b) => FORMAT_RANK[b.format] - FORMAT_RANK[a.format])
              .map((c) => (
                <li key={c.id}>
                  <span class="chip" data-format={c.format}>{FORMAT_SHORT[c.format]}</span>
                  <span class="grow">{[c.edition, c.location, c.upgrade_wanted ? "on the upgrade list" : null].filter(Boolean).join(" · ") || FORMAT_LABEL[c.format]}</span>
                  {c.added_by && <Person name={c.added_by} size={22} />}
                </li>
              ))}
          </ul>
        )}
        {kind === "hunt" && v.hunt?.notes && <p class="reveal-note">{v.hunt.notes}</p>}
        <div class="row">
          {(v.kind === "not_owned" || v.kind === "upgrade") && !v.unknown && (
            <a class="btn primary grow" href={addHrefFor(v)}>{v.kind === "upgrade" ? `Add ${FORMAT_LABEL[v.scanned!]}` : "Bought it"}</a>
          )}
          {v.movie && v.kind !== "upgrade" && <a class="btn grow" href={`#/movie/${v.movie.id}`}>Details</a>}
          {v.kind === "not_owned" && !v.hunt && cand && <HuntButton hit={cand} />}
          {kind === "unknown" && (
            <button
              class="btn primary grow"
              onClick={() => {
                onClose();
                setTimeout(() => document.querySelector<HTMLInputElement>("input[aria-label='Search your collection']")?.focus(), 50);
              }}
            >
              Type the title
            </button>
          )}
          <button class="btn" onClick={onNext}>Next</button>
        </div>
      </div>
    </div>
  );
}

export function VerdictCard({ v, onNext }: { v: Verdict; onNext: () => void }) {
  const cand = v.lookup?.candidates[0];
  const display = v.movie ?? (cand ? { title: cand.title, year: cand.year, poster_path: cand.poster_path } : null);
  const addHref = () => addHrefFor(v);
  return (
    <section class={`verdict verdict-${v.unknown ? "unknown" : v.kind}`} aria-live="polite">
      {v.hunt && (
        <div class="hunt-banner">
          <b>On the hunt list!</b>
          <span class="row hunt-meta">
            <Person name={v.hunt.added_by} size={20} />
            {v.hunt.added_by ? `${v.hunt.added_by} has been looking for this` : "Someone's been looking for this"}
            {v.hunt.notes ? ` · ${v.hunt.notes}` : ""}
          </span>
        </div>
      )}
      <div class="stack">
        <span class="eyebrow">{v.scanned && v.scanned !== "other" ? `Scanned · ${FORMAT_LABEL[v.scanned]}` : "Result"}</span>
        <h2 class="verdict-title">{v.unknown ? "Unknown disc" : HEADLINE[v.kind]}</h2>
      </div>
      <div class="verdict-head">
        {display && <Poster movie={display} size="w185" class="verdict-poster" />}
        <div class="stack">
          <p class="verdict-sub">{summary(v)}</p>
          {v.rarity?.rare && v.kind !== "have" && (
            <span class="rare-note">Rare find · first time you've seen it in {v.rarity.trips} trips</span>
          )}
        </div>
      </div>
      {v.copies.length > 0 && (
        <ul class="owned">
          {v.copies
            .slice()
            .sort((a, b) => FORMAT_RANK[b.format] - FORMAT_RANK[a.format])
            .map((c) => (
              <li key={c.id}>
                <span class="chip" data-format={c.format}>{FORMAT_SHORT[c.format]}</span>
                <span class="stack">
                  <span>{c.edition ?? FORMAT_LABEL[c.format]}</span>
                  {(c.location || c.upgrade_wanted) && (
                    <span class="muted">{[c.location, c.upgrade_wanted ? "wants upgrade" : null].filter(Boolean).join(" · ")}</span>
                  )}
                </span>
              </li>
            ))}
        </ul>
      )}
      <div class="row">
        {(v.kind === "not_owned" || v.kind === "upgrade") && !v.unknown && (
          <a class="btn primary grow" href={addHref()}>
            {v.kind === "upgrade" ? `Add ${FORMAT_LABEL[v.scanned!]}` : "Bought it"}
          </a>
        )}
        {v.movie && v.kind !== "upgrade" && (
          <a class="btn grow" href={`#/movie/${v.movie.id}`}>Details</a>
        )}
        {v.kind === "not_owned" && !v.hunt && cand && <HuntButton hit={cand} />}
        <button class="btn" onClick={onNext}>Scan next</button>
      </div>
    </section>
  );
}

function HuntButton({ hit }: { hit: { tmdb_id: number; title: string; year: number | null; poster_path: string | null } }) {
  const [done, setDone] = useState(false);
  return (
    <button
      class="btn"
      disabled={done}
      onClick={async () => {
        await addHunt(hit);
        setDone(true);
      }}
    >
      {done ? "On hunt list" : "Hunt it"}
    </button>
  );
}

function ResultRow({ m }: { m: Movie }) {
  const [copies, setCopies] = useState<Copy[]>([]);
  useEffect(() => void copiesFor(m.id).then(setCopies), [m.id]);
  const best = copies.reduce<Copy | null>((a, c) => (!a || FORMAT_RANK[c.format] > FORMAT_RANK[a.format] ? c : a), null);
  return (
    <li>
      <a class="list-row" href={`#/movie/${m.id}`}>
        <Poster movie={m} size="w185" class="thumb" />
        <span class="stack grow">
          <b>{m.title}</b>
          <span class="muted">{m.year ?? ""}</span>
        </span>
        {copies.map((c) => (
          <span key={c.id} class="chip" data-format={c.format}>{FORMAT_SHORT[c.format]}</span>
        ))}
        {!best && <span class="chip">—</span>}
      </a>
    </li>
  );
}

function Hello() {
  const me = useMe();
  const hunts = useData(allHunts);
  if (!me) return null;
  const open = (hunts ?? []).filter((h) => !h.found);
  const mine = open.filter((h) => h.added_by === me).length;
  const others = open.length - mine;
  return (
    <div class="hello">
      <Person name={me} size={34} />
      <div class="stack">
        <b>{greeting()}, {me}</b>
        <span class="muted">
          {open.length === 0
            ? "Nothing on the hunt list yet"
            : [mine ? `${mine} on your hunt list` : null, others ? `${others} on the family's` : null].filter(Boolean).join(" · ")}
        </span>
      </div>
    </div>
  );
}

export function Check() {
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Movie[] | null>(null);
  const [hunts, setHunts] = useState<Hunt[]>([]);
  const [haul, setHaul] = useState(false);
  const [shelf, setShelf] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  const onCover = async (file?: File) => {
    if (!file) return;
    setError(null);
    setVerdict(null);
    setQ("");
    setBusy(true);
    try {
      const { b64 } = await preparePhoto(file, 1400);
      const v = await verdictForCover(await coverScan(b64, true));
      setVerdict(v);
      if (v.hunt) celebrate();
    } catch (e) {
      setError(
        e instanceof ApiError && e.kind === "offline"
          ? "Cover photos need a connection. Try the barcode — that works offline for discs you own."
          : e instanceof Error ? e.message : "Couldn't read that photo.",
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!q.trim()) return setResults(null);
    let alive = true;
    searchLocal(q).then((r) => alive && setResults(r));
    searchHunts(q).then((h) => alive && setHunts(h));
    return () => void (alive = false);
  }, [q]);

  const onCode = async (code: string) => {
    setScanning(false);
    setBusy(true);
    setQ("");
    try {
      const v = await verdictForBarcode(code, { store: true });
      setVerdict(v);
      if (v.hunt) celebrate();
    } finally {
      setBusy(false);
    }
  };

  const startScan = () => {
    primeAudio();
    setScanning(true);
  };
  const next = () => {
    setVerdict(null);
    startScan();
  };

  return (
    <div class="screen">
      <header class="screen-head">
        <div class="row between">
          <ScreenTitle title="Check" />
          <SyncPill />
        </div>
        <div class="row">
          <label class="search grow">
            <IconSearch />
            <input
              type="search"
              placeholder="Type a title"
              aria-label="Search your collection"
              value={q}
              onInput={(e) => {
                setVerdict(null);
                setQ((e.target as HTMLInputElement).value);
              }}
            />
          </label>
          <button class="btn icon-btn" aria-label="Photo of the cover" onClick={() => { primeAudio(); coverInput.current?.click(); }}>
            <IconCamera />
          </button>
          <button class="btn primary icon-btn" aria-label="Scan a barcode" onClick={startScan}>
            <IconScan />
          </button>
          <input ref={coverInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void onCover((e.target as HTMLInputElement).files?.[0]); (e.target as HTMLInputElement).value = ""; }} />
        </div>
      </header>

      <div class="screen-body">
        {busy && <p class="muted center">Looking it up…</p>}
        {error && !busy && <p class="notice">{error}</p>}
        {verdict && !busy && currentSkin() !== "marquee" && <VerdictCard v={verdict} onNext={next} />}

        {!verdict && !busy && results && hunts.map((h) => (
          <div key={h.id} class="hunt-banner standalone">
            <b>“{h.title}” is on your hunt list!</b>
            <span>{h.added_by ? `${h.added_by} is looking for it` : "Grab it if you see it"}{h.notes ? ` · ${h.notes}` : ""}</span>
          </div>
        ))}

        {!verdict && !busy && results && (
          results.length ? (
            <ul class="list">{results.map((m) => <ResultRow key={m.id} m={m} />)}</ul>
          ) : (
            <section class="verdict verdict-not_owned">
              <h2 class="verdict-title">Not in your collection</h2>
              <p class="verdict-sub">Nothing on your shelf matches “{q}”.</p>
              <div class="row">
                <a class="btn primary grow" href={`#/add?q=${encodeURIComponent(q)}`}>Bought it</a>
              </div>
            </section>
          )
        )}

        {!verdict && !busy && !results && (
          <>
            <Hello />
            <button class="hero-scan" onClick={startScan}>
              <IconScan />
              <span class="hero-scan-title">Scan a disc</span>
              <span class="muted">See if you own it or if it's an upgrade. Works without signal.</span>
            </button>
            <div class="start-tiles">
              <button
                class="start-tile"
                onClick={() => {
                  primeAudio();
                  setHaul(true);
                }}
              >
                <IconStack />
                <span class="start-tile-title">Haul mode</span>
                <span class="muted">Scan a whole stack</span>
              </button>
              <button
                class="start-tile"
                onClick={() => {
                  primeAudio();
                  setShelf(true);
                }}
              >
                <IconShelfPhoto />
                <span class="start-tile-title">Shelf scan</span>
                <span class="muted">Photo a shelf, find the gems</span>
              </button>
            </div>
          </>
        )}
      </div>

      {verdict && !busy && currentSkin() === "marquee" && <VerdictReveal v={verdict} onNext={next} onClose={() => setVerdict(null)} />}
      {scanning && <Scanner onCode={onCode} onClose={() => setScanning(false)} />}
      {haul && <Haul onClose={() => setHaul(false)} />}
      {shelf && <ShelfScan onClose={() => setShelf(false)} />}
    </div>
  );
}
