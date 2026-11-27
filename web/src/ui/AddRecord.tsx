import { useEffect, useRef, useState } from "preact/hooks";
import { ScreenTitle } from "./Zone";
import { Scanner } from "./Scanner";
import { Cover } from "./Cover";
import { IconCamera, IconScan, IconSearch } from "./icons";
import { go, useData } from "./util";
import { ApiError, coverScan, lookupAny, recordMaster, recordRelease, searchRecords } from "../lib/api";
import { preparePhoto } from "../lib/photo";
import { addRecord } from "../lib/records";
import { albumByDiscogs, allPressings, getAlbum, pressingsFor } from "../lib/db";
import { RECORD_FORMATS, RECORD_LABEL, type Album, type AlbumHit, type PressingInfo, type RecordFormat } from "../lib/types";

type Pick = { album?: Album; hit?: AlbumHit; pressing?: Partial<PressingInfo>; manual?: { artist: string; title: string } };

/** Add a record: search Discogs, scan its barcode, photograph the sleeve, or type it in. */
export function AddRecord({ query }: { query: URLSearchParams }) {
  const [q, setQ] = useState(query.get("q") ?? "");
  const [results, setResults] = useState<AlbumHit[] | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [barcode, setBarcode] = useState<string | null>(query.get("barcode"));
  const [format, setFormat] = useState<RecordFormat | null>((query.get("format") as RecordFormat) || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const typed = useRef(false);
  const coverInput = useRef<HTMLInputElement>(null);

  const fail = (e: unknown) =>
    setError(
      e instanceof ApiError && e.kind === "offline"
        ? "No connection right now. You can still add it by typing below; it'll sync later."
        : e instanceof Error ? e.message : "Something went wrong",
    );

  // Arriving from a scan or a record page with things already known.
  useEffect(() => {
    (async () => {
      const albumId = query.get("album");
      const release = Number(query.get("release")) || null;
      const master = Number(query.get("master")) || null;
      if (albumId) {
        const a = await getAlbum(albumId);
        if (a) return setPick({ album: a });
      }
      if (master) {
        const own = await albumByDiscogs(master, null);
        if (own && !release) return setPick({ album: own });
      }
      try {
        if (release) {
          const r = await recordRelease(release);
          const own = await albumByDiscogs(r.album.discogs_master_id, r.album.discogs_release_id);
          return setPick(own ? { album: own, pressing: r.pressing } : { hit: r.album, pressing: r.pressing });
        }
        if (master) return setPick({ hit: await recordMaster(master) });
      } catch (e) {
        fail(e);
      }
      if (q) void runSearch(q);
    })();
  }, []);

  const seq = useRef(0);
  async function runSearch(text: string) {
    if (!text.trim()) return;
    const n = ++seq.current;
    if (!results) setBusy(true);
    setError(null);
    try {
      const r = await searchRecords(text);
      if (n === seq.current) setResults(r);
    } catch (e) {
      if (n === seq.current) {
        fail(e);
        setResults([]);
      }
    } finally {
      if (n === seq.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (!typed.current || q.trim().length < 2) return;
    const t = setTimeout(() => void runSearch(q), 260);
    return () => clearTimeout(t);
  }, [q]);

  async function runBarcode(code: string) {
    setBusy(true);
    setError(null);
    setBarcode(code);
    try {
      const r = await lookupAny(code);
      if (r.kind === "album") {
        const own = await albumByDiscogs(r.album.discogs_master_id, r.album.discogs_release_id);
        setFormat(r.pressing.format);
        setPick(own ? { album: own, pressing: r.pressing } : { hit: r.album, pressing: r.pressing });
      } else setError(r.product_title ? `That barcode is a movie (“${r.product_title}”). Add it from the movie shelf.` : "Discogs doesn't know that barcode. Search by artist or album instead.");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function runCover(file?: File) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { b64 } = await preparePhoto(file, 1400);
      const s = await coverScan(b64, false);
      if (s?.kind === "album" && s.album) {
        if (s.format === "vinyl" || s.format === "cd" || s.format === "cassette") setFormat(s.format);
        setPick({ hit: s.album });
      } else if (s) {
        setQ([s.artist, s.title].filter(Boolean).join(" "));
        void runSearch([s.artist, s.title].filter(Boolean).join(" "));
        setError(s.kind === "album" ? `Read “${s.title}” but couldn't find it on Discogs. Here's a search.` : "That looks like a movie, not a record.");
      } else setError("Couldn't read that sleeve. Try the barcode, or search.");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  if (pick) return <RecordForm pick={pick} barcode={barcode} initialFormat={format} onBack={() => setPick(null)} />;

  return (
    <div class="screen">
      <header class="screen-head">
        <ScreenTitle title="Add a record" />
        <form class="row" onSubmit={(e) => { e.preventDefault(); void runSearch(q); }}>
          <label class="search grow">
            <IconSearch />
            <input type="search" placeholder="Artist or album" aria-label="Search records" value={q} onInput={(e) => { typed.current = true; setQ((e.target as HTMLInputElement).value); }} />
          </label>
          <button type="button" class="btn icon-btn" aria-label="Photo of the sleeve" onClick={() => coverInput.current?.click()}><IconCamera /></button>
          <button type="button" class="btn primary icon-btn" aria-label="Scan a barcode" onClick={() => setScanning(true)}><IconScan /></button>
          <input ref={coverInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void runCover((e.target as HTMLInputElement).files?.[0]); (e.target as HTMLInputElement).value = ""; }} />
        </form>
      </header>
      <div class="screen-body">
        {busy && <p class="muted center">Searching…</p>}
        {error && <p class="notice">{error}</p>}
        {results && !busy && (
          <ul class="list">
            {results.map((r) => (
              <li key={`${r.discogs_master_id}-${r.discogs_release_id}`}>
                <button class="list-row" onClick={async () => setPick((await (async () => { const own = await albumByDiscogs(r.discogs_master_id, r.discogs_release_id); return own ? { album: own } : { hit: r }; })()))}>
                  <Cover album={r} class="thumb" />
                  <span class="stack grow">
                    <b>{r.title}</b>
                    <span class="muted">{[r.artist, r.year].filter(Boolean).join(" · ")}</span>
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
            <span class="muted">Finds the exact pressing. Older records with no barcode: search, or photograph the sleeve.</span>
          </button>
        )}
        {(error || (results && results.length === 0)) && q.trim() && (
          <button class="btn" onClick={() => setPick({ manual: { artist: "", title: q.trim() } })}>Add “{q.trim()}” without lookup</button>
        )}
      </div>
      {scanning && <Scanner onClose={() => setScanning(false)} onCode={(c) => { setScanning(false); void runBarcode(c); }} />}
    </div>
  );
}

function RecordForm({ pick, barcode, initialFormat, onBack }: { pick: Pick; barcode: string | null; initialFormat: RecordFormat | null; onBack: () => void }) {
  const base = pick.album ?? pick.hit ?? { title: pick.manual!.title, artist: pick.manual!.artist, year: null, cover_url: null };
  const [format, setFormat] = useState<RecordFormat>(initialFormat ?? pick.pressing?.format ?? "vinyl");
  const [desc, setDesc] = useState(pick.pressing?.description ?? "");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [artist, setArtist] = useState(base.artist ?? "");
  const [title, setTitle] = useState(base.title);
  const [year, setYear] = useState(base.year ? String(base.year) : "");
  const [saving, setSaving] = useState(false);
  const existing = useData(async () => (pick.album ? pressingsFor(pick.album.id) : []), [pick.album?.id]);
  const locations = useData(async () => [...new Set((await allPressings()).map((p) => p.location).filter(Boolean) as string[])].sort());

  const save = async () => {
    setSaving(true);
    const { album } = await addRecord({
      album: pick.album,
      hit: pick.hit,
      manual: pick.manual ? { artist: artist.trim(), title: title.trim(), year: Number(year) || null } : undefined,
      format,
      pressing: { ...pick.pressing, description: desc.trim() || null },
      barcode,
      location,
      notes,
    });
    go(`#/record/${album.id}`);
  };

  return (
    <div class="screen">
      <header class="screen-head">
        <button class="btn ghost" onClick={onBack}>‹ Back</button>
      </header>
      <div class="screen-body">
        <div class="detail-head">
          <Cover album={{ title: base.title, artist: base.artist, cover_url: base.cover_url }} class="detail-poster" />
          <div class="stack">
            {pick.manual ? (
              <>
                <label class="field">Artist<input value={artist} onInput={(e) => setArtist((e.target as HTMLInputElement).value)} /></label>
                <label class="field">Album<input value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} /></label>
                <label class="field">Year<input inputMode="numeric" value={year} onInput={(e) => setYear((e.target as HTMLInputElement).value)} /></label>
              </>
            ) : (
              <>
                <span class="record-artist">{base.artist}</span>
                <h2>{base.title}</h2>
                <span class="muted">{base.year ?? ""}</span>
              </>
            )}
            {existing && existing.length > 0 && (
              <p class={format === "vinyl" && !existing.some((p) => p.format === "vinyl") ? "notice good" : "notice"}>
                You already own: {existing.map((p) => RECORD_LABEL[p.format]).join(", ")}
                {format === "vinyl" && !existing.some((p) => p.format === "vinyl") ? " — this is a vinyl upgrade." : ""}
              </p>
            )}
          </div>
        </div>
        <fieldset class="field">
          <legend>Format</legend>
          <div class="seg">
            {RECORD_FORMATS.map((f) => (
              <button key={f} type="button" class={format === f ? "on" : ""} aria-pressed={format === f} onClick={() => setFormat(f)}>{RECORD_LABEL[f]}</button>
            ))}
          </div>
        </fieldset>
        <label class="field"><span>Pressing <span class="muted">(optional)</span></span>
          <input placeholder="2×LP, reissue, red vinyl…" value={desc} onInput={(e) => setDesc((e.target as HTMLInputElement).value)} />
        </label>
        {pick.pressing?.label && <p class="muted">{[pick.pressing.label, pick.pressing.catno, pick.pressing.country, pick.pressing.year].filter(Boolean).join(" · ")}</p>}
        <label class="field"><span>Where it lives <span class="muted">(optional)</span></span>
          <input list="rlocations" placeholder="Record shelf, crate 2…" value={location} onInput={(e) => setLocation((e.target as HTMLInputElement).value)} />
          <datalist id="rlocations">{(locations ?? []).map((l) => <option key={l} value={l} />)}</datalist>
        </label>
        <label class="field"><span>Notes <span class="muted">(optional)</span></span>
          <input value={notes} onInput={(e) => setNotes((e.target as HTMLInputElement).value)} />
        </label>
        {barcode && <p class="muted">Barcode {barcode} will be saved so future scans match instantly.</p>}
        <button class="btn primary block" disabled={saving || (pick.manual && !title.trim())} onClick={() => void save()}>
          {saving ? "Saving…" : `Add ${RECORD_LABEL[format]} to collection`}
        </button>
      </div>
    </div>
  );
}
