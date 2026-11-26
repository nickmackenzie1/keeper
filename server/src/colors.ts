import sharp from "sharp";
import { db } from "./db.js";
import { outbound } from "./lookup.js";
import { config } from "./config.js";

/**
 * Poster colours: each movie gets a dark background tone and a bright accent picked
 * from its own poster, so the app's screens take on that movie's look.
 * Worked out once per poster on the server and cached; the result syncs with the movie.
 */

db.exec(`CREATE TABLE IF NOT EXISTS poster_colors (poster_path TEXT PRIMARY KEY, bg TEXT NOT NULL, accent TEXT NOT NULL)`);

export type Palette = { bg: string; accent: string };

type HSL = [number, number, number];

function rgbToHsl(r: number, g: number, b: number): HSL {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex([h, s, l]: HSL): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Pick colours from raw RGB pixels: the most common hue for the background, the most vivid for the accent. */
export function paletteFromPixels(data: Buffer, channels: number): Palette {
  // Hues wrap around (350° and 5° are both red), so average them as angles.
  const buckets = new Map<number, { w: number; vivid: number; hx: number; hy: number; s: number; l: number; n: number }>();
  for (let i = 0; i < data.length; i += channels) {
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    const key = s < 0.12 ? -1 : Math.round(h / 20) % 18; // -1 = greys
    const b = buckets.get(key) ?? { w: 0, vivid: 0, hx: 0, hy: 0, s: 0, l: 0, n: 0 };
    b.n++;
    b.w += 1;
    b.vivid += s * (1 - Math.abs(l - 0.5) * 1.6); // saturated and mid-light = vivid
    b.hx += Math.cos((h * Math.PI) / 180); b.hy += Math.sin((h * Math.PI) / 180); b.s += s; b.l += l;
    buckets.set(key, b);
  }
  const avg = (b: { hx: number; hy: number; s: number; l: number; n: number }): HSL => [
    ((Math.atan2(b.hy, b.hx) * 180) / Math.PI + 360) % 360,
    b.s / b.n,
    b.l / b.n,
  ];
  const all = [...buckets.entries()];
  const common = all.sort((a, b) => b[1].w - a[1].w)[0][1];
  const total = data.length / channels;
  // Accent: a colour that's vivid AND present enough to matter (not one stray pixel).
  const score = (b: { vivid: number; n: number }) => (b.vivid / b.n) ** 2 * Math.sqrt(b.n / total);
  const colourful = all
    .filter(([k, b]) => k !== -1 && b.n / total >= 0.03)
    .sort((a, b) => score(b[1]) - score(a[1]))[0]?.[1];

  const [bh, bs] = avg(common);
  // Background: the poster's main tone, kept dark so white text always reads.
  const bg = hslToHex([bh, clamp(bs, 0.1, 0.55), 0.14]);
  // Accent: its most vivid colour, kept bright enough to read on that dark background.
  const [ah, as] = colourful ? avg(colourful) : [40, 0.9];
  const accent = colourful ? hslToHex([ah, clamp(as, 0.55, 0.95), 0.68]) : "#fdba4d";
  return { bg, accent };
}

export async function posterColors(posterPath: string | null | undefined): Promise<Palette | null> {
  if (!posterPath) return null;
  return imageColors(posterPath, `${config.tmdbImageBase}/w92${posterPath}`, 24, 36);
}

/** Album covers are square and come from Discogs as full URLs. */
export async function coverColors(url: string | null | undefined): Promise<Palette | null> {
  if (!url) return null;
  return imageColors(url, url, 30, 30, { "User-Agent": "Keeper/1.0 +https://github.com/nickmackenzie1/keeper" });
}

async function imageColors(key: string, url: string, w: number, h: number, headers: Record<string, string> = {}): Promise<Palette | null> {
  const hit = db.prepare("SELECT bg, accent FROM poster_colors WHERE poster_path = ?").get(key) as Palette | undefined;
  if (hit) return hit;
  try {
    const r = await outbound("Cover image", url, { headers }, 8000);
    if (!r.ok) return null;
    const { data, info } = await sharp(Buffer.from(await r.arrayBuffer()))
      .resize(w, h, { fit: "cover" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const p = paletteFromPixels(data, info.channels);
    db.prepare("INSERT OR REPLACE INTO poster_colors(poster_path, bg, accent) VALUES (?, ?, ?)").run(key, p.bg, p.accent);
    return p;
  } catch {
    return null;
  }
}
