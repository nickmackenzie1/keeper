import type { ComponentChildren } from "preact";
import { currentSkin } from "./skins";

// Screen titles reveal once per visit, not every time you switch tabs.
const played = new Set<string>();

/**
 * A "new zone" title: wide-spaced kicker, a giant word, and thin rules either side —
 * like entering a new area in a game. Animates once when `play` is true.
 */
export function ZoneTitle({
  title,
  kicker,
  sub,
  size = "screen",
  play = false,
  as: Tag = "h2",
  fontSize,
}: {
  fontSize?: string;
  title: ComponentChildren;
  kicker?: ComponentChildren;
  sub?: ComponentChildren;
  size?: "screen" | "reveal" | "chapter";
  play?: boolean;
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <div class={`zone zone-${size} ${play ? "zone-play" : ""}`}>
      {kicker && <span class="zone-kicker">{kicker}</span>}
      <div class="zone-row">
        <span class="zone-rule" aria-hidden="true" />
        <Tag class="zone-title" style={fontSize ? { fontSize } : undefined}>{title}</Tag>
        <span class="zone-rule" aria-hidden="true" />
      </div>
      {sub && <span class="zone-kicker zone-sub">{sub}</span>}
    </div>
  );
}

/** Screen heading: a zone title in Marquee, a plain h1 in the other skins. */
// Every screen is a file in the Library, like a location card in a government building.
const FILE_NO: Record<string, string> = { Check: "01", Collection: "02", "Hunt list": "03", Stats: "04", Settings: "05", "Add a disc": "06", "Movie night": "07" };

export function ScreenTitle({ title, kicker }: { title: string; kicker?: string }) {
  if (currentSkin() !== "marquee") return <h1>{title}</h1>;
  kicker = kicker ?? `Library · File ${FILE_NO[title] ?? "00"}`;
  const play = !played.has(title);
  played.add(title);
  return <ZoneTitle as="h1" title={title} kicker={kicker} play={play} />;
}
