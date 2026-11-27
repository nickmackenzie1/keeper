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

// New versions download in the background, but never reload the page while you're using it
// (that used to throw you out of the add screen mid-way). The switch happens the next time
// the app goes into the background, so you come back to the new version where you left off.
let updateReady = false;
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateReady = true;
    if (document.visibilityState === "hidden") void updateSW(true);
  },
});
document.addEventListener("visibilitychange", () => {
  if (updateReady && document.visibilityState === "hidden") void updateSW(true);
});

render(<App />, document.getElementById("app")!);
