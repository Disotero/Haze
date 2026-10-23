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
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** City name → [{ name, country, admin, lat, lon }] */
async function geocode(query) {
  const url =
    "https://geocoding-api.open-meteo.com/v1/search?count=6&language=ru&format=json&name=" +
    encodeURIComponent(query);
  const j = await getJson(url);
  return (j.results || []).map((r) => ({
    name: r.name,
    country: r.country,
    admin: r.admin1,
    lat: r.latitude,
    lon: r.longitude,
  }));
}

async function fetchWeather({ lat, lon }) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day" +
    "&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min" +
    "&timezone=auto&forecast_days=1&wind_speed_unit=ms";
  const j = await getJson(url);
  const c = j.current;
  const [desc, kind] = CODES[c.weather_code] || ["—", "partly-cloudy"];
  const hhmm = (iso) => (iso ? iso.slice(11, 16) : "");
  return {
    temp: Math.round(c.temperature_2m),
    feels: Math.round(c.apparent_temperature),
    humidity: c.relative_humidity_2m,
    wind: c.wind_speed_10m,
    code: c.weather_code,
    desc,
    kind,
    isDay: c.is_day === 1,
    max: Math.round(j.daily.temperature_2m_max[0]),
    min: Math.round(j.daily.temperature_2m_min[0]),
    sunrise: hhmm(j.daily.sunrise[0]),
    sunset: hhmm(j.daily.sunset[0]),
    fetchedAt: Date.now(),
  };
}

module.exports = { geocode, fetchWeather };
