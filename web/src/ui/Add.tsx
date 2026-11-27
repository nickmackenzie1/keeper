import { ScreenTitle } from "./Zone";
import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError, coverScan, lookupBarcode, searchTmdbPage, tmdbDetails } from "../lib/api";
import { preparePhoto } from "../lib/photo";
import { allCopies, copiesFor, getMovie, movieByTmdb } from "../lib/db";
import { addDisc } from "../lib/collection";
import { FORMATS, FORMAT_LABEL, isUpgradeOver, type Format, type Movie, type TmdbHit } from "../lib/types";
import { Scanner } from "./Scanner";
import { Poster } from "./Poster";
import { IconCamera, IconScan, IconSearch } from "./icons";
import { go, useData } from "./util";

type Pick = { tmdb?: TmdbHit; movie?: Movie; manual?: { title: string; year: number | null } };

export function Add({ query }: { query: URLSearchParams }) {
  const [scanning, setScanning] = useState(false);
  const [q, setQ] = useState(query.get("q") ?? "");
  const [results, setResults] = useState<TmdbHit[] | null>(null);
  const [page, setPage] = useState({ n: 1, more: false, loading: false });
  const [searching, setSearching] = useState(false);
  const [barcode, setBarcode] = useState<string | null>(query.get("barcode"));
  const [format, setFormat] = useState<Format | null>((query.get("format") as Format) || null);
  const [productTitle, setProductTitle] = useState<string | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  // Arriving from the Check screen or a movie page with things already known.
  useEffect(() => {
    (async () => {
      const movieId = query.get("movie");
      const tmdb = Number(query.get("tmdb")) || null;
      if (movieId) {
        const m = await getMovie(movieId);
        if (m) return setPick({ movie: m });
      }
      if (tmdb) {
        const local = await movieByTmdb(tmdb);
        if (local) return setPick({ movie: local });
        try {
          return setPick({ tmdb: await tmdbDetails(tmdb) });
        } catch {
          /* fall through to search */
        }
      }
      if (barcode) await runBarcode(barcode);
      else if (q) await runSearch(q);
    })();
  }, []);

  const fail = (e: unknown) =>
    setError(
      e instanceof ApiError && e.kind === "offline"
        ? "No connection to the server right now. You can still add it by title below and it'll sync later."
        : e instanceof ApiError && e.kind === "login_required"
          ? "Your sign-in expired. Reopen At Home to sign in again."
          : e instanceof Error ? e.message : "Something went wrong",
    );

  async function runBarcode(code: string) {
    setBusy(true);
    setError(null);
    setBarcode(code);
    try {
      const r = await lookupBarcode(code);
      setProductTitle(r.product_title);
      if (r.format && r.format !== "other") setFormat(r.format);
      setResults(r.candidates ?? []);
      setPage({ n: 1, more: false, loading: false });
      if (!r.product_title) setError("That barcode isn't in the lookup database — search by title instead.");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const searchSeq = useRef(0);
  async function runSearch(text: string) {
    if (!text.trim()) return;
    const seq = ++searchSeq.current;
    // Keep the current results on screen while the next ones load (no flashing "Searching…").
    if (!results) setBusy(true);
    setSearching(true);
    setError(null);
    try {
      const r = await searchTmdbPage(text, 1);
      if (seq !== searchSeq.current) return; // a newer search already started
      setResults(r.results);
      setPage({ n: 1, more: r.more, loading: false });
    } catch (e) {
      if (seq !== searchSeq.current) return;
      fail(e);
      setResults([]);
    } finally {
      if (seq === searchSeq.current) {
        setBusy(false);
        setSearching(false);
      }
    }
  }

  async function runCover(file?: File) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setBarcode(null);
    try {
      const { b64 } = await preparePhoto(file, 1400);
      const spine = await coverScan(b64, false);
      if (spine?.format && spine.format !== "unknown") setFormat(spine.format as Format);
      setProductTitle(spine ? [spine.title, spine.label, spine.edition].filter(Boolean).join(" · ") : null);
      if (spine?.match) setResults([spine.match]);
      else {
        setResults([]);
        if (spine?.title) setQ(spine.title);
        setError(spine ? `Read “${spine.title}” but couldn't find it on TMDB — try searching.` : "Couldn't identify that cover. Try the barcode or search by title.");
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  // Search as you type (after a short pause), unless a barcode/cover lookup is showing.
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current || q.trim().length < 2) return;
    const t = setTimeout(() => {
      setBarcode(null);
      setProductTitle(null);
      void runSearch(q);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const loadMore = async () => {
    setPage({ ...page, loading: true });
    try {
      const r = await searchTmdbPage(q, page.n + 1);
      const seen = new Set((results ?? []).map((h) => h.tmdb_id));
      setResults([...(results ?? []), ...r.results.filter((h) => !seen.has(h.tmdb_id))]);
      setPage({ n: page.n + 1, more: r.more, loading: false });
    } catch {
      setPage({ ...page, loading: false });
    }
  };

  const choose = async (hit: TmdbHit) => {
    const local = await movieByTmdb(hit.tmdb_id);
    setPick(local ? { movie: local } : { tmdb: hit });
  };

  if (pick) {
    return <AddForm pick={pick} barcode={barcode} initialFormat={format} onBack={() => setPick(null)} />;
  }

  return (
    <div class="screen">
      <header class="screen-head">
        <ScreenTitle title="Add a disc" />
        <form
          class="row"
          onSubmit={(e) => {
            e.preventDefault();
            setBarcode(null);
            void runSearch(q);
          }}
        >
          <label class={`search grow ${searching ? "searching" : ""}`}>
            <IconSearch />
            <input type="search" placeholder="Search movie title" aria-label="Search movie title" value={q} onInput={(e) => { typed.current = true; setQ((e.target as HTMLInputElement).value); }} />
          </label>
          <button type="button" class="btn icon-btn" aria-label="Photo of the cover" onClick={() => coverInput.current?.click()}>
            <IconCamera />
          </button>
          <button type="button" class="btn primary icon-btn" aria-label="Scan a barcode" onClick={() => setScanning(true)}>
            <IconScan />
          </button>
          <input ref={coverInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void runCover((e.target as HTMLInputElement).files?.[0]); (e.target as HTMLInputElement).value = ""; }} />
        </form>
      </header>

      <div class="screen-body">
        {!barcode && productTitle && <p class="muted">From the cover: “{productTitle}”{format ? ` · ${FORMAT_LABEL[format]}` : ""}</p>}
        {barcode && (
          <p class="muted">
            Barcode {barcode}
            {productTitle ? ` · “${productTitle}”` : ""}
            {format ? ` · ${FORMAT_LABEL[format]}` : ""}
          </p>
        )}
        {busy && <p class="muted center">Searching…</p>}
        {error && <p class="notice">{error}</p>}

        {results && !busy && (
          <ul class="list">
            {results.map((r) => (
              <li key={r.tmdb_id}>
                <button class="list-row" onClick={() => void choose(r)}>
                  <Poster movie={r} size="w185" class="thumb" />
                  <span class="stack grow">
                    <b>{r.title}</b>
                    <span class="muted">{r.year ?? "—"}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {results && !busy && page.more && !barcode && (
          <button class="btn block more-btn" disabled={page.loading} onClick={() => void loadMore()}>
            {page.loading ? "Loading…" : "More results"}
          </button>
        )}

        {!results && !busy && (
          <button class="hero-scan" onClick={() => setScanning(true)}>
            <IconScan />
            <span class="hero-scan-title">Scan the barcode</span>
            <span class="muted">Fills in the movie, poster and whether it's DVD, Blu-ray or 4K.</span>
          </button>
        )}

        {(error || (results && results.length === 0)) && q.trim() && (
          <button class="btn" onClick={() => setPick({ manual: { title: q.trim(), year: null } })}>
            Add “{q.trim()}” without lookup
          </button>
        )}
      </div>

      {scanning && (
        <Scanner
          onClose={() => setScanning(false)}
          onCode={(code) => {
            setScanning(false);
            void runBarcode(code);
          }}
        />
      )}
    </div>
  );
}

function AddForm({ pick, barcode, initialFormat, onBack }: { pick: Pick; barcode: string | null; initialFormat: Format | null; onBack: () => void }) {
  const base = pick.movie ?? pick.tmdb ?? { title: pick.manual!.title, year: pick.manual!.year, poster_path: null };
  const [format, setFormat] = useState<Format>(initialFormat ?? "dvd");
  const [edition, setEdition] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [title, setTitle] = useState(base.title);
  const [year, setYear] = useState(base.year ? String(base.year) : "");
  const [saving, setSaving] = useState(false);
  const existing = useData(async () => (pick.movie ? copiesFor(pick.movie.id) : []), [pick.movie?.id]);
  const locations = useData(async () => [...new Set((await allCopies()).map((c) => c.location).filter(Boolean) as string[])].sort());

  const isUpgrade = existing && existing.length > 0 && isUpgradeOver(format, existing.map((c) => c.format));

  const save = async () => {
    setSaving(true);
    const { movie } = await addDisc({
      movie: pick.movie,
      tmdb: pick.tmdb,
      manual: pick.manual ? { title: title.trim(), year: Number(year) || null } : undefined,
      format,
      barcode,
      edition,
      location,
      notes,
    });
    go(`#/movie/${movie.id}`);
  };

  return (
    <div class="screen">
      <header class="screen-head">
        <button class="btn ghost" onClick={onBack}>‹ Back</button>
      </header>
      <div class="screen-body">
        <div class="detail-head">
          <Poster movie={{ title: base.title, year: base.year, poster_path: base.poster_path }} class="detail-poster" />
          <div class="stack">
            {pick.manual ? (
              <>
                <label class="field">Title<input value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} /></label>
                <label class="field">Year<input inputMode="numeric" value={year} onInput={(e) => setYear((e.target as HTMLInputElement).value)} /></label>
              </>
            ) : (
              <>
                <h2>{base.title}</h2>
                <span class="muted">{base.year ?? ""}</span>
              </>
            )}
            {existing && existing.length > 0 && (
              <p class={isUpgrade ? "notice good" : "notice"}>
                You already own: {existing.map((c) => FORMAT_LABEL[c.format]).join(", ")}
                {isUpgrade ? " — this is an upgrade." : ""}
              </p>
            )}
          </div>
        </div>

        <fieldset class="field">
          <legend>Format</legend>
          <div class="seg">
            {FORMATS.map((f) => (
              <button key={f} type="button" class={format === f ? "on" : ""} aria-pressed={format === f} onClick={() => setFormat(f)}>
                {FORMAT_LABEL[f]}
              </button>
            ))}
          </div>
        </fieldset>
        <label class="field"><span>Edition <span class="muted">(optional)</span></span>
          <input placeholder="Steelbook, Criterion, Director's Cut…" value={edition} onInput={(e) => setEdition((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field"><span>Where it lives <span class="muted">(optional)</span></span>
          <input list="locations" placeholder="Living room, basement…" value={location} onInput={(e) => setLocation((e.target as HTMLInputElement).value)} />
          <datalist id="locations">{(locations ?? []).map((l) => <option key={l} value={l} />)}</datalist>
        </label>
        <label class="field"><span>Notes <span class="muted">(optional)</span></span>
          <input value={notes} onInput={(e) => setNotes((e.target as HTMLInputElement).value)} />
        </label>
        {barcode && <p class="muted">Barcode {barcode} will be saved so future scans match instantly.</p>}
        <button class="btn primary block" disabled={saving || (pick.manual && !title.trim())} onClick={() => void save()}>
          {saving ? "Saving…" : `Add ${FORMAT_LABEL[format]} to collection`}
        </button>
      </div>
    </div>
  );
}
