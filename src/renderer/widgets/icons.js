// Inline SVG icons (stroke-based, inherit currentColor).
const s = (body, vb = "0 0 24 24") =>
  `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const icons = {
  lock: s('<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  gear: s(
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'
  ),
  power: s('<path d="M12 3v9"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>'),
  pin: s('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  note: s('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'),
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.5-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4.5" height="14" rx="1.5"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.5"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 6.2v11.6a1 1 0 0 0 1.6.8L15 12.8a1 1 0 0 0 0-1.6L6.6 5.4A1 1 0 0 0 5 6.2z"/><rect x="16.5" y="5" width="3" height="14" rx="1.2"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.2v11.6a1 1 0 0 1-1.6.8L9 12.8a1 1 0 0 1 0-1.6l8.4-5.8a1 1 0 0 1 1.6.8z"/><rect x="4.5" y="5" width="3" height="14" rx="1.2"/></svg>',
  speaker: (level) =>
    s(
      '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/>' +
        (level === 0
          ? '<path d="M16 9.5l5 5M21 9.5l-5 5"/>'
          : '<path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"/>' + (level > 1 ? '<path d="M18 7a7 7 0 0 1 0 10"/>' : ""))
    ),
  wifi: (bars) =>
    s(
      ['<path d="M12 19h.01" stroke-width="3"/>', '<path d="M9 15.5a4.5 4.5 0 0 1 6 0"/>', '<path d="M6 12.3a9 9 0 0 1 12 0"/>', '<path d="M3 9a13.5 13.5 0 0 1 18 0"/>']
        .map((p, i) => (i <= bars ? p : p.replace("<path", '<path opacity=".3"')))
        .join("")
    ),
  ethernet: s('<rect x="4" y="9" width="16" height="10" rx="2"/><path d="M8 9V5h8v4M8 13v2M12 13v2M16 13v2"/>'),
  offline: s('<path d="M3 3l18 18"/><path d="M8.5 15.5a4.5 4.5 0 0 1 5.5-.7M5 12a9 9 0 0 1 4-2.2M14.5 9.6A9 9 0 0 1 19 12"/>'),
  bluetooth: s('<path d="M7 7.5l10 9-5 4.5V3l5 4.5-10 9"/>'),
  battery: (pct, charging) =>
    s(
      `<rect x="2.5" y="7" width="17" height="10" rx="2.5"/><path d="M22 10.5v3"/><rect x="4.5" y="9" width="${Math.max(1, (13 * pct) / 100).toFixed(1)}" height="6" rx="1" fill="currentColor" stroke="none"/>` +
        (charging ? '<path d="M11.5 8.5l-2 3.5h3l-2 3.5" stroke-width="1.6"/>' : "")
    ),
  mic: s('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>'),
  cam: s('<rect x="3" y="6.5" width="13" height="11" rx="2.5"/><path d="M16 10.5l5-3v9l-5-3"/>'),
  grid: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="6" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="12" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="12" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
  filter: s('<path d="M4 5h16l-6.2 7.6V19l-3.6-2v-4.4z"/>'),
  gamepad: s('<path d="M7 8h10a4 4 0 0 1 4 4.5l-.6 3.4a2.4 2.4 0 0 1-4.2 1.1L14.5 15h-5l-1.7 2a2.4 2.4 0 0 1-4.2-1.1L3 12.5A4 4 0 0 1 7 8z"/><path d="M8 11v3M6.5 12.5h3"/><circle cx="15.5" cy="12" r=".6"/><circle cx="17.5" cy="13.5" r=".6"/>'),
  activity: s('<path d="M3 12h4l3-7 4 14 3-7h4"/>'),
  moon: s('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
  bell: s('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
  plus: s('<path d="M12 5v14M5 12h14"/>'),
  close: s('<path d="M6 6l12 12M18 6L6 18"/>'),
  check: s('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  chevL: s('<path d="M15 5l-7 7 7 7"/>'),
  chevR: s('<path d="M9 5l7 7-7 7"/>'),
  image: s('<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M20 16l-5-5-8 8"/>'),
  search: s('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  globe: s('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/>'),
  folder: s('<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'),
  down: s('<path d="M12 4v12M6.5 10.5L12 16l5.5-5.5M5 20h14"/>'),
  up: s('<path d="M12 20V8M6.5 13.5L12 8l5.5 5.5M5 4h14"/>'),
  reset: s('<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/>'),
  app: s('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M4 9h16"/>'),
};

// Weather glyphs keyed by weather.js "kind" (+ night variants).
const sun = '<circle cx="24" cy="24" r="8"/><path d="M24 6v4M24 38v4M6 24h4M38 24h4M11.3 11.3l2.8 2.8M33.9 33.9l2.8 2.8M11.3 36.7l2.8-2.8M33.9 14.1l2.8-2.8"/>';
const moon = '<path d="M33 30.5A12 12 0 0 1 19.5 15a12 12 0 1 0 13.5 15.5z"/>';
const cloud = '<path d="M15 36h19a7 7 0 0 0 .9-13.9A10 10 0 0 0 15.6 24 6 6 0 0 0 15 36z"/>';
const w = (body) =>
  `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export function weatherGlyph(kind, isDay) {
  const sky = isDay ? sun : moon;
  switch (kind) {
    case "clear":
      return w(sky);
    case "mostly-clear":
    case "partly-cloudy":
      return w(`<g transform="translate(-6 -6) scale(.8)">${sky}</g>${cloud}`);
    case "overcast":
      return w(`<path d="M12 30h4" opacity=".5"/>${cloud}`);
    case "fog":
      return w('<path d="M8 18h32M12 25h26M8 32h30M14 39h20"/>');
    case "drizzle":
    case "rain":
      return w(`<g transform="translate(0 -6)">${cloud}</g><path d="M17 36l-2 5M25 36l-2 5M33 36l-2 5"/>`);
    case "snow":
      return w(`<g transform="translate(0 -6)">${cloud}</g><path d="M17 38h.01M25 41h.01M33 38h.01M21 44h.01M29 44h.01" stroke-width="4"/>`);
    case "storm":
      return w(`<g transform="translate(0 -6)">${cloud}</g><path d="M25 33l-4 6h6l-4 6"/>`);
    default:
      return w(cloud);
  }
}

