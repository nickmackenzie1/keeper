import { ScreenTitle, ZoneTitle } from "./Zone";
import { currentSkin } from "./skins";
import { Skeleton } from "./Skeleton";
import { useMemo, useState } from "preact/hooks";
import { allAlbums, allCopies, allMovies, allPressings } from "../lib/db";
import { Cover } from "./Cover";
import type { JSX } from "preact";
import { normalizeTitle } from "../lib/verdict";
import { FORMAT_RANK, FORMAT_SHORT, type Album, type Copy, type Format, type Movie, type Pressing, type RecordFormat } from "../lib/types";
import { Poster } from "./Poster";
import { IconGrid, IconList, IconPlus, IconSearch } from "./icons";
import { SyncPill } from "./SyncPill";
import { useData } from "./util";

type Filter = "all" | Format | "upgrade";
const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["dvd", "DVD"],
  ["bluray", "Blu-ray"],
  ["uhd", "4K"],
  ["upgrade", "Upgrade list"],
];

const NUMBERS = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen"];
const WORDS: Record<number, string> = { 1920: "Twenties", 1930: "Thirties", 1940: "Forties", 1950: "Fifties", 1960: "Sixties", 1970: "Seventies", 1980: "Eighties", 1990: "Nineties" };
const decadeName = (d: number) => (d === 0 ? "Undated" : WORDS[d] ? `The ${WORDS[d]}` : `The ${d}s`);

type Mode = "movies" | "music";
const readMode = (): Mode => { try { return localStorage.getItem("shelfMode") === "music" ? "music" : "movies"; } catch { return "movies"; } };

/** The shelf: movies or records, one switch at the top. */
export function Shelf() {
  const [mode, setModeState] = useState<Mode>(readMode());
  const setMode = (m: Mode) => {
    setModeState(m);
    try { localStorage.setItem("shelfMode", m); } catch { /* private mode */ }
  };
  const toggle = <ModeSwitch mode={mode} onChange={setMode} />;
  return mode === "music" ? <MusicShelf toggle={toggle} /> : <MovieShelf toggle={toggle} />;
}

function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div class="mode-switch" role="tablist" aria-label="Movies or music">
      {(["movies", "music"] as const).map((m) => (
        <button key={m} role="tab" aria-selected={mode === m} class={mode === m ? "on" : ""} onClick={() => onChange(m)}>
          {m === "movies" ? "Movies" : "Music"}
        </button>
      ))}
    </div>
  );
}

type RFilter = "all" | RecordFormat;
const RFILTERS: [RFilter, string][] = [["all", "All"], ["vinyl", "Vinyl"], ["cd", "CD"], ["cassette", "Tape"]];

