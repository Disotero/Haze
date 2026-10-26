// The built-in widgets: profile, world clock, big clock, player, weather
// and system stats. Each factory returns { el, update?(kind), column }.
// They read the page's live state (settings, weather, stats…) straight from
// widgets.js: imported bindings always show the current value.
import { weatherUrl } from "../shared/weathersites.js";
import { icons, weatherGlyph } from "./icons.js";
import { MONTHS, MONTHS_SHORT, DAYS, DAYS_SHORT, pad, esc, $, h } from "./dom.js";
import { safe, cssUrl, imageUrl } from "../shared/util.js";
import { settings, weather, weatherError, profile, lastStats, openPanel } from "./widgets.js";

export function profileWidget() {
  const el = h(`
    <div class="widget w-profile">
      <div class="glass">
        <div class="banner"></div>
        <div class="body">
          <div class="row">
            <div class="avatar"></div>
            <div class="grow">
              <div class="name ellipsis"></div>
              <div class="uptime muted num"></div>
            </div>
          </div>
          <div class="status muted ellipsis"></div>
          <div class="row actions">
            <button class="pill" data-act="lock">${icons.lock}Блок</button>
            <button class="icon-btn" data-act="settings" title="Настройки">${icons.gear}</button>
            <button class="icon-btn" data-act="power" title="Питание">${icons.power}</button>
          </div>
        </div>
      </div>
    </div>`);
  const glass = $(el, ".glass");
  $(el, '[data-act="lock"]').onclick = () => window.cozy.lock();
  $(el, '[data-act="settings"]').onclick = () => window.cozy.openSettings();
  $(el, '[data-act="power"]').onclick = () => togglePowerMenu(glass);

  async function paint() {
    const p = settings.profile || {};
    const name = p.displayName || profile.user || "";
    $(el, ".name").textContent = `${name}@${String(profile.host || "").toLowerCase()}`;
    const av = $(el, ".avatar");
    const avatarUrl = p.avatarPath ? await safe(window.cozy.fileUrl(p.avatarPath), "") : profile.avatar;
    av.style.backgroundImage = cssUrl(avatarUrl);
    av.textContent = av.style.backgroundImage ? "" : name.slice(0, 1).toUpperCase();
    const banner = $(el, ".banner");
    const bannerUrl = p.bannerPath ? await safe(window.cozy.fileUrl(p.bannerPath), "") : "";
    banner.style.backgroundImage = cssUrl(bannerUrl);
  }

  function update(kind) {
    if (kind === "settings" || kind === "init") paint();
    if (kind === "stats" && lastStats) {
      const m = Math.floor(lastStats.uptimeSec / 60);
      const d = Math.floor(m / 1440);
      const hh = Math.floor((m % 1440) / 60);
      $(el, ".uptime").textContent =
        "в сети · " + (d ? `${d} д ${hh} ч` : hh ? `${hh} ч ${m % 60} мин` : `${m} мин`);
    }
    if (kind === "weather" || kind === "init") {
      $(el, ".status").textContent =
        weather && Number.isFinite(weather.temp) ? `☁ сегодня ${weather.desc}, ${weather.temp}°` : "☁ хорошего дня";
    }
  }
  return { el, update, column: "left" };
}

function togglePowerMenu(glass) {
  const existing = $(glass, ".power-menu");
  if (existing) return existing.remove();
  const items = [
    ["sleep", "Сон"],
    ["restart", "Перезагрузка"],
    ["shutdown", "Выключение"],
    ["signout", "Выйти из системы"],
  ];
  const menu = h(`<div class="power-menu">${items
    .map(([k, l]) => `<button data-k="${k}" data-label="${l}">${l}</button>`)
    .join("")}</div>`);
  // Two-step confirm: first click arms the action, second click runs it.
  menu.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.classList.contains("confirm")) {
      window.cozy.power(b.dataset.k);
      menu.remove();
      return;
    }
    menu.querySelectorAll("button").forEach((x) => {
      x.classList.remove("confirm");
      x.textContent = x.dataset.label;
    });
    b.classList.add("confirm");
    b.textContent = `${b.dataset.label} — точно?`;
  };
  glass.appendChild(menu);
  setTimeout(() => menu.isConnected && menu.remove(), 8000);
}

function tzOffset(tz, now) {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName")?.value;
  return (part || "GMT").replace("GMT", "UTC").replace(/^UTC$/, "UTC+0");
}

