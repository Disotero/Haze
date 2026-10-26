// Weather via Open-Meteo (no API key). Only the city name / coordinates leave
// the machine.

const CODES = {
  0: ["ясно", "clear"],
  1: ["преимущественно ясно", "mostly-clear"],
  2: ["переменная облачность", "partly-cloudy"],
  3: ["пасмурно", "overcast"],
  45: ["туман", "fog"],
  48: ["изморозь и туман", "fog"],
  51: ["лёгкая морось", "drizzle"],
  53: ["морось", "drizzle"],
  55: ["сильная морось", "drizzle"],
  56: ["ледяная морось", "drizzle"],
  57: ["ледяная морось", "drizzle"],
  61: ["небольшой дождь", "rain"],
  63: ["дождь", "rain"],
  65: ["ливень", "rain"],
  66: ["ледяной дождь", "rain"],
  67: ["ледяной дождь", "rain"],
  71: ["небольшой снег", "snow"],
  73: ["снег", "snow"],
  75: ["сильный снег", "snow"],
  77: ["снежная крупа", "snow"],
  80: ["кратковременный дождь", "rain"],
  81: ["ливни", "rain"],
  82: ["сильные ливни", "rain"],
  85: ["снегопад", "snow"],
  86: ["сильный снегопад", "snow"],
  95: ["гроза", "storm"],
  96: ["гроза с градом", "storm"],
  99: ["гроза с градом", "storm"],
};

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  // Open-Meteo explains a bad request in the body: { error: true, reason }.
  const j = await res.json().catch(() => null);
  if (j?.error) throw new Error(`погода: ${j.reason || "ошибка запроса"}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!j) throw new Error("погода: пустой ответ");
  return j;
}

/** City name → [{ name, country, admin, lat, lon }] */
async function geocode(query) {
  const q = String(query ?? "").trim().slice(0, 100);
  if (!q) return [];
  const url =
    "https://geocoding-api.open-meteo.com/v1/search?count=6&language=ru&format=json&name=" +
    encodeURIComponent(q);
  const j = await getJson(url);
  return (j.results || []).map((r) => ({
    name: r.name,
    country: r.country,
    admin: r.admin1,
    lat: r.latitude,
    lon: r.longitude,
  }));
}

/** A finite number, or null: Open-Meteo leaves fields out or null at times. */
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round = (v) => (num(v) == null ? null : Math.round(v));

async function fetchWeather({ lat, lon } = {}) {
  lat = Number(lat);
  lon = Number(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error(`погода: неверные координаты (${lat}, ${lon})`);
  }
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day" +
    "&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min" +
    "&timezone=auto&forecast_days=1&wind_speed_unit=ms";
  const j = await getJson(url);
  const c = j.current;
  if (!c || typeof c !== "object") throw new Error("погода: в ответе нет текущих данных");
  const d = j.daily || {};
  const first = (a) => (Array.isArray(a) ? a[0] : undefined);
  const [desc, kind] = CODES[c.weather_code] || ["—", "partly-cloudy"];
  const hhmm = (iso) => (typeof iso === "string" && iso.length >= 16 ? iso.slice(11, 16) : "");
  return {
    temp: round(c.temperature_2m),
    feels: round(c.apparent_temperature),
    humidity: round(c.relative_humidity_2m),
    wind: num(c.wind_speed_10m),
    code: num(c.weather_code),
    desc,
    kind,
    isDay: c.is_day !== 0,
    max: round(first(d.temperature_2m_max)),
    min: round(first(d.temperature_2m_min)),
    sunrise: hhmm(first(d.sunrise)),
    sunset: hhmm(first(d.sunset)),
    fetchedAt: Date.now(),
  };
}

module.exports = { geocode, fetchWeather };
