/** The app's name, in one place. */
export const APP_NAME = "Library";

const BOOKS: [number, number, boolean][] = [
  [48, 150, true], [70, 170, false], [92, 140, true], [114, 160, true],
  [160, 150, false], [182, 172, true], [204, 138, true], [226, 158, false],
];

/**
 * The logo, "The gap": a shelf of books with one missing, and something glowing purple where it was.
 * With `play`, the books rise onto the shelf one by one, then the gap flickers on like an old tube light
 * and keeps a faint, uneven hum.
 */
export function Logo({ size = 200, play = false, class: cls = "" }: { size?: number; play?: boolean; class?: string }) {
  return (
    <svg class={`logo ${play ? "logo-play" : ""} ${cls}`} viewBox="28 60 244 216" width={size} height={(size * 216) / 244} role="img" aria-label={APP_NAME}>
      {BOOKS.map(([x, h, light], i) => (
        <rect key={x} class="logo-book" style={{ animationDelay: `${0.05 + i * 0.06}s` }} x={x} y={236 - h} width="18" height={h} fill={light ? "currentColor" : "#9e9a92"} />
      ))}
      <g class="logo-gap">
        <rect x="136" y="76" width="22" height="160" fill="#8a3ffc" opacity="0.38" />
        <rect x="137.5" y="77.5" width="19" height="157" fill="none" stroke="#8a3ffc" stroke-width="3" />
        <polygon points="136,236 158,236 176,272 118,272" fill="#8a3ffc" opacity="0.22" />
      </g>
      <rect x="36" y="236" width="228" height="8" fill="currentColor" />
    </svg>
  );
}
