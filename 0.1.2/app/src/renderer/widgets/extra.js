// Time and productivity widgets: analog clock, calendar, notes, to-do and
// pomodoro. The utility widgets (network, quote, photo, search, converter)
// live in tools.js — split by widget family (A3).
// Each factory takes ctx { s (settings), save(patch), openPanel() } and
// returns { el, update?(kind, payload), destroy?() }.
import { h, $, esc, pad, uid } from "./dom.js";
import { icons } from "./icons.js";
import { mountCalendar } from "./calendar.js";
import { chime } from "./sound.js";

// ── Classic clock ──────────────────────────────────────────────────────────

const DAYS_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

export function analogWidget() {
  // Material-style face: a scalloped "cookie" dial, hour dots, chunky
  // rounded hands and the seconds as a dot running round the rim.
  const lobes = Array.from({ length: 240 }, (_, i) => {
    const a = (i / 240) * Math.PI * 2;
    const r = 48 * (0.95 + 0.05 * Math.cos(a * 12));
    return `${(50 + Math.cos(a) * r).toFixed(2)},${(50 + Math.sin(a) * r).toFixed(2)}`;
  });
  const dots = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    const big = i % 3 === 0;
    return `<circle cx="${(50 + Math.sin(a) * 36).toFixed(2)}" cy="${(50 - Math.cos(a) * 36).toFixed(2)}" r="${big ? 2.1 : 1.3}" class="${big ? "dot q" : "dot"}"/>`;
  }).join("");
  const el = h(`
    <div class="widget w-analog">
      <div class="glass">
        <svg viewBox="0 0 100 100" class="face">
          <polygon class="dial" points="${lobes.join(" ")}"/>
          <g>${dots}</g>
          <text class="date" x="50" y="73"></text>
          <rect class="hh" x="45.5" y="27" width="9" height="27.5" rx="4.5"/>
          <rect class="mm" x="47.4" y="14" width="5.2" height="40" rx="2.6"/>
          <circle class="sec" cx="50" cy="8.6" r="2.3"/>
          <circle class="pin" cx="50" cy="50" r="2.2"/>
        </svg>
      </div>
    </div>`);
  const turn = (sel, deg) => ($(el, sel).style.transform = `rotate(${deg}deg)`);
  function update(kind) {
    if (kind !== "tick" && kind !== "init") return;
    const d = new Date();
    // Degrees keep counting up through the day, so a hand never spins back at 12.
    const sec = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
    turn(".sec", sec * 6);
    turn(".mm", sec / 10);
    turn(".hh", sec / 120);
    $(el, ".date").textContent = `${DAYS_SHORT[d.getDay()]} ${d.getDate()}`;
    // Hands glide only after the first paint (no sweep in from 12 o'clock).
    if (kind === "init") requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("live")));
  }
  return { el, update };
}

// ── Calendar ───────────────────────────────────────────────────────────────

export function calendarWidget(ctx) {
  const el = h(`
    <div class="widget w-calendar">
      <div class="glass">
        <div class="cal"></div>
        <button class="pill wide open-panel">${icons.bell}Будильники и таймер</button>
      </div>
    </div>`);
  const cal = mountCalendar($(el, ".cal"), ctx);
  // The widget is the calendar already: the panel only adds alarms and the timer.
  $(el, ".open-panel").onclick = () => ctx.openPanel(el, { calendar: false });
  let day = new Date().getDate();
  return {
    el,
    update(kind) {
      // Roll over at midnight.
      if (kind === "tick" && new Date().getDate() !== day) {
        day = new Date().getDate();
        cal.refresh();
      }
      if (kind === "settings") cal.refresh(); // notes changed elsewhere
    },
  };
}

// ── Notes ──────────────────────────────────────────────────────────────────

export function notesWidget(ctx) {
  const el = h(`
    <div class="widget w-notes" data-focus>
      <div class="glass">
        <div class="w-title">Заметка <span class="muted saved"></span></div>
        <textarea spellcheck="false" placeholder="Пиши что угодно — сохраняется само…"></textarea>
      </div>
    </div>`);
  const ta = $(el, "textarea");
  let timer = 0;
  ta.addEventListener("input", () => {
    clearTimeout(timer);
    $(el, ".saved").textContent = "…";
    timer = setTimeout(async () => {
      await ctx.save({ notes: ta.value });
      $(el, ".saved").textContent = "сохранено";
    }, 600);
  });
  return {
    el,
    update(kind) {
      if ((kind === "init" || kind === "settings") && document.activeElement !== ta) ta.value = ctx.s.notes;
    },
  };
}

// ── To-do ──────────────────────────────────────────────────────────────────

