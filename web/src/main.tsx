import { render } from "preact";
import { registerSW } from "virtual:pwa-register";
import { App } from "./ui/App";
import { applySkin, DEFAULT_SKIN, type Skin } from "./ui/skins";
import { getMeta } from "./lib/db";
import "./styles.css";

// The skin is also applied pre-paint from localStorage in index.html; this keeps it in step with IndexedDB.
getMeta("theme").then((s) => {
  let local: string | null = null;
  try {
    local = localStorage.getItem("keeper-skin");
  } catch {
    /* private mode */
  }
  applySkin(((s as Skin | undefined) ?? (local as Skin | null) ?? DEFAULT_SKIN) as Skin);
});

// New versions install in the background and take over on next launch.
registerSW({ immediate: true });

render(<App />, document.getElementById("app")!);
