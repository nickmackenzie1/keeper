import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError, shelfScan } from "../lib/api";
import { celebrate, toast } from "../lib/celebrate";
import { addHunt, allCopies, allMovies, copiesFor, movieByTmdb } from "../lib/db";
import { judge, matchHunt, normalizeTitle, type VerdictKind } from "../lib/verdict";
import { FORMAT_LABEL, type Format, type Hunt, type Movie, type ShelfSpine } from "../lib/types";
import { Poster } from "./Poster";
import { preparePhoto } from "../lib/photo";

type Row = {
  spine: ShelfSpine;
  movie: Movie | null;
  kind: VerdictKind;
  hunt?: Hunt;
  series?: string; // "Fits your Alien series"
  tags: { label: string; tone: string }[];
  score: number;
};

async function evaluate(spines: ShelfSpine[]): Promise<Row[]> {
  const movies = await allMovies();
  const copies = await allCopies();
  const ownedMovieIds = new Set(copies.map((c) => c.movie_id));
  const ownedSeries = new Map<number, string>();
  for (const m of movies) if (m.collection_id && ownedMovieIds.has(m.id)) ownedSeries.set(m.collection_id, m.collection_name ?? "");

  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const s of spines) {
    const key = s.match ? `t${s.match.tmdb_id}` : `n${normalizeTitle(s.title)}`;
    if (seen.has(key)) continue; // same movie twice on the shelf
    seen.add(key);

    let movie: Movie | null = s.match ? ((await movieByTmdb(s.match.tmdb_id)) ?? null) : null;
    if (!movie) {
      const want = normalizeTitle(s.match?.title ?? s.title);
      movie = movies.find((m) => normalizeTitle(m.title) === want) ?? null;
    }
    const mine = movie ? await copiesFor(movie.id) : [];
    const fmt = s.format === "unknown" ? null : (s.format as Format);
    const v = judge(movie, mine, fmt);
    const hunt = v.kind === "not_owned" || v.kind === "upgrade" ? await matchHunt(s.match ? [s.match.tmdb_id] : [], s.match?.title ?? s.title) : undefined;

    const tags: Row["tags"] = [];
    let score = 0;
    if (hunt) { tags.push({ label: "Hunt list", tone: "hunt" }); score += 100; }
    if (v.kind === "upgrade") { tags.push({ label: `Upgrade · ${FORMAT_LABEL[fmt!]}`, tone: "upgrade" }); score += 40; }
    if (s.collector && v.kind !== "have") {
      tags.push({ label: s.collector_reason ? `Collector · ${s.collector_reason}` : "Collector pick", tone: "collector" });
      score += 50;
    }
    if (s.rarity?.rare && v.kind === "not_owned") { tags.push({ label: `Rare · first in ${s.rarity.trips} trips`, tone: "rare" }); score += 30; }
    let series: string | undefined;
    if (v.kind === "not_owned" && s.match?.collection_id && ownedSeries.has(s.match.collection_id)) {
      series = (s.match.collection_name ?? ownedSeries.get(s.match.collection_id) ?? "").replace(/ Collection$/, "");
      tags.push({ label: `Fits your ${series} series`, tone: "series" });
      score += 35;
    }
    if (v.kind === "not_owned" && (s.match?.rating ?? 0) >= 7.5 && (s.match?.votes ?? 0) >= 1000) {
      tags.push({ label: `Rated ${s.match!.rating}`, tone: "rated" });
      score += 10 + (s.match!.rating ?? 0);
    }
    if (v.kind === "have" || v.kind === "owned") tags.push({ label: "You own it", tone: "have" });
    rows.push({ spine: s, movie, kind: v.kind, hunt, series, tags, score });
  }
  return rows.sort((a, b) => b.score - a.score);
}

const LOADING = ["Reading the spines…", "Squinting at tiny fonts…", "Checking your collection…", "Looking for treasure…"];

