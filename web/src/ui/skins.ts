export type Skin = "rewind" | "midnight" | "catalog" | "latefee";

export const SKINS: { id: Skin; name: string; blurb: string; bg: string; fg: string; accent: string; themeColor: string }[] = [
  { id: "catalog", name: "Catalog", blurb: "Clean and light", bg: "#F6F7F9", fg: "#111827", accent: "#2563EB", themeColor: "#F6F7F9" },
  { id: "midnight", name: "Midnight", blurb: "Dark, poster-first", bg: "#0D0E12", fg: "#F1F2F5", accent: "#F5B841", themeColor: "#0D0E12" },
  { id: "rewind", name: "Rewind", blurb: "90s video store", bg: "#FFFFFF", fg: "#111111", accent: "#FF6A2B", themeColor: "#FFFFFF" },
  { id: "latefee", name: "Late Fee", blurb: "Friday night rental", bg: "#2A0E3A", fg: "#FFF1FA", accent: "#FF4FA3", themeColor: "#2A0E3A" },
];

export function applySkin(id: Skin) {
  const skin = SKINS.find((s) => s.id === id) ?? SKINS[0];
  document.documentElement.dataset.skin = skin.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", skin.themeColor);
  try {
    localStorage.setItem("keeper-skin", skin.id); // read before first paint in index.html
  } catch {
    /* private mode */
  }
}
