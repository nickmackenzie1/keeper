import { useState } from "preact/hooks";
import { tint } from "./util";

type Props = { album: { title: string; artist?: string | null; cover_url?: string | null; cover_bg?: string | null }; class?: string; badge?: string };

/** A square record sleeve: the Discogs cover, or a coloured sleeve with the title when there isn't one. */
export function Cover({ album, class: cls = "", badge }: Props) {
  const [failed, setFailed] = useState(false);
  return (
    <div class={`cover ${cls}`} style={{ background: album.cover_bg ?? tint(album.title) }}>
      {album.cover_url && !failed ? (
        <img src={album.cover_url} alt={`${album.artist ? album.artist + " – " : ""}${album.title}`} loading="lazy" decoding="async" referrerpolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <span class="cover-title">
          <b>{album.title}</b>
          {album.artist && <span>{album.artist}</span>}
        </span>
      )}
      {badge && <span class="poster-badge">{badge}</span>}
    </div>
  );
}
