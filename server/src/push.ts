import { Router } from "express";
import * as webpush from "web-push";
import { z } from "zod";
import { config } from "./config.js";
import { currentSeq, db } from "./db.js";

/**
 * Background updates via Web Push.
 *
 * iOS only lets a home-screen web app run in the background when a push arrives,
 * and every push must show a notification. So instead of one push per disc we send
 * a digest: after the other phone adds discs, wait DEBOUNCE, then send at most one
 * notification per PUSH_MIN_HOURS. Receiving it wakes Keeper's service worker,
 * which syncs the collection silently while the notification is shown.
 */

db.exec(`
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint      TEXT PRIMARY KEY,
  device_id     TEXT NOT NULL,
  subscription  TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  last_push_at  INTEGER NOT NULL DEFAULT 0,
  last_push_seq INTEGER NOT NULL DEFAULT 0,
  pending_since INTEGER
);
`);

function vapidKeys(): { publicKey: string; privateKey: string } {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'vapid'").get() as { value: string } | undefined;
  if (row) return JSON.parse(row.value);
  const keys = webpush.generateVAPIDKeys(); // generated once, kept in keeper.db
  db.prepare("INSERT INTO meta(key, value) VALUES ('vapid', ?)").run(JSON.stringify(keys));
  return keys;
}

const keys = vapidKeys();
webpush.setVapidDetails(config.vapidSubject, keys.publicKey, keys.privateKey);

/** Called after a sync from `fromDevice` changed something: queue a digest for everyone else. */
export function queueDigest(fromDevice: string) {
  db.prepare("UPDATE push_subs SET pending_since = COALESCE(pending_since, ?) WHERE device_id != ?")
    .run(Date.now(), fromDevice);
}

type Sub = {
  endpoint: string; device_id: string; subscription: string;
  last_push_at: number; last_push_seq: number; pending_since: number | null;
};

function digestText(sub: Sub): { title: string; body: string } | null {
  const added = db.prepare(`
    SELECT m.title AS title, c.updated_by AS by, d.name AS name
    FROM copies c JOIN movies m ON m.id = c.movie_id
    LEFT JOIN devices d ON d.device_id = c.updated_by
    WHERE c.seq > ? AND c.deleted = 0 AND c.updated_by != ?
    ORDER BY c.seq`).all(sub.last_push_seq, sub.device_id) as { title: string; name: string | null }[];

  const other = db.prepare(`
    SELECT COUNT(*) AS n FROM (
      SELECT id FROM movies WHERE seq > ? AND updated_by != ?
      UNION ALL SELECT id FROM copies WHERE seq > ? AND updated_by != ? AND deleted = 1)`)
    .get(sub.last_push_seq, sub.device_id, sub.last_push_seq, sub.device_id) as { n: number };

  if (added.length === 0 && other.n === 0) return null;
  if (added.length === 0) return { title: "Keeper", body: "The collection was updated. You're synced." };

  const who = added[0].name ?? "Someone";
  const titles = [...new Set(added.map((a) => a.title))];
  const shown = titles.slice(0, 3).join(", ") + (titles.length > 3 ? ` +${titles.length - 3} more` : "");
  const n = added.length;
  return { title: `${who} added ${n} disc${n === 1 ? "" : "s"}`, body: `${shown} — your copy is up to date.` };
}

export async function sendTo(sub: Sub, payload: object): Promise<boolean> {
  try {
    await webpush.sendNotification(JSON.parse(sub.subscription), JSON.stringify(payload), { TTL: 60 * 60 * 24 });
    return true;
  } catch (e: any) {
    if (e?.statusCode === 404 || e?.statusCode === 410) {
      db.prepare("DELETE FROM push_subs WHERE endpoint = ?").run(sub.endpoint); // phone unsubscribed
    } else {
      console.warn("push failed:", e?.statusCode ?? e);
    }
    return false;
  }
}

/** Runs every few minutes. */
export async function flushDigests() {
  const now = Date.now();
  const subs = db.prepare("SELECT * FROM push_subs WHERE pending_since IS NOT NULL").all() as Sub[];
  for (const sub of subs) {
    // If that phone already synced after the change, it doesn't need waking.
    const dev = db.prepare("SELECT last_sync_at FROM devices WHERE device_id = ?").get(sub.device_id) as { last_sync_at: number } | undefined;
    if (dev && dev.last_sync_at > (sub.pending_since ?? 0)) {
      db.prepare("UPDATE push_subs SET pending_since = NULL, last_push_seq = ? WHERE endpoint = ?").run(currentSeq(), sub.endpoint);
      continue;
    }
    if (now - (sub.pending_since ?? now) < config.pushDebounceMinutes * 60_000) continue;
    if (now - sub.last_push_at < config.pushMinHours * 3_600_000) continue;

    const text = digestText(sub);
    const seq = currentSeq();
    if (text && (await sendTo(sub, { ...text, tag: "keeper-digest", sync: true }))) {
      db.prepare("UPDATE push_subs SET pending_since = NULL, last_push_at = ?, last_push_seq = ? WHERE endpoint = ?")
        .run(now, seq, sub.endpoint);
    } else if (!text) {
      db.prepare("UPDATE push_subs SET pending_since = NULL, last_push_seq = ? WHERE endpoint = ?").run(seq, sub.endpoint);
    }
  }
}

const SubscribeBody = z.object({
  device_id: z.string().min(1),
  subscription: z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }).passthrough(),
});

export const pushRouter = Router();

pushRouter.get("/push/key", (_req, res) => res.json({ publicKey: keys.publicKey }));

pushRouter.post("/push/subscribe", (req, res) => {
  const parsed = SubscribeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid_request" }); return; }
  const { device_id, subscription } = parsed.data;
  db.prepare(`
    INSERT INTO push_subs(endpoint, device_id, subscription, created_at, last_push_seq) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET device_id = excluded.device_id, subscription = excluded.subscription`)
    .run(subscription.endpoint, device_id, JSON.stringify(subscription), Date.now(), currentSeq());
  res.json({ ok: true });
});

pushRouter.post("/push/unsubscribe", (req, res) => {
  db.prepare("DELETE FROM push_subs WHERE endpoint = ?").run(String(req.body?.endpoint ?? ""));
  res.json({ ok: true });
});

/** Sends a test notification to one phone (used by the Settings screen). */
pushRouter.post("/push/test", async (req, res) => {
  const deviceId = String(req.body?.device_id ?? "");
  const subs = db.prepare("SELECT * FROM push_subs WHERE device_id = ?").all(deviceId) as Sub[];
  let sent = 0;
  for (const s of subs) if (await sendTo(s, { title: "Keeper", body: "Notifications work. Your collection will stay up to date.", tag: "keeper-test", sync: true })) sent++;
  res.json({ sent });
});
