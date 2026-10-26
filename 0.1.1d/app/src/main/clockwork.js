// Alarms and the power-off timer. Both live in the main process so they keep
// working whatever the widget windows are doing (reloads, hidden, etc.).
const { Notification } = require("electron");
const { runTool } = require("./runtool");

const ACTIONS = { shutdown: "Выключение", restart: "Перезагрузка", sleep: "Сон" };
const MAX_MINUTES = 7 * 24 * 60; // setTimeout can't wait much longer anyway
// After sleep or a clock jump, alarms missed by up to this long still ring.
const CATCH_UP = 30 * 60e3;
const MAX_SNOOZED = 10;

function createClockwork({ settings, applySettings, broadcast, sleepNow }) {
  let lastTick = Date.now();
  let sleepTimer = null;
  const snoozed = []; // { id, time, label, at }

  function ring(alarm) {
    new Notification({ title: `Будильник · ${alarm.time}`, body: alarm.label || "Пора!" }).show();
    broadcast("alarm:ring", { id: alarm.id, time: alarm.time, label: alarm.label || "" });
  }

  /** When `a` was due last, at or before `now` (today's or yesterday's time). */
  function lastDue(a, now) {
    const [hh, mm] = a.time.split(":").map(Number);
    for (const back of [0, 1]) {
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, hh, mm);
      if (at > now) continue;
      const dow = at.getDay() || 7; // Mon=1 … Sun=7
      return !a.days.length || a.days.includes(dow) ? at.getTime() : 0;
    }
    return 0;
  }

  /**
   * Every alarm whose time fell between the previous tick and this one rings
   * once. Normally that's a one-second window; after sleep or hibernation
   * (the process stood still) it covers the missed stretch, up to CATCH_UP.
   */
  function tick() {
    const now = new Date();
    const t = now.getTime();
    for (let i = snoozed.length - 1; i >= 0; i--) {
      if (t >= snoozed[i].at) ring(snoozed.splice(i, 1)[0]);
    }
    const since = Math.max(lastTick, t - CATCH_UP);
    lastTick = t;
    let changed = false;
    const alarms = (settings.get().alarms || []).map((a) => {
      if (!a || !a.on || typeof a.time !== "string") return a;
      const due = lastDue(a, now);
      if (!due || due <= since) return a;
      ring(a);
      if (a.days.length) return a;
      changed = true; // one-off alarms switch themselves off
      return { ...a, on: false };
    });
    if (changed) applySettings({ alarms });
  }

  function snooze(id, minutes = 5) {
    const a = (settings.get().alarms || []).find((x) => x && x.id === id);
    if (!a) return;
    // Snoozing again moves the reminder; it doesn't add a second one.
    const i = snoozed.findIndex((x) => x.id === id);
    if (i >= 0) snoozed.splice(i, 1);
    if (snoozed.length >= MAX_SNOOZED) snoozed.shift();
    snoozed.push({ id, time: a.time, label: a.label || "", at: Date.now() + minutes * 60e3 });
  }

  function armSleep(at) {
    clearTimeout(sleepTimer);
    sleepTimer = setTimeout(() => {
      sleepTimer = null;
      applySettings({ powerTimer: null });
      sleepNow();
    }, Math.max(0, at - Date.now()));
  }

  /**
   * Shutdown and restart are handed to Windows (`shutdown /t`), so they
   * happen even if Cozy is closed; Windows also shows its own warning.
   * Sleep has no such command, so Cozy keeps that timer itself.
   */
  function setPowerTimer(action, minutes) {
    minutes = Number(minutes);
    if (!ACTIONS[action] || !Number.isFinite(minutes) || minutes <= 0) return;
    cancelPowerTimer(false);
    // Whole minutes, rounded up: a fraction must never mean "right now".
    const secs = Math.min(Math.ceil(minutes), MAX_MINUTES) * 60;
    const at = Date.now() + secs * 1000;
    if (action === "sleep") armSleep(at);
    else {
      runTool("shutdown", [action === "shutdown" ? "/s" : "/r", "/t", String(secs), "/c", `Haze: ${ACTIONS[action].toLowerCase()} по таймеру`]);
    }
    applySettings({ powerTimer: { action, at } });
  }

  function cancelPowerTimer(save = true) {
    const t = settings.get().powerTimer;
    // Only a pending Windows shutdown can be aborted; with none, `/a` just fails.
    if (t && t.action !== "sleep" && t.at > Date.now()) runTool("shutdown", ["/a"], { expectFail: true });
    clearTimeout(sleepTimer);
    sleepTimer = null;
    if (save) applySettings({ powerTimer: null });
  }

  /** After a restart of Cozy: drop stale timers, re-arm a pending sleep. */
  function restore() {
    const t = settings.get().powerTimer;
    if (!t) return;
    if (t.at <= Date.now()) applySettings({ powerTimer: null });
    else if (t.action === "sleep") armSleep(t.at);
  }

  return { tick, snooze, setPowerTimer, cancelPowerTimer, restore };
}

module.exports = { createClockwork };
