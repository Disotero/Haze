// Widget catalog and layout presets.
//
// An arrangement is a list of groups; each group sits against one side of
// the screen and holds columns of widget ids, stacked top to bottom:
//   { anchor: "left" | "right" | "center", valign: "top" | "bottom" | "center", cols: [[id, …], …] }
// Saved per-widget positions (settings.layout) always win over it.

// Most used first: this is the order of the list in the settings.
export const WIDGETS = {
  weather: ["Погода", "Сейчас и на день; клик открывает прогноз"],
  bigClock: ["Часы и дата", "Крупные цифры; клик по дате — календарь, будильники, таймер"],
  calendar: ["Календарь", "Месяц с заметками на даты"],
  player: ["Музыка", "Что играет в любом плеере, с кнопками"],
  notes: ["Заметка", "Быстрые записи, сохраняются сами"],
  todo: ["Список дел", "Дела с галочками"],
  stats: ["Нагрузка на ПК", "Процессор, память, батарея или диск"],
  worldClock: ["Мировое время", "Время в других городах"],
  search: ["Поиск", "Google, Яндекс, DuckDuckGo или Bing"],
  news: ["Новости", "Свежие заголовки: РБК, Lenta, BBC, Meduza, Хабр, iXBT…"],
  analog: ["Классические часы", "Циферблат со стрелками"],
  pomodoro: ["Помодоро", "Таймер: 25 минут работы, 5 отдыха"],
  profile: ["Профиль", "Аватар, аптайм, блокировка и выключение"],
  quote: ["Цитата дня", "Новая каждый день, клик — следующая"],
  photo: ["Фоторамка", "Слайд-шоу из папки"],
  converter: ["Конвертер картинок", "Перетащи файл — получишь PNG, JPG, WEBP, BMP, ICO или PDF"],
  net: ["Скорость интернета", "Загрузка и отдача сейчас"],
  stocks: ["Акции и крипта", "Котировки Yahoo и Мосбиржи"],
  sports: ["Спорт", "АПЛ, Ла Лига, ЛЧ, РПЛ, НБА, НХЛ"],
  esports: ["Киберспорт", "CS2 с HLTV, Dota 2, Valorant, LoL"],
  phone: ["Телефон", "Фото по USB, заряд по Bluetooth"],
};

export const CLASSIC = [
  { anchor: "left", valign: "top", cols: [["profile", "worldClock"]] },
  { anchor: "right", valign: "bottom", cols: [["bigClock", "player", "weather", "stats"]] },
];

const only = (...ids) => Object.fromEntries(Object.keys(WIDGETS).map((id) => [id, ids.includes(id)]));

export const PRESETS = [
  {
    id: "classic",
    name: "Уютная классика",
    desc: "Профиль слева, музыка, погода и система справа",
    widgets: only("profile", "worldClock", "bigClock", "player", "weather", "stats"),
    arrangement: CLASSIC,
  },
  {
    id: "mosaic",
    name: "Мозаика",
    desc: "Плотная плитка у левого края, как на референсе",
    widgets: only("profile", "worldClock", "bigClock", "converter", "weather", "player", "stats"),
    arrangement: [{ anchor: "left", valign: "center", cols: [["profile", "worldClock"], ["bigClock", "converter"], ["weather", "player", "stats"]] }],
  },
  {
    id: "minimal",
    name: "Минимализм",
    desc: "Только время и цитата по центру",
    widgets: only("bigClock", "quote", "weather"),
    arrangement: [
      { anchor: "center", valign: "center", cols: [["bigClock", "quote"]] },
      { anchor: "right", valign: "bottom", cols: [["weather"]] },
    ],
  },
  {
    id: "work",
    name: "Работа",
    desc: "Календарь, дела, заметка и помодоро",
    widgets: only("calendar", "todo", "notes", "pomodoro", "stats", "search"),
    arrangement: [
      { anchor: "left", valign: "top", cols: [["calendar", "todo"]] },
      { anchor: "center", valign: "top", cols: [["search"]] },
      { anchor: "right", valign: "top", cols: [["stats", "pomodoro", "notes"]] },
    ],
  },
  {
    id: "mood",
    name: "Атмосфера",
    desc: "Фото, музыка, стрелочные часы и цитата",
    widgets: only("photo", "quote", "analog", "player", "weather"),
    arrangement: [
      { anchor: "left", valign: "bottom", cols: [["photo", "quote"]] },
      { anchor: "right", valign: "bottom", cols: [["analog", "player", "weather"]] },
    ],
  },
  {
    id: "gamer",
    name: "Геймер",
    desc: "Киберспорт, нагрузка на систему и сеть",
    widgets: only("bigClock", "player", "esports", "stats", "net"),
    arrangement: [
      { anchor: "left", valign: "top", cols: [["bigClock", "player"]] },
      { anchor: "right", valign: "top", cols: [["esports", "stats", "net"]] },
    ],
  },
  {
    id: "markets",
    name: "Новости и рынки",
    desc: "Заголовки, котировки, мировое время и погода",
    widgets: only("worldClock", "weather", "news", "stocks"),
    arrangement: [
      { anchor: "left", valign: "top", cols: [["worldClock", "weather"]] },
      { anchor: "right", valign: "top", cols: [["news", "stocks"]] },
    ],
  },
];
