import { Router } from "express";
import { config } from "./config.js";
import { db } from "./db.js";
import { cleanTitle, movieDetails, searchMovies } from "./lookup.js";
import { sight, type Rarity } from "./sightings.js";

/**
 * Shelf scan: a photo of DVD/Blu-ray spines → Claude reads the titles and spots
 * collector editions → each title is matched on TMDB → the phone compares the
 * results with its own collection and hunt list.
 */

db.exec(`CREATE TABLE IF NOT EXISTS shelf_usage (day TEXT PRIMARY KEY, count INTEGER NOT NULL)`);

const PROMPT = `This photo shows DVDs, Blu-rays or 4K discs, usually spines on a shelf in a thrift store or a home.

List every disc whose title you can read, left to right, top to bottom. For each one give:
- "title": the movie or show title as printed (fix obvious OCR-style mistakes; no format words)
- "year": release year if printed or you are confident, else null
- "format": "dvd", "bluray", "uhd" (4K) or "unknown" — judge from spine colour/logo (blue Blu-ray cases, black 4K cases with the 4K logo, DVD logo)
- "label": the distributor/label if it's a notable one (e.g. Criterion, Arrow, Scream Factory, Shout!, Vinegar Syndrome, Kino Lorber, Severin, Second Sight, 88 Films, Eureka), else null
- "edition": e.g. "steelbook", "limited edition", "box set", "collector's edition", else null
- "collector": true if collectors tend to seek this exact release (boutique label, limited/numbered, steelbook, out of print, known sought-after release), else false
- "collector_reason": a few words why, else null
- "confidence": "high", "medium" or "low" for how sure you are of the title

Skip anything you can't read at all. Don't invent titles.
Reply with ONLY a JSON array, no other text.`;

type Spine = {
  title: string;
  year: number | null;
  format: "dvd" | "bluray" | "uhd" | "unknown";
  label: string | null;
  edition: string | null;
  collector: boolean;
  collector_reason: string | null;
  confidence: "high" | "medium" | "low";
};

async function readSpines(imageB64: string, mediaType: string): Promise<Spine[]> {
  const r = await fetch(`${config.anthropicBase}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": config.anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.anthropicModel,
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: imageB64 } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    }),
  });
  if (!r.ok) {
    const body = await r.text();
    console.warn("Anthropic error", r.status, body.slice(0, 300));
    throw Object.assign(new Error(r.status === 401 ? "Anthropic API key is wrong" : `AI service error ${r.status}`), { status: 502 });
  }
  const data = (await r.json()) as { content?: { type: string; text?: string }[] };
  const text = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
  const json = text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
  try {
    const arr = JSON.parse(json) as Spine[];
    return arr.filter((s) => s && typeof s.title === "string" && s.title.trim());
  } catch {
    console.warn("Couldn't parse spines:", text.slice(0, 300));
    return [];
  }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

export const shelfRouter = Router();

shelfRouter.get("/shelf/status", (_req, res) => {
  const used = (db.prepare("SELECT count FROM shelf_usage WHERE day = ?").get(new Date().toLocaleDateString("en-CA")) as { count: number } | undefined)?.count ?? 0;
  res.json({ enabled: !!config.anthropicKey, used_today: used, daily_limit: config.shelfDailyLimit });
});

/**
 * POST /api/shelf  { image: "<base64 jpeg>", media_type?: "image/jpeg" }
 * → { spines: [{ title, year, format, label, edition, collector, collector_reason, confidence,
 *                match: { tmdb_id, title, year, poster_path, rating, votes, genres, collection_id, collection_name } | null,
 *                rarity }] }
 */
shelfRouter.post("/shelf", async (req, res, next) => {
  try {
    if (!config.anthropicKey) {
      res.status(503).json({ error: "Shelf scan isn't set up — add ANTHROPIC_API_KEY to the server's .env" });
      return;
    }
    const image = String(req.body?.image ?? "").replace(/^data:[^,]+,/, "");
    if (image.length < 1000) { res.status(400).json({ error: "missing image" }); return; }

    const day = new Date().toLocaleDateString("en-CA");
    const used = (db.prepare("SELECT count FROM shelf_usage WHERE day = ?").get(day) as { count: number } | undefined)?.count ?? 0;
    if (used >= config.shelfDailyLimit) {
      res.status(429).json({ error: `Daily shelf-scan limit (${config.shelfDailyLimit}) reached — try again tomorrow` });
      return;
    }
    db.prepare("INSERT INTO shelf_usage(day, count) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET count = count + 1").run(day);

    const spines = await readSpines(image, String(req.body?.media_type ?? "image/jpeg"));

    const results = await pool(spines.slice(0, 60), 5, async (s) => {
      let match = null;
      let rarity: Rarity | null = null;
      try {
        const hits = await searchMovies(cleanTitle(s.title) || s.title, s.year ?? undefined);
        const hit = hits[0] ?? (s.year ? (await searchMovies(cleanTitle(s.title) || s.title))[0] : undefined);
        if (hit) {
          const d = await movieDetails(hit.tmdb_id).catch(() => null);
          match = { ...hit, genres: d?.genres ?? null, collection_id: d?.collection_id ?? null, collection_name: d?.collection_name ?? null };
          rarity = sight(hit.tmdb_id, hit.title, "shelf");
        }
      } catch (e: any) {
        if (e?.status === 503) throw e;
      }
      return { ...s, match, rarity };
    });

    res.json({ spines: results });
  } catch (e) {
    next(e);
  }
});
