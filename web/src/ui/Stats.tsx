import { ScreenTitle } from "./Zone";
import { Skeleton } from "./Skeleton";
import { useEffect, useMemo, useState } from "preact/hooks";
import { fetchSeries } from "../lib/api";
import { computeAchievements, loadCollection, type CollectionData } from "../lib/achievements";
import { toast } from "../lib/celebrate";
import { addHunt, onChanged, setMeta } from "../lib/db";
import { FORMAT_LABEL, FORMAT_RANK, type Format, type Series } from "../lib/types";
import { Poster } from "./Poster";
import { SyncPill } from "./SyncPill";
import { Person } from "./Person";

function Bars({ rows, max }: { rows: { label: string; value: number; key?: string }[]; max?: number }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul class="bars">
      {rows.map((r) => (
        <li key={r.key ?? r.label}>
          <span class="bar-label">{r.label}</span>
          <span class="bar-track" aria-hidden="true">
            <span class="bar-fill" style={{ width: `${(r.value / top) * 100}%` }} />
          </span>
          <span class="bar-value">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function Stats() {
  const [data, setData] = useState<CollectionData>();
  const [seriesState, setSeriesState] = useState<"loading" | "ok" | "offline">("loading");

  useEffect(() => {
    const load = () => loadCollection().then(setData);
    load();
    const off = onChanged(load);
    // Refresh series info from the server when we can; otherwise use the cached copy.
    fetchSeries()
      .then(async (s) => {
        await setMeta("series", s);
        setSeriesState("ok");
        load();
      })
      .catch(() => setSeriesState("offline"));
    return off;
  }, []);

  const s = useMemo(() => {
    if (!data) return null;
    const ownedIds = new Set(data.copies.map((c) => c.movie_id));
    const owned = data.movies.filter((m) => ownedIds.has(m.id));

    const formats = (["dvd", "bluray", "uhd", "other"] as Format[])
      .map((f) => ({ label: FORMAT_LABEL[f], value: data.copies.filter((c) => c.format === f).length }))
      .filter((r) => r.value > 0 || r.label !== "Other");

    // Best format per movie → how much of the collection is Blu-ray or better.
    const best = new Map<string, number>();
    for (const c of data.copies) best.set(c.movie_id, Math.max(best.get(c.movie_id) ?? 0, FORMAT_RANK[c.format]));
    const hd = [...best.values()].filter((r) => r >= FORMAT_RANK.bluray).length;
    const hdPct = best.size ? Math.round((hd / best.size) * 100) : 0;
    const wantUpgrade = new Set(data.copies.filter((c) => c.upgrade_wanted).map((c) => c.movie_id)).size;

    const decadeMap = new Map<number, number>();
    for (const m of owned) if (m.year) decadeMap.set(Math.floor(m.year / 10) * 10, (decadeMap.get(Math.floor(m.year / 10) * 10) ?? 0) + 1);
    const decades = [...decadeMap.entries()].sort((a, b) => a[0] - b[0]).map(([d, v]) => ({ label: `${String(d).slice(2)}s`, key: String(d), value: v }));

    const genreMap = new Map<string, number>();
    for (const m of owned) for (const g of (m.genres ?? "").split(",").map((x) => x.trim()).filter(Boolean)) genreMap.set(g, (genreMap.get(g) ?? 0) + 1);
    const genres = [...genreMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }));
    const missingGenres = owned.filter((m) => !m.genres).length;

    // Finds per month (last 12 months), and the all-time biggest month.
    const monthMap = new Map<string, number>();
    for (const c of data.copies) {
      const t = c.created_at ?? c.updated_at;
      const d = new Date(t);
      const k = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
      monthMap.set(k, (monthMap.get(k) ?? 0) + 1);
    }
    const now = new Date();
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      const k = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
      return { label: MONTHS[d.getMonth()], key: k, value: monthMap.get(k) ?? 0 };
    });
    const biggest = [...monthMap.entries()].sort((a, b) => b[1] - a[1])[0];
    const biggestLabel = biggest ? `${MONTHS[Number(biggest[0].slice(5))]} ${biggest[0].slice(0, 4)} · ${biggest[1]} discs` : null;

    // Who's adding: discs added (all time + this month) and hunts found, per person.
    const people = new Map<string, { discs: number; month: number; found: number }>();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const bump = (name: string | null) => {
      if (!name) return null;
      if (!people.has(name)) people.set(name, { discs: 0, month: 0, found: 0 });
      return people.get(name)!;
    };
    for (const c of data.copies) {
      const p = bump(c.added_by);
      if (p) {
        p.discs++;
        if ((c.created_at ?? 0) >= monthStart) p.month++;
      }
    }
    for (const h of data.hunts) if (h.found) { const p = bump(h.found_by); if (p) p.found++; }
    const team = [...people.entries()].sort((a, b) => b[1].discs - a[1].discs);

    return { team, owned, formats, hdPct, hd, total: best.size, wantUpgrade, decades, genres, missingGenres, months, biggestLabel };
  }, [data]);

  const achievements = useMemo(() => (data ? computeAchievements(data) : []), [data]);
  const unlocked = achievements.filter((a) => a.unlocked).length;
  const gaps: Series[] = (data?.series ?? []).filter((x) => x.owned < x.total);
  const huntIds = new Set((data?.hunts ?? []).filter((h) => !h.found).map((h) => h.tmdb_id));

  if (!data || !s) return <Skeleton />;

  return (
    <div class="screen">
      <header class="screen-head">
        <div class="row between">
          <ScreenTitle title="Stats" />
          <SyncPill />
        </div>
      </header>
      <div class="screen-body">
        <div class="stat-tiles">
          <div class="tile"><span class="tile-num">{s.owned.length}</span><span class="muted">movies</span></div>
          <div class="tile"><span class="tile-num">{data.copies.length}</span><span class="muted">discs</span></div>
          <div class="tile"><span class="tile-num">{unlocked}</span><span class="muted">badges</span></div>
        </div>

        {s.team.length > 0 && (
          <section class="card">
            <h3>Who's adding</h3>
            <ul class="team">
              {s.team.map(([name, t]) => (
                <li key={name}>
                  <Person name={name} size={32} />
                  <span class="stack grow">
                    <b>{name}</b>
                    <span class="muted">
                      {[`${t.discs} disc${t.discs === 1 ? "" : "s"}`, t.month ? `${t.month} this month` : null, t.found ? `${t.found} hunt${t.found === 1 ? "" : "s"} found` : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section class="card">
          <h3>Upgrade progress</h3>
          <div class="progress" role="progressbar" aria-valuenow={s.hdPct} aria-valuemin={0} aria-valuemax={100} aria-label="Movies on Blu-ray or better">
            <span style={{ width: `${s.hdPct}%` }} />
          </div>
          <p>
            <b>{s.hdPct}%</b> of your movies are on Blu-ray or better ({s.hd} of {s.total}).
            {s.wantUpgrade > 0 ? ` ${s.wantUpgrade} on the upgrade list.` : ""}
          </p>
        </section>

        <section class="card">
          <h3>By format</h3>
          <Bars rows={s.formats} />
        </section>

        <section class="card">
          <h3>Finds per month</h3>
          <div class="cols" aria-label="Discs added in each of the last 12 months">
            {s.months.map((m) => {
              const top = Math.max(1, ...s.months.map((x) => x.value));
              return (
                <div key={m.key} class="col">
                  <span class="col-val">{m.value || ""}</span>
                  <span class="col-bar" style={{ height: `${(m.value / top) * 100}%` }} />
                  <span class="col-label">{m.label[0]}</span>
                </div>
              );
            })}
          </div>
          {s.biggestLabel && <p class="muted">Biggest month: <b>{s.biggestLabel}</b></p>}
        </section>

        {s.decades.length > 0 && (
          <section class="card">
            <h3>By decade</h3>
            <Bars rows={s.decades} />
          </section>
        )}

        <section class="card">
          <h3>Top genres</h3>
          {s.genres.length ? <Bars rows={s.genres} /> : <p class="muted">Genres fill in automatically from TMDB once the server has your key.</p>}
          {s.missingGenres > 0 && s.genres.length > 0 && <p class="muted">{s.missingGenres} movies still waiting for genre info.</p>}
        </section>

        <section class="card">
          <div class="row between">
            <h3>Series gaps</h3>
            {seriesState === "offline" && <span class="muted">offline copy</span>}
          </div>
          {seriesState === "loading" && gaps.length === 0 && <p class="muted">Checking your series…</p>}
          {seriesState !== "loading" && gaps.length === 0 && (
            <p class="muted">{data.series.length ? "Every series you own is complete. Nice." : "No series found yet — they fill in from TMDB."}</p>
          )}
          <ul class="series">
            {gaps.map((x) => {
              const have = x.parts.filter((p) => p.owned).map((p) => p.title);
              const missing = x.parts.filter((p) => !p.owned);
              return (
                <li key={x.collection_id}>
                  <div class="row between">
                    <b>{x.name.replace(/ Collection$/, "")}</b>
                    <span class="muted">{x.owned} of {x.total}</span>
                  </div>
                  <p class="muted">
                    You own {have.join(", ")} — missing {missing.map((p) => p.title).join(", ")}.
                  </p>
                  <div class="series-missing">
                    {missing.map((p) => (
                      <div key={p.tmdb_id} class="series-part">
                        <Poster movie={p} size="w185" />
                        <button
                          class="btn small"
                          disabled={huntIds.has(p.tmdb_id)}
                          onClick={async () => {
                            await addHunt(p);
                            toast(`Hunting for ${p.title}`);
                          }}
                        >
                          {huntIds.has(p.tmdb_id) ? "Hunting" : "Hunt it"}
                        </button>
                      </div>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section class="card">
          <h3>Achievements · {unlocked}/{achievements.length}</h3>
          <ul class="badges">
            {achievements
              .slice()
              .sort((a, b) => Number(b.unlocked) - Number(a.unlocked))
              .map((a) => (
                <li key={a.id} class={`badge ${a.unlocked ? "on" : ""}`}>
                  <span class="badge-icon" aria-hidden="true">{a.unlocked ? "★" : "☆"}</span>
                  <span class="stack">
                    <b>{a.title}</b>
                    <span class="muted">{a.desc}</span>
                    {!a.unlocked && a.progress && (
                      <span class="badge-progress">
                        <span style={{ width: `${(a.progress.have / a.progress.need) * 100}%` }} />
                      </span>
                    )}
                  </span>
                  {!a.unlocked && a.progress && <span class="muted">{a.progress.have}/{a.progress.need}</span>}
                </li>
              ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
