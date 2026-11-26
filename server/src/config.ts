export const config = {
  port: Number(process.env.PORT ?? 8787),
  dataDir: process.env.DATA_DIR ?? "./data",
  // Built web app to serve. In Docker this is /app/web.
  webDir: process.env.WEB_DIR ?? "../web/dist",
  // Shared secret both phones enter once in Keeper's setup screen.
  apiToken: process.env.KEEPER_API_TOKEN ?? "",
  // TMDB "API Read Access Token" (v4) from https://www.themoviedb.org/settings/api
  tmdbToken: cleanSecret(process.env.TMDB_READ_TOKEN),
  // Optional: UPCitemdb paid key. Without it the free trial endpoint is used (~100 lookups/day).
  upcItemDbKey: cleanSecret(process.env.UPCITEMDB_KEY),
  // A phone that hasn't synced in this many days gets a full fresh copy.
  fullResyncDays: Number(process.env.FULL_RESYNC_DAYS ?? 14),
  // Deleted rows are kept this long so other phones learn about the delete, then purged.
  tombstoneDays: Number(process.env.TOMBSTONE_DAYS ?? 60),
  // Web Push: contact for the push services, and digest pacing.
  vapidSubject: process.env.VAPID_SUBJECT ?? "mailto:keeper@example.com",
  pushDebounceMinutes: Number(process.env.PUSH_DEBOUNCE_MINUTES ?? 10),
  pushMinHours: Number(process.env.PUSH_MIN_HOURS ?? 12),
  // Shelf scan (AI reads DVD spines from a photo). Leave blank to turn the feature off.
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
  // Safety net on cost: max shelf photos per day across both phones.
  shelfDailyLimit: Number(process.env.SHELF_DAILY_LIMIT ?? 40),
  // Only changed for testing against mock services.
  anthropicBase: process.env.ANTHROPIC_API_BASE ?? "https://api.anthropic.com",
  tmdbBase: process.env.TMDB_API_BASE ?? "https://api.themoviedb.org/3",
  tmdbImageBase: process.env.TMDB_IMAGE_BASE ?? "https://image.tmdb.org/t/p",
  upcBase: process.env.UPC_API_BASE ?? "https://api.upcitemdb.com",
  // Records: Discogs personal access token (discogs.com → Settings → Developers → Generate new token).
  discogsToken: cleanSecret(process.env.DISCOGS_TOKEN),
  discogsBase: process.env.DISCOGS_API_BASE ?? "https://api.discogs.com",
  // Read-only link for other apps (e.g. CRATE DIGGER) to read the record collection.
  shareToken: cleanSecret(process.env.SHARE_TOKEN),
};

if (!config.apiToken) {
  console.warn("⚠️  KEEPER_API_TOKEN is not set — the API is open to anyone who can reach it.");
}

/** Forgive the usual .env slips: stray spaces, wrapping quotes, a pasted "Bearer " prefix. */
function cleanSecret(v: string | undefined): string {
  return (v ?? "").trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "").trim();
}
