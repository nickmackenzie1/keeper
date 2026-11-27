import { Skeleton } from "./Skeleton";
import { useState } from "preact/hooks";
import { ChangePoster, FixMatch } from "./MatchFixer";
import { copiesFor, deleteCopy, deleteMovie, getMovie, saveCopy } from "../lib/db";
import { FORMATS, FORMAT_LABEL, FORMAT_RANK, FORMAT_SHORT, type Copy } from "../lib/types";
import { Poster } from "./Poster";
import { IconTrash } from "./icons";
import { go, useData } from "./util";
import { Person } from "./Person";

export function MovieDetail({ id }: { id: string }) {
  const data = useData(async () => ({ movie: await getMovie(id), copies: await copiesFor(id) }), [id]);
  const [fixing, setFixing] = useState<null | "match" | "poster">(null);
  if (!data) return <Skeleton />;
  const { movie, copies } = data;
  if (!movie) {
    return (
      <div class="screen">
        <div class="screen-body empty">
          <p>That movie isn't in your collection anymore.</p>
          <a class="btn" href="#/shelf">Back to collection</a>
        </div>
      </div>
    );
  }
  const sorted = copies.slice().sort((a, b) => FORMAT_RANK[b.format] - FORMAT_RANK[a.format]);
  // The page takes on the poster's colours: a tone washing down from the top, and its accent for buttons.
  const themed = movie.poster_accent
    ? ({ "--accent": movie.poster_accent, "--on-accent": "#0a0a0a", "--tone": movie.poster_bg ?? "transparent" } as Record<string, string>)
    : undefined;

  return (
    <div class={`screen movie-page ${themed ? "themed" : ""}`} style={themed}>
      <header class="screen-head">
        <button class="btn ghost" onClick={() => history.back()}>‹ Back</button>
      </header>
      <div class="screen-body">
        <div class="detail-head">
          <Poster movie={movie} class="detail-poster" />
          <div class="stack">
            <h2>{movie.title}</h2>
            <span class="muted">{[movie.year, movie.runtime ? `${movie.runtime} min` : null].filter(Boolean).join(" · ")}</span>
            <div class="row wrap">
              {sorted.map((c) => <span key={c.id} class="chip" data-format={c.format}>{FORMAT_SHORT[c.format]}</span>)}
            </div>
          </div>
        </div>
        {movie.overview && <p class="overview">{movie.overview}</p>}
        {!movie.overview && movie.tmdb_id && !movie.genres && <p class="overview filling">Filling in the details…</p>}

        {!fixing && (
          <div class="row">
            <button class="btn small grow" onClick={() => setFixing("match")}>
              {movie.tmdb_id ? "Wrong movie? Fix match" : "Find the movie"}
            </button>
            {movie.tmdb_id && <button class="btn small grow" onClick={() => setFixing("poster")}>Change poster</button>}
          </div>
        )}
        {fixing === "match" && <FixMatch movie={movie} onDone={() => setFixing(null)} />}
        {fixing === "poster" && <ChangePoster movie={movie} onDone={() => setFixing(null)} />}

        <h3>Your copies</h3>
        <ul class="copies">
          {sorted.map((c) => <CopyEditor key={c.id} copy={c} />)}
        </ul>
        <a class="btn block" href={`#/add?movie=${movie.id}`}>+ Add another copy</a>

        <button
          class="btn danger block"
          onClick={async () => {
            if (confirm(`Remove ${movie.title} and all its copies from the collection?`)) {
              await deleteMovie(movie);
              go("#/shelf");
            }
          }}
        >
          Remove from collection
        </button>
      </div>
    </div>
  );
}

function CopyEditor({ copy }: { copy: Copy }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(copy);
  const set = <K extends keyof Copy>(k: K, v: Copy[K]) => setDraft({ ...draft, [k]: v });
  const save = async (next: Copy) => {
    const { updated_at: _u, updated_by: _b, dirty: _d, ...rest } = next;
    await saveCopy(rest);
  };

  return (
    <li class="copy">
      <div class="row between">
        <span class="stack">
          <b>{[FORMAT_LABEL[copy.format], copy.edition].filter(Boolean).join(" · ")}</b>
          <span class="muted row hunt-meta">
            {copy.added_by && <Person name={copy.added_by} size={18} />}
            {[copy.location, copy.added_by ? `added by ${copy.added_by}` : null].filter(Boolean).join(" · ") || "—"}
          </span>
        </span>
        <button class="btn ghost" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Done" : "Edit"}</button>
      </div>
      <label class="toggle">
        <input type="checkbox" checked={copy.upgrade_wanted} onChange={(e) => void save({ ...copy, upgrade_wanted: (e.target as HTMLInputElement).checked })} />
        Want to upgrade this one
      </label>
      {open && (
        <div class="stack gap">
          <div class="seg">
            {FORMATS.map((f) => (
              <button key={f} type="button" class={draft.format === f ? "on" : ""} aria-pressed={draft.format === f} onClick={() => set("format", f)}>{FORMAT_LABEL[f]}</button>
            ))}
          </div>
          <label class="field">Edition<input value={draft.edition ?? ""} onInput={(e) => set("edition", (e.target as HTMLInputElement).value || null)} /></label>
          <label class="field">Where it lives<input value={draft.location ?? ""} onInput={(e) => set("location", (e.target as HTMLInputElement).value || null)} /></label>
          <label class="field">Notes<input value={draft.notes ?? ""} onInput={(e) => set("notes", (e.target as HTMLInputElement).value || null)} /></label>
          <div class="row">
            <button class="btn primary grow" onClick={async () => { await save(draft); setOpen(false); }}>Save</button>
            <button class="btn danger icon-btn" aria-label="Delete this copy" onClick={async () => { if (confirm("Delete this copy?")) await deleteCopy(copy); }}>
              <IconTrash />
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
