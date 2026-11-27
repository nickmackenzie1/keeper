import { useState } from "preact/hooks";
import { api, ApiError } from "../lib/api";
import { setMeta } from "../lib/db";
import { sync } from "../lib/live";
import { Logo } from "./Logo";

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
    <div class="setup-v2">
      <header class="setup-hero">
        <p class="setup-file">File 0001 · New device</p>
        <h1 class="sr-only">We Have It At Home</h1>
        <Logo play class="setup-logo" />
        <span class="setup-rule" aria-hidden="true" />
        <p class="setup-tag">Department of Already Owning It. Set this phone up once.</p>
      </header>
      {!window.isSecureContext && (
        <p class="setup-warn">
          You're on a plain <b>http://</b> address. The camera scanner, offline mode and notifications need the secure one:
          open <b>https://keeper.mackenzie.house</b> and add that to your Home Screen.
        </p>
      )}
      <form class="setup-form" onSubmit={submit}>
        <label class="line-field">
          <span>Whose phone is this</span>
          <input placeholder="e.g. Nick" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} autoComplete="given-name" />
        </label>
        <label class="line-field">
          <span>Access code</span>
          <input type="password" placeholder="From the .env file on the NAS" value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} autoComplete="current-password" required />
        </label>
        {error && <p class="setup-error" role="alert">{error}</p>}
        <button class="setup-go" disabled={busy || !code.trim()}>{busy ? "Connecting…" : "Get started"}</button>
      </form>
    </div>
  );
}