// Settings navigation and section icons: inner SVG markup, drawn at 24×24.
export const NAV_ICONS = {
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M20 16l-5-5-8 8"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-.9 2-1.8 0-1.3-1-1.6-1-2.7 0-1 .8-1.8 1.8-1.8H17a3.5 3.5 0 0 0 3.5-3.5C20.5 6.8 16.7 3.5 12 3.5z"/><circle cx="7.8" cy="11" r="1"/><circle cx="10.5" cy="7.6" r="1"/><circle cx="15" cy="7.8" r="1"/>',
  layout: '<rect x="3.5" y="3.5" width="7" height="9" rx="2"/><rect x="13.5" y="3.5" width="7" height="5" rx="2"/><rect x="13.5" y="11.5" width="7" height="9" rx="2"/><rect x="3.5" y="15.5" width="7" height="5" rx="2"/>',
  widgets: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  apps: '<circle cx="6.5" cy="6.5" r="2.3"/><circle cx="12" cy="6.5" r="2.3"/><circle cx="17.5" cy="6.5" r="2.3"/><circle cx="6.5" cy="12" r="2.3"/><circle cx="12" cy="12" r="2.3"/><circle cx="17.5" cy="12" r="2.3"/><circle cx="6.5" cy="17.5" r="2.3"/><circle cx="12" cy="17.5" r="2.3"/><circle cx="17.5" cy="17.5" r="2.3"/>',
  bar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18"/>',
  dock: '<rect x="3" y="4" width="18" height="16" rx="3"/><rect x="7" y="14" width="10" height="3.5" rx="1.5"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.6A3.3 3.3 0 0 0 7 18z"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.2"/>',
};
