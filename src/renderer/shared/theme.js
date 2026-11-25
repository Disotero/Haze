const FONT_FAMILIES = {
  haze: ["Nunito", "Quicksand"],
  manrope: ["Manrope"],
  comfortaa: ["Comfortaa"],
  rubik: ["Rubik"],
  montserrat: ["Montserrat"],
  mono: ["JetBrains Mono"],
  system: [],
};

/**
 * Webfonts load lazily (font-display: swap), so switching straight away draws
 * the fallback first and the real font a moment later: two layout jumps.
 * Load every weight we use (Latin and Cyrillic) before switching.
 */
function loadFont(font) {
  const families = FONT_FAMILIES[font] || [];
  const loads = families.flatMap((f) => [500, 600, 700, 800].map((w) => document.fonts.load(`${w} 16px "${f}"`, "Aa Яя 09")));
  const timeout = new Promise((r) => setTimeout(r, 1500));
  return Promise.race([Promise.allSettled(loads), timeout]);
}

// Applies { dark, palette, reduceMotion } from the main process to <html>.
export async function bindTheme(onChange) {
  let wantFont = null;
  const apply = (t) => {
    const root = document.documentElement;
    root.dataset.theme = t.dark ? "dark" : "light";
    root.dataset.palette = t.palette;
    root.dataset.bar = t.barStyle || "glass";
    const font = t.font || "haze";
    // First paint: set it at once (the window isn't visible yet anyway).
    if (wantFont === null) root.dataset.font = font;
    else if (font !== wantFont) loadFont(font).then(() => wantFont === font && (root.dataset.font = font));
    wantFont = font;
    root.dataset.glass = t.glassStyle || "frost";
    root.toggleAttribute("data-reduce-motion", Boolean(t.reduceMotion));
    if (onChange) onChange(t);
  };
  // A main process that doesn't answer must not leave the window blank:
  // start light, the next theme broadcast puts the real one in place.
  let first;
  try {
    first = await window.cozy.getTheme();
  } catch (e) {
    console.warn("[theme]", e?.message || e);
  }
  apply(first || { dark: false, palette: "sage", font: "haze" });
  window.cozy.onTheme(apply);
}

export function cssColor(name) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const m = v.match(/^#([0-9a-f]{6})$/i);
  if (!m) return [0.5, 0.5, 0.5];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function prefersReducedMotion() {
  return (
    document.documentElement.hasAttribute("data-reduce-motion") ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
