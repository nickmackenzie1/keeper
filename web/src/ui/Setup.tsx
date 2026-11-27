import { useState } from "preact/hooks";
import { api, ApiError } from "../lib/api";
import { setMeta } from "../lib/db";
import { sync } from "../lib/live";

/** First launch on a phone: name it and enter the access code from the server's .env. */
export function Setup({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/stats", {}, code.trim());
      await setMeta("token", code.trim());
      await setMeta("deviceName", name.trim() || "iPhone");
      await setMeta("cursor", 0);
      await sync();
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.kind === "unauthorized"
            ? "That access code isn't right."
            : err.kind === "login_required"
              ? "Sign in through Cloudflare first, then try again."
              : "Can't reach the server."
          : `Something went wrong: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="screen setup">
      <div class="screen-body">
        <h1 class="brand">We Have It At Home</h1>
        <p>Your movie collection, in your pocket. Set up this phone once.</p>
        {!window.isSecureContext && (
          <p class="notice">
            You're on a plain <b>http://</b> address. At Home will work, but the camera scanner, offline mode and notifications
            need the secure address — open <b>https://keeper.mackenzie.house</b> instead, and add that one to your Home Screen.
          </p>
        )}
        <form class="stack gap" onSubmit={submit}>
          <label class="field">
            Whose phone is this?
            <input placeholder="e.g. Nick" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} autoComplete="given-name" />
          </label>
          <label class="field">
            Access code
            <input type="password" placeholder="From the .env file on the NAS" value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} autoComplete="current-password" required />
          </label>
          {error && <p class="notice">{error}</p>}
          <button class="btn primary block" disabled={busy || !code.trim()}>{busy ? "Connecting…" : "Get started"}</button>
        </form>
      </div>
    </div>
  );
}
