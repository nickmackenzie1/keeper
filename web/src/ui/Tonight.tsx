import { ScreenTitle } from "./Zone";
import { useMemo, useRef, useState } from "preact/hooks";
import { allCopies, allMovies } from "../lib/db";
import { chime, primeAudio } from "../lib/celebrate";
import type { Copy, Movie } from "../lib/types";
import { Poster } from "./Poster";
import { useData } from "./util";

const KID_CERTS = new Set(["G", "PG", "TV-Y", "TV-Y7", "TV-G", "TV-PG", "U"]);

/** Kid-friendly: rated G/PG, or (no rating known) a Family/Animation movie. */
export const kidFriendly = (m: Movie) => {
  if (m.certification) return KID_CERTS.has(m.certification.toUpperCase());
  return /\b(Family|Animation)\b/.test(m.genres ?? "");
};

type Length = "any" | "short" | "medium";
const LENGTHS: [Length, string][] = [
  ["any", "Any length"],
  ["short", "Under 100 min"],
  ["medium", "Under 2 hours"],
];

/** Movie night: narrow it down, then let Keeper pick from your own shelf. */
export function Tonight() {
  const data = useData(async () => ({ movies: await allMovies(), copies: await allCopies() }));
  const [genre, setGenreRaw] = useState<string>("any");
  const [length, setLengthRaw] = useState<Length>("any");
  const [kids, setKidsRaw] = useState(false);
  const [shown, setShown] = useState<Movie | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [landed, setLanded] = useState(false);
  // Changing a filter clears the last pick.
  const reset = () => {
    setShown(null);
    setLanded(false);
  };
  const setGenre = (g: string) => { setGenreRaw(g); reset(); };
  const setLength = (l: Length) => { setLengthRaw(l); reset(); };
  const setKids = (k: boolean) => { setKidsRaw(k); reset(); };
  const last = useRef<string | null>(null);

  const owned = useMemo(() => {
    if (!data) return [];
    const ids = new Set(data.copies.map((c) => c.movie_id));
    return data.movies.filter((m) => ids.has(m.id));
  }, [data]);

  const genres = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of owned) for (const g of (m.genres ?? "").split(",").map((x) => x.trim()).filter(Boolean)) counts.set(g, (counts.get(g) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([g]) => g);
  }, [owned]);

  const pool = useMemo(
    () =>
      owned.filter((m) => {
        if (genre !== "any" && !(m.genres ?? "").split(",").map((x) => x.trim()).includes(genre)) return false;
        if (length === "short" && !(m.runtime && m.runtime < 100)) return false;
        if (length === "medium" && !(m.runtime && m.runtime < 120)) return false;
        if (kids && !kidFriendly(m)) return false;
        return true;
      }),
    [owned, genre, length, kids],
  );

  const where = (m: Movie) => {
    const cs: Copy[] = (data?.copies ?? []).filter((c) => c.movie_id === m.id);
    return [...new Set(cs.map((c) => c.location).filter(Boolean))].join(", ");
  };

  const spin = () => {
    if (!pool.length || spinning) return;
    primeAudio();
    // Avoid landing on the same movie twice in a row when there's a choice.
    const options = pool.length > 1 ? pool.filter((m) => m.id !== last.current) : pool;
    const pick = options[Math.floor(Math.random() * options.length)];
    last.current = pick.id;
    setLanded(false);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || pool.length === 1) {
      setShown(pick);
      setLanded(true);
      return;
    }
    setSpinning(true);
    let delay = 60;
    let elapsed = 0;
    const tick = () => {
      if (elapsed > 1800) {
        setShown(pick);
        setSpinning(false);
        setLanded(true);
        chime("jackpot");
        return;
      }
      setShown(pool[Math.floor(Math.random() * pool.length)]);
      chime("blip");
      elapsed += delay;
      delay = Math.min(260, delay * 1.18);
      setTimeout(tick, delay);
    };
    tick();
  };

  return (
    <div class="screen">
      <header class="screen-head">
        <div class="row between">
          <ScreenTitle title="Movie night" />
          <a class="btn ghost" href="#/shelf">Done</a>
        </div>
      </header>
      <div class="screen-body">
        <div class="chips" role="group" aria-label="Genre">
          <button class={`filter ${genre === "any" ? "on" : ""}`} aria-pressed={genre === "any"} onClick={() => setGenre("any")}>Anything</button>
          {genres.map((g) => (
            <button key={g} class={`filter ${genre === g ? "on" : ""}`} aria-pressed={genre === g} onClick={() => setGenre(g)}>{g}</button>
          ))}
        </div>
        <div class="seg seg-3" role="group" aria-label="Length">
          {LENGTHS.map(([l, label]) => (
            <button key={l} class={length === l ? "on" : ""} aria-pressed={length === l} onClick={() => setLength(l)}>{label}</button>
          ))}
        </div>
        <label class="toggle">
          <input type="checkbox" checked={kids} onChange={(e) => setKids((e.target as HTMLInputElement).checked)} />
          Kid-friendly (rated G / PG)
        </label>

        <div class={`tonight-stage ${landed ? "landed" : ""}`}>
          {shown ? (
            <>
              <Poster key={shown.id} movie={shown} size="w500" class="tonight-poster" />
              {landed && (
                <div class="stack center">
                  <h2>{shown.title}</h2>
                  <span class="muted">
                    {[shown.year, shown.runtime ? `${shown.runtime} min` : null, shown.certification, shown.genres?.split(",").slice(0, 2).join(",")].filter(Boolean).join(" · ")}
                  </span>
                  {where(shown) && <span class="muted">On the shelf in: {where(shown)}</span>}
                </div>
              )}
            </>
          ) : (
            <>
            {pool.length > 0 && (
              <div class="tonight-fan" aria-hidden="true">
                {pool.slice(0, 3).map((m, i) => (
                  <Poster key={m.id} movie={m} size="w342" class={`fan-${i}`} />
                ))}
              </div>
            )}
            <p class="muted center">
              {pool.length
                ? `${pool.length} movie${pool.length === 1 ? "" : "s"} to choose from.`
                : owned.length
                  ? "Nothing on your shelf matches — loosen the filters."
                  : "Add some movies first."}
            </p>
            </>
          )}
        </div>

        <button class="btn primary block" disabled={!pool.length || spinning} onClick={spin}>
          {spinning ? "Picking…" : landed ? "Spin again" : "Pick for me"}
        </button>
        {landed && shown && <a class="btn block" href={`#/movie/${shown.id}`}>Details</a>}
        {kids && owned.some((m) => !m.certification && !m.genres) && (
          <p class="muted">Some movies don't have an age rating yet — they fill in from TMDB automatically.</p>
        )}
      </div>
    </div>
  );
}
