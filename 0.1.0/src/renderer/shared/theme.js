// Applies { dark, palette, reduceMotion } from the main process to <html>.
export async function bindTheme(onChange) {
  const apply = (t) => {
    const root = document.documentElement;
    root.dataset.theme = t.dark ? "dark" : "light";
    root.dataset.palette = t.palette;
    root.dataset.bar = t.barStyle || "glass";
    root.dataset.font = t.font || "haze";
    root.dataset.glass = t.glassStyle || "frost";
    root.toggleAttribute("data-reduce-motion", Boolean(t.reduceMotion));
    if (onChange) onChange(t);
  };
  apply(await window.cozy.getTheme());
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
