import { bindTheme } from "../shared/theme.js";
import { WallSource } from "../shared/wallsource.js";
import { safe, bootSettings } from "../shared/util.js";

const wall = new WallSource(document.getElementById("wall"), { scale: 1 });
const apply = (s) => {
  wall.setSound(s.wallpaperSound);
  // Weak PC: at most 15 fps, and the animation drawn at half size (it's soft anyway).
  wall.scale = s.lowPower ? 0.5 : 1;
  wall.set(s.wallpaper, s.lowPower ? Math.min(15, s.fpsLimit) : s.fpsLimit);
};

await bindTheme(() => wall.refreshColors());
apply(await bootSettings());
window.cozy.onSettings(apply);
wall.setPaused(await safe(window.cozy.isPaused(), false));
window.cozy.onPaused((p) => wall.setPaused(p));