export function todoWidget(ctx) {
  const el = h(`
    <div class="widget w-todo">
      <div class="glass">
        <div class="w-title">Список дел <span class="muted count"></span></div>
        <div class="todo-list"></div>
        <div class="todo-add"><input type="text" placeholder="Новое дело и Enter" /></div>
      </div>
    </div>`);
  const input = $(el, "input");
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !input.value.trim()) return;
    ctx.save({ todos: [...ctx.s.todos, { id: uid(), text: input.value.trim(), done: false }] });
    input.value = "";
  });
  $(el, ".todo-list").onclick = (e) => {
    const row = e.target.closest("[data-id]");
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest(".t-del")) ctx.save({ todos: ctx.s.todos.filter((t) => t.id !== id) });
    else ctx.save({ todos: ctx.s.todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) });
  };
  function update(kind) {
    if (kind !== "init" && kind !== "settings") return;
    const todos = ctx.s.todos;
    const open = todos.filter((t) => !t.done).length;
    $(el, ".count").textContent = todos.length ? `${open} из ${todos.length}` : "";
    // Open items first, done ones sink to the bottom.
    const sorted = [...todos.filter((t) => !t.done), ...todos.filter((t) => t.done)];
    $(el, ".todo-list").innerHTML = sorted.length
      ? sorted
          .map(
            (t) => `<div class="todo ${t.done ? "done" : ""}" data-id="${t.id}">
              <span class="box">${t.done ? icons.check : ""}</span>
              <span class="grow">${esc(t.text)}</span>
              <button class="t-del" title="Удалить">${icons.close}</button>
            </div>`
          )
          .join("")
      : `<div class="muted empty">Пусто — можно отдыхать</div>`;
  }
  return { el, update };
}

// ── Pomodoro ───────────────────────────────────────────────────────────────

const POMO = { focus: [25, "Фокус"], short: [5, "Перерыв"], long: [15, "Длинный"] };

export function pomodoroWidget() {
  const el = h(`
    <div class="widget w-pomodoro">
      <div class="glass">
        <div class="seg modes">${Object.entries(POMO).map(([k, [, n]]) => `<button data-m="${k}">${n}</button>`).join("")}</div>
        <div class="pomo-body">
          <svg viewBox="0 0 120 120" class="pomo-ring"><circle cx="60" cy="60" r="52" class="track"/><circle cx="60" cy="60" r="52" class="fill"/></svg>
          <div class="pomo-time num"></div>
        </div>
        <div class="row center">
          <button class="icon-btn reset" title="Сначала">${icons.reset}</button>
          <button class="icon-btn play big" title="Старт/пауза"></button>
          <span class="muted done-count"></span>
        </div>
      </div>
    </div>`);
  let mode = "focus";
  let total = POMO.focus[0] * 60e3;
  let left = total;
  let endsAt = 0; // running when > 0
  let rounds = 0;
  let fast = 0; // 250 ms timer while running
  const C = 2 * Math.PI * 52;

  function setMode(m) {
    mode = m;
    total = left = POMO[m][0] * 60e3;
    endsAt = 0;
    clearInterval(fast);
    paint();
  }
  function paint() {
    const ms = endsAt ? Math.max(0, endsAt - Date.now()) : left;
    const sec = Math.ceil(ms / 1000);
    $(el, ".pomo-time").textContent = `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
    $(el, ".fill").style.strokeDasharray = `${(C * ms) / total} ${C}`;
    $(el, ".play").innerHTML = endsAt ? icons.pause : icons.play;
    el.querySelectorAll(".modes button").forEach((b) => b.classList.toggle("on", b.dataset.m === mode));
    $(el, ".done-count").textContent = rounds ? `🍅 ${rounds}` : "";
    el.classList.toggle("running", Boolean(endsAt));
  }
  $(el, ".modes").onclick = (e) => e.target.closest("[data-m]") && setMode(e.target.closest("[data-m]").dataset.m);
  const run = (on) => {
    clearInterval(fast);
    // Smooth, immediate countdown while running (the shared tick is 1 s).
    if (on) fast = setInterval(() => update("tick"), 250);
  };
  $(el, ".play").onclick = () => {
    if (endsAt) {
      left = Math.max(0, endsAt - Date.now());
      endsAt = 0;
    } else endsAt = Date.now() + left;
    run(Boolean(endsAt));
    paint();
  };
  $(el, ".reset").onclick = () => setMode(mode);

  function update(kind) {
    if (kind === "init") return paint();
    if (kind !== "tick" || !endsAt) return;
    if (Date.now() >= endsAt) {
      chime();
      if (mode === "focus") {
        rounds++;
        window.cozy.notify("Помидор готов 🍅", "Время сделать перерыв");
        setMode(rounds % 4 === 0 ? "long" : "short");
      } else {
        window.cozy.notify("Перерыв окончен", "Снова за дело");
        setMode("focus");
      }
      return;
    }
    paint();
  }
  return { el, update, destroy: () => clearInterval(fast) };
}
