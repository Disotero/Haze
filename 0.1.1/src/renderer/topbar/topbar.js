import { bindTheme } from "../shared/theme.js";
import { icons, weatherGlyph } from "../widgets/icons.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pad = (n) => String(n).padStart(2, "0");
const DAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
// Primary language id (low 10 bits of a LANGID) → short label.
const LANGS = {
  0x09: "EN", 0x19: "RU", 0x22: "UK", 0x23: "BE", 0x3f: "KK", 0x07: "DE", 0x0c: "FR", 0x10: "IT",
  0x0a: "ES", 0x16: "PT", 0x13: "NL", 0x1d: "SV", 0x15: "PL", 0x05: "CS", 0x1f: "TR", 0x2c: "AZ",
  0x37: "KA", 0x2b: "HY", 0x43: "UZ", 0x11: "JA", 0x12: "KO", 0x04: "ZH",
};

let status = await window.cozy.getStatus();
let desk = await window.cozy.getDesk();
let weather = await window.cozy.getWeather();
let media = await window.cozy.getMedia();
let stats = null;
let dragging = false; // volume slider thumb held
let pendingVol = null;
let settings = await window.cozy.getSettings();
const vertical = () => ["left", "right"].includes(settings.topbar.position);

function paintBattery() {
  const b = stats?.battery;
  $("battery").hidden = !b?.hasBattery;
  if (!b?.hasBattery) return;
  $("battery").innerHTML = `${icons.battery(b.percent, b.charging)}<span class="num">${b.percent}%</span>`;
  $("battery").title = b.charging ? "Заряжается" : "Батарея";
}

function paintStatus() {
  const s = status;
  const vol = $("volume");
  if (!s || s.volume == null) {
    vol.innerHTML = icons.speaker(0);
    vol.title = "Нет устройства вывода звука";
  } else {
    const level = s.muted || s.volume === 0 ? 0 : s.volume < 50 ? 1 : 2;
    vol.innerHTML = `${icons.speaker(level)}<span class="num">${s.muted ? "выкл" : s.volume + "%"}</span>`;
    vol.title = "Клик — без звука, колесо — громкость, правый клик — настройки звука";
  }
  vol.classList.toggle("off", Boolean(s?.muted));
  const slider = $("volSlider");
  slider.disabled = !s || s.volume == null;
  // Don't fight the thumb while it's being dragged.
  if (!dragging && s?.volume != null) slider.value = s.muted ? 0 : s.volume;
  slider.style.setProperty("--fill", `${slider.value}%`);

  const net = $("net");
  const n = s?.net || { kind: "none" };
  if (n.kind === "wifi") {
    const bars = n.signal == null ? 3 : n.signal > 75 ? 3 : n.signal > 50 ? 2 : n.signal > 25 ? 1 : 0;
    net.innerHTML = icons.wifi(bars);
    net.title = `Wi-Fi${n.ssid ? ": " + n.ssid : ""}${n.signal != null ? ` · ${n.signal}%` : ""}`;
  } else if (n.kind === "ethernet") {
    net.innerHTML = icons.ethernet;
    net.title = "Подключено по кабелю";
  } else {
    net.innerHTML = icons.offline;
    net.title = "Нет сети";
  }
  net.classList.toggle("off", n.kind === "none");

  const bt = $("bt");
  bt.hidden = s?.bt == null;
  bt.innerHTML = icons.bluetooth;
  bt.classList.toggle("off", s?.bt === false);
  bt.title = s?.bt ? "Bluetooth включён" : "Bluetooth выключен";

  // Mic / camera in use right now (from Windows privacy usage records).
  const rec = $("rec");
  rec.hidden = !(s?.mic || s?.cam);
  rec.innerHTML = (s?.cam ? icons.cam : "") + (s?.mic ? icons.mic : "");
  rec.title = [s?.cam && "камера", s?.mic && "микрофон"].filter(Boolean).join(" и ") + " используется";
}

