import dns from "node:dns";
import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { currentSeq, db, purgeTombstones } from "./db.js";
import { syncRouter } from "./sync.js";
import { lookupRouter, outbound } from "./lookup.js";
import { eventsRouter } from "./events.js";
import { pushRouter, flushDigests } from "./push.js";
import { enrichMovies, seriesRouter } from "./enrich.js";
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

app.get("/api/stats", (_req, res) => {
  const q = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  res.json({
    movies: q("SELECT COUNT(*) n FROM movies WHERE deleted = 0"),
    copies: q("SELECT COUNT(*) n FROM copies WHERE deleted = 0"),
    dvd: q("SELECT COUNT(*) n FROM copies WHERE deleted = 0 AND format = 'dvd'"),
    bluray: q("SELECT COUNT(*) n FROM copies WHERE deleted = 0 AND format = 'bluray'"),
    uhd: q("SELECT COUNT(*) n FROM copies WHERE deleted = 0 AND format = 'uhd'"),
    upgrade_wanted: q("SELECT COUNT(*) n FROM copies WHERE deleted = 0 AND upgrade_wanted = 1"),
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
  const [tmdb, upc] = await Promise.all([
    check(async () => {
      if (!config.tmdbToken) return "missing: add TMDB_READ_TOKEN to .env";
      const r = await outbound("TMDB", `${config.tmdbBase}/configuration`, { headers: { Authorization: `Bearer ${config.tmdbToken}` } }, 8000);
      return r.ok ? "ok" : r.status === 401 ? "error: token rejected — use the long Read Access Token" : `error: HTTP ${r.status}`;
    }),
    check(async () => {
      const r = await outbound("Barcode lookup", `${config.upcBase}/prod/trial/lookup?upc=025192012920`, {}, 8000);
      return r.ok ? "ok" : r.status === 429 ? "ok (daily limit reached)" : `error: HTTP ${r.status}`;
    }),
  ]);
  res.json({
    tmdb,
    barcode: upc,
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

app.listen(config.port, () => console.log(`Keeper listening on :${config.port}`));
