import { useEffect, useState } from "preact/hooks";
import { allCopies, allHunts, getMeta, myName, onChanged } from "../lib/db";
import { setPeople } from "./Person";
import { newlyUnlocked } from "../lib/achievements";
import { confetti, chime, toast } from "../lib/celebrate";
import { startLiveSync } from "../lib/live";
import { Add } from "./Add";
import { Check } from "./Check";
import { MovieDetail } from "./MovieDetail";
import { Settings } from "./Settings";
import { Setup } from "./Setup";
import { Shelf } from "./Shelf";
import { Hunt } from "./Hunt";
import { Stats } from "./Stats";
import { Tonight } from "./Tonight";
import { IconScan, IconSettings, IconShelf, IconStar, IconTarget } from "./icons";
import { useRoute } from "./util";

const TABS = [
  { id: "check", label: "Check", Icon: IconScan },
  { id: "shelf", label: "Shelf", Icon: IconShelf },
  { id: "hunt", label: "Hunt", Icon: IconTarget },
  { id: "stats", label: "Stats", Icon: IconStar },
  { id: "settings", label: "Settings", Icon: IconSettings },
] as const;

export function App() {
  const [ready, setReady] = useState<boolean | null>(null);
  const { path, query } = useRoute();

  useEffect(() => {
    getMeta("token").then((t) => setReady(!!t));
  }, []);
  useEffect(() => {
    if (!ready) return;
    startLiveSync();
    // Warm up the barcode scanner in the background so the first scan opens instantly.
    const warm = () => void import("./Scanner").then((m) => m.loadZxing()).catch(() => {});
    if ("requestIdleCallback" in window) (window as unknown as { requestIdleCallback: (f: () => void) => void }).requestIdleCallback(warm);
    else setTimeout(warm, 1500);
    // Celebrate newly unlocked achievements (from this phone or the other one).
    let t: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const fresh = await newlyUnlocked();
        if (fresh.length) {
          confetti();
          chime("jackpot");
          for (const a of fresh.slice(0, 3)) toast(`Achievement unlocked: ${a.title}`);
        }
      }, 1200);
    };
    check();
    return onChanged(check);
  }, [ready]);

  // Learn who's in the family (for badge colours) before drawing.
  const [peopleReady, setPeopleReady] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const load = async () => {
      const names: (string | null)[] = [await myName()];
      for (const c of await allCopies()) names.push(c.added_by);
      for (const h of await allHunts()) names.push(h.added_by, h.found_by);
      setPeople(names);
      setPeopleReady(true);
    };
    void load();
    return onChanged((src) => src === "remote" && void load());
  }, [ready]);

  if (ready === null || (ready && !peopleReady)) return null;
  if (!ready) return <Setup onDone={() => setReady(true)} />;

  const tab = path[0] ?? "check";
  let screen;
  if (tab === "movie" && path[1]) screen = <MovieDetail id={path[1]} />;
  else if (tab === "shelf") screen = <Shelf />;
  else if (tab === "add") screen = <Add key={query.toString()} query={query} />;
  else if (tab === "settings") screen = <Settings />;
  else if (tab === "hunt") screen = <Hunt />;
  else if (tab === "stats") screen = <Stats />;
  else if (tab === "tonight") screen = <Tonight />;
  else screen = <Check />;

  const active = tab === "movie" || tab === "add" || tab === "tonight" ? "shelf" : tab;
  return (
    <div class="app">
      <main key={path.join("/") || "check"} class="route">{screen}</main>
      <nav class="tabbar" aria-label="Main">
        {TABS.map(({ id, label, Icon }) => (
          <a key={id} href={`#/${id}`} class={active === id ? "on" : ""} aria-current={active === id ? "page" : undefined}>
            <Icon />
            <span>{label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
