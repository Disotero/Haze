// Info widgets fed by the main process (see main/feeds.js): esports matches
// from Liquipedia, stock/crypto quotes, sports scores and the phone.
import { h, $, esc, pad, relTime, sparkline, plural } from "./dom.js";
import { icons } from "./icons.js";

function timeLabel(ts) {
  const d = new Date(ts);
  const now = new Date();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return `сегодня ${hm}`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `завтра ${hm}`;
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${hm}`;
}

/**
 * Re-fetch every `ms` while mounted; returns { tick, now }. One fetch at a
 * time: a slow one can't overlap the next tick (or a click on "refresh")
 * and then paint its older data over newer.
 */
function poller(ms, fn) {
  let last = 0;
  let busy = false;
  const run = () => {
    if (busy) return;
    busy = true;
    last = Date.now();
    Promise.resolve()
      .then(fn)
      .catch((e) => console.warn("[feed]", e))
      .finally(() => (busy = false));
  };
  return {
    tick() {
      if (Date.now() - last >= ms) run();
    },
    now: run,
  };
}

/** A team: name, and its logo once main has it (see fillImages). */
function team(t) {
  const logo = t?.logo ? `<img data-src="${esc(t.logo)}" alt="" hidden />` : "";
  return `<span class="team">${logo}<span class="ellipsis">${esc(t?.name || "TBD")}</span></span>`;
}

/** Logos are fetched by main (known feed hosts only, cached on disk), never by this page. */
function fillImages(root) {
  for (const img of root.querySelectorAll("img[data-src]")) {
    const src = img.dataset.src;
    img.removeAttribute("data-src");
    window.cozy.feedImage(src).then((url) => {
      if (!url || !img.isConnected) return;
      img.src = url;
      img.hidden = false;
    }, () => {});
  }
}

// ── Esports (Liquipedia) ───────────────────────────────────────────────────

const GAMES = { dota2: "Dota 2", cs2: "CS2", valorant: "Valorant", lol: "LoL" };
const SITES = { dota2: "https://liquipedia.net/dota2/Liquipedia:Matches", cs2: "https://www.hltv.org/matches", valorant: "https://www.vlr.gg/matches", lol: "https://liquipedia.net/leagueoflegends/Liquipedia:Matches" };

/** Matches out of Liquipedia's "Liquipedia:Matches" page HTML. */
function parseLiquipedia(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const abs = (u) => (u && u.startsWith("/") ? "https://liquipedia.net" + u : u || "");
  const seen = new Set();
  const out = [];
  for (const m of doc.querySelectorAll(".match-info")) {
    const ts = Number(m.querySelector("[data-timestamp]")?.dataset.timestamp) * 1000;
    // Two ".match-info-header-opponent" blocks: left team, then right team.
    const [oa, ob] = m.querySelectorAll(".match-info-header-opponent");
    const side = (o) => ({
      name: o?.querySelector(".name")?.textContent.trim() || o?.textContent.trim() || "TBD",
      logo: abs(o?.querySelector("img")?.getAttribute("src")),
    });
    const a = side(oa);
    const b = side(ob);
    const scores = [...m.querySelectorAll(".match-info-header-scoreholder-score")].map((s) => s.textContent.trim());
    const t = m.querySelector(".match-info-tournament a, .match-info-tournament-name a, [class*=tournament] a");
    const key = `${ts}|${a.name}|${b.name}`;
    if (!ts || seen.has(key)) continue;
    seen.add(key);
    const finished = m.querySelector("[data-finished]")?.dataset.finished === "finished";
    out.push({ ts, a, b, scores, finished, event: t?.textContent.trim() || "", link: abs(t?.getAttribute("href")) });
  }
  return out.sort((x, y) => x.ts - y.ts);
}

export function esportsWidget(ctx) {
  const el = h(`
    <div class="widget w-esports feed">
      <div class="glass">
        <div class="feed-head">
          <div class="seg games">${Object.entries(GAMES).map(([k, n]) => `<button data-g="${k}">${n}</button>`).join("")}</div>
          <button class="icon-btn sm site" title="Открыть сайт">${icons.globe}</button>
        </div>
        <div class="seg tabs"><button data-t="next">Ближайшие</button><button data-t="live">Идут и итоги</button></div>
        <div class="feed-list"></div>
        <div class="feed-foot muted"></div>
      </div>
    </div>`);
  let tab = "next";
  let matches = [];
  let error = "";
  const game = () => ctx.s.esportsGame;

  function paint() {
    $(el, ".feed-foot").textContent = `Данные: ${game() === "cs2" ? "HLTV.org" : "Liquipedia"} · обновляется раз в 10 минут`;
    el.querySelectorAll(".games button").forEach((b) => b.classList.toggle("on", b.dataset.g === game()));
    el.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === tab));
    const now = Date.now();
    // HLTV says outright what's live; Liquipedia only gives start times.
    const isNext = (m) => !m.finished && !m.live && (m.ts > now || m.ts === 0);
    const list = tab === "next" ? matches.filter(isNext) : matches.filter((m) => !isNext(m)).sort((x, y) => (y.live - x.live) || y.ts - x.ts);
    $(el, ".feed-list").innerHTML = error
      ? `<div class="muted empty">Не удалось загрузить: ${esc(error)}</div>`
      : list.length
        ? list
            .slice(0, 8)
            .map((m) => {
              const live = m.live ?? (m.ts <= now && !m.finished);
              const played = live || m.finished || m.ts <= now;
              const mid = m.scores.length === 2 && played ? `${m.scores[0]} : ${m.scores[1]}` : "vs";
              const rounds = live && m.rounds ? ` <small class="rounds">${m.rounds[0]}–${m.rounds[1]}</small>` : "";
              return `<button class="match ${live ? "live" : ""}" data-link="${esc(m.link)}">
                <span class="when">${live ? "LIVE" : !m.ts ? "—" : tab === "next" ? relTime(m.ts) : timeLabel(m.ts)}</span>
                ${team(m.a)}<b class="score num">${mid}${rounds}</b>${team(m.b)}
                <small class="event ellipsis">${esc(m.event)}</small>
              </button>`;
            })
            .join("")
        : `<div class="muted empty">${matches.length ? "Здесь пока пусто" : "Загружаю…"}</div>`;
    fillImages($(el, ".feed-list"));
  }

  const poll = poller(10 * 60e3, async () => {
    try {
      const data = await window.cozy.feed("esports", { game: game() });
      matches = data.matches || parseLiquipedia(data.html);
      error = "";
    } catch (e) {
      error = e.message;
    }
    paint();
  });

  $(el, ".games").onclick = (e) => {
    const b = e.target.closest("[data-g]");
    if (!b || b.dataset.g === game()) return;
    matches = [];
    ctx.save({ esportsGame: b.dataset.g }).then(() => poll.now());
    paint();
  };
  $(el, ".tabs").onclick = (e) => {
    const b = e.target.closest("[data-t]");
    if (b) (tab = b.dataset.t), paint();
  };
  $(el, ".site").onclick = () => window.cozy.openBrowser(SITES[game()]);
  $(el, ".feed-list").onclick = (e) => {
    const b = e.target.closest("[data-link]");
    if (b?.dataset.link) window.cozy.openBrowser(b.dataset.link);
  };
  return {
    el,
    update(kind) {
      if (kind === "init") return paint(), poll.now();
      if (kind === "tick") poll.tick();
    },
  };
}

// ── Stocks / watchlist ─────────────────────────────────────────────────────

const CURRENCY = { USD: "$", EUR: "€", RUB: "₽", GBP: "£", JPY: "¥" };

export function stocksWidget(ctx) {
  const el = h(`
    <div class="widget w-stocks feed">
      <div class="glass">
        <div class="feed-head"><div class="w-title">Акции и крипта</div><button class="icon-btn sm edit" title="Изменить список">${icons.gear}</button></div>
        <div class="edit-row" hidden>
          <input type="text" placeholder="AAPL, BTC-USD, MOEX:SBER" />
          <small class="muted">Тикеры Yahoo Finance (AAPL, ^GSPC, BTC-USD, EURUSD=X) или Мосбиржи: MOEX:SBER. Enter — сохранить</small>
        </div>
        <div class="feed-list"></div>
      </div>
    </div>`);
  let rows = [];
  const input = $(el, "input");
  function paint() {
    $(el, ".feed-list").innerHTML = rows.length
      ? rows
          .map((r) => {
            if (r.error) return `<div class="quote"><b>${esc(r.symbol)}</b><span class="muted grow">${esc(r.error)}</span></div>`;
            if (typeof r.price !== "number" || !Number.isFinite(r.price)) {
              return `<div class="quote"><b>${esc(r.symbol)}</b><span class="muted grow">нет цены</span></div>`;
            }
            const ch = Number.isFinite(r.prev) && r.prev ? ((r.price - r.prev) / r.prev) * 100 : 0;
            const up = ch >= 0;
            const cur = CURRENCY[r.currency] || "";
            const price = r.price >= 1000 ? r.price.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) : r.price.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
            return `<div class="quote ${up ? "up" : "down"}">
              <b class="sym">${esc(String(r.symbol || "").replace(/^MOEX:/, ""))}</b>
              <span class="g">${sparkline(r.spark, 80, 24, up ? "var(--accent)" : "var(--accent-2)")}</span>
              <span class="p num">${price}${cur}</span>
              <span class="ch num">${up ? "+" : ""}${ch.toFixed(2)}%</span>
            </div>`;
          })
          .join("")
      : `<div class="muted empty">${loaded ? "Список пуст — добавьте тикеры (✎)" : "Загружаю…"}</div>`;
  }
  let loaded = false;
  const poll = poller(60e3, async () => {
    try {
      rows = await window.cozy.feed("stocks", { symbols: ctx.s.stocks });
      loaded = true;
    } catch (e) {
      rows = [{ symbol: "", error: e.message }];
    }
    paint();
  });
  $(el, ".edit").onclick = () => {
    const row = $(el, ".edit-row");
    row.hidden = !row.hidden;
    input.value = ctx.s.stocks;
  };
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    $(el, ".edit-row").hidden = true;
    rows = [];
    paint();
    ctx.save({ stocks: input.value.trim() }).then(() => poll.now());
  });
  return {
    el,
    update(kind) {
      if (kind === "init") return paint(), poll.now();
      if (kind === "tick") poll.tick();
    },
  };
}

// ── Sports scores (ESPN) ───────────────────────────────────────────────────

const LEAGUES = {
  "soccer/eng.1": "АПЛ",
  "soccer/esp.1": "Ла Лига",
  "soccer/uefa.champions": "ЛЧ",
  "soccer/rus.1": "РПЛ",
  "basketball/nba": "НБА",
  "hockey/nhl": "НХЛ",
};

export function sportsWidget(ctx) {
  const el = h(`
    <div class="widget w-sports feed">
      <div class="glass">
        <div class="seg leagues">${Object.entries(LEAGUES).map(([k, n]) => `<button data-l="${k}">${n}</button>`).join("")}</div>
        <div class="feed-list"></div>
      </div>
    </div>`);
  let data = null;
  let error = "";
  function paint() {
    el.querySelectorAll(".leagues button").forEach((b) => b.classList.toggle("on", b.dataset.l === ctx.s.sportsLeague));
    $(el, ".feed-list").innerHTML = error
      ? `<div class="muted empty">Не удалось загрузить: ${esc(error)}</div>`
      : !data
        ? `<div class="muted empty">Загружаю…</div>`
        : data.events.length
          ? data.events
              .map((e) => {
                const played = e.state !== "pre";
                return `<div class="match ${e.state === "in" ? "live" : ""}">
                  <span class="when">${e.state === "in" ? "LIVE" : e.state === "post" ? "итог" : timeLabel(e.date)}</span>
                  ${team(e.home)}<b class="score num">${played ? `${e.home.score} : ${e.away.score}` : "vs"}</b>${team(e.away)}
                  <small class="event">${esc(e.state === "in" ? e.detail : "")}</small>
                </div>`;
              })
              .join("")
          : `<div class="muted empty">На этой неделе матчей нет</div>`;
    fillImages($(el, ".feed-list"));
  }
  const poll = poller(60e3, async () => {
    try {
      data = await window.cozy.feed("sports", { league: ctx.s.sportsLeague });
      error = "";
    } catch (e) {
      error = e.message;
    }
    paint();
  });
  $(el, ".leagues").onclick = (e) => {
    const b = e.target.closest("[data-l]");
    if (!b) return;
    data = null;
    paint();
    ctx.save({ sportsLeague: b.dataset.l }).then(() => poll.now());
  };
  return {
    el,
    update(kind) {
      if (kind === "init") return paint(), poll.now();
      if (kind === "tick") poll.tick();
    },
  };
}

// ── Phone ──────────────────────────────────────────────────────────────────

export function phoneWidget() {
  const el = h(`
    <div class="widget w-phone feed">
      <div class="glass">
        <div class="feed-head"><div class="w-title">Телефон</div>
          <button class="pill sm link" title="Открыть «Связь с телефоном»">Связь с телефоном</button></div>
        <div class="phone-body"><div class="muted empty">Ищу устройства…</div></div>
      </div>
    </div>`);
  let data = null;
  function paint() {
    const body = $(el, ".phone-body");
    if (!data) return;
    const dev = data.devices?.[0];
    const bt = (data.bluetooth || [])
      .map(
        (b) =>
          `<div class="bt"><span class="ellipsis">${esc(String(b.name || "").replace(/ Hands-Free.*| Avrcp.*/i, ""))}</span><b class="num">${Number.isFinite(b.battery) ? b.battery + "%" : "?"}</b></div>`
      )
      .join("");
    if (!dev) {
      body.innerHTML =
        `<div class="muted empty">Телефон не подключён по USB.<br><small>Подключи кабелем и выбери «Передача файлов» — появятся фото и видео.</small></div>` +
        (bt ? `<div class="sub">Заряд по Bluetooth</div>${bt}` : "");
      return;
    }
    body.innerHTML = `
      <div class="dev"><b>${esc(dev.name)}</b><small class="muted">${esc((dev.storages || []).join(" · "))}</small></div>
      <div class="sub">Камера · ${dev.total || 0} ${plural(dev.total || 0, "файл", "файла", "файлов")}</div>
      <div class="recent">${(dev.recent || [])
        .map((f) => `<div class="file">${f.video ? "🎬" : "🖼"} <span class="ellipsis">${esc(f.name)}</span><small class="muted">${relTime(f.date)}</small></div>`)
        .join("")}</div>
      ${dev.camera ? `<button class="pill wide open-cam" data-p="${esc(dev.camera)}">${icons.folder}Открыть фото и видео</button>` : ""}
      ${bt ? `<div class="sub">Заряд по Bluetooth</div>${bt}` : ""}`;
  }
  const poll = poller(30e3, async () => {
    data = await window.cozy.feed("phone", {}).catch((e) => ({ devices: [], error: e.message }));
    paint();
  });
  $(el, ".link").onclick = () => window.cozy.openSystem("ms-phone:");
  el.addEventListener("click", (e) => {
    const b = e.target.closest(".open-cam");
    if (b) window.cozy.openPhoneFolder(b.dataset.p);
  });
  return {
    el,
    update(kind) {
      if (kind === "init") return poll.now();
      if (kind === "tick") poll.tick();
    },
  };
}

// ── News (RSS) ─────────────────────────────────────────────────────────────

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
