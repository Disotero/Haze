// Launcher widget: a grid of programs and websites. There can be any number
// of them (ids "apps-…", data in settings.launchers[id]). Programs start
// normally; websites open in the Cozy browser shell.
import { h, $, esc } from "./dom.js";
import { icons } from "./icons.js";

/** A site's icon, fetched once by main and kept on disk (no per-paint lookups). */
const favicon = async (url) => {
  try {
    return await window.cozy.favicon(new URL(url).hostname);
  } catch {
    return "";
  }
};

export function launcherWidget(ctx, id) {
  const el = h(`
    <div class="widget w-launcher">
      <div class="glass">
        <div class="l-title"></div>
        <div class="l-grid"></div>
        <div class="l-url" hidden>
          <input type="text" placeholder="Адрес сайта, например youtube.com" />
        </div>
      </div>
    </div>`);
  const data = () => ctx.s.launchers[id] || { title: "", cols: 4, apps: [] };
  const saveData = (patch) => ctx.save({ launchers: { ...ctx.s.launchers, [id]: { ...data(), ...patch } } });
  const icons_ = new Map();

  async function iconOf(app) {
    const key = app.url || app.path;
    if (!icons_.has(key)) icons_.set(key, await (app.url ? favicon(app.url) : window.cozy.appIcon(app.path).catch(() => "")));
    return icons_.get(key);
  }

  async function paint() {
    const d = data();
    el.style.setProperty("--cols", d.cols || 4);
    $(el, ".l-title").textContent = d.title || "";
    $(el, ".l-title").hidden = !d.title;
    const tiles = await Promise.all(
      (d.apps || []).map(async (a, i) => {
        const src = await iconOf(a);
        return `<button class="l-app" data-i="${i}" title="${esc(a.url || a.path)}">
          <span class="l-icon">${src ? `<img src="${esc(src)}" alt="" />` : a.url ? icons.globe : icons.app}</span>
          <span class="l-name ellipsis">${esc(a.name)}</span>
        </button>`;
      })
    );
    $(el, ".l-grid").innerHTML =
      tiles.join("") +
      `<button class="l-app l-add" title="Добавить программу или сайт"><span class="l-icon">${icons.plus}</span><span class="l-name">Добавить</span></button>`;
  }

  function addApp(app) {
    const d = data();
    if (d.apps.some((a) => (a.path && a.path === app.path) || (a.url && a.url === app.url))) return;
    saveData({ apps: [...d.apps, app] });
  }

  const urlInput = $(el, ".l-url input");
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") $(el, ".l-url").hidden = true;
    if (e.key !== "Enter" || !urlInput.value.trim()) return;
    let url = urlInput.value.trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    let name;
    try {
      name = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return;
    }
    addApp({ url, name: name.charAt(0).toUpperCase() + name.slice(1) });
    urlInput.value = "";
    $(el, ".l-url").hidden = true;
  });

  async function addMenu() {
    const choice = await window.cozy.popupMenu([
      { id: "app", label: "Программу…" },
      { id: "url", label: "Сайт (откроется в оболочке Haze)…" },
    ]);
    if (choice === "app") {
      const p = await window.cozy.pickFile("app");
      if (p) addApp({ path: p, name: p.split(/[\\/]/).pop().replace(/\.(exe|lnk)$/i, "") });
    } else if (choice === "url") {
      $(el, ".l-url").hidden = false;
      window.cozy.focusWidgets();
      setTimeout(() => urlInput.focus(), 80);
    }
  }

  $(el, ".l-grid").addEventListener("click", (e) => {
    const t = e.target.closest(".l-app");
    if (!t) return;
    if (t.classList.contains("l-add")) return addMenu();
    const i = Number(t.dataset.i);
    if (!data().apps[i]) return;
    if (!t.classList.contains("open") && !t.classList.contains("min")) {
      t.classList.remove("bounce");
      void t.offsetWidth;
      t.classList.add("bounce");
      t.addEventListener("animationend", () => t.classList.remove("bounce"), { once: true });
    }
    window.cozy.launcherActivate(id, i);
  });

  el.addEventListener("contextmenu", async (e) => {
    e.preventDefault();
    const t = e.target.closest(".l-app:not(.l-add)");
    const d = data();
    if (t) {
      const i = Number(t.dataset.i);
      const a = d.apps[i];
      const running = t.classList.contains("open") || t.classList.contains("min");
      const choice = await window.cozy.popupMenu([
        { id: "open", label: running ? "Показать окно" : "Открыть" },
        ...(a.path ? [{ id: "reveal", label: "Показать в папке" }] : [{ id: "external", label: "Открыть в обычном браузере" }]),
        { id: "left", label: "Сдвинуть левее" },
        { type: "separator" },
        { id: "remove", label: running ? "Закрыть и убрать из панели" : "Убрать из панели" },
      ]);
      if (choice === "open") window.cozy.launcherActivate(id, i);
      if (choice === "reveal") window.cozy.revealApp(a.path);
      if (choice === "external") window.cozy.openExternal(a.url);
      // Removing also closes whatever this entry has open.
      if (choice === "remove") window.cozy.launcherRemove(id, i);
      if (choice === "left" && i > 0) {
        const apps = [...d.apps];
        [apps[i - 1], apps[i]] = [apps[i], apps[i - 1]];
        saveData({ apps });
      }
      return;
    }
    const choice = await window.cozy.popupMenu([
      { id: "add", label: "Добавить программу или сайт…" },
      { type: "separator" },
      ...[3, 4, 5, 6, 8].map((n) => ({ id: "cols" + n, label: `${n} в ряд`, checked: (d.cols || 4) === n })),
      { type: "separator" },
      { id: "title", label: d.title ? "Убрать заголовок" : "Добавить заголовок «Приложения»" },
      { id: "delete", label: "Удалить эту панель" },
    ]);
    if (choice === "add") addMenu();
    if (choice?.startsWith("cols")) saveData({ cols: Number(choice.slice(4)) });
    if (choice === "title") saveData({ title: d.title ? "" : "Приложения" });
    if (choice === "delete") {
      const { [id]: _, ...rest } = ctx.s.launchers;
      ctx.save({ launchers: rest });
    }
  });

  // Drop .exe / .lnk files from Explorer to add them.
  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    el.classList.add("drop-over");
  });
  el.addEventListener("dragleave", () => el.classList.remove("drop-over"));
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    el.classList.remove("drop-over");
    for (const f of e.dataTransfer.files) {
      const p = window.cozy.pathForFile(f);
      if (/\.(exe|lnk)$/i.test(p)) addApp({ path: p, name: p.split(/[\\/]/).pop().replace(/\.(exe|lnk)$/i, "") });
    }
  });

  // Open / minimized marks on the tiles.
  let states = {};
  const paintStates = () =>
    el.querySelectorAll(".l-app[data-i]").forEach((t) => {
      const a = data().apps[Number(t.dataset.i)];
      const st = a && states[a.url || a.path];
      t.classList.toggle("open", st === "open");
      t.classList.toggle("min", st === "min");
    });
  const offStates = window.cozy.onLauncherStates((s) => {
    states = s;
    paintStates();
  });
  window.cozy.launcherStates();

  let lastJson = "";
  return {
    el,
    update(kind) {
      if (kind !== "init" && kind !== "settings") return;
      const json = JSON.stringify(data());
      if (json === lastJson) return;
      lastJson = json;
      paint().then(paintStates);
    },
    destroy: offStates,
  };
}
