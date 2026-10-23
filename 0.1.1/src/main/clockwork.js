// Alarms and the power-off timer. Both live in the main process so they keep
// working whatever the widget windows are doing (reloads, hidden, etc.).
const { Notification } = require("electron");
const { execFile } = require("node:child_process");

const pad = (n) => String(n).padStart(2, "0");
const ACTIONS = { shutdown: "Выключение", restart: "Перезагрузка", sleep: "Сон" };
const MAX_MINUTES = 7 * 24 * 60; // setTimeout can't wait much longer anyway

function createClockwork({ settings, applySettings, broadcast, sleepNow }) {
  let lastMinute = "";
  let sleepTimer = null;
  const snoozed = []; // { id, time, label, at }

  function ring(alarm) {
    new Notification({ title: `Будильник · ${alarm.time}`, body: alarm.label || "Пора!" }).show();
    broadcast("alarm:ring", { id: alarm.id, time: alarm.time, label: alarm.label || "" });
  }

  function tick() {
    const now = new Date();
    for (let i = snoozed.length - 1; i >= 0; i--) {
      if (now >= snoozed[i].at) ring(snoozed.splice(i, 1)[0]);
    }
    const minute = `${now.toDateString()} ${now.getHours()}:${now.getMinutes()}`;
    if (minute === lastMinute) return;
    lastMinute = minute;
    const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const dow = now.getDay() || 7; // Mon=1 … Sun=7
    let changed = false;
    const alarms = settings.get().alarms.map((a) => {
      if (!a.on || a.time !== hhmm || (a.days.length && !a.days.includes(dow))) return a;
      ring(a);
      if (a.days.length) return a;
      changed = true; // one-off alarms switch themselves off
      return { ...a, on: false };
    });
    if (changed) applySettings({ alarms });
  }

  function snooze(id, minutes = 5) {
    const a = settings.get().alarms.find((x) => x.id === id);
    snoozed.push({ id, time: a?.time || "", label: a?.label || "", at: Date.now() + minutes * 60e3 });
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
    if (!ACTIONS[action] || !(minutes > 0)) return;
    cancelPowerTimer(false);
    const secs = Math.round(Math.min(minutes, MAX_MINUTES) * 60);
    const at = Date.now() + secs * 1000;
    if (action === "sleep") armSleep(at);
    else {
      execFile(
        "shutdown",
        [action === "shutdown" ? "/s" : "/r", "/t", String(secs), "/c", `Haze: ${ACTIONS[action].toLowerCase()} по таймеру`],
        { windowsHide: true }
      );
    }
    applySettings({ powerTimer: { action, at } });
  }

  function cancelPowerTimer(save = true) {
    const t = settings.get().powerTimer;
    if (t && t.action !== "sleep") execFile("shutdown", ["/a"], { windowsHide: true });
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
