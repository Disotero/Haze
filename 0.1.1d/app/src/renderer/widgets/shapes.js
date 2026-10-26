// Material-style shapes as CSS clip-path polygons (in %, so they scale with
// the box): the scalloped "cookie", a softer flower and so on. Set once as
// custom properties on <html>; CSS uses var(--shape-cookie) etc.

function radial(r, steps = 180) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const k = r(a);
    pts.push(`${(50 + Math.cos(a) * 50 * k).toFixed(2)}% ${(50 + Math.sin(a) * 50 * k).toFixed(2)}%`);
  }
  return `polygon(${pts.join(",")})`;
}

// Triangle wave 0…1, for pointed shapes.
const tri = (x) => 1 - Math.abs(((x / Math.PI) % 2) - 1);

const SHAPES = {
  cookie: radial((a) => 0.92 + 0.08 * Math.cos(a * 9)),
  flower: radial((a) => 0.8 + 0.2 * Math.pow(Math.abs(Math.cos(a * 4)), 0.6)),
  burst: radial((a) => 0.74 + 0.26 * Math.pow(tri(a * 10 + Math.PI), 1.4), 240),
  clover: radial((a) => 0.62 + 0.38 * Math.pow(Math.abs(Math.cos(a * 2)), 0.45)),
};

export function installShapes() {
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(SHAPES)) root.setProperty(`--shape-${k}`, v);
}

/** Photo frame shapes, in the order the menus list them. */
export const PHOTO_SHAPES = {
  rounded: "Скруглённая",
  arch: "Арка",
  circle: "Круг",
  pill: "Капсула",
  cookie: "Печенька",
  flower: "Цветок",
  clover: "Клевер",
  burst: "Звезда",
};
