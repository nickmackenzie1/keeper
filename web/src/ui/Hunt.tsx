import { ScreenTitle } from "./Zone";
import { useState } from "preact/hooks";
import { ApiError, searchTmdb } from "../lib/api";
import { toast } from "../lib/celebrate";
import { addHunt, allHunts, myName, saveHunt } from "../lib/db";
import { Person, useMe } from "./Person";
import type { Hunt as HuntRow, TmdbHit } from "../lib/types";
import { Poster } from "./Poster";
import { IconSearch, IconTrash } from "./icons";
import { SyncPill } from "./SyncPill";
import { timeAgo, useData } from "./util";

const strip = ({ updated_at: _u, updated_by: _b, dirty: _d, ...rest }: HuntRow) => rest;

/** Movies you're both on the lookout for. Synced, so a scan on either phone celebrates. */
export function Hunt() {
  const hunts = useData(allHunts);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TmdbHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [showFound, setShowFound] = useState(false);
  const [who, setWho] = useState<string>("everyone");
  const me = useMe();

  const people = [...new Set((hunts ?? []).filter((h) => !h.found).map((h) => h.added_by).filter(Boolean) as string[])];
  const mine = (h: HuntRow) => (who === "everyone" ? true : who === "mine" ? h.added_by === me : h.added_by === who);
  const open = (hunts ?? []).filter((h) => !h.found && mine(h)).sort((a, b) => b.updated_at - a.updated_at);
  const found = (hunts ?? []).filter((h) => h.found).sort((a, b) => b.updated_at - a.updated_at);

  const search = async (e: Event) => {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    setOffline(false);
    try {
      setResults(await searchTmdb(q.trim()));
    } catch (err) {
      setResults([]);
      setOffline(err instanceof ApiError);
    } finally {
      setBusy(false);
    }
  };

  const add = async (hit: { tmdb_id: number | null; title: string; year: number | null; poster_path: string | null }) => {
    await addHunt(hit);
    toast(`Hunting for ${hit.title}`);
    setQ("");
    setResults(null);
  };

  return (
    <div class="screen">
      <header class="screen-head">
        <div class="row between">
          <ScreenTitle title="Hunt list" />
          <SyncPill />
        </div>
        <form class="row" onSubmit={search}>
          <label class="search grow">
            <IconSearch />
            <input type="search" placeholder="Add a movie to hunt for" aria-label="Search for a movie to hunt" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
          </label>
        </form>
      </header>

      <div class="screen-body">
        {busy && <p class="muted center">Searching…</p>}
        {results && !busy && (
          <>
            <ul class="list">
              {results.map((r) => (
                <li key={r.tmdb_id}>
                  <button class="list-row" onClick={() => void add(r)}>
                    <Poster movie={r} size="w185" class="thumb" />
                    <span class="stack grow">
                      <b>{r.title}</b>
                      <span class="muted">{r.year ?? "—"}</span>
                    </span>
                    <span class="btn small">Hunt</span>
                  </button>
                </li>
              ))}
            </ul>
            {(offline || results.length === 0) && (
              <button class="btn" onClick={() => void add({ tmdb_id: null, title: q.trim(), year: null, poster_path: null })}>
                Hunt for “{q.trim()}” anyway
              </button>
            )}
            <button class="btn ghost" onClick={() => setResults(null)}>Cancel</button>
          </>
        )}

        {!results && people.length > 1 && (
          <div class="chips" role="group" aria-label="Whose hunts">
            <button class={`filter ${who === "everyone" ? "on" : ""}`} aria-pressed={who === "everyone"} onClick={() => setWho("everyone")}>Everyone</button>
            {me && people.includes(me) && (
              <button class={`filter ${who === "mine" ? "on" : ""}`} aria-pressed={who === "mine"} onClick={() => setWho("mine")}>Mine</button>
            )}
            {people.filter((p) => p !== me).map((p) => (
              <button key={p} class={`filter ${who === p ? "on" : ""}`} aria-pressed={who === p} onClick={() => setWho(p)}>
                <Person name={p} size={18} /> {p}'s
              </button>
            ))}
          </div>
        )}

        {!results && hunts && open.length === 0 && who !== "everyone" && (
          <p class="muted center">Nothing here — switch to Everyone.</p>
        )}
        {!results && hunts && open.length === 0 && who === "everyone" && (
          <div class="empty">
            <p><b>Nothing on the hunt list yet.</b></p>
            <p class="muted">Add movies you're looking for. When either of you scans one in a store, Keeper celebrates.</p>
          </div>
        )}

        {!results && open.length > 0 && (
          <ul class="hunt-grid">
            {open.map((h) => (
              <li key={h.id} class="hunt-card">
                <Poster movie={h} size="w342" />
                <div class="stack">
                  <b>{h.title}</b>
                  <span class="muted row hunt-meta">
                    <Person name={h.added_by} size={18} />
                    {[h.year, h.added_by].filter(Boolean).join(" · ")}
                  </span>
                  {h.notes && <span class="muted">{h.notes}</span>}
                </div>
                <div class="row hunt-actions">
                  <button class="btn small grow" onClick={async () => void saveHunt({ ...strip(h), found: true, found_by: await myName() })}>Found it</button>
                  <button class="btn small icon-btn" aria-label={`Remove ${h.title}`} onClick={() => void saveHunt({ ...strip(h), deleted: true })}>
                    <IconTrash />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {!results && found.length > 0 && (
          <section>
            <button class="btn ghost" aria-expanded={showFound} onClick={() => setShowFound(!showFound)}>
              {showFound ? "Hide" : "Show"} found ({found.length})
            </button>
            {showFound && (
              <ul class="list">
                {found.map((h) => (
                  <li key={h.id} class="list-row">
                    <Poster movie={h} size="w185" class="thumb" />
                    <span class="stack grow">
                      <b>{h.title}</b>
                      <span class="muted row hunt-meta">
                        {h.found_by && <Person name={h.found_by} size={18} />}
                        Found {h.found_by ? `by ${h.found_by} ` : ""}{timeAgo(h.updated_at)}
                      </span>
                    </span>
                    <button class="btn small" onClick={() => void saveHunt({ ...strip(h), found: false, found_by: null })}>Undo</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
