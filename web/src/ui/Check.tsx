import { ScreenTitle, ZoneTitle } from "./Zone";
import { currentSkin } from "./skins";
import { posterUrl } from "../lib/types";
import { tint } from "./util";
import { useEffect, useRef, useState } from "preact/hooks";
import { copiesFor } from "../lib/db";
import { matchHunt, searchHunts, searchLocal, verdictForBarcode, verdictForCover, type Verdict } from "../lib/verdict";
import { ApiError, coverScan, searchTmdbPage } from "../lib/api";
import { preparePhoto } from "../lib/photo";
import { celebrate, primeAudio } from "../lib/celebrate";
import { addHunt, allHunts } from "../lib/db";
import { Person, greeting, useMe } from "./Person";
import { useData } from "./util";
import { Haul } from "./Haul";
import { ShelfScan } from "./ShelfScan";
import { FORMAT_LABEL, FORMAT_SHORT, FORMAT_RANK, type Copy, type Hunt, type Movie, type TmdbHit } from "../lib/types";
import { Scanner } from "./Scanner";
import { Poster } from "./Poster";
import { Redacted } from "./Redacted";
import { Cover } from "./Cover";
import { RecordCard, RecordReveal, recordDisplay, recordWord } from "./RecordVerdict";
import { searchLocalAlbums, matchAlbumHunt, judgeRecord } from "../lib/records";
import { searchRecords } from "../lib/api";
import { RECORD_SHORT, type Album, type AlbumHit } from "../lib/types";
import { pressingsFor } from "../lib/db";
import { IconCamera, IconScan, IconSearch, IconShelfPhoto, IconStack } from "./icons";
import { SyncPill } from "./SyncPill";
import { allScans, onScans, queueScan, type Scan } from "../lib/scans";

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
          fontSize={`min(96px, ${Math.floor(78 / (WORD[kind].length * 0.68))}vw)`}
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

const WORD_OF: Record<string, string> = { not_owned: "Grab it", upgrade: "Upgrade", have: "Got it", owned: "You own it", hunt: "Found it", unknown: "No match" };
const kindOf = (v: Verdict) => (v.unknown ? "unknown" : v.hunt ? "hunt" : v.kind);

