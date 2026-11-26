# Keeper

Our DVD / Blu-ray / 4K collection as an installable web app, self-hosted on the Synology.
At Talize or Value Village: scan a barcode (or type a title) and instantly see **Not in your collection**, **Upgrade!** or **Already on the shelf** — with or without signal.

```
iPhone (Keeper on Home Screen: offline copy in IndexedDB, service worker)
   ⇅  HTTPS via Cloudflare (Access: only our two emails)  ⇅
Synology: Docker → keeper (Node/Express + SQLite keeper.db) + cloudflared tunnel
   → TMDB (titles/posters) · UPCitemdb (barcodes)
```

- `server/` — TypeScript + Express + SQLite: sync, lookups, push notifications, serves the app
- `web/` — Preact + TypeScript PWA: Check (+ Haul mode), Collection, Hunt list, Stats (achievements, series gaps), Settings; skins: Catalog, Midnight, Rewind, Late Fee
- `BACKLOG.md` — ideas for later (shelf-photo scan, etc.)

## 1. Get the keys (10 min)

1. **TMDB**: sign up at themoviedb.org → Settings → API → copy the **API Read Access Token**.
2. **Access code**: any long random string, e.g. `openssl rand -hex 16`. Both phones type it once.
3. **Cloudflare** (needs a domain on Cloudflare, ~$10–15/yr — you can buy one there):
   1. Zero Trust dashboard → **Networks → Tunnels → Create a tunnel** (type *Cloudflared*), name it `keeper`.
   2. Copy the token from the "Install connector" step (the long string after `--token`).
   3. **Public hostname**: `keeper.yourdomain.com` → Service `HTTP` → `localhost:8787`.
   4. **Access → Applications → Add → Self-hosted**: domain `keeper.yourdomain.com`.
      Policy: *Allow* → *Emails* → your email and your wife's. Session duration: **1 month** (so she rarely re-logs in).
      Login method: One-time PIN (emailed code) is fine.

## 2. Run it on the Synology

1. Copy this whole folder to `/volume1/docker/keeper/` and create `/volume1/docker/keeper/data`.
2. `cp .env.example .env` and fill in `KEEPER_API_TOKEN`, `TMDB_READ_TOKEN`, `CLOUDFLARE_TUNNEL_TOKEN`, `VAPID_SUBJECT`.
3. Container Manager → **Project → Create** → path `/volume1/docker/keeper` (uses `docker-compose.yml`) → Build & start.
   Or SSH: `cd /volume1/docker/keeper && sudo docker compose up -d --build`
4. Check `https://keeper.yourdomain.com` → Cloudflare login → Keeper setup screen.
5. Add `/volume1/docker/keeper/data` to **Hyper Backup**.

## 3. Each iPhone (once)

1. Open `https://keeper.yourdomain.com` in Safari → sign in with the emailed code.
2. **Share → Add to Home Screen**. Open Keeper from the Home Screen from now on.
3. Enter your name + the access code.
4. Settings → **Turn on background updates** (allow notifications).
5. Pick a skin.

## Features

- **Check** — scan a barcode or type a title: *Not in your collection*, *Upgrade!*, *Already on the shelf*. Works offline.
- **Haul mode** — scan a whole stack, get "6 new, 2 upgrades, 1 you already own", tick what you bought, add them all at once.
- **Hunt list** — movies you're looking for, shared between both phones. Scanning one in a store sets off confetti and a chime.
- **Stats** — discs by format, decade and genre, finds per month, upgrade progress.
- **Achievements** — "First 4K", "Century Club", "Completed Back to the Future", and more.
- **Series gaps** — "You own Alien — missing Aliens, Alien³", with one tap to put them on the hunt list.
- **Shelf scan** — photo of a shelf → AI reads the spines → *Worth a look* (hunt-list matches, collector editions like Criterion / Scream Factory / steelbooks, rare finds, upgrades, gaps in your series, highly rated), *Also on the shelf*, *Already yours*. Needs `ANTHROPIC_API_KEY`; about 1–3¢ per photo, capped by `SHELF_DAILY_LIMIT`.
- **Cover photo** — no barcode (or a worn one)? Snap the cover on the Check or Add screen and the AI identifies it.
- **Movie night** — filter by genre, length or kid-friendly (G/PG, from TMDB age ratings) and let Keeper spin to pick from your shelf.
- **Rare finds** — every store scan is logged, so after a few trips Keeper can say "first time you've seen this in 14 trips".
- Genres and series fill in automatically from TMDB (also for discs added earlier).

## Updating

Keeper updates itself: `update.sh` checks GitHub every 15 minutes and, when there's something new,
downloads it (leaving `.env` and `data/` alone) and rebuilds. Set it up once in DSM:

1. **Control Panel → Task Scheduler → Create → Scheduled Task → User-defined script**
2. General: name `Keeper update`, user **root**
3. Schedule: run daily, repeat **every 15 minutes**
4. Task Settings → Run command: `sh /volume1/docker/keeper/update.sh`

Press **Run** on the task to update right away. Settings → Server check in the app shows the running version;
`update.log` in the keeper folder shows what happened. If a build fails, the previous version keeps running.

## How staying in sync works

- Each phone keeps the whole collection, so the store check works with zero signal.
- Opening Keeper anywhere syncs in a second or two (Cloudflare makes it reachable away from home).
- While Keeper's open, the other phone's changes appear live.
- When one phone adds discs, the other gets **one digest notification** ("Nick added 3 discs: Alien, Jaws…") at most every 12h, and its copy updates in the background — no need to open the app. (iOS requires a visible notification for background work.)
- A phone that hasn't synced in 14 days gets a full fresh copy. Newest edit wins; deletes propagate.
- Settings shows when each phone last synced.

## Development (Windows is fine)

```
cd server && npm install && npm run dev      # API on :8787
cd web    && npm install && npm run dev      # app on :5173, proxies /api
cd server && npm test                         # two-phone sync test
```

Set `KEEPER_API_TOKEN` and `TMDB_READ_TOKEN` in your shell (or a `server/.env` loaded by your tooling) for local runs.

## API (all need `Authorization: Bearer <KEEPER_API_TOKEN>` except health)

| | | |
|---|---|---|
| GET | `/api/health` | reachability |
| POST | `/api/sync` | push local changes, get delta or full copy |
| GET | `/api/events` | live "changed" events (SSE) |
| GET | `/api/devices` | last sync per phone |
| GET | `/api/search?q=` · `/api/movie/:id` | TMDB |
| GET | `/api/barcode/:upc` | barcode → title, format, TMDB matches |
| GET/POST | `/api/push/key` · `/subscribe` · `/unsubscribe` · `/test` | Web Push |
| GET | `/api/stats` | counts |
