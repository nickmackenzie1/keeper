import { useEffect, useState } from "preact/hooks";
import { copiesFor } from "../lib/db";
import { searchLocal, verdictForBarcode, type Verdict } from "../lib/verdict";
import { FORMAT_LABEL, FORMAT_SHORT, FORMAT_RANK, type Copy, type Movie } from "../lib/types";
import { Scanner } from "./Scanner";
import { Poster } from "./Poster";
import { IconScan, IconSearch } from "./icons";
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
      return `You own ${title} on ${owned}${v.scanned ? ` — this ${FORMAT_LABEL[v.scanned]} isn't an upgrade` : ""}.`;
    case "owned":
      return `You own ${title} on ${owned}. Check the case to see if this one's better.`;
    default:
      if (v.unknown) return "Couldn't identify this barcode. Try typing the title.";
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
      <div class="verdict-head">
        {display && <Poster movie={display} size="w185" class="verdict-poster" />}
        <div class="stack">
          <span class="eyebrow">{v.scanned && v.scanned !== "other" ? `Scanned · ${FORMAT_LABEL[v.scanned]}` : "Result"}</span>
          <h2 class="verdict-title">{v.unknown ? "Unknown disc" : HEADLINE[v.kind]}</h2>
          <p class="verdict-sub">{summary(v)}</p>
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
                <span>{[FORMAT_LABEL[c.format], c.edition].filter(Boolean).join(" · ")}</span>
                <span class="muted">{c.location ?? ""}{c.upgrade_wanted ? " · wants upgrade" : ""}</span>
              </li>
            ))}
        </ul>
      )}
      <div class="row">
        {(v.kind === "not_owned" || v.kind === "upgrade") && !v.unknown && (
          <a class="btn primary grow" href={addHref()}>
            {v.kind === "upgrade" ? `Grab it · add ${FORMAT_LABEL[v.scanned!]}` : "Bought it — add"}
          </a>
        )}
        {v.movie && v.kind !== "upgrade" && (
          <a class="btn grow" href={`#/movie/${v.movie.id}`}>Details</a>
        )}
        <button class="btn" onClick={onNext}>Scan next</button>
      </div>
    </section>
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

  useEffect(() => {
    if (!q.trim()) return setResults(null);
    let alive = true;
    searchLocal(q).then((r) => alive && setResults(r));
    return () => void (alive = false);
  }, [q]);

  const onCode = async (code: string) => {
    setScanning(false);
    setBusy(true);
    setQ("");
    try {
      setVerdict(await verdictForBarcode(code));
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    setVerdict(null);
    setScanning(true);
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
          <button class="btn primary icon-btn" aria-label="Scan a barcode" onClick={() => setScanning(true)}>
            <IconScan />
          </button>
        </div>
      </header>

      <div class="screen-body">
        {busy && <p class="muted center">Looking it up…</p>}
        {verdict && !busy && <VerdictCard v={verdict} onNext={next} />}

        {!verdict && !busy && results && (
          results.length ? (
            <ul class="list">{results.map((m) => <ResultRow key={m.id} m={m} />)}</ul>
          ) : (
            <section class="verdict verdict-not_owned">
              <h2 class="verdict-title">Not in your collection</h2>
              <p class="verdict-sub">Nothing on your shelf matches “{q}”.</p>
              <div class="row">
                <a class="btn primary grow" href={`#/add?q=${encodeURIComponent(q)}`}>Bought it — add</a>
              </div>
            </section>
          )
        )}

        {!verdict && !busy && !results && (
          <button class="hero-scan" onClick={() => setScanning(true)}>
            <IconScan />
            <span class="hero-scan-title">Scan a disc</span>
            <span class="muted">Instantly see if you own it, or if it's an upgrade. Works without signal.</span>
          </button>
        )}
      </div>

      {scanning && <Scanner onCode={onCode} onClose={() => setScanning(false)} />}
    </div>
  );
}
