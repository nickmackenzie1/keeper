import dns from "node:dns";
import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { currentSeq, db, purgeTombstones } from "./db.js";
import { syncRouter } from "./sync.js";
import { lookupRouter, outbound, tmdbFetch } from "./lookup.js";
import { eventsRouter } from "./events.js";
import { pushRouter, flushDigests } from "./push.js";
import { colourAlbums, colourMovies, enrichMovies, seriesRouter } from "./enrich.js";
import { discogs, recordsRouter, shareRecords } from "./discogs.js";
import { shelfRouter } from "./shelf.js";

// Docker on Synology often has no IPv6; trying IPv6 first makes outside requests hang.
dns.setDefaultResultOrder("ipv4first");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "12mb" })); // shelf photos

// Unauthenticated: the app pings this to see whether the server is reachable.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "keeper", cursor: currentSeq() });
});

// Read-only record list for other apps (e.g. CRATE DIGGER). Its own token, never the main one.
app.get("/api/share/records", (req, res) => {
  const given = String(req.query.token ?? "") || (req.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!config.shareToken) { res.status(503).json({ error: "sharing is off — set SHARE_TOKEN in .env" }); return; }
  if (given !== config.shareToken) { res.status(401).json({ error: "unauthorized" }); return; }
  res.json({ records: shareRecords(), generated_at: Date.now() });
});

app.use("/api", (req, res, next) => {
  if (!config.apiToken) return next();
  const header = req.get("authorization") === `Bearer ${config.apiToken}`;
  // EventSource can't send headers, so /events may pass the token as a query param.
  const query = req.path === "/events" && req.query.token === config.apiToken;
  if (header || query) return next();
  res.status(401).json({ error: "unauthorized" });
});

app.use("/api", syncRouter);
app.use("/api", lookupRouter);
app.use("/api", eventsRouter);
app.use("/api", pushRouter);
app.use("/api", seriesRouter);
app.use("/api", shelfRouter);
app.use("/api", recordsRouter);

app.get("/api/stats", (_req, res) => {
  const q = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  res.json({
    movies: q("SELECT COUNT(*) n FROM movies WHERE deleted = 0"),
    copies: q("SELECT COUNT(*) n FROM copies WHERE deleted = 0"),
    dvd: q("SELECT COUNT(*) n FROM copies WHERE deleted = 0 AND format = 'dvd'"),
    bluray: q("SELECT COUNT(*) n FROM copies WHERE deleted = 0 AND format = 'bluray'"),
    uhd: q("SELECT COUNT(*) n FROM copies WHERE deleted = 0 AND format = 'uhd'"),
    upgrade_wanted: q("SELECT COUNT(*) n FROM copies WHERE deleted = 0 AND upgrade_wanted = 1"),
    albums: q("SELECT COUNT(*) n FROM albums WHERE deleted = 0"),
    records: q("SELECT COUNT(*) n FROM pressings WHERE deleted = 0"),
  });
});

/** GET /api/diagnostics — can the NAS reach TMDB, the barcode service and the AI? Shown in Settings. */
app.get("/api/diagnostics", async (_req, res) => {
  const check = async (fn: () => Promise<string>) => {
    try {
      return await fn();
    } catch (e: any) {
      return `error: ${e?.message ?? e}`;
    }
  };
  const [tmdb, upc, records] = await Promise.all([
    check(async () => {
      if (!config.tmdbToken) return "missing: add TMDB_READ_TOKEN to .env";
      const r = await tmdbFetch(new URL(`${config.tmdbBase}/configuration`), 8000);
      if (r.ok) return "ok";
      if (r.status !== 401) return `error: HTTP ${r.status}`;
      const t = config.tmdbToken;
      const shape = t.startsWith("eyJ") ? `looks like a Read Access Token (${t.length} characters) but TMDB says it's not valid — copy it again` : `isn't a TMDB key (${t.length} characters) — paste the API Read Access Token or the 32-character API Key`;
      return `error: key rejected — the TMDB_READ_TOKEN in .env ${shape}`;
    }),
    check(async () => {
      const r = await outbound("Barcode lookup", `${config.upcBase}/prod/trial/lookup?upc=025192012927`, { headers: { Accept: "application/json" } }, 8000);
      // Any answer from the service means it's reachable; only network errors and 5xx are real problems.
      return r.ok || r.status === 400 || r.status === 404 ? "ok" : r.status === 429 ? "ok (daily limit reached)" : `error: HTTP ${r.status}`;
    }),
    check(async () => {
      if (!config.discogsToken) return "missing: add DISCOGS_TOKEN to .env for records";
      await discogs("/database/search", { q: "rumours", type: "master", per_page: "1" });
      return "ok";
    }),
  ]);
  res.json({
    tmdb,
    barcode: upc,
    records,
    ai: config.anthropicKey ? "configured" : "missing: add ANTHROPIC_API_KEY to .env for cover & shelf photos",
    version: process.env.KEEPER_VERSION ?? "dev",
  });
});

app.use("/api", (_req, res) => res.status(404).json({ error: "not_found" }));

// ---- The web app ----
const webDir = path.resolve(config.webDir);
if (fs.existsSync(path.join(webDir, "index.html"))) {
  app.use(
    express.static(webDir, {
      setHeaders(res, file) {
        // The service worker and HTML must always be fresh so updates roll out.
        if (/(sw\.js|index\.html|manifest\.webmanifest)$/.test(file)) res.setHeader("Cache-Control", "no-cache");
      },
    }),
  );
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(webDir, "index.html")));
} else {
  console.warn(`Web app not found at ${webDir} — API only.`);
}

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(err.status ?? 500).json({ error: err.message ?? "server_error" });
});

purgeTombstones(config.tombstoneDays);
setInterval(() => purgeTombstones(config.tombstoneDays), 86_400_000);
setInterval(() => flushDigests().catch((e) => console.error("digest:", e)), 60_000);
// Fill in genres + series for new movies (and everything added before this existed).
setTimeout(() => void enrichMovies(), 5_000);
setInterval(() => void enrichMovies(), 2 * 60_000);
setTimeout(() => void colourMovies(), 8_000);
setInterval(() => void colourMovies(), 3 * 60_000);
setTimeout(() => void colourAlbums(), 10_000);
setInterval(() => void colourAlbums(), 3 * 60_000);

app.listen(config.port, () => console.log(`Keeper listening on :${config.port}`));
