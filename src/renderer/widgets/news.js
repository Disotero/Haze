// News (RSS/Atom via Google News sections and searches) — its own module
// after the family split of feedwidgets.js (A3). The phone widget stays with
// the match/market feeds; both share the poller.
import { h, $, esc, relTime } from "./dom.js";
import { icons } from "./icons.js";
import { poller } from "./feedwidgets.js";

const NEWS_SOURCES = {
  rbc: "РБК",
  lenta: "Lenta",
  bbc: "BBC",
  ixbt: "iXBT",
  habr: "Хабр",
  stopgame: "StopGame",
  verge: "The Verge",
};

/** Items out of an RSS or Atom document. */
function parseFeed(xml) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const text = (el, sel) => el.querySelector(sel)?.textContent.trim() || "";
  const items = [...doc.querySelectorAll("item")].map((it) => ({
    title: text(it, "title"),
    link: text(it, "link") || it.querySelector("guid")?.textContent.trim() || "",
    date: text(it, "pubDate") || text(it, "date"),
    image: it.querySelector("enclosure[type^=image]")?.getAttribute("url") || it.getElementsByTagNameNS("*", "content")[0]?.getAttribute("url") || "",
  }));
  if (items.length) return items;
  // Atom
  return [...doc.querySelectorAll("entry")].map((e) => ({
    title: text(e, "title"),
    link: e.querySelector("link[rel=alternate], link")?.getAttribute("href") || "",
    date: text(e, "updated") || text(e, "published"),
    image: "",
  }));
}

// Topics: Google News sections, plus two made from searches.
const NEWS_TOPICS = {
  WORLD: ["Мир", "topic", "WORLD"],
  NATION: ["Россия", "topic", "NATION"],
  BUSINESS: ["Экономика", "topic", "BUSINESS"],
  TECHNOLOGY: ["Технологии", "topic", "TECHNOLOGY"],
  SCIENCE: ["Наука", "topic", "SCIENCE"],
  games: ["Игры", "search", "видеоигры OR PlayStation OR Xbox OR Steam OR Nintendo"],
  SPORTS: ["Спорт", "topic", "SPORTS"],
  ENTERTAINMENT: ["Кино и шоу", "topic", "ENTERTAINMENT"],
  HEALTH: ["Здоровье", "topic", "HEALTH"],
  auto: ["Авто", "search", "автомобили OR автопром"],
};

/** "Заголовок - Издание" (Google News) → [title, outlet]. */
function splitOutlet(title) {
  const i = title.lastIndexOf(" - ");
  return i > 20 ? [title.slice(0, i), title.slice(i + 3)] : [title, ""];
}

