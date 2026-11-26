import { useEffect, useRef, useState } from "preact/hooks";
import { copiesFor } from "../lib/db";
import { searchHunts, searchLocal, verdictForBarcode, verdictForCover, type Verdict } from "../lib/verdict";
import { ApiError, coverScan } from "../lib/api";
import { preparePhoto } from "../lib/photo";
import { celebrate, primeAudio } from "../lib/celebrate";
import { addHunt } from "../lib/db";
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

export function VerdictCard({ v, onNext }: { v: Verdict; onNext: () => void }) {
  const cand = v.lookup?.candidates[0];
  const display = v.movie ?? (cand ? { title: cand.title, year: cand.year, poster_path: cand.poster_path } : null);
  const addHref = () => {
    const q = new URLSearchParams();
    if (v.lookup?.barcode) q.set("barcode", v.lookup.barcode);
    if (v.scanned) q.set("format", v.scanned);
    const tmdb = v.movie?.tmdb_id ?? cand?.tmdb_id;
    if (tmdb) q.set("tmdb", String(tmdb));
    if (v.movie) q.set("movie", v.movie.id);
    return `#/add?${q}`;
  };
  return (
    <section class={`verdict verdict-${v.unknown ? "unknown" : v.kind}`} aria-live="polite">
      {v.hunt && (
        <div class="hunt-banner">
          <b>On your hunt list!</b>
          <span>{v.hunt.added_by ? `${v.hunt.added_by} has been looking for this` : "You've been looking for this"}{v.hunt.notes ? ` · ${v.hunt.notes}` : ""}</span>
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
          <h1>Check</h1>
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
        {verdict && !busy && <VerdictCard v={verdict} onNext={next} />}

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

      {scanning && <Scanner onCode={onCode} onClose={() => setScanning(false)} />}
      {haul && <Haul onClose={() => setHaul(false)} />}
      {shelf && <ShelfScan onClose={() => setShelf(false)} />}
    </div>
  );
}