/** Marquee: the scan is on screen at once, while the answer is fetched. Keep scanning any time. */
function PendingReveal({ scan, onNext, onClose }: { scan: Scan; onNext: () => void; onClose: () => void }) {
  return (
    <div class="reveal reveal-pending" role="dialog" aria-label="Checking">
      <div class="reveal-bg" aria-hidden="true" style={{ background: "#050505" }}>
        <span class="pending-sweep" />
      </div>
      <button class="reveal-close icon-btn" aria-label="Close" onClick={onClose}>×</button>
      <div class="reveal-center" aria-live="polite">
        <ZoneTitle size="reveal" play kicker={scan.error ? "Couldn't check" : scan.label === "Cover photo" ? "Reading the cover" : `Barcode ${scan.label}`} title={scan.error ? "Offline" : "Checking"} sub={scan.error ?? "Keep scanning. This one will land on your list."} fontSize="min(96px, 21vw)" />
      </div>
      <div class="reveal-panel">
        <div class="row">
          <button class="btn primary grow" onClick={onNext}>Scan next</button>
          <button class="btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function PendingCard({ scan, onNext }: { scan: Scan; onNext: () => void }) {
  return (
    <section class="verdict verdict-pending" aria-live="polite">
      <span class="eyebrow">{scan.label === "Cover photo" ? "Cover photo" : `Barcode ${scan.label}`}</span>
      <h2 class="verdict-title">{scan.error ? "Couldn't check" : "Checking…"}</h2>
      <p class="verdict-sub">{scan.error ?? "Keep scanning. This one will land in your list below."}</p>
      <div class="row"><button class="btn primary grow" onClick={onNext}>Scan next</button></div>
    </section>
  );
}

/** This trip's scans, newest first. Each card fills in as its answer lands. */
function ScanTray({ scans, onOpen }: { scans: Scan[]; onOpen: (id: string) => void }) {
  return (
    <section class="scan-tray" aria-label="Recent scans">
      <h3 class="suggest-head">01 · This trip</h3>
      <ul class="list">
        {scans.slice(0, 12).map((s) => {
          const v = s.verdict;
          if (v?.record) {
            const d = recordDisplay(v.record);
            return (
              <li key={s.id} class={`scan-row scan-${v.record.hunt ? "hunt" : v.record.kind === "upgrade" ? "upgrade" : v.record.kind === "new" ? "not_owned" : "have"}`}>
                <button class="list-row" onClick={() => onOpen(s.id)}>
                  {d ? <Cover album={d} class="thumb" /> : <span class="thumb scan-ghost" aria-hidden="true" />}
                  <span class="stack grow">
                    <b>{d?.title ?? "Record"}</b>
                    <span class="muted">{[d?.artist, d?.year].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span class="scan-word">{recordWord(v.record)}</span>
                </button>
              </li>
            );
          }
          const cand = v?.lookup?.candidates?.[0];
          const disp = v?.movie ?? (cand ? { title: cand.title, year: cand.year, poster_path: cand.poster_path } : null);
          const k = v ? kindOf(v) : s.error ? "error" : "pending";
          return (
            <li key={s.id} class={`scan-row scan-${k}`}>
              <button class="list-row" onClick={() => onOpen(s.id)}>
                {disp ? <Poster movie={disp} size="w185" class="thumb" /> : <span class="thumb scan-ghost" aria-hidden="true" />}
                <span class="stack grow">
                  {disp ? <b>{disp.title}</b> : s.error ? <b>Couldn't check</b> : <Redacted label={s.label === "Cover photo" ? "Reading the cover" : "Checking"} />}
                  <span class="muted">{disp?.year ?? (s.label === "Cover photo" ? "Cover photo" : s.label)}</span>
                </span>
                <span class="scan-word">{v ? WORD_OF[k] : s.error ? "Retry later" : ""}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
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

function AlbumRow({ a }: { a: Album }) {
  const [formats, setFormats] = useState<string[]>([]);
  useEffect(() => void pressingsFor(a.id).then((ps) => setFormats([...new Set(ps.map((p) => p.format))])), [a.id]);
  return (
    <li>
      <a class="list-row" href={`#/record/${a.id}`}>
        <Cover album={a} class="thumb" />
        <span class="stack grow">
          <b>{a.title}</b>
          <span class="muted">{[a.artist, a.year].filter(Boolean).join(" · ")}</span>
        </span>
        {formats.map((f) => <span key={f} class="chip" data-format={f}>{RECORD_SHORT[f as keyof typeof RECORD_SHORT]}</span>)}
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
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Movie[] | null>(null);
  const [suggest, setSuggest] = useState<TmdbHit[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [recSuggest, setRecSuggest] = useState<AlbumHit[]>([]);
  const [sugPage, setSugPage] = useState({ page: 1, more: false, loading: false });
  const [hunts, setHunts] = useState<Hunt[]>([]);
  const [haul, setHaul] = useState(false);
  const [shelf, setShelf] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  // Scans and cover photos run in the background: the card shows up at once and fills in.
  const [scans, setScans] = useState<Scan[]>(allScans());
  useEffect(() => onScans(() => setScans(allScans())), []);
  const [openScan, setOpenScan] = useState<string | null>(null);
  const opened = scans.find((x) => x.id === openScan) ?? null;

  const onCover = (file?: File) => {
    if (!file) return;
    setError(null);
    setVerdict(null);
    setQ("");
    const id = queueScan(
      "Cover photo",
      async () => {
        const { b64 } = await preparePhoto(file, 1400);
        try {
          return await verdictForCover(await coverScan(b64, true));
        } catch (e) {
          throw new Error(
            e instanceof ApiError && e.kind === "offline"
              ? "Cover photos need a connection. The barcode works offline for discs you own."
              : e instanceof Error ? e.message : "Couldn't read that photo.",
          );
        }
      },
      (v) => v.hunt && celebrate(),
    );
    setOpenScan(id);
  };

  useEffect(() => {
    if (!q.trim()) return setResults(null);
    let alive = true;
    searchLocal(q).then((r) => alive && setResults(r));
    searchHunts(q).then((h) => alive && setHunts(h));
    searchLocalAlbums(q).then((a) => alive && setAlbums(a));
    return () => void (alive = false);
  }, [q]);

  // Records from Discogs as you type (quietly skipped when records aren't set up, or offline).
  useEffect(() => {
    if (q.trim().length < 3) {
      setRecSuggest([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => searchRecords(q.trim()).then((r) => alive && setRecSuggest(r.slice(0, 6))).catch(() => alive && setRecSuggest([])), 260);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const pickRecord = async (hit: AlbumHit) => {
    const own = albums.find((a) => (hit.discogs_master_id && a.discogs_master_id === hit.discogs_master_id));
    const pressings = own ? await pressingsFor(own.id) : [];
    const rec = { kind: judgeRecord(own ?? null, pressings, null), album: own ?? null, pressings, hit, scanned: null, hunt: own ? undefined : await matchAlbumHunt(hit) };
    setVerdict({ kind: "not_owned", movie: null, copies: [], scanned: null, record: rec });
    if (rec.hunt) celebrate();
  };

  // Suggestions from the movie database as you type (online only; quietly skipped offline).
  useEffect(() => {
    if (q.trim().length < 2) {
      setSuggest([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      searchTmdbPage(q.trim(), 1)
        .then((r) => {
          if (!alive) return;
          setSuggest(r.results);
          setSugPage({ page: 1, more: r.more, loading: false });
        })
        .catch(() => {});
    }, 220);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const pickSuggestion = async (hit: TmdbHit) => {
    const v: Verdict = {
      kind: "not_owned",
      movie: null,
      copies: [],
      scanned: null,
      lookup: { barcode: "", product_title: hit.title, format: null, candidates: [hit] },
    };
    v.hunt = await matchHunt([hit.tmdb_id], hit.title);
    setVerdict(v);
    if (v.hunt) celebrate();
  };
  const moreSuggestions = async () => {
    const next = sugPage.page + 1;
    setSugPage({ ...sugPage, loading: true });
    try {
      const r = await searchTmdbPage(q.trim(), next);
      const seen = new Set(suggest.map((h) => h.tmdb_id));
      setSuggest([...suggest, ...r.results.filter((h) => !seen.has(h.tmdb_id))]);
      setSugPage({ page: next, more: r.more, loading: false });
    } catch {
      setSugPage({ ...sugPage, loading: false });
    }
  };
  const ownedIds = new Set((results ?? []).map((m) => m.tmdb_id));
  const fresh = suggest.filter((h) => !ownedIds.has(h.tmdb_id));

  const onCode = (code: string) => {
    setScanning(false);
    setQ("");
    setVerdict(null);
    const id = queueScan(code, () => verdictForBarcode(code, { store: true }), (v) => v.hunt && celebrate());
    setOpenScan(id);
  };

  const startScan = () => {
    primeAudio();
    setScanning(true);
  };
  const next = () => {
    setVerdict(null);
    setOpenScan(null);
    startScan();
  };
  const closeShown = () => {
    setVerdict(null);
    setOpenScan(null);
  };
  // What's on screen: a verdict you picked directly, or the scan you're looking at (maybe still checking).
  const shown: Verdict | null = verdict ?? opened?.verdict ?? null;
  const pending = !verdict && opened && !opened.verdict ? opened : null;
  const busy = false;

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
          <input ref={coverInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onCover((e.target as HTMLInputElement).files?.[0]); (e.target as HTMLInputElement).value = ""; }} />
        </div>
      </header>

      <div class="screen-body">
        {error && <p class="notice">{error}</p>}
        {pending && currentSkin() !== "marquee" && <PendingCard scan={pending} onNext={next} />}
        {shown && currentSkin() !== "marquee" && (shown.record ? <RecordCard v={shown.record} onNext={next} /> : <VerdictCard v={shown} onNext={next} />)}

        {!shown && !pending && results && hunts.map((h) => (
          <div key={h.id} class="hunt-banner standalone">
            <b>“{h.title}” is on your hunt list!</b>
            <span>{h.added_by ? `${h.added_by} is looking for it` : "Grab it if you see it"}{h.notes ? ` · ${h.notes}` : ""}</span>
          </div>
        ))}

        {!shown && !pending && results && (
          results.length ? (
            <ul class="list">{results.map((m) => <ResultRow key={m.id} m={m} />)}</ul>
          ) : albums.length ? null : (
            <section class="verdict verdict-not_owned">
              <h2 class="verdict-title">Not in your collection</h2>
              <p class="verdict-sub">Nothing on your shelf matches “{q}”.</p>
              <div class="row">
                <a class="btn primary grow" href={`#/add?q=${encodeURIComponent(q)}`}>Bought it</a>
              </div>
            </section>
          )
        )}

        {!shown && !pending && results && albums.length > 0 && (
          <>
            <h3 class="suggest-head">Your records</h3>
            <ul class="list">
              {albums.slice(0, 8).map((a) => <AlbumRow key={a.id} a={a} />)}
            </ul>
          </>
        )}

        {!shown && !pending && results && recSuggest.filter((h) => !albums.some((a) => a.discogs_master_id && a.discogs_master_id === h.discogs_master_id)).length > 0 && (
          <>
            <h3 class="suggest-head">Records not on your shelf</h3>
            <ul class="list">
              {recSuggest
                .filter((h) => !albums.some((a) => a.discogs_master_id && a.discogs_master_id === h.discogs_master_id))
                .map((h) => (
                  <li key={`${h.discogs_master_id}-${h.discogs_release_id}`}>
                    <button class="list-row suggest-row" onClick={() => void pickRecord(h)}>
                      <Cover album={h} class="thumb" />
                      <span class="stack grow">
                        <b>{h.title}</b>
                        <span class="muted">{[h.artist, h.year].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span class="chip new">NEW</span>
                    </button>
                  </li>
                ))}
            </ul>
          </>
        )}

        {!shown && !pending && results && fresh.length > 0 && (
          <>
            <h3 class="suggest-head">{results.length ? "02 · Not on your shelf" : "02 · Did you mean"}</h3>
            <ul class="list">
              {fresh.map((h) => (
                <li key={h.tmdb_id}>
                  <button class="list-row suggest-row" onClick={() => void pickSuggestion(h)}>
                    <Poster movie={h} size="w185" class="thumb" />
                    <span class="stack grow">
                      <b>{h.title}</b>
                      <span class="muted">{h.year ?? ""}</span>
                    </span>
                    <span class="chip new">NEW</span>
                  </button>
                </li>
              ))}
            </ul>
            {sugPage.more && (
              <button class="btn block more-btn" disabled={sugPage.loading} onClick={() => void moreSuggestions()}>
                {sugPage.loading ? "Loading…" : "More results"}
              </button>
            )}
          </>
        )}

        {!shown && !pending && !results && (
          <>
            <Hello />
            {scans.length > 0 && <ScanTray scans={scans} onOpen={setOpenScan} />}
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

      {pending && currentSkin() === "marquee" && <PendingReveal scan={pending} onNext={next} onClose={closeShown} />}
      {shown && currentSkin() === "marquee" && (shown.record
        ? <RecordReveal key={opened?.id ?? "direct"} v={shown.record} onNext={next} onClose={closeShown} />
        : <VerdictReveal key={opened?.id ?? "direct"} v={shown} onNext={next} onClose={closeShown} />)}
      {scanning && <Scanner onCode={onCode} onClose={() => setScanning(false)} />}
      {haul && <Haul onClose={() => setHaul(false)} />}
      {shelf && <ShelfScan onClose={() => setShelf(false)} />}
    </div>
  );
}