export function newsWidget(ctx) {
  const el = h(`
    <div class="widget w-news feed">
      <div class="glass">
        <div class="feed-head"><div class="w-title">Новости</div>
          <button class="icon-btn sm filter" title="Скрывать новости со словами">${icons.filter}</button></div>
        <div class="seg modes"><button data-m="topics">Темы</button><button data-m="search">Поиск</button><button data-m="source">Издания</button></div>
        <button class="news-fold"></button>
        <div class="news-pick"></div>
        <div class="news-block" hidden>
          <input type="text" placeholder="Скрывать со словами: через запятую, Enter" />
        </div>
        <div class="feed-list news-list"></div>
        <div class="feed-foot muted"></div>
      </div>
    </div>`);
  let items = [];
  let error = "";
  const cfg = () => ctx.s.news;
  const saveCfg = (patch) => ctx.save({ news: { ...cfg(), ...patch } });

  /** The feeds the current choice needs. */
  function requests() {
    const c = cfg();
    if (c.mode === "search") return c.queries.map((q) => ({ kind: "search", value: q }));
    if (c.mode === "source") return [{ kind: "source", value: ctx.s.newsSource }];
    return c.topics.filter((t) => NEWS_TOPICS[t]).map((t) => ({ kind: NEWS_TOPICS[t][1], value: NEWS_TOPICS[t][2] }));
  }

  // The picker folds into one line so the headlines get the room.
  let open = localStorage.getItem("news.pickOpen") === "1";
  function summary() {
    const c = cfg();
    if (c.mode === "topics") return c.topics.map((t) => NEWS_TOPICS[t]?.[0]).filter(Boolean).join(", ") || "темы не выбраны";
    if (c.mode === "search") return c.queries.join(", ") || "запросов нет";
    return NEWS_SOURCES[ctx.s.newsSource] || "РБК";
  }

  function paintPick() {
    const c = cfg();
    el.querySelectorAll(".modes button").forEach((b) => b.classList.toggle("on", b.dataset.m === c.mode));
    $(el, ".news-fold").innerHTML = `<span class="ellipsis">${esc(summary())}</span><b>${open ? "свернуть ▴" : "изменить ▾"}</b>`;
    const pick = $(el, ".news-pick");
    pick.hidden = !open;
    if (c.mode === "topics") {
      pick.innerHTML = `<div class="chips">${Object.entries(NEWS_TOPICS)
        .map(([id, [label]]) => `<button data-topic="${id}" class="${c.topics.includes(id) ? "on" : ""}">${label}</button>`)
        .join("")}</div>`;
    } else if (c.mode === "search") {
      pick.innerHTML = `<input type="text" class="q" placeholder="Что искать? Enter — добавить" />
        <div class="chips">${c.queries.map((q, i) => `<span class="chip">${esc(q)}<button data-drop="${i}" title="Убрать">×</button></span>`).join("")}</div>`;
    } else {
      pick.innerHTML = `<div class="chips">${Object.entries(NEWS_SOURCES)
        .map(([id, label]) => `<button data-source="${id}" class="${id === ctx.s.newsSource ? "on" : ""}">${label}</button>`)
        .join("")}</div>`;
    }
  }

  function paintList() {
    const c = cfg();
    const block = c.block
      .split(",")
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);
    const shown = items.filter((n) => !block.some((w) => n.title.toLowerCase().includes(w)));
    $(el, ".filter").classList.toggle("on", block.length > 0);
    $(el, ".feed-foot").textContent = block.length ? `скрыто: ${items.length - shown.length} · обновление раз в 10 минут` : "обновление раз в 10 минут";
    $(el, ".news-list").innerHTML = error
      ? `<div class="muted empty">Не удалось загрузить: ${esc(error)}</div>`
      : !requests().length
        ? `<div class="muted empty">${c.mode === "search" ? "Добавь запрос — например «SpaceX» или «видеокарты»" : "Выбери хотя бы одну тему"}</div>`
        : shown.length
          ? shown
              .slice(0, 15)
              .map(
                (n) => `<button class="news" data-link="${esc(n.link)}">
                  <span class="grow"><span class="n-title">${esc(n.title)}</span><small class="muted">${esc([n.outlet, n.date ? relTime(n.date) : ""].filter(Boolean).join(" · "))}</small></span>
                </button>`
              )
              .join("")
          : `<div class="muted empty">${items.length ? "Всё скрыто фильтром" : "Загружаю…"}</div>`;
  }

  async function load() {
    const reqs = requests();
    if (!reqs.length) {
      items = [];
      return paintList();
    }
    try {
      const lists = await Promise.all(reqs.map((r) => window.cozy.feed("news", r).then((d) => parseFeed(d.xml)).catch(() => [])));
      // Merge, drop repeats (same story from two feeds), newest first.
      const seen = new Set();
      items = lists
        .flat()
        .map((n) => {
          const [title, outlet] = splitOutlet(n.title);
          return { ...n, title, outlet };
        })
        .filter((n) => {
          const key = n.title.toLowerCase().slice(0, 60);
          if (!n.title || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
      error = items.length ? "" : "лента пустая";
    } catch (e) {
      error = e.message;
    }
    paintList();
  }
  const poll = poller(10 * 60e3, load);
  const reload = () => {
    items = [];
    error = "";
    paintList();
    poll.now();
  };

  $(el, ".news-fold").onclick = () => {
    open = !open;
    localStorage.setItem("news.pickOpen", open ? "1" : "0");
    paintPick();
  };
  $(el, ".modes").onclick = async (e) => {
    const b = e.target.closest("[data-m]");
    if (!b || b.dataset.m === cfg().mode) return;
    await saveCfg({ mode: b.dataset.m });
    paintPick();
    reload();
  };
  $(el, ".news-pick").addEventListener("click", async (e) => {
    const topic = e.target.closest("[data-topic]");
    const src = e.target.closest("[data-source]");
    const drop = e.target.closest("[data-drop]");
    if (topic) {
      const t = topic.dataset.topic;
      const topics = cfg().topics.includes(t) ? cfg().topics.filter((x) => x !== t) : [...cfg().topics, t];
      await saveCfg({ topics });
    } else if (src) await ctx.save({ newsSource: src.dataset.source });
    else if (drop) await saveCfg({ queries: cfg().queries.filter((_, i) => i !== Number(drop.dataset.drop)) });
    else return;
    paintPick();
    reload();
  });
  $(el, ".news-pick").addEventListener("keydown", async (e) => {
    if (e.key !== "Enter" || !e.target.matches(".q")) return;
    const q = e.target.value.trim();
    if (!q || cfg().queries.includes(q)) return;
    await saveCfg({ queries: [...cfg().queries, q] });
    paintPick();
    reload();
  });
  $(el, ".filter").onclick = () => {
    const row = $(el, ".news-block");
    row.hidden = !row.hidden;
    $(el, ".news-block input").value = cfg().block;
  };
  $(el, ".news-block input").addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    await saveCfg({ block: e.target.value });
    $(el, ".news-block").hidden = true;
    paintList();
  });
  $(el, ".news-list").onclick = (e) => {
    const b = e.target.closest("[data-link]");
    if (b?.dataset.link) window.cozy.openBrowser(b.dataset.link);
  };
  return {
    el,
    update(kind) {
      if (kind === "init") return paintPick(), paintList(), poll.now();
      if (kind === "tick") poll.tick();
    },
  };
}