export function worldWidget() {
  const el = h(`
    <div class="widget w-world">
      <div class="glass">
        <div class="row label"><span class="pin" style="width:14px;height:14px;display:inline-flex">${icons.pin}</span><span class="city grow ellipsis"></span></div>
        <div class="big num"></div>
        <div class="date muted"></div>
        <div class="zones"></div>
      </div>
    </div>`);
  function update(kind) {
    if (kind !== "tick" && kind !== "init" && kind !== "settings" && kind !== "weather") return;
    const now = new Date();
    $(el, ".city").textContent = settings.weather.city || "Локальное время";
    $(el, ".big").textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    $(el, ".date").textContent = `${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
    const fmt = (tz) =>
      new Intl.DateTimeFormat("ru-RU", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(now);
    $(el, ".zones").innerHTML = settings.worldClocks
      .slice(0, 4)
      .map((z) => {
        try {
          return `<div class="zone"><div class="top"><span class="ellipsis">${esc(z.name)}</span><span class="off">${tzOffset(z.tz, now)}</span></div><div class="t num">${fmt(z.tz)}</div></div>`;
        } catch {
          return `<div class="zone"><div class="top"><span>${esc(z.name)}</span></div><div class="t muted">?</div></div>`;
        }
      })
      .join("");
  }
  return { el, update, column: "left" };
}

export function bigClockWidget() {
  const el = h(`
    <div class="widget w-bigclock">
      <div class="digits"><div class="hh"></div><div class="mm"></div></div>
      <div class="glass tile"><div class="head"><b class="mon"></b> <span class="dow"></span></div><div class="day"></div></div>
    </div>`);
  const tile = $(el, ".tile");
  tile.title = "Календарь, будильники, таймер выключения";
  tile.addEventListener("click", () => openPanel(el));
  function update(kind) {
    if (kind !== "tick" && kind !== "init") return;
    const now = new Date();
    $(el, ".hh").textContent = pad(now.getHours());
    $(el, ".mm").textContent = pad(now.getMinutes());
    $(el, ".mon").textContent = MONTHS_SHORT[now.getMonth()];
    $(el, ".dow").textContent = DAYS_SHORT[now.getDay()];
    $(el, ".day").textContent = now.getDate();
  }
  return { el, update, column: "right" };
}

function fmtTime(ms) {
  if (!ms || ms < 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

function appName(id = "") {
  const known = { spotify: "Spotify", chrome: "Chrome", msedge: "Edge", firefox: "Firefox", yandex: "Яндекс", zune: "Медиаплеер", music: "Музыка", vlc: "VLC", telegram: "Telegram" };
  const low = id.toLowerCase();
  for (const [k, v] of Object.entries(known)) if (low.includes(k)) return v;
  return id.replace(/\.exe$/i, "").split(/[!\\.]/).pop() || "";
}

export function playerWidget() {
  const el = h(`
    <div class="widget w-player">
      <div class="glass">
        <div class="row">
          <div class="cover">${icons.note}</div>
          <div class="grow">
            <div class="title ellipsis"></div>
            <div class="artist muted ellipsis"></div>
            <div class="src muted ellipsis"></div>
          </div>
        </div>
        <div class="bar"><div class="fill"></div></div>
        <div class="times muted num"><span class="pos"></span><span class="dur"></span></div>
        <div class="controls">
          <button class="icon-btn" data-c="prev" title="Назад">${icons.prev}</button>
          <button class="icon-btn play" data-c="toggle" title="Пауза/воспроизведение"></button>
          <button class="icon-btn" data-c="next" title="Вперёд">${icons.next}</button>
        </div>
      </div>
    </div>`);
  let m = { active: false };
  let thumb = "";
  el.querySelectorAll("[data-c]").forEach((b) => {
    b.onclick = () => {
      window.cozy.mediaCommand(b.dataset.c);
      if (b.dataset.c === "toggle" && m.active) {
        m.playing = !m.playing;
        paint();
      }
    };
  });

  function position() {
    if (!m.active || !m.durationMs) return 0;
    let pos = m.positionMs;
    if (m.playing && m.updatedAt) pos += Date.now() - m.updatedAt;
    return Math.min(pos, m.durationMs);
  }

  function paint() {
    el.classList.toggle("playing", Boolean(m.active && m.playing));
    $(el, ".title").innerHTML = m.active
      ? `${esc(m.title || "Без названия")}<span class="eq"><i></i><i></i><i></i></span>`
      : "Ничего не играет";
    $(el, ".artist").textContent = m.active ? m.artist || "" : "включите музыку или видео";
    $(el, ".src").textContent = m.active ? appName(m.app) : "";
    $(el, ".play").innerHTML = m.active && m.playing ? icons.pause : icons.play;
    $(el, ".play").disabled = !m.active;
    $(el, '[data-c="prev"]').disabled = !m.active || !m.canPrev;
    $(el, '[data-c="next"]').disabled = !m.active || !m.canNext;
    const cover = $(el, ".cover");
    // The art comes from whatever app is playing: only real picture URLs.
    const art = m.active ? (m.thumb === undefined ? thumb : imageUrl(m.thumb)) : "";
    if (art !== thumb) {
      thumb = art;
      cover.style.backgroundImage = cssUrl(art);
      cover.classList.toggle("has-art", Boolean(art));
    }
    paintProgress();
  }

  function paintProgress() {
    const pos = position();
    const dur = m.active ? m.durationMs : 0;
    $(el, ".fill").style.width = dur ? `${(pos / dur) * 100}%` : "0%";
    $(el, ".pos").textContent = dur ? fmtTime(pos) : "";
    $(el, ".dur").textContent = dur ? fmtTime(dur) : "";
  }

  function update(kind, payload) {
    if (kind === "media") {
      m = payload || { active: false };
      paint();
    } else if (kind === "tick") paintProgress();
    else if (kind === "init") paint();
  }
  window.cozy.getMedia().then((s) => update("media", s));
  return { el, update, column: "right" };
}

export function weatherWidget() {
  const el = h(`
    <div class="widget w-weather">
      <div class="glass">
        <div class="row">
          <div class="grow">
            <div class="row" style="align-items:flex-end;gap:12px">
              <div class="temp num"></div>
              <div class="grow" style="padding-bottom:4px">
                <div class="desc ellipsis"></div>
                <div class="city muted ellipsis" style="font-size:12px"></div>
              </div>
            </div>
          </div>
          <div class="glyph"></div>
        </div>
        <div class="facts"></div>
      </div>
    </div>`);
  let retrying = false;
  $(el, ".glass").addEventListener("click", async () => {
    // No data and the last fetch failed: a click tries again.
    if (!weather && weatherError) {
      if (retrying) return;
      retrying = true;
      $(el, ".desc").textContent = "обновляю…";
      await safe(window.cozy.refreshWeather(), null);
      retrying = false;
      update("weather");
      return;
    }
    const url = weatherUrl(settings);
    if (url) window.cozy.openExternal(url);
  });

  // Open-Meteo leaves fields out at times: a dash, never "NaN" or a crash.
  const num = (v) => typeof v === "number" && Number.isFinite(v);
  const deg = (v) => (num(v) ? `${v}°` : "—");

  function update(kind) {
    if (kind !== "weather" && kind !== "init" && kind !== "settings") return;
    const linked = Boolean(weatherUrl(settings));
    const failed = !weather && Boolean(weatherError);
    el.classList.toggle("linked", linked || failed);
    el.classList.toggle("failed", failed);
    $(el, ".glass").title = failed ? `Повторить (${weatherError})` : linked ? "Открыть прогноз в браузере" : "";
    if (!weather) {
      $(el, ".temp").textContent = "—";
      $(el, ".desc").textContent = failed ? "погода недоступна — нажмите, чтобы повторить" : "загружаю погоду…";
      $(el, ".city").textContent = settings.weather?.city || "";
      $(el, ".glyph").innerHTML = "";
      $(el, ".facts").innerHTML = "";
      return;
    }
    $(el, ".temp").textContent = num(weather.temp) ? `${weather.temp}°C` : "—";
    $(el, ".desc").textContent = weather.desc || "—";
    $(el, ".city").textContent = `${weather.city || ""} · ощущается ${deg(weather.feels)}`;
    $(el, ".glyph").innerHTML = weatherGlyph(weather.kind, weather.isDay);
    $(el, ".facts").innerHTML = `
      <span>💧 <b>${num(weather.humidity) ? weather.humidity + "%" : "—"}</b></span>
      <span>💨 <b>${num(weather.wind) ? weather.wind.toFixed(1) + " м/с" : "—"}</b></span>
      <span>↑ <b>${deg(weather.max)}</b> ↓ <b>${deg(weather.min)}</b></span>
      <span>☀ <b>${esc(weather.sunrise || "—")}</b>–<b>${esc(weather.sunset || "—")}</b></span>`;
  }
  return { el, update, column: "right" };
}

function ringSvg(pct, color) {
  const r = 15.5;
  const c = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 36 36">
    <circle cx="18" cy="18" r="${r}" fill="none" stroke="var(--track)" stroke-width="3.6"/>
    <circle cx="18" cy="18" r="${r}" fill="none" stroke="${color}" stroke-width="3.6" stroke-linecap="round"
      stroke-dasharray="${(c * Math.max(0, Math.min(100, pct))) / 100} ${c}" transform="rotate(-90 18 18)"/>
  </svg>`;
}

export function statsWidget() {
  const el = h(`
    <div class="widget w-stats">
      <div class="glass" data-s="cpu"></div>
      <div class="glass" data-s="ram"></div>
      <div class="glass" data-s="third"></div>
    </div>`);
  const tile = (key, pct, value, label, color) => {
    $(el, `[data-s="${key}"]`).innerHTML =
      `${ringSvg(pct, color)}<div class="v num">${value}</div><div class="k">${label}</div>`;
  };
  function update(kind) {
    if (kind !== "stats" && kind !== "init") return;
    const s = lastStats;
    if (!s) {
      tile("cpu", 0, "—", "CPU", "var(--accent)");
      tile("ram", 0, "—", "RAM", "var(--accent-2)");
      tile("third", 0, "—", "", "var(--accent)");
      return;
    }
    tile("cpu", s.cpu, `${s.cpu}%`, "CPU", "var(--accent)");
    tile("ram", s.ram, `${s.ram}%`, `RAM · ${Number(s.ramUsedGb || 0).toFixed(1)} ГБ`, "var(--accent-2)");
    if (s.battery?.hasBattery) {
      tile("third", s.battery.percent, `${s.battery.percent}%`, s.battery.charging ? "Заряд ⚡" : "Батарея", "var(--accent)");
    } else {
      tile("third", s.disk ?? 0, s.disk == null ? "—" : `${s.disk}%`, "Диск C:", "var(--accent)");
    }
  }
  return { el, update, column: "right" };
}
