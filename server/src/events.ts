import { Router, type Response } from "express";
import { currentSeq } from "./db.js";

/**
 * Live updates (Server-Sent Events).
 * While a phone has Keeper open it holds GET /api/events open. When the *other*
 * phone syncs in new changes, every listener gets a `changed` event with the new
 * cursor and simply runs a normal /api/sync to pull them.
 */
type Client = { res: Response; deviceId: string };
const clients = new Set<Client>();

export function broadcastChange(fromDevice: string) {
  const payload = `event: changed\ndata: ${JSON.stringify({ cursor: currentSeq(), from: fromDevice })}\n\n`;
  for (const c of clients) {
    if (c.deviceId !== fromDevice) c.res.write(payload);
  }
}

export const eventsRouter = Router();

/** GET /api/events?device_id=... */
eventsRouter.get("/events", (req, res) => {
  const deviceId = String(req.query.device_id ?? "unknown");
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  res.write(`event: hello\ndata: ${JSON.stringify({ cursor: currentSeq() })}\n\n`);

  const client: Client = { res, deviceId };
  clients.add(client);
  // Comment line every 25s keeps the connection alive through sleepy routers.
  const keepAlive = setInterval(() => res.write(": ping\n\n"), 25_000);

  req.on("close", () => {
    clearInterval(keepAlive);
    clients.delete(client);
  });
});

export const listenerCount = () => clients.size;
