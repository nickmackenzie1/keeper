import { Logo } from "./Logo";
import { ScreenTitle } from "./Zone";
import { Skeleton } from "./Skeleton";
import { useEffect, useState } from "preact/hooks";
import { diagnostics, listDevices } from "../lib/api";
import { deviceId, getMeta, pendingCount, setMeta } from "../lib/db";
import { sync } from "../lib/live";
import { currentSubscription, disablePush, enablePush, isInstalled, pushSupported, testPush } from "../lib/push";
import { DEFAULT_SKIN, SKINS, applySkin, type Skin } from "./skins";
import { timeAgo, useData } from "./util";

export function Settings() {
  const meta = useData(async () => ({
    name: (await getMeta("deviceName")) ?? "",
    lastSyncAt: await getMeta("lastSyncAt"),
    pending: await pendingCount(),
    skin: ((await getMeta("theme")) as Skin) ?? DEFAULT_SKIN,
    me: await deviceId(),
  }));
  const [devices, setDevices] = useState<Awaited<ReturnType<typeof listDevices>>["devices"] | null>(null);
  const [pushOn, setPushOn] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [diag, setDiag] = useState<Awaited<ReturnType<typeof diagnostics>> | "checking" | "failed" | null>(null);

  useEffect(() => {
    listDevices().then((r) => setDevices(r.devices)).catch(() => setDevices(null));
    currentSubscription().then((s) => setPushOn(!!s)).catch(() => setPushOn(false));
  }, []);

  if (!meta) return <Skeleton />;

  return (
    <div class="screen">
      <header class="screen-head">
        <ScreenTitle title="Settings" />
      </header>
      <div class="screen-body">
        <section class="card">
          <h3>Skin</h3>
          <div class="skin-grid">
            {SKINS.map((s) => (
              <button
                key={s.id}
                class={`skin-swatch ${meta.skin === s.id ? "on" : ""}`}
                aria-pressed={meta.skin === s.id}
                onClick={async () => {
                  applySkin(s.id);
                  await setMeta("theme", s.id);
                  location.reload(); // simplest way to repaint everything in the new skin
                }}
                style={{ background: s.bg, color: s.fg, borderColor: s.accent }}
              >
                <span class="skin-dot" style={{ background: s.accent }} />
                <b>{s.name}</b>
                <span>{s.blurb}</span>
              </button>
            ))}
          </div>
        </section>

        <section class="card">
          <h3>Sync</h3>
          <p>
            Last synced <b>{timeAgo(meta.lastSyncAt)}</b>
            {meta.pending > 0 ? ` · ${meta.pending} change${meta.pending === 1 ? "" : "s"} waiting to upload` : ""}
          </p>
          <button
            class="btn block"
            onClick={async () => {
              setMsg("Syncing…");
              const r = await sync();
              setMsg(r.ok ? `Synced${r.full ? " (full refresh)" : ""}.` : r.error === "login_required" ? "Sign-in expired — reopen Library." : "Couldn't reach the server. Your offline copy is still here.");
            }}
          >
            Sync now
          </button>
          {devices && (
            <ul class="devices">
              {devices.map((d) => (
                <li key={d.device_id} class="row between">
                  <span>{d.name ?? "Unnamed phone"}{d.device_id === meta.me ? " (this phone)" : ""}</span>
                  <span class={d.days_since_sync > 7 ? "warn" : "muted"}>{timeAgo(d.last_sync_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section class="card">
          <h3>Background updates</h3>
          {!isInstalled() ? (
            <p>
              Add Library to your Home Screen first: tap <b>Share</b> → <b>Add to Home Screen</b>, then open it from there. iPhones only allow
              background updates for home-screen apps.
            </p>
          ) : !pushSupported() ? (
            <p>This browser doesn't support notifications.</p>
          ) : (
            <>
              <p>
                When the other phone adds discs, you'll get one short notification and your copy updates in the background — even if you
                don't open Library.
              </p>
              {pushOn ? (
                <div class="row">
                  <button class="btn grow" onClick={async () => setMsg((await testPush()).sent ? "Test sent." : "No subscription found — turn it off and on.")}>Send test</button>
                  <button class="btn" onClick={async () => { await disablePush(); setPushOn(false); }}>Turn off</button>
                </div>
              ) : (
                <button
                  class="btn primary block"
                  onClick={async () => {
                    const r = await enablePush().catch(() => "unsupported" as const);
                    setPushOn(r === "on");
                    setMsg(r === "denied" ? "Notifications are blocked. Allow them in iPhone Settings › Notifications › Library." : r === "on" ? "Background updates are on." : "Couldn't turn on notifications.");
                  }}
                >
                  Turn on background updates
                </button>
              )}
            </>
          )}
        </section>

        <section class="card">
          <h3>This phone</h3>
          <label class="field">
            Name (shown in notifications)
            <input value={name ?? meta.name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </label>
          {name !== null && name !== meta.name && (
            <button class="btn block" onClick={async () => { await setMeta("deviceName", name.trim()); await sync(); setMsg("Saved."); }}>Save name</button>
          )}
          <button
            class="btn ghost block"
            onClick={async () => {
              if (confirm("Forget the access code on this phone? You'll need to enter it again.")) {
                await setMeta("token", "");
                location.reload();
              }
            }}
          >
            Change access code
          </button>
        </section>

        <section class="card">
          <h3>Server check</h3>
          <p class="muted">Can the Synology reach the movie database, the barcode service and the AI?</p>
          {diag && diag !== "checking" && diag !== "failed" && (
            <ul class="diag">
              {([
                ["Movie database (TMDB)", diag.tmdb],
                ["Barcode lookups", diag.barcode],
                ["AI photos", diag.ai],
              ] as const).map(([label, v]) => (
                <li key={label} class={v.startsWith("ok") || v === "configured" ? "ok" : "bad"}>
                  <b>{v.startsWith("ok") || v === "configured" ? "✓" : "✕"} {label}</b>
                  {!(v.startsWith("ok") || v === "configured") && <span class="muted">{v.replace(/^(error|missing): /, "")}</span>}
                </li>
              ))}
            </ul>
          )}
          {diag && typeof diag === "object" && <p class="muted">Server version {diag.version.slice(0, 7)}</p>}
          {diag === "failed" && <p class="notice">Couldn't reach The server.</p>}
          <button
            class="btn block"
            disabled={diag === "checking"}
            onClick={async () => {
              setDiag("checking");
              try {
                setDiag(await diagnostics());
              } catch {
                setDiag("failed");
              }
            }}
          >
            {diag === "checking" ? "Checking…" : "Run server check"}
          </button>
        </section>

        {msg && <p class="notice" role="status">{msg}</p>}
        <div class="logo-foot">
          <Logo size={90} />
          <b class="foot-word">Library</b>
          <p>Department of Already Owning It</p>
        </div>
      </div>
    </div>
  );
}
