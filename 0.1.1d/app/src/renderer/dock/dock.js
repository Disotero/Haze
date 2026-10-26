import { bindTheme } from "../shared/theme.js";
import { icons } from "../widgets/icons.js";
import { esc } from "../widgets/dom.js";
import { safe, bootSettings } from "../shared/util.js";

const dock = document.getElementById("dock");
const apps = document.getElementById("apps");
const tip = document.getElementById("tip");
const windowsWord = (n) =>
  n % 10 === 1 && n % 100 !== 11 ? "окно" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "окна" : "окон";

let settings = await bootSettings();
let items = [];
let tray = [];
const MAG = 1.55; // icon scale right under the pointer
const RANGE = 130; // px over which magnification fades out
const edge = () => settings.dock.position || "bottom";
const vertical = () => ["left", "right"].includes(edge());

/** Which screen edge the dock hugs: the CSS lays everything out from it. */
function applyEdge() {
  if (document.body.dataset.edge === edge()) return;
  document.body.dataset.edge = edge();
  magnify(null);
  showTip(null);
  reportRect();
}

document.querySelector("#start .face").innerHTML = icons.grid;
document.getElementById("peek").innerHTML = icons.up;
document.getElementById("gear").innerHTML = icons.gear;
document.getElementById("peek").onclick = () => window.cozy.peekTaskbar();
document.getElementById("gear").onclick = () => window.cozy.openSettings();
document.getElementById("taskmgr").innerHTML = icons.activity;
document.getElementById("taskmgr").onclick = () => window.cozy.taskManager();