export function ShelfScan({ onClose }: { onClose: () => void }) {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(0);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hunted, setHunted] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setMsg((m) => (m + 1) % LOADING.length), 2500);
    return () => clearInterval(t);
  }, [busy]);

  const onFile = async (file?: File) => {
    if (!file) return;
    setError(null);
    setRows(null);
    setBusy(true);
    try {
      const { b64, preview } = await preparePhoto(file);
      setPreview(preview);
      const spines = await shelfScan(b64);
      const r = await evaluate(spines);
      setRows(r);
      if (r.some((x) => x.hunt)) celebrate();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.kind === "offline"
            ? "Shelf scan needs a connection. Barcode checks still work offline."
            : e.kind === "login_required"
              ? "Your sign-in expired. Reopen Library to sign in."
              : e.message
          : "Couldn't read that photo. Try again a little closer, with the spines straight on.",
      );
    } finally {
      setBusy(false);
    }
  };

  const grab = rows?.filter((r) => r.score >= 10) ?? [];
  const others = rows?.filter((r) => r.score < 10 && r.kind === "not_owned") ?? [];
  const owned = rows?.filter((r) => r.kind === "have" || r.kind === "owned") ?? [];
  const huntCount = rows?.filter((r) => r.hunt).length ?? 0;

  const addHref = (r: Row) => {
    const q = new URLSearchParams();
    if (r.spine.match) q.set("tmdb", String(r.spine.match.tmdb_id));
    else q.set("q", r.spine.title);
    if (r.spine.format !== "unknown") q.set("format", r.spine.format);
    return `#/add?${q}`;
  };

  const RowView = ({ r, actions }: { r: Row; actions: boolean }) => {
    const m = r.spine.match;
    const display = m ?? { title: r.spine.title, year: r.spine.year, poster_path: null };
    const key = m ? String(m.tmdb_id) : r.spine.title;
    return (
      <li class="shelf-row">
        <Poster movie={display} size="w185" class="thumb" />
        <div class="stack grow">
          <b>
            {display.title}
            {display.year ? <span class="muted"> · {display.year}</span> : null}
          </b>
          {(r.spine.label || r.spine.edition || r.spine.format !== "unknown" || r.spine.confidence === "low") && (
            <span class="muted">
              {[r.spine.format !== "unknown" ? FORMAT_LABEL[r.spine.format as Format] : null, r.spine.label, r.spine.edition].filter(Boolean).join(" · ")}
              {r.spine.confidence === "low" ? " · not sure of title" : ""}
            </span>
          )}
          {r.tags.length > 0 && (
            <div class="row wrap">
              {r.tags.map((t) => <span key={t.label} class={`tag tag-${t.tone}`}>{t.label}</span>)}
            </div>
          )}
          {actions && (
            <div class="row">
              <a class="btn small" href={addHref(r)} onClick={onClose}>Bought it</a>
              {!r.hunt && r.kind === "not_owned" && (
                <button
                  class="btn small"
                  disabled={hunted.has(key)}
                  onClick={async () => {
                    await addHunt({ tmdb_id: m?.tmdb_id ?? null, title: display.title, year: display.year ?? null, poster_path: display.poster_path ?? null });
                    setHunted(new Set([...hunted, key]));
                    toast(`Hunting for ${display.title}`);
                  }}
                >
                  {hunted.has(key) ? "Hunting" : "Hunt it"}
                </button>
              )}
            </div>
          )}
        </div>
      </li>
    );
  };

  return (
    <div class="haul" role="dialog" aria-label="Shelf scan">
      <header class="screen-head">
        <div class="row between">
          <h1>Shelf scan</h1>
          <button class="btn ghost" onClick={onClose}>Close</button>
        </div>
        {rows && (
          <p class="haul-summary">
            Found {rows.length} title{rows.length === 1 ? "" : "s"}
            {grab.length ? ` · ${grab.length} worth a look` : ""}
            {huntCount ? ` · ${huntCount} on your hunt list` : ""}
            {owned.length ? ` · ${owned.length} you own` : ""}
          </p>
        )}
      </header>

      <div class="screen-body">
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onFile((e.target as HTMLInputElement).files?.[0])} />
        <input ref={library} type="file" accept="image/*" hidden onChange={(e) => void onFile((e.target as HTMLInputElement).files?.[0])} />

        {!busy && !rows && (
          <>
            <p>Take a photo of a shelf with the spines facing you. Library reads the titles and tells you what's worth grabbing: hunt list matches, collector editions, rare finds, upgrades and gaps in your series.</p>
            <button class="btn primary block" onClick={() => camera.current?.click()}>Take a photo</button>
            <button class="btn block" onClick={() => library.current?.click()}>Choose from photos</button>
            <p class="muted">Tip: one shelf at a time, straight on, in good light. Uses about 1–3¢ of AI per photo.</p>
          </>
        )}

        {preview && (busy || rows) && <img class="shelf-preview" src={preview} alt="Your shelf photo" />}
        {busy && <p class="center"><b>{LOADING[msg]}</b><br /><span class="muted">Usually 10–20 seconds</span></p>}
        {error && <p class="notice">{error}</p>}

        {rows && rows.length === 0 && <p class="notice">Couldn't read any titles. Try closer, straight on, with less glare.</p>}

        {grab.length > 0 && (
          <section>
            <h3>Worth a look</h3>
            <ul class="list">{grab.map((r) => <RowView key={r.spine.title} r={r} actions />)}</ul>
          </section>
        )}
        {others.length > 0 && (
          <section>
            <h3>Also on the shelf</h3>
            <ul class="list">{others.map((r) => <RowView key={r.spine.title} r={r} actions />)}</ul>
          </section>
        )}
        {owned.length > 0 && (
          <section>
            <h3>Already yours</h3>
            <ul class="list">{owned.map((r) => <RowView key={r.spine.title} r={r} actions={false} />)}</ul>
          </section>
        )}
        {rows && (
          <button class="btn block" onClick={() => { setRows(null); setPreview(null); camera.current?.click(); }}>Scan another shelf</button>
        )}
      </div>
    </div>
  );
}
