import { useState } from "preact/hooks";
import { Skeleton } from "./Skeleton";
import { Cover } from "./Cover";
import { Person } from "./Person";
import { IconTrash } from "./icons";
import { go, useData } from "./util";
import { catalogueData, deleteAlbum, deletePressing, getAlbum, pressingsFor, savePressing } from "../lib/db";
import { catalogue, fmtNo } from "../lib/catalogue";
import { RECORD_FORMATS, RECORD_LABEL, RECORD_SHORT, type Pressing } from "../lib/types";

export function RecordDetail({ id }: { id: string }) {
  const data = useData(async () => ({ album: await getAlbum(id), pressings: await pressingsFor(id) }), [id]);
  const no = useData(async () => { const d = await catalogueData(); return catalogue(d.movies, d.copies, d.albums, d.pressings).get(id); }, [id]);
  if (!data) return <Skeleton />;
  const { album, pressings } = data;
  if (!album) {
    return (
      <div class="screen">
        <div class="screen-body empty">
          <p>That record isn't in your collection anymore.</p>
          <a class="btn" href="#/shelf">Back to the shelf</a>
        </div>
      </div>
    );
  }
  const themed = album.cover_accent
    ? ({ "--accent": album.cover_accent, "--on-accent": "#0a0a0a", "--tone": album.cover_bg ?? "transparent" } as Record<string, string>)
    : undefined;
  const discogs = album.discogs_master_id
    ? `https://www.discogs.com/master/${album.discogs_master_id}`
    : album.discogs_release_id ? `https://www.discogs.com/release/${album.discogs_release_id}` : null;

  return (
    <div class={`screen movie-page record-page ${themed ? "themed" : ""}`} style={themed}>
      <header class="screen-head">
        <button class="btn ghost" onClick={() => history.back()}>‹ Back</button>
      </header>
      <div class="screen-body">
        <Cover album={album} class="record-cover" />
        <div class="stack">
          <span class="record-artist">{album.artist ?? "Unknown artist"}{no ? <span class="billing-no"> · {fmtNo(no)}</span> : null}</span>
          <h2>{album.title}</h2>
          <span class="muted">{[album.year, album.genres, album.styles].filter(Boolean).join(" · ")}</span>
          <div class="row wrap">{pressings.map((p) => <span key={p.id} class="chip" data-format={p.format}>{RECORD_SHORT[p.format]}</span>)}</div>
        </div>
        {discogs && <a class="btn small" href={discogs} target="_blank" rel="noopener">Open on Discogs</a>}

        <h3>Your copies</h3>
        <ul class="copies">{pressings.map((p) => <PressingEditor key={p.id} p={p} />)}</ul>
        <a class="btn block" href={`#/add-record?album=${album.id}`}>+ Add another copy</a>
        <button
          class="btn danger block"
          onClick={async () => {
            if (confirm(`Remove ${album.title} and all its copies?`)) {
              await deleteAlbum(album);
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

function PressingEditor({ p }: { p: Pressing }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(p);
  const set = <K extends keyof Pressing>(k: K, v: Pressing[K]) => setDraft({ ...draft, [k]: v });
  const save = async (next: Pressing) => {
    const { updated_at: _u, updated_by: _b, dirty: _d, ...rest } = next;
    await savePressing(rest);
  };
  return (
    <li class="copy">
      <div class="row between">
        <span class="stack">
          <b>{[RECORD_LABEL[p.format], p.description].filter(Boolean).join(" · ")}</b>
          <span class="muted row hunt-meta">
            {p.added_by && <Person name={p.added_by} size={18} />}
            {[p.label && (p.catno ? `${p.label} ${p.catno}` : p.label), p.country, p.year, p.location].filter(Boolean).join(" · ") || "—"}
          </span>
        </span>
        <button class="btn ghost" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Done" : "Edit"}</button>
      </div>
      {open && (
        <div class="stack gap">
          <div class="seg">
            {RECORD_FORMATS.map((f) => (
              <button key={f} type="button" class={draft.format === f ? "on" : ""} aria-pressed={draft.format === f} onClick={() => set("format", f)}>{RECORD_LABEL[f]}</button>
            ))}
          </div>
          <label class="field">Pressing<input placeholder="2×LP, reissue, red vinyl…" value={draft.description ?? ""} onInput={(e) => set("description", (e.target as HTMLInputElement).value || null)} /></label>
          <label class="field">Where it lives<input value={draft.location ?? ""} onInput={(e) => set("location", (e.target as HTMLInputElement).value || null)} /></label>
          <label class="field">Notes<input value={draft.notes ?? ""} onInput={(e) => set("notes", (e.target as HTMLInputElement).value || null)} /></label>
          <div class="row">
            <button class="btn primary grow" onClick={async () => { await save(draft); setOpen(false); }}>Save</button>
            <button class="btn danger icon-btn" aria-label="Delete this copy" onClick={async () => { if (confirm("Delete this copy?")) await deletePressing(p); }}>
              <IconTrash />
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