/** An icon <img>, or "" if `src` isn't a picture data URL (main only sends those). */
const iconImg = (src) => (/^data:image\//.test(src || "") ? `<img src="${esc(src)}" alt="" />` : "");

/** Tray apps running in the background (the Windows tray is hidden with the taskbar). */
function renderShelf() {
  const el = document.getElementById("shelf");
  el.hidden = !settings.dock.shelf;
  el.classList.toggle("fade", settings.dock.shelfFade);
  document.getElementById("shelfApps").innerHTML = tray
    .map(
      (t) => `<button class="s-app" data-exe="${esc(t.exe)}" data-name="${esc(t.name)}" data-sub="клик — открыть, правый клик — закрыть">
        ${iconImg(t.icon) || icons.app}</button>`
    )
    .join("");
  el.classList.toggle("empty", !tray.length);
}

function render() {
  // Reuse tiles by key so hover state and magnification don't flicker.
  const old = new Map([...apps.children].map((t) => [t.dataset.key, t]));
  const frag = document.createDocumentFragment();
  for (const it of items) {
    let t = old.get(it.key);
    if (!t) {
      t = document.createElement("button");
      t.className = "tile";
      t.dataset.key = it.key;
      t.innerHTML = `<span class="face"></span>`;
    }
    old.delete(it.key);
    const face = t.firstElementChild;
    const html = iconImg(it.icon) || icons.app;
    if (face.dataset.icon !== it.icon) {
      face.innerHTML = html;
      face.dataset.icon = it.icon || "";
    }
    t.classList.toggle("running", it.windows.length > 0);
    t.classList.toggle("active", it.active);
    t.dataset.name = it.name;
    t.dataset.sub = it.windows.length > 1 ? `${it.windows.length} ${windowsWord(it.windows.length)}` : it.windows[0]?.title || "";
    frag.appendChild(t);
  }
  apps.replaceChildren(frag);
  baseCenters = null;
  reportRect();
}

// Layout box, not the on-screen one: while hidden the dock is slid off-screen.
function reportRect() {
  requestAnimationFrame(() => {
    window.cozy.dockRect({ x: dock.offsetLeft, y: dock.offsetTop, width: dock.offsetWidth, height: dock.offsetHeight });
  });
}

// ── Magnification & tooltip ──

// Where each icon sits unmagnified, measured once per hover (and again after
// the tiles change), not on every mouse move: each measurement is a layout pass.
let baseCenters = null;

/** `pos`: the pointer along the dock (x, or y for a side dock). */
function magnify(pos) {
  const tiles = [...dock.querySelectorAll(".tile")];
  const on = settings.dock.magnify && !settings.lowPower && pos != null;
  if (pos == null) baseCenters = null;
  // Distances are measured to where each icon sits unmagnified. The live
  // boxes are mid-transition and pushed around by their neighbours, and
  // measuring those makes the sizes chase each other (the jitter).
  let base = baseCenters || [];
  if (on && (!baseCenters || baseCenters.length !== tiles.length)) {
    const v = vertical();
    const rects = tiles.map((t) => t.getBoundingClientRect());
    const size = parseFloat(getComputedStyle(dock).getPropertyValue("--size")) || 44;
    const extra = rects.map((r) => (v ? r.height : r.width) - size);
    const total = extra.reduce((a, b) => a + b, 0);
    let before = 0;
    base = rects.map((r, i) => {
      // The dock stays centred, so it grows by half the extra on each side.
      const c = (v ? r.top + r.height / 2 : r.left + r.width / 2) - before - extra[i] / 2 + total / 2;
      before += extra[i];
      return c;
    });
    baseCenters = base;
  }
  tiles.forEach((t, i) => {
    let s = 1;
    if (on) {
      const d = Math.abs(pos - base[i]);
      if (d < RANGE) s = 1 + (MAG - 1) * Math.cos(((d / RANGE) * Math.PI) / 2) ** 2;
    }
    t.style.setProperty("--s", s.toFixed(3));
  });
}

function showTip(t) {
  if (!t) return tip.classList.remove("on");
  const r = t.getBoundingClientRect();
  tip.innerHTML = esc(t.dataset.name || t.title) + (t.dataset.sub ? ` <small>· ${esc(t.dataset.sub)}</small>` : "");
  const e = edge();
  if (vertical()) {
    // Beside the icon, on the screen's side; vertically centred on it.
    const half = tip.offsetHeight / 2;
    tip.style.top = Math.max(half + 4, Math.min(innerHeight - half - 4, r.top + r.height / 2)) + "px";
    tip.style.left = (e === "left" ? r.right + 12 : r.left - 12 - tip.offsetWidth) + "px";
  } else {
    const half = tip.offsetWidth / 2;
    tip.style.left = Math.max(half + 6, Math.min(innerWidth - half - 6, r.left + r.width / 2)) + "px";
    tip.style.top = (e === "top" ? Math.min(innerHeight - 30, r.bottom + 8) : Math.max(4, r.top - 34)) + "px";
  }
  tip.classList.add("on");
}

let hit = false;
document.addEventListener("mousemove", (e) => {
  const over = Boolean(e.target.closest?.(".dock, .shelf"));
  if (over !== hit) {
    hit = over;
    window.cozy.dockHit(over);
  }
  const inDock = Boolean(e.target.closest?.(".dock"));
  magnify(inDock ? (vertical() ? e.clientY : e.clientX) : null);
  showTip(over ? e.target.closest(".tile[data-name], .s-app, .shelf-btn") : null);
});
document.addEventListener("mouseleave", () => {
  hit = false;
  window.cozy.dockHit(false);
  magnify(null);
  showTip(null);
});
// The dock window slid in or out: re-send whether the pointer is over it, so
// main re-arms mouse forwarding (Windows can drop it on show/hide).
window.cozy.onDockVisible(() => window.cozy.dockHit(hit));

// ── Actions ──

apps.addEventListener("click", (e) => {
  const t = e.target.closest(".tile");
  if (!t) return;
  if (!t.classList.contains("running")) {
    t.classList.remove("bounce");
    void t.offsetWidth;
    t.classList.add("bounce");
    // One hop only: the dock re-inserts its tiles every second, and that
    // would restart a lingering animation forever.
    t.addEventListener("animationend", () => t.classList.remove("bounce"), { once: true });
  }
  window.cozy.dockActivate(t.dataset.key);
});
apps.addEventListener("contextmenu", (e) => {
  const t = e.target.closest(".tile");
  if (t) window.cozy.dockMenu(t.dataset.key);
});
document.getElementById("start").onclick = () => window.cozy.dockStart();
document.getElementById("shelfApps").addEventListener("click", (e) => {
  const b = e.target.closest(".s-app");
  if (b) window.cozy.openTrayApp(b.dataset.exe);
});
// Right click: open, close (politely or by force), or the app's own tray menu.
document.getElementById("shelfApps").addEventListener("contextmenu", async (e) => {
  const b = e.target.closest(".s-app");
  if (!b) return;
  const exe = b.dataset.exe;
  const choice = await window.cozy.popupMenu([
    { id: "open", label: "Открыть" },
    { id: "tray", label: "Меню программы (трей Windows)" },
    { type: "separator" },
    { id: "close", label: "Закрыть программу" },
    { id: "kill", label: "Завершить принудительно" },
  ]);
  if (choice === "open") window.cozy.openTrayApp(exe);
  if (choice === "tray") window.cozy.peekTaskbar();
  if (choice === "close") window.cozy.closeTrayApp(exe, false);
  if (choice === "kill") window.cozy.closeTrayApp(exe, true);
});

await bindTheme();
({ items = [], tray = [] } = (await safe(window.cozy.getDockItems(), null)) || {});
render();
renderShelf();

window.cozy.onDockItems((next) => {
  ({ items, tray } = next);
  render();
  renderShelf();
});
window.cozy.onDockVisible(({ visible: v, covered }) => {
  document.body.classList.toggle("shown", v);
  // Fullscreen apps get the whole screen: the shelf hides too.
  document.body.classList.toggle("covered", covered);
  if (!v) {
    magnify(null);
    showTip(null);
  }
});
window.cozy.onSettings((s) => {
  settings = s;
  applyEdge();
  renderShelf();
});
applyEdge();
new ResizeObserver(reportRect).observe(dock);
