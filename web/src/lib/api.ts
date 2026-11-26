import { getMeta } from "./db";
import type { BarcodeLookup, Series, ShelfSpine, TmdbHit } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public kind: "offline" | "login_required" | "unauthorized" | "server",
    public status = 0,
  ) {
    super(message);
  }
}

/**
 * Same-origin call to the Keeper server. Works in pages and in the service worker.
 * Cloudflare Access answers an expired session with a redirect to its login page;
 * `redirect: "manual"` lets us spot that instead of failing with a vague CORS error.
 */
export async function api<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}, token?: string): Promise<T> {
  const t = token ?? (await getMeta("token")) ?? "";
  const { timeoutMs = 25_000, ...rest } = init;
  init = rest;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      // Never leave the screen spinning forever.
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}`, ...(init.headers ?? {}) },
    });
  } catch (e) {
    if ((e as Error)?.name === "TimeoutError") throw new ApiError("Keeper didn't answer in time. Check Settings › Server check.", "server", 504);
    throw new ApiError("Can't reach Keeper", "offline");
  }
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
    throw new ApiError("Sign in again", "login_required", res.status);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    // Not Keeper answering: either Cloudflare's login page, or Cloudflare saying the
    // server is down (e.g. restarting after an auto-update). Tell those apart.
    const text = await res.text().catch(() => "");
    if (/cloudflareaccess\.com|cf-access|Cloudflare Access|Sign in ・ Cloudflare/i.test(text) || res.status === 403) {
      throw new ApiError("Sign in again", "login_required", res.status);
    }
    if (res.status >= 500 || res.status === 0) {
      throw new ApiError(
        `Keeper's server isn't responding (HTTP ${res.status}). It may be restarting after an update — try again in a minute.`,
        "server",
        res.status,
      );
    }
    throw new ApiError(`Unexpected answer from the server (HTTP ${res.status})`, "server", res.status);
  }
  if (res.status === 401) throw new ApiError("Wrong access code", "unauthorized", 401);
  const body = await res.json();
  if (!res.ok) throw new ApiError(body?.error ?? `Error ${res.status}`, "server", res.status);
  return body as T;
}

export const searchTmdb = (q: string) =>
  api<{ results: TmdbHit[] }>(`/search?q=${encodeURIComponent(q)}`).then((r) => r.results);

export const tmdbDetails = (id: number) => api<TmdbHit & { runtime: number | null }>(`/movie/${id}`);

export const fetchSeries = () => api<{ series: Series[] }>("/series").then((r) => r.series);

/** `store`: this scan happened in a store, so log it for rarity tracking. */
export const lookupBarcode = (upc: string, store = false) =>
  api<BarcodeLookup>(`/barcode/${encodeURIComponent(upc)}${store ? "?store=1" : ""}`);

export const shelfScan = (imageB64: string) =>
  api<{ spines: ShelfSpine[] }>("/shelf", { method: "POST", body: JSON.stringify({ image: imageB64, media_type: "image/jpeg" }) }).then((r) => r.spines);

/** One case photographed up close → what disc is it? `store`: count it as a store sighting. */
export const coverScan = (imageB64: string, store: boolean) =>
  api<{ spines: ShelfSpine[] }>("/shelf", {
    method: "POST",
    body: JSON.stringify({ image: imageB64, media_type: "image/jpeg", mode: "cover", store }),
    timeoutMs: 120_000,
  }).then((r) => r.spines[0] ?? null);

export const listDevices = () =>
  api<{ devices: { device_id: string; name: string | null; last_sync_at: number; days_since_sync: number }[] }>(
    "/devices",
  );

export const diagnostics = () =>
  api<{ tmdb: string; barcode: string; ai: string; version: string }>("/diagnostics", { timeoutMs: 30_000 });