function paintDesk() {
  const d = desk || { count: 1, current: 0, lang: 0 };
  $("wsName").textContent = `Рабочий стол ${d.current + 1}`;
  $("dots").innerHTML =
    d.count > 1
      ? Array.from({ length: d.count }, (_, i) => `<button data-i="${i}" class="${i === d.current ? "on" : ""}" title="Рабочий стол ${i + 1}"></button>`).join("")
      : "";
  $("lang").textContent = LANGS[d.lang & 0x3ff] || "—";
}

function paintWeather() {
  const w = weather;
  $("weather").hidden = !w;
  if (!w) return;
  $("weather").innerHTML = `${weatherGlyph(w.kind, w.isDay)}<span class="num">${w.temp}°C</span>`;
  $("weather").title = `${w.city}: ${w.desc}`;
}

function paintClock() {
  const now = new Date();
  if (vertical()) {
    $("clock").innerHTML = `${pad(now.getHours())}
${pad(now.getMinutes())}<small>${pad(now.getDate())}.${pad(now.getMonth() + 1)}</small>`;
  } else {
    $("clock").textContent = `${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]} · ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }
  paintTimers(now);
}

/** Next ring of any enabled alarm within the coming week, as a Date. */
function nextAlarm(now) {
  let best = null;
  for (const a of settings.alarms) {
    if (!a.on) continue;
    const [h, m] = a.time.split(":").map(Number);
    for (let d = 0; d < 8; d++) {
      const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, h, m);
      if (t <= now) continue;
      const dow = t.getDay() || 7;
      if (a.days.length && !a.days.includes(dow)) continue;
      if (!best || t < best) best = t;
      break;
    }
  }
  return best;
}

function paintTimers(now) {
  const next = nextAlarm(now);
  // Only alarms within the next day are worth a spot on the bar.
  $("alarm").hidden = !next || next - now > 24 * 3600e3;
  if (!$("alarm").hidden) $("alarm").innerHTML = `${icons.bell}<span>${pad(next.getHours())}:${pad(next.getMinutes())}</span>`;
  const t = settings.powerTimer;
  const left = t ? t.at - now : 0;
  $("timer").hidden = !(left > 0);
  if (left > 0) {
    const sec = Math.ceil(left / 1000);
    const hh = Math.floor(sec / 3600);
    const mm = Math.floor((sec % 3600) / 60);
    const label = hh ? `${hh}:${pad(mm)}:${pad(sec % 60)}` : `${mm}:${pad(sec % 60)}`;
    $("timer").innerHTML = `${icons.power}<span>${label}</span>`;
    $("timer").title = { shutdown: "Выключение", restart: "Перезагрузка", sleep: "Сон" }[t.action] + " по таймеру";
  }
}

function paintDnd() {
  $("dnd").innerHTML = icons.moon;
  $("dnd").classList.toggle("on", settings.dnd);
  $("game").innerHTML = icons.gamepad;
  $("game").classList.toggle("on", settings.gameMode === "on");
  $("game").title = settings.gameMode === "on" ? "Игровой режим включён — клик: снова авто" : "Игровой режим: авто (включится сам в играх). Клик — включить сейчас";
}

// Slide away while a window covers the screen (see main/topbar.js).
window.cozy.onBarCovered((c) => {
  if (c) document.body.classList.add("covered");
  // Two frames: let the window show the slid-out state before sliding in.
  else requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove("covered")));
});

function applyLayout() {
  document.body.dataset.edge = settings.topbar.position;
  document.body.classList.toggle("vertical", vertical());
  $("volSlider").hidden = !settings.topbar.volumeSlider;
  paintClock();
}

function paintMedia() {
  const m = media;
  const el = $("media");
  if (!m?.active) {
    el.innerHTML = `${icons.note}<span class="a">нет медиа</span>`;
    el.title = "";
    $("next").hidden = true;
    return;
  }
  el.innerHTML = `${m.playing ? icons.pause : icons.play}<span class="t">${esc(m.title || "Без названия")}${m.artist ? ` <span class="a">— ${esc(m.artist)}</span>` : ""}</span>`;
  el.title = m.playing ? "Пауза" : "Воспроизвести";
  $("next").hidden = !m.canNext;
  $("next").innerHTML = icons.next;
}

// ── Actions ──
$("brand").onclick = () => window.cozy.openSettings();
$("taskmgr").innerHTML = icons.activity;
$("taskmgr").onclick = () => window.cozy.taskManager();
$("volume").onclick = () => window.cozy.statusCommand("mute");
$("volume").addEventListener("wheel", (e) => {
  e.preventDefault();
  window.cozy.statusCommand(`volstep ${e.deltaY < 0 ? 2 : -2}`);
});
// Hover slider: sends absolute levels, throttled to one per frame.
$("volSlider").addEventListener("input", (e) => {
  dragging = true;
  e.target.style.setProperty("--fill", `${e.target.value}%`);
  if (pendingVol == null) {
    requestAnimationFrame(() => {
      window.cozy.statusCommand(`vol ${pendingVol}`);
      pendingVol = null;
    });
  }
  pendingVol = e.target.value;
});
$("volSlider").addEventListener("change", () => {
  dragging = false;
});
$("volSlider").addEventListener("wheel", (e) => {
  e.preventDefault();
  window.cozy.statusCommand(`volstep ${e.deltaY < 0 ? 2 : -2}`);
});
$("volume").oncontextmenu = () => window.cozy.openSystem("ms-settings:sound");
$("net").onclick = () => window.cozy.openSystem("ms-settings:network");
$("bt").onclick = () => window.cozy.openSystem("ms-settings:bluetooth");
$("battery").onclick = () => window.cozy.openSystem("ms-settings:batterysaver");
$("clock").onclick = () => window.cozy.openSystem("ms-actioncenter:");
$("lang").onclick = () => window.cozy.nextLayout();
$("dots").onclick = (e) => {
  const b = e.target.closest("button");
  if (b && desk) window.cozy.switchDesktop(Number(b.dataset.i) - desk.current);
};
$("media").onclick = () => media?.active && window.cozy.mediaCommand("toggle");
$("next").onclick = () => window.cozy.mediaCommand("next");
$("dnd").onclick = () => window.cozy.setSettings({ dnd: !settings.dnd });
$("game").onclick = () => window.cozy.setSettings({ gameMode: settings.gameMode === "on" ? "auto" : "on" });
$("dnd").oncontextmenu = () => window.cozy.openSystem("ms-settings:notifications");
$("alarm").onclick = () => window.cozy.openDayPanel();
$("timer").onclick = () => window.cozy.openDayPanel();

// Only the islands take the mouse; the gaps click through to whatever is below.
let hit = false;
document.addEventListener("mousemove", (e) => {
  const over = Boolean(e.target.closest?.(".island"));
  if (over !== hit) {
    hit = over;
    window.cozy.barHit(over);
  }
});
document.addEventListener("mouseleave", () => {
  hit = false;
  window.cozy.barHit(false);
});

await bindTheme();
applyLayout();
paintDnd();
paintStatus();
paintDesk();
paintWeather();
paintMedia();
paintClock();
paintBattery();

window.cozy.onStatus((s) => {
  status = s;
  paintStatus();
});
window.cozy.onDesk((d) => {
  desk = d;
  paintDesk();
});
window.cozy.onWeather((w) => {
  weather = w;
  paintWeather();
});
window.cozy.onMedia((m) => {
  media = m;
  paintMedia();
});
window.cozy.onStats((s) => {
  stats = s;
  paintBattery();
});
window.cozy.onSettings((s) => {
  settings = s;
  applyLayout();
  paintDnd();
});
setInterval(paintClock, 1000);
