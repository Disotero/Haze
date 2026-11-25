// Month calendar + the day panel (calendar, alarms, power-off timer) that
// opens over the other widgets when the date tile is clicked.
import { h, $, esc, pad, uid, WEEK, MONTHS, MONTHS_NOM, DAYS } from "./dom.js";
import { icons } from "./icons.js";

/** ISO week number. */
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}

export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Month grid HTML, Monday first; days outside the month are dimmed, days with a note dotted. */
export function monthGrid(year, month, notes = {}, selected = "") {
  const today = new Date();
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month, 1 - lead + i);
    const key = dateKey(d);
    const cls = [
      d.getMonth() !== month && "out",
      d.toDateString() === today.toDateString() && "today",
      (d.getDay() === 0 || d.getDay() === 6) && "weekend",
      notes[key] && "has-note",
      key === selected && "sel",
    ].filter(Boolean);
    cells.push(`<button class="${cls.join(" ")}" data-date="${key}">${d.getDate()}</button>`);
    // Stop after the week that contains the month's last day.
    if (i % 7 === 6 && new Date(year, month, 1 - lead + i + 1).getMonth() !== month) break;
  }
  return `<div class="cal-grid">${WEEK.map((w, i) => `<b class="${i > 4 ? "weekend" : ""}">${w}</b>`).join("")}${cells.join("")}</div>`;
}

/**
 * Interactive month calendar inside `root`: prev/next month, notes on dates.
 * Hovering a day shows its note; clicking opens the note for editing.
 * ctx: { s (settings getter), save(patch), saveEntry(map, key, value) }.
 */
export function mountCalendar(root, ctx) {
  let view = new Date();
  view.setDate(1);
  let selected = "";
  let timer = 0;
  const notes = () => ctx.s.dateNotes || {};

  const paint = () => {
    root.innerHTML = `<div class="cal-head">
        <button class="icon-btn sm" data-m="-1" title="Предыдущий месяц">${icons.chevL}</button>
        <b title="К сегодняшнему дню">${MONTHS_NOM[view.getMonth()]} ${view.getFullYear()}</b>
        <button class="icon-btn sm" data-m="1" title="Следующий месяц">${icons.chevR}</button>
      </div>${monthGrid(view.getFullYear(), view.getMonth(), notes(), selected)}
      <div class="cal-note" ${selected ? "" : "hidden"}>
        <div class="cal-note-head"><b></b><button class="icon-btn sm cal-note-close" title="Закрыть">${icons.close}</button></div>
        <textarea placeholder="Заметка на этот день…" spellcheck="false"></textarea>
      </div>
      <div class="cal-hint muted"></div>`;
    if (selected) {
      const [y, m, d] = selected.split("-").map(Number);
      root.querySelector(".cal-note-head b").textContent = `${d} ${MONTHS[m - 1]} ${y}`;
      root.querySelector(".cal-note textarea").value = notes()[selected] || "";
    }
  };

  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-m]");
    if (b) {
      view = new Date(view.getFullYear(), view.getMonth() + Number(b.dataset.m), 1);
      return paint();
    }
    if (e.target.closest(".cal-head b")) {
      view = new Date();
      view.setDate(1);
      return paint();
    }
    if (e.target.closest(".cal-note-close")) {
      selected = "";
      return paint();
    }
    const day = e.target.closest("[data-date]");
    if (day) {
      selected = selected === day.dataset.date ? "" : day.dataset.date;
      paint();
      if (selected) {
        // Typing needs the widgets window focused (see widgets.js).
        window.cozy.focusWidgets();
        setTimeout(() => root.querySelector(".cal-note textarea")?.focus(), 80);
      }
    }
  });
  root.addEventListener("input", (e) => {
    if (!e.target.matches(".cal-note textarea")) return;
    const key = selected;
    const text = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(() => {
      // Just this day: the widget's calendar and the day panel's both edit
      // notes, and a whole-map save from one would drop the other's edit.
      ctx.saveEntry("dateNotes", key, text.trim() ? text : undefined);
    }, 500);
  });
  // Hover: show the day's note under the grid.
  root.addEventListener("mouseover", (e) => {
    const day = e.target.closest("[data-date]");
    const hint = root.querySelector(".cal-hint");
    if (!hint) return;
    const text = day && notes()[day.dataset.date];
    hint.textContent = text ? `📝 ${text.split("\n")[0]}` : "";
  });
  root.addEventListener("mouseleave", () => {
    const hint = root.querySelector(".cal-hint");
    if (hint) hint.textContent = "";
  });
  paint();
  return {
    refresh() {
      // Don't wipe a note being typed.
      if (!root.contains(document.activeElement)) paint();
    },
  };
}

