// Small DOM and formatting helpers shared by the widget modules.
export const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
export const MONTHS_NOM = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
export const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
export const DAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
export const DAYS_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
export const WEEK = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]; // Monday first

export const pad = (n) => String(n).padStart(2, "0");
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const $ = (root, sel) => root.querySelector(sel);
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function h(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** Russian plural: plural(5, "файл", "файла", "файлов"). */
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

/** "через 5 мин", "2 ч назад"… */
export function relTime(date, now = Date.now()) {
  const m = Math.round((new Date(date) - now) / 60000);
  const abs = Math.abs(m);
  const txt = abs < 60 ? `${abs} мин` : abs < 1440 ? `${Math.round(abs / 60)} ч` : `${Math.round(abs / 1440)} д`;
  if (abs < 1) return "сейчас";
  return m > 0 ? `через ${txt}` : `${txt} назад`;
}

/** SVG polyline sparkline for a series of numbers. */
export function sparkline(values, w = 90, h = 26, color = "currentColor") {
  if (!values || values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const k = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / k) * (h - 4)).toFixed(1)}`);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
