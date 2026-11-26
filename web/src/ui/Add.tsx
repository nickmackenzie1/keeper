import { useEffect, useState } from "preact/hooks";
import { ApiError, lookupBarcode, searchTmdb, tmdbDetails } from "../lib/api";
import { allCopies, copiesFor, getMeta, getMovie, movieByTmdb, saveCopy, saveMovie } from "../lib/db";
import { FORMATS, FORMAT_LABEL, FORMAT_RANK, type Format, type Movie, type TmdbHit } from "../lib/types";
import { Scanner } from "./Scanner";
import { Poster } from "./Poster";
import { IconScan, IconSearch } from "./icons";
import { go, useData } from "./util";

type Pick = { tmdb?: TmdbHit; movie?: Movie; manual?: { title: string; year: number | null } };

export function Add({ query }: { query: URLSearchParams }) {
  const [scanning, setScanning] = useState(false);
  const [q, setQ] = useState(query.get("q") ?? "");
  const [results, setResults] = useState<TmdbHit[] | null>(null);
  const [barcode, setBarcode] = useState<string | null>(query.get("barcode"));
  const [format, setFormat] = useState<Format | null>((query.get("format") as Format) || null);
  const [productTitle, setProductTitle] = useState<string | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        ? "No connection to Keeper right now. You can still add it by title below and it'll sync later."
        : e instanceof ApiError && e.kind === "login_required"
          ? "Your sign-in expired. Reopen Keeper to sign in again."
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
      setResults(r.candidates);
      if (!r.product_title) setError("That barcode isn't in the lookup database — search by title instead.");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function runSearch(text: string) {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setResults(await searchTmdb(text));
    } catch (e) {
      fail(e);
      setResults([]);
    } finally {
      setBusy(false);
    }
  }

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
        <h1>Add a disc</h1>
        <form
          class="row"
          onSubmit={(e) => {
            e.preventDefault();
            setBarcode(null);
            void runSearch(q);
          }}
        >
          <label class="search grow">
            <IconSearch />
            <input type="search" placeholder="Search movie title" aria-label="Search movie title" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
          </label>
          <button type="button" class="btn primary icon-btn" aria-label="Scan a barcode" onClick={() => setScanning(true)}>
            <IconScan />
          </button>
        </form>
      </header>

      <div class="screen-body">
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

  const bestOwned = (existing ?? []).reduce((a, c) => Math.max(a, FORMAT_RANK[c.format]), 0);
  const isUpgrade = existing && existing.length > 0 && FORMAT_RANK[format] > bestOwned;

  const save = async () => {
    setSaving(true);
    let movie = pick.movie;
    if (!movie) {
      let details: Partial<TmdbHit> = pick.tmdb ?? {};
      if (pick.tmdb) details = await tmdbDetails(pick.tmdb.tmdb_id).catch(() => pick.tmdb!);
      movie = await saveMovie({
        id: crypto.randomUUID(),
        tmdb_id: pick.tmdb?.tmdb_id ?? null,
        title: pick.manual ? title.trim() : details.title ?? title,
        year: pick.manual ? Number(year) || null : details.year ?? null,
        poster_path: details.poster_path ?? null,
        overview: details.overview ?? null,
        runtime: details.runtime ?? null,
        deleted: false,
      });
    }
    // Got a better version: the old ones no longer need upgrading.
    if (isUpgrade) {
      for (const c of existing ?? []) if (c.upgrade_wanted && FORMAT_RANK[c.format] < FORMAT_RANK[format]) await saveCopy({ ...c, upgrade_wanted: false });
    }
    await saveCopy({
      id: crypto.randomUUID(),
      movie_id: movie.id,
      format,
      barcode,
      edition: edition.trim() || null,
      location: location.trim() || null,
      notes: notes.trim() || null,
      upgrade_wanted: false,
      added_by: (await getMeta("deviceName")) ?? null,
      deleted: false,
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
        <label class="field">Edition <span class="muted">(optional)</span>
          <input placeholder="Steelbook, Criterion, Director's Cut…" value={edition} onInput={(e) => setEdition((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field">Where it lives <span class="muted">(optional)</span>
          <input list="locations" placeholder="Living room, basement…" value={location} onInput={(e) => setLocation((e.target as HTMLInputElement).value)} />
          <datalist id="locations">{(locations ?? []).map((l) => <option key={l} value={l} />)}</datalist>
        </label>
        <label class="field">Notes <span class="muted">(optional)</span>
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