function MusicShelf({ toggle }: { toggle: JSX.Element }) {
  const data = useData(async () => ({ albums: await allAlbums(), pressings: await allPressings() }));
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<RFilter>("all");
  const byAlbum = useMemo(() => {
    const m = new Map<string, Pressing[]>();
    for (const p of data?.pressings ?? []) m.set(p.album_id, [...(m.get(p.album_id) ?? []), p]);
    return m;
  }, [data]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, vinyl: 0, cd: 0, cassette: 0 };
    for (const a of data?.albums ?? []) if (byAlbum.has(a.id)) c.all++;
    for (const p of data?.pressings ?? []) if (p.format in c) c[p.format]++;
    return c;
  }, [data, byAlbum]);
  const sortKey = (a: Album) => normalizeTitle(a.artist ?? a.title);
  const shown = useMemo(() => {
    const n = normalizeTitle(q);
    return (data?.albums ?? [])
      .filter((a) => byAlbum.has(a.id))
      .filter((a) => !n || `${normalizeTitle(a.artist ?? "")} ${normalizeTitle(a.title)}`.includes(n))
      .filter((a) => filter === "all" || (byAlbum.get(a.id) ?? []).some((p) => p.format === filter))
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || (a.year ?? 0) - (b.year ?? 0));
  }, [data, q, filter, byAlbum]);
  const skin = currentSkin();
  // Marquee: chapters by the artist's first letter.
  const chapters = useMemo(() => {
    if (skin !== "marquee" || q.trim()) return null;
    const g = new Map<string, Album[]>();
    for (const a of shown) {
      const c = sortKey(a).charAt(0).toUpperCase();
      const k = /[A-Z]/.test(c) ? c : "#";
      g.set(k, [...(g.get(k) ?? []), a]);
    }
    return [...g.entries()];
  }, [shown, skin, q]);
  const badge = (a: Album) => {
    const fs = new Set((byAlbum.get(a.id) ?? []).map((p) => p.format));
    return fs.has("vinyl") ? "LP" : fs.has("cd") ? "CD" : fs.has("cassette") ? "TAPE" : undefined;
  };
  if (!data) return <Skeleton rows={7} />;
  const grid = (list: Album[]) => (
    <ul class="poster-grid cover-grid">
      {list.map((a) => (
        <li key={a.id}>
          <a href={`#/record/${a.id}`} aria-label={`${a.artist ? a.artist + ", " : ""}${a.title}`}>
            <Cover album={a} badge={badge(a)} />
          </a>
        </li>
      ))}
    </ul>
  );
  return (
    <div class="screen">
      <header class="screen-head">
        <div class="row between">
          <ScreenTitle title="Collection" />
          <div class="row">
            <SyncPill />
            <a class="btn primary icon-btn add-btn" href="#/add-record" aria-label="Add a record"><IconPlus /><span class="add-label" aria-hidden="true">Add</span></a>
          </div>
        </div>
        {toggle}
        <label class="search">
          <IconSearch />
          <input type="search" placeholder="Artist or album" aria-label="Search records" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        </label>
        <div class="chips" role="tablist" aria-label="Filter by format">
          {RFILTERS.map(([f, label]) => (
            <button key={f} role="tab" aria-selected={filter === f} class={`filter ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>
              {label} <span class="count">{counts[f]}</span>
            </button>
          ))}
        </div>
      </header>
      <div class="screen-body">
        {counts.all === 0 && (
          <div class="empty">
            <p>No records yet.</p>
            <a class="btn primary" href="#/add-record">Add your first record</a>
          </div>
        )}
        {chapters
          ? chapters.map(([letter, list], i) => (
              <section key={letter} class="chapter">
                <ZoneTitle size="chapter" as="h2" kicker={`Chapter ${NUMBERS[i] ?? i + 1}`} title={letter === "#" ? "0–9" : letter} />
                {grid(list)}
              </section>
            ))
          : grid(shown)}
      </div>
    </div>
  );
}

function MovieShelf({ toggle }: { toggle: JSX.Element }) {
  const data = useData(async () => ({ movies: await allMovies(), copies: await allCopies() }));
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [grid, setGrid] = useState<boolean | null>(null);

  const byMovie = useMemo(() => {
    const map = new Map<string, Copy[]>();
    for (const c of data?.copies ?? []) map.set(c.movie_id, [...(map.get(c.movie_id) ?? []), c]);
    return map;
  }, [data]);

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: data?.movies.length ?? 0, dvd: 0, bluray: 0, uhd: 0, upgrade: 0 };
    for (const c of data?.copies ?? []) {
      if (c.format in out) out[c.format]++;
      if (c.upgrade_wanted) out.upgrade++;
    }
    return out;
  }, [data]);

  const shown = useMemo(() => {
    const n = normalizeTitle(q);
    return (data?.movies ?? [])
      .filter((m) => !n || normalizeTitle(m.title).includes(n))
      .filter((m) => {
        if (filter === "all") return true;
        const cs = byMovie.get(m.id) ?? [];
        return filter === "upgrade" ? cs.some((c) => c.upgrade_wanted) : cs.some((c) => c.format === filter);
      })
      .sort((a, b) => normalizeTitle(a.title).localeCompare(normalizeTitle(b.title)));
  }, [data, q, filter, byMovie]);

  // Midnight skin defaults to the poster grid; others to the list.
  const skin = currentSkin();
  const isGrid = grid ?? (skin === "midnight" || skin === "marquee");
  // Marquee: the poster wall is split into chapters by decade (when not searching).
  const chapters = useMemo(() => {
    if (skin !== "marquee" || q.trim()) return null;
    const groups = new Map<number, Movie[]>();
    for (const m of shown) {
      const d = m.year ? Math.floor(m.year / 10) * 10 : 0;
      groups.set(d, [...(groups.get(d) ?? []), m]);
    }
    return [...groups.entries()].sort((a, b) => (a[0] || 9999) - (b[0] || 9999));
  }, [shown, skin, q]);
  const badge = (m: Movie) => {
    const cs = byMovie.get(m.id) ?? [];
    const best = cs.reduce<Format | null>((a, c) => (!a || FORMAT_RANK[c.format] > FORMAT_RANK[a] ? c.format : a), null);
    return best ? FORMAT_SHORT[best] : undefined;
  };

  if (!data) return <Skeleton rows={7} />;

  return (
    <div class="screen">
      <header class="screen-head">
        <div class="row between">
          <ScreenTitle title="Collection" />
          <div class="row">
            <SyncPill />
            <a class="btn primary icon-btn add-btn" href="#/add" aria-label="Add a disc"><IconPlus /><span class="add-label" aria-hidden="true">Add</span></a>
          </div>
        </div>
        {toggle}
        <div class="row">
          <label class="search grow">
            <IconSearch />
            <input type="search" placeholder="Search titles" aria-label="Search titles" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
          </label>
          <button class="btn icon-btn" aria-label={isGrid ? "Show as list" : "Show as posters"} onClick={() => setGrid(!isGrid)}>
            {isGrid ? <IconList /> : <IconGrid />}
          </button>
        </div>
        <div class="chips" role="tablist" aria-label="Filter by format">
          {FILTERS.map(([f, label]) => (
            <button key={f} role="tab" aria-selected={filter === f} class={`filter ${filter === f ? "on" : ""} ${f === "upgrade" ? "accent" : ""}`} onClick={() => setFilter(f)}>
              {label} <span class="count">{counts[f]}</span>
            </button>
          ))}
        </div>
      </header>

      <div class="screen-body">
        {data && data.movies.length > 1 && (
          <a class="movie-night" href="#/tonight">
            <b>Movie night</b>
            <span class="muted">Can't decide? We'll pick something from your shelf</span>
          </a>
        )}
        {data && data.movies.length === 0 && (
          <div class="empty">
            <p>Your shelf is empty.</p>
            <a class="btn primary" href="#/add">Add your first disc</a>
          </div>
        )}
        {isGrid && chapters ? (
          chapters.map(([decade, movies], i) => (
            <section key={decade} class="chapter">
              <ZoneTitle
                size="chapter"
                as="h2"
                kicker={`Chapter ${NUMBERS[i] ?? i + 1}`}
                title={decadeName(decade)}
              />
              <ul class="poster-grid">
                {movies.map((m) => (
                  <li key={m.id}>
                    <a href={`#/movie/${m.id}`} aria-label={`${m.title}${m.year ? `, ${m.year}` : ""}`}>
                      <Poster movie={m} badge={badge(m)} />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))
        ) : isGrid ? (
          <ul class="poster-grid">
            {shown.map((m) => (
              <li key={m.id}>
                <a href={`#/movie/${m.id}`} aria-label={m.title}>
                  <Poster movie={m} badge={badge(m)} />
                  <span class="grid-cap">{m.year ?? ""}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <ul class="list">
            {shown.map((m) => {
              const cs = (byMovie.get(m.id) ?? []).sort((a, b) => FORMAT_RANK[b.format] - FORMAT_RANK[a.format]);
              const loc = [...new Set(cs.map((c) => c.location).filter(Boolean))].join(", ");
              return (
                <li key={m.id}>
                  <a class="list-row" href={`#/movie/${m.id}`}>
                    <Poster movie={m} size="w185" class="thumb" />
                    <span class="stack grow">
                      <b>{m.title}</b>
                      <span class="muted">
                        {[m.year, loc, cs.some((c) => c.upgrade_wanted) ? "wants upgrade" : ""].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {cs.map((c) => (
                      <span key={c.id} class="chip" data-format={c.format}>{FORMAT_SHORT[c.format]}</span>
                    ))}
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

