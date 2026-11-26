import { useMemo, useState } from "preact/hooks";
import { allCopies, allMovies } from "../lib/db";
import { normalizeTitle } from "../lib/verdict";
import { FORMAT_RANK, FORMAT_SHORT, type Copy, type Format, type Movie } from "../lib/types";
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

export function Shelf() {
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
  const isGrid = grid ?? document.documentElement.dataset.skin === "midnight";
  const badge = (m: Movie) => {
    const cs = byMovie.get(m.id) ?? [];
    const best = cs.reduce<Format | null>((a, c) => (!a || FORMAT_RANK[c.format] > FORMAT_RANK[a] ? c.format : a), null);
    return best ? FORMAT_SHORT[best] : undefined;
  };

  return (
    <div class="screen">
      <header class="screen-head">
        <div class="row between">
          <h1>Collection</h1>
          <div class="row">
            <SyncPill />
            <a class="btn primary icon-btn" href="#/add" aria-label="Add a disc"><IconPlus /></a>
          </div>
        </div>
        <div class="row">
          <label class="search grow">
            <IconSearch />
            <input type="search" placeholder="Search titles" aria-label="Search titles" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
          </label>
          <button class="btn icon-btn" aria-label={isGrid ? "Show as list" : "Show as posters"} onClick={() => setGrid(!isGrid)}>
            {isGrid ? <IconList /> : <IconGrid />}
          </button>
        </div>
        <a class="movie-night" href="#/tonight">
          <b>Movie night</b>
          <span class="muted">Can't decide? Let Keeper pick from your shelf</span>
        </a>
        <div class="chips" role="tablist" aria-label="Filter by format">
          {FILTERS.map(([f, label]) => (
            <button key={f} role="tab" aria-selected={filter === f} class={`filter ${filter === f ? "on" : ""} ${f === "upgrade" ? "accent" : ""}`} onClick={() => setFilter(f)}>
              {label} <span class="count">{counts[f]}</span>
            </button>
          ))}
        </div>
      </header>

      <div class="screen-body">
        {data && data.movies.length === 0 && (
          <div class="empty">
            <p>Your shelf is empty.</p>
            <a class="btn primary" href="#/add">Add your first disc</a>
          </div>
        )}
        {isGrid ? (
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