const ACTION_NAMES = { shutdown: "Выключение", restart: "Перезагрузка", sleep: "Сон" };

function daysLabel(days) {
  if (!days.length) return "один раз";
  if (days.length === 7) return "каждый день";
  if (days.join() === "1,2,3,4,5") return "по будням";
  if (days.join() === "6,7") return "по выходным";
  return days.map((d) => WEEK[d - 1]).join(", ");
}

/**
 * The day panel. ctx: { s (settings getter), save(patch) }.
 * Returns { el, update(), destroy() }.
 */
export function createDayPanel(ctx, { calendar = true } = {}) {
  const el = h(`
    <div class="panel glass" role="dialog" aria-label="Календарь и будильники">
      <button class="icon-btn sm panel-close" title="Закрыть">${icons.close}</button>
      <div class="panel-cal"><div class="cal"></div><div class="today-line muted"></div></div>
      <div class="panel-side">
        <section>
          <h4>${icons.bell} Будильники</h4>
          <div class="alarm-list"></div>
          <div class="alarm-add">
            <input type="time" class="a-time" value="07:30" />
            <input type="text" class="a-label" placeholder="Подпись (необязательно)" />
            <div class="day-chips">${WEEK.map((w, i) => `<button data-d="${i + 1}">${w}</button>`).join("")}</div>
            <button class="pill accent a-add">${icons.plus}Добавить</button>
          </div>
        </section>
        <section>
          <h4>${icons.power} Выключить компьютер</h4>
          <div class="power-active"></div>
          <div class="power-set">
            <div class="seg p-action">
              <button data-a="shutdown" class="on">Выключить</button>
              <button data-a="restart">Перезагрузить</button>
              <button data-a="sleep">Сон</button>
            </div>
            <div class="row p-quick">
              <button class="pill" data-min="15">15 мин</button>
              <button class="pill" data-min="30">30 мин</button>
              <button class="pill" data-min="60">1 ч</button>
              <button class="pill" data-min="120">2 ч</button>
            </div>
            <div class="row">
              <span class="muted">или в</span>
              <input type="time" class="p-at" />
              <button class="pill p-at-go">Запланировать</button>
            </div>
          </div>
        </section>
      </div>
    </div>`);

  // From the calendar widget the panel is just alarms + timer (no second calendar).
  let cal = { refresh() {} };
  if (calendar) cal = mountCalendar($(el, ".cal"), ctx);
  else {
    $(el, ".panel-cal").remove();
    el.classList.add("no-cal");
  }
  const now = new Date();
  if (calendar) $(el, ".today-line").textContent = `Сегодня ${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]} · ${isoWeek(now)}-я неделя`;

  // ── Alarms ──
  const chosenDays = new Set([1, 2, 3, 4, 5]);
  const paintChips = () =>
    el.querySelectorAll(".day-chips button").forEach((b) => b.classList.toggle("on", chosenDays.has(Number(b.dataset.d))));
  $(el, ".day-chips").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const d = Number(b.dataset.d);
    chosenDays.has(d) ? chosenDays.delete(d) : chosenDays.add(d);
    paintChips();
  };
  $(el, ".a-add").onclick = () => {
    const time = $(el, ".a-time").value;
    if (!/^\d\d:\d\d$/.test(time)) return;
    const alarm = { id: uid(), time, days: [...chosenDays].sort(), label: $(el, ".a-label").value.trim(), on: true };
    $(el, ".a-label").value = "";
    ctx.save({ alarms: [...ctx.s.alarms, alarm].sort((a, b) => a.time.localeCompare(b.time)) });
  };
  $(el, ".alarm-list").onclick = (e) => {
    const row = e.target.closest("[data-id]");
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest(".a-del")) ctx.save({ alarms: ctx.s.alarms.filter((a) => a.id !== id) });
    else if (e.target.closest(".a-toggle")) {
      ctx.save({ alarms: ctx.s.alarms.map((a) => (a.id === id ? { ...a, on: !a.on } : a)) });
    }
  };

  // ── Power timer ──
  let action = "shutdown";
  $(el, ".p-action").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    action = b.dataset.a;
    el.querySelectorAll(".p-action button").forEach((x) => x.classList.toggle("on", x === b));
  };
  $(el, ".p-quick").onclick = (e) => {
    const b = e.target.closest("[data-min]");
    if (b) window.cozy.setPowerTimer(action, Number(b.dataset.min));
  };
  $(el, ".p-at-go").onclick = () => {
    const v = $(el, ".p-at").value;
    if (!/^\d\d:\d\d$/.test(v)) return;
    const [hh, mm] = v.split(":").map(Number);
    const t = new Date();
    t.setHours(hh, mm, 0, 0);
    if (t <= new Date()) t.setDate(t.getDate() + 1); // that time tomorrow
    // Whole minutes, rounded up (main rounds up too): never earlier than asked.
    window.cozy.setPowerTimer(action, Math.ceil((t - Date.now()) / 60000));
  };

  // Rebuilt only when what they show changed; the countdown alone ticks.
  let alarmsSig = "";
  let powerSig = "";

  function update() {
    const alarms = ctx.s.alarms || [];
    const sig = JSON.stringify(alarms);
    if (sig !== alarmsSig) {
      alarmsSig = sig;
      paintAlarms(alarms);
    }
    const t = ctx.s.powerTimer;
    const left = t ? t.at - Date.now() : 0;
    const ps = left > 0 ? `${t.action}|${t.at}` : "";
    if (ps !== powerSig) {
      powerSig = ps;
      $(el, ".power-active").hidden = !ps;
      if (ps) {
        const at = new Date(t.at);
        $(el, ".power-active").innerHTML = `<div class="power-line">
          <span class="grow">${ACTION_NAMES[t.action] || ""} в <b class="num">${pad(at.getHours())}:${pad(at.getMinutes())}</b>
          <small>осталось <span class="num rest"></span></small></span>
          <button class="pill p-cancel">Отменить</button></div>`;
        $(el, ".p-cancel").onclick = () => window.cozy.cancelPowerTimer();
      }
    }
    if (ps) {
      const sec = Math.ceil(left / 1000);
      const hh = Math.floor(sec / 3600);
      $(el, ".power-active .rest").textContent = `${hh ? hh + ":" : ""}${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`;
    }
  }

  function paintAlarms(alarms) {
    $(el, ".alarm-list").innerHTML = alarms.length
      ? alarms
          .map(
            (a) => `<div class="alarm ${a.on ? "" : "off"}" data-id="${esc(a.id)}">
              <b class="num">${esc(a.time)}</b>
              <span class="grow ellipsis">${esc(a.label || "")}<small>${daysLabel(a.days)}</small></span>
              <button class="toggle a-toggle ${a.on ? "on" : ""}" title="Вкл/выкл"><i></i></button>
              <button class="icon-btn sm a-del" title="Удалить">${icons.close}</button>
            </div>`
          )
          .join("")
      : `<div class="muted empty">Будильников нет</div>`;
  }

  paintChips();
  update();
  const timer = setInterval(update, 1000);
  return {
    el,
    update,
    destroy() {
      clearInterval(timer);
      el.remove();
    },
    refreshCalendar: cal.refresh,
  };
}
