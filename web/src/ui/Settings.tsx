import { Logo } from "./Logo";
import { clearLog, onLog, readLog, type LogLine } from "../lib/log";
import { ScreenTitle } from "./Zone";
import { Skeleton } from "./Skeleton";
import { useEffect, useState } from "preact/hooks";
import { api, diagnostics, listDevices } from "../lib/api";
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
                ["Records (Discogs)", diag.records ?? "missing: update the server"],
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
          {diag === "failed" && <p class="notice">Couldn't reach the server.</p>}
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

        <LogCard />

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

/** A light log of what the app has been doing on this phone, plus the server's recent problems. */
function LogCard() {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<LogLine[]>(readLog());
  const [server, setServer] = useState<{ t: number; text: string }[] | null>(null);
  useEffect(() => onLog(() => setLines(readLog())), []);
  const fmt = (t: number) => {
    const d = new Date(t);
    const today = d.toDateString() === new Date().toDateString();
    return d.toLocaleString("en-CA", today ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };
  const text = lines.map((l) => `${fmt(l.t)}  ${l.kind.toUpperCase()}  ${l.text}`).join("\n");
  return (
    <section class="card">
      <h3>Log</h3>
      <p class="muted">What this phone has been up to: syncs, scans, adds, updates and anything that went wrong.</p>
      <button class="btn block" aria-expanded={open} onClick={() => { setOpen(!open); if (!open) api<{ lines: { t: number; text: string }[] }>("/log").then((r) => setServer(r.lines)).catch(() => setServer(null)); }}>
        {open ? "Hide log" : `Show log (${lines.length})`}
      </button>
      {open && (
        <>
          <ol class="log-list">
            {lines.length === 0 && <li class="muted">Nothing yet.</li>}
            {lines.map((l, i) => (
              <li key={i} class={`log-${l.kind}`}>
                <span class="log-time">{fmt(l.t)}</span>
                <span class="log-kind">{l.kind}</span>
                <span class="log-text">{l.text}</span>
              </li>
            ))}
          </ol>
          {server && server.length > 0 && (
            <>
              <h4 class="log-head">Server · recent problems</h4>
              <ol class="log-list">
                {server.map((l, i) => (
                  <li key={i} class="log-error">
                    <span class="log-time">{fmt(l.t)}</span>
                    <span class="log-text">{l.text}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
          <div class="row">
            <button class="btn grow" onClick={() => void navigator.clipboard?.writeText(text)}>Copy</button>
            <button class="btn" onClick={() => clearLog()}>Clear</button>
          </div>
        </>
      )}
    </section>
  );
}
