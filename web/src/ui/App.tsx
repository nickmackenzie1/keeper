import { useEffect, useState } from "preact/hooks";
import { getMeta, onChanged } from "../lib/db";
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
import { IconScan, IconSettings, IconShelf, IconStar, IconTarget } from "./icons";
import { useRoute } from "./util";

const TABS = [
  { id: "check", label: "Check", Icon: IconScan },
  { id: "shelf", label: "Collection", Icon: IconShelf },
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

  if (ready === null) return null;
  if (!ready) return <Setup onDone={() => setReady(true)} />;

  const tab = path[0] ?? "check";
  let screen;
  if (tab === "movie" && path[1]) screen = <MovieDetail id={path[1]} />;
  else if (tab === "shelf") screen = <Shelf />;
  else if (tab === "add") screen = <Add key={query.toString()} query={query} />;
  else if (tab === "settings") screen = <Settings />;
  else if (tab === "hunt") screen = <Hunt />;
  else if (tab === "stats") screen = <Stats />;
  else screen = <Check />;

  const active = tab === "movie" || tab === "add" ? "shelf" : tab;
  return (
    <div class="app">
      <main>{screen}</main>
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
