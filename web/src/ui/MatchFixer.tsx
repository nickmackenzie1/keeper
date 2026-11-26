import { useEffect, useState } from "preact/hooks";
import { ApiError, moviePosters, searchTmdb, tmdbDetails } from "../lib/api";
import { toast } from "../lib/celebrate";
import { copiesFor, deleteMovie, movieByTmdb, saveCopy, saveMovie } from "../lib/db";
import { posterUrl, type Movie, type TmdbHit } from "../lib/types";
import { Poster } from "./Poster";
import { IconSearch } from "./icons";
import { go } from "./util";

const strip = <T extends { updated_at: number; updated_by: string; dirty: number }>({ updated_at: _u, updated_by: _b, dirty: _d, ...rest }: T) => rest;

const why = (e: unknown) =>
  e instanceof ApiError && e.kind === "offline" ? "Needs a connection to Keeper." : e instanceof Error ? e.message : "Something went wrong.";

/** Wrong movie matched (or none)? Search TMDB and pick the right one. */
export function FixMatch({ movie, onDone }: { movie: Movie; onDone: () => void }) {
  const [q, setQ] = useState(movie.title);
  const [results, setResults] = useState<TmdbHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (text = q) => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setResults(await searchTmdb(text.trim()));
    } catch (e) {
      setError(why(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => void search(), []);

  const choose = async (hit: TmdbHit) => {
    setBusy(true);
    try {
      const d = await tmdbDetails(hit.tmdb_id).catch(() => hit);
      const other = await movieByTmdb(hit.tmdb_id);
      if (other && other.id !== movie.id) {
        // Already have that movie: move these copies onto it instead of making a duplicate.
        for (const c of await copiesFor(movie.id)) await saveCopy({ ...strip(c), movie_id: other.id });
        await deleteMovie({ ...movie });
        toast(`Merged into ${other.title}`);
        go(`#/movie/${other.id}`);
        return;
      }
      await saveMovie({
        ...strip(movie),
        tmdb_id: hit.tmdb_id,
        title: d.title,
        year: d.year ?? null,
        poster_path: d.poster_path ?? null,
        overview: d.overview || null,
        runtime: d.runtime ?? null,
        genres: d.genres ?? null,
        collection_id: d.collection_id ?? null,
        collection_name: d.collection_name ?? null,
        certification: d.certification ?? null,
      });
      toast(`Matched to ${d.title}${d.year ? ` (${d.year})` : ""}`);
      onDone();
    } catch (e) {
      setError(why(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="card fixer">
      <div class="row between">
        <h3>Fix match</h3>
        <button class="btn ghost" onClick={onDone}>Cancel</button>
      </div>
      <form class="row" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <label class="search grow">
          <IconSearch />
          <input type="search" aria-label="Search for the right movie" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        </label>
      </form>
      {busy && <p class="muted center">Searching…</p>}
      {error && <p class="notice">{error}</p>}
      {results && !busy && (
        results.length ? (
          <ul class="list">
            {results.map((r) => (
              <li key={r.tmdb_id}>
                <button class={`list-row ${r.tmdb_id === movie.tmdb_id ? "current" : ""}`} onClick={() => void choose(r)}>
                  <Poster movie={r} size="w185" class="thumb" />
                  <span class="stack grow">
                    <b>{r.title}</b>
                    <span class="muted">{[r.year, r.tmdb_id === movie.tmdb_id ? "current match" : null].filter(Boolean).join(" · ")}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p class="muted">No matches — try a different spelling or add the year.</p>
        )
      )}
    </section>
  );
}

/** Pick a different poster for this movie. */
export function ChangePoster({ movie, onDone }: { movie: Movie; onDone: () => void }) {
  const [posters, setPosters] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!movie.tmdb_id) return;
    moviePosters(movie.tmdb_id).then(setPosters).catch((e) => setError(why(e)));
  }, [movie.tmdb_id]);

  return (
    <section class="card fixer">
      <div class="row between">
        <h3>Change poster</h3>
        <button class="btn ghost" onClick={onDone}>Cancel</button>
      </div>
      {error && <p class="notice">{error}</p>}
      {!posters && !error && <p class="muted center">Loading posters…</p>}
      {posters && posters.length === 0 && <p class="muted">TMDB has no other posters for this one.</p>}
      {posters && posters.length > 0 && (
        <ul class="poster-picker">
          {posters.map((p) => (
            <li key={p}>
              <button
                class={p === movie.poster_path ? "on" : ""}
                aria-label={p === movie.poster_path ? "Current poster" : "Use this poster"}
                aria-pressed={p === movie.poster_path}
                onClick={async () => {
                  await saveMovie({ ...strip(movie), poster_path: p });
                  toast("Poster updated");
                  onDone();
                }}
              >
                <img src={posterUrl(p, "w185")!} alt="" loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
