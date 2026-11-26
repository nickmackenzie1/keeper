import { useEffect, useState } from "preact/hooks";
import { getMeta } from "../lib/db";
import { startLiveSync } from "../lib/live";
import { Add } from "./Add";
import { Check } from "./Check";
import { MovieDetail } from "./MovieDetail";
import { Settings } from "./Settings";
import { Setup } from "./Setup";
import { Shelf } from "./Shelf";
import { IconPlus, IconScan, IconSettings, IconShelf } from "./icons";
import { useRoute } from "./util";

const TABS = [
  { id: "check", label: "Check", Icon: IconScan },
  { id: "shelf", label: "Collection", Icon: IconShelf },
  { id: "add", label: "Add", Icon: IconPlus },
  { id: "settings", label: "Settings", Icon: IconSettings },
] as const;

export function App() {
  const [ready, setReady] = useState<boolean | null>(null);
  const { path, query } = useRoute();

  useEffect(() => {
    getMeta("token").then((t) => setReady(!!t));
  }, []);
  useEffect(() => {
    if (ready) startLiveSync();
  }, [ready]);

  if (ready === null) return null;
  if (!ready) return <Setup onDone={() => setReady(true)} />;

  const tab = path[0] ?? "check";
  let screen;
  if (tab === "movie" && path[1]) screen = <MovieDetail id={path[1]} />;
  else if (tab === "shelf") screen = <Shelf />;
  else if (tab === "add") screen = <Add key={query.toString()} query={query} />;
  else if (tab === "settings") screen = <Settings />;
  else screen = <Check />;

  const active = tab === "movie" ? "shelf" : tab;
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
