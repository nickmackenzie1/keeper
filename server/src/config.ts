export const config = {
  port: Number(process.env.PORT ?? 8787),
  dataDir: process.env.DATA_DIR ?? "./data",
  // Built web app to serve. In Docker this is /app/web.
  webDir: process.env.WEB_DIR ?? "../web/dist",
  // Shared secret both phones enter once in Keeper's setup screen.
  apiToken: process.env.KEEPER_API_TOKEN ?? "",
  // TMDB "API Read Access Token" (v4) from https://www.themoviedb.org/settings/api
  tmdbToken: process.env.TMDB_READ_TOKEN ?? "",
  // Optional: UPCitemdb paid key. Without it the free trial endpoint is used (~100 lookups/day).
  upcItemDbKey: process.env.UPCITEMDB_KEY ?? "",
  // A phone that hasn't synced in this many days gets a full fresh copy.
  fullResyncDays: Number(process.env.FULL_RESYNC_DAYS ?? 14),
  // Deleted rows are kept this long so other phones learn about the delete, then purged.
  tombstoneDays: Number(process.env.TOMBSTONE_DAYS ?? 60),
  // Web Push: contact for the push services, and digest pacing.
  vapidSubject: process.env.VAPID_SUBJECT ?? "mailto:keeper@example.com",
  pushDebounceMinutes: Number(process.env.PUSH_DEBOUNCE_MINUTES ?? 10),
  pushMinHours: Number(process.env.PUSH_MIN_HOURS ?? 12),
  // Only changed for testing against mock services.
  tmdbBase: process.env.TMDB_API_BASE ?? "https://api.themoviedb.org/3",
  upcBase: process.env.UPC_API_BASE ?? "https://api.upcitemdb.com",
};

if (!config.apiToken) {
  console.warn("⚠️  KEEPER_API_TOKEN is not set — the API is open to anyone who can reach it.");
}
