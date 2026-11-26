import { useState } from "preact/hooks";
import { posterUrl, type Movie } from "../lib/types";
import { tint } from "./util";

type Props = { movie: Pick<Movie, "title" | "poster_path" | "year">; size?: "w185" | "w342" | "w500"; class?: string; badge?: string };

/** TMDB poster, or a coloured title card when there's no poster / no signal. */
export function Poster({ movie, size = "w342", class: cls = "", badge }: Props) {
  const [failed, setFailed] = useState(false);
  const src = posterUrl(movie.poster_path, size);
  return (
    <div class={`poster ${cls}`} style={{ background: tint(movie.title) }}>
      {src && !failed ? (
        <img src={src} alt={movie.title} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <span class="poster-title">{movie.title}</span>
      )}
      {badge && <span class="poster-badge">{badge}</span>}
    </div>
  );
}
