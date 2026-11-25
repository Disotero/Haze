// Forecast sites the weather widget can open. {lat} {lon} {city} are filled in.
export const WEATHER_SITES = {
  ventusky: { name: "Ventusky — карта погоды", url: "https://www.ventusky.com/?p={lat};{lon};9" },
  windy: { name: "Windy", url: "https://www.windy.com/?{lat},{lon},9" },
  yandex: { name: "Яндекс Погода", url: "https://yandex.ru/pogoda/?lat={lat}&lon={lon}" },
};

/** URL to open for the configured site, or "" when the link is off or invalid. */
export function weatherUrl(settings) {
  const { site, custom } = settings.weatherLink || {};
  const template = site === "custom" ? custom : WEATHER_SITES[site]?.url;
  if (!template || !/^https:\/\//i.test(template)) return "";
  const w = settings.weather;
  return template
    .replaceAll("{lat}", Number(w.lat).toFixed(4))
    .replaceAll("{lon}", Number(w.lon).toFixed(4))
    .replaceAll("{city}", encodeURIComponent(w.city || ""));
}
