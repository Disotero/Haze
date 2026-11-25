// The alarm-ringing card: a glass card with the bell, snooze and stop.
// Extracted from widgets.js unchanged (A3).
import { alarmLoop } from "./sound.js";
import { esc, h } from "./dom.js";
import { icons } from "./icons.js";

/**
 * `board` — the widgets board; `setHit`/`trackClipFor`/`updateClip` — the
 * shared interaction helpers.
 */
export function createRing({ board, setHit, trackClipFor, updateClip }) {
  let ringDone = null; // stops the alarm that's ringing now

  function ringAlarm(a) {
    // A second alarm replaces the first, sound included.
    ringDone?.();
    document.querySelector(".ring-card")?.remove();
    const stopSound = alarmLoop();
    const card = h(`
      <div class="ring-card glass">
        <div class="ring-bell">${icons.bell}</div>
        <div class="ring-time num">${esc(a.time)}</div>
        <div class="ring-label">${esc(a.label || "Будильник")}</div>
        <div class="row">
          <button class="pill snooze">Отложить на 5 минут</button>
          <button class="pill accent stop">Стоп</button>
        </div>
      </div>`);
    const done = () => {
      stopSound();
      card.remove();
      if (ringDone === done) ringDone = null;
      requestAnimationFrame(updateClip);
    };
    ringDone = done;
    card.querySelector(".stop").onclick = done;
    card.querySelector(".snooze").onclick = () => {
      window.cozy.snoozeAlarm(a.id);
      done();
    };
    board.append(card);
    setHit(true);
    trackClipFor(800);
    setTimeout(done, 120000);
  }

  return ringAlarm;
}
