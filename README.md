<img width="150" height="150" alt="icon" src="https://github.com/user-attachments/assets/080877a8-7fd3-4880-9d26-2860da9366e2" /># Haze ![Uplo<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <!-- Haze: an Akira nod — the red-and-white capsule from Kaneda's jacket
       over the red light trails of his bike. Animated when shown as an
       image (trails streak by, the capsule floats); frame 0 is the icon. -->
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1c1426"/>
      <stop offset="1" stop-color="#0d0a14"/>
    </linearGradient>
    <linearGradient id="trail" gradientUnits="userSpaceOnUse" x1="20" y1="0" x2="210" y2="0">
      <stop offset="0" stop-color="#ff3b3b" stop-opacity="0"/>
      <stop offset=".7" stop-color="#ff3b3b" stop-opacity=".9"/>
      <stop offset="1" stop-color="#ffb0a0"/>
    </linearGradient>
    <clipPath id="pill"><rect x="-74" y="-30" width="148" height="60" rx="30"/></clipPath>
    <style>
      .trail { animation: streak 2.6s cubic-bezier(.5, 0, .5, 1) -1.1s infinite; }
      .trail.b { animation-delay: -1.9s; animation-duration: 3.1s; }
      .trail.c { animation-delay: -.8s; animation-duration: 2.3s; }
      @keyframes streak { 0% { transform: translateX(-60px); opacity: 0; } 30% { opacity: 1; } 100% { transform: translateX(60px); opacity: 0; } }
      .float { animation: float 5s ease-in-out infinite; }
      @keyframes float { 0%, 100% { transform: translate(128px, 128px) rotate(-32deg); } 50% { transform: translate(128px, 121px) rotate(-29deg); } }
    </style>
  </defs>
  <rect width="256" height="256" rx="58" fill="url(#bg)"/>
  <!-- the red sun disc behind, a quiet nod to the poster -->
  <circle cx="128" cy="128" r="92" fill="#e23b3b" opacity=".16"/>
  <!-- bike light trails -->
  <g stroke-linecap="round">
    <path class="trail" d="M20 186 H150" stroke="url(#trail)" stroke-width="7"/>
    <path class="trail b" d="M60 206 H210" stroke="url(#trail)" stroke-width="5"/>
    <path class="trail c" d="M30 70 H140" stroke="url(#trail)" stroke-width="4"/>
  </g>
  <!-- the capsule -->
  <g class="float" transform="translate(128 128) rotate(-32)">
    <g clip-path="url(#pill)">
      <rect x="-74" y="-30" width="74" height="60" fill="#e8343a"/>
      <rect x="0" y="-30" width="74" height="60" fill="#fbf6ef"/>
      <!-- cel shading -->
      <rect x="-74" y="10" width="148" height="20" fill="#000" opacity=".14"/>
      <rect x="-60" y="-21" width="44" height="8" rx="4" fill="#fff" opacity=".55"/>
      <rect x="10" y="-21" width="40" height="8" rx="4" fill="#fff" opacity=".9"/>
    </g>
    <rect x="-74" y="-30" width="148" height="60" rx="30" fill="none" stroke="#120c18" stroke-width="6"/>
    <path d="M0 -30 V30" stroke="#120c18" stroke-width="5"/>
  </g>
</svg>
ading icon.svg…]()


<img width="2559" height="1439" alt="image" src="https://github.com/user-attachments/assets/3867e852-ad6a-47a3-9b8d-76557bbb1590" />


**Живые обои, виджеты, верхняя панель и док для Windows 10/11 — в одном уютном приложении.**

Haze превращает рабочий стол в аккуратную «стеклянную» витрину: анимированный фон под иконками, перетаскиваемые виджеты с настоящими данными, своя информационная панель сверху и док с приложениями снизу. Что-то среднее между Wallpaper Engine, Rainmeter и macOS — только легче и без аккаунтов.

> ⚠️ **Честно сразу: это вайбкод.**
> Проект целиком написан в паре с ИИ (Claude) — я ставил задачи, тестировал на своём рабочем столе и говорил «нет, не так», а код писала нейросеть. Работает, пользуюсь каждый день, но это хобби-проект, а не продукт студии. Баги есть, будут ещё. Pull request'ы и issue — welcome.

---

## Скачать и запустить

Текущая версия — **0.1.1**.

1. Скачайте **`Haze.exe`** (≈100 МБ, портативная версия — установка не нужна): из раздела [Releases](../../releases) (сборка 0.1.0 лежит ещё и в папке [`0.1.0`](0.1.0)).
2. Запустите. Windows SmartScreen может предупредить, что издатель неизвестен (exe не подписан сертификатом) — «Подробнее» → «Выполнить в любом случае».
3. При первом запуске откроется окно знакомства: что можно настроить и где. Каждая карточка сразу ведёт в нужный раздел настроек.
4. Потом настройки открываются кнопкой **◐** на инфо-панели, из иконки в трее или по <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>H</kbd>.

Настройки хранятся в `%APPDATA%\Haze\settings.json` — у каждого пользователя свои. В самой программе нет ничьих имён и картинок: имя и аватар в профиле берутся из учётной записи Windows того, кто запустил.

Выйти — правый клик по иконке Haze в трее → «Выход». Так Haze вернёт панель задач Windows и освободит полосу экрана под свою панель. **Не убивайте процесс через диспетчер задач** — иначе панель задач может остаться скрытой (лечится повторным запуском и нормальным выходом).

Требования: Windows 10 (2004+) или Windows 11, x64.

---

## Что умеет

### 🌄 Живые обои
- Встроенная шейдерная анимация, своё видео, GIF или картинка — рисуются **под иконками** рабочего стола (через `WorkerW`, как у Lively / Wallpaper Engine).
- Совместимость с **Wallpaper Engine**: Haze уступает ему фон, а виджеты размывают живую картинку под собой. Если при первом запуске Wallpaper Engine уже работает, Haze сам выбирает его обои.
- Пауза, когда окно развёрнуто на весь экран; ограничение FPS; режим «слабый ПК».

### 🧩 Виджеты
Перетаскиваются мышью, масштабируются уголком или `Ctrl + колесо`, правый клик — меню виджета. Есть готовые пресеты расстановки.

| Включены по умолчанию | По желанию |
|---|---|
| Профиль (аватар, аптайм, блокировка/выключение) | Календарь с заметками на датах, аналоговые часы |
| Мировое время | Заметки, список дел, помидоро-таймер |
| Большие часы + дата | Сеть, цитата дня, фоторамка (фото или папка, разные формы) |
| Плеер «сейчас играет» (SMTC — Spotify, браузер, любой плеер) | Поиск, конвертер изображений |
| Погода (Open-Meteo, без ключа) | Киберспорт (Dota 2, CS2, Valorant, LoL), акции, спорт |
| CPU / RAM / диск | Новости (RSS / Google News), телефон, панели быстрого запуска, «Звук» и «Медиа волна» (спектр музыки) |

### ▔ Информационная панель
Звук (с выезжающим ползунком громкости при наведении), сеть, Bluetooth, батарея, погода, виртуальные рабочие столы, часы, раскладка клавиатуры, «сейчас играет», «Не беспокоить», игровой режим, будильники и таймер выключения. Ставится к любому краю экрана — сверху, снизу, слева или справа; прячется в полноэкранных играх и видео.

### ▁ Док и трей
Закреплённые и запущенные приложения с увеличением при наведении, кнопка «Пуск», значки фоновых программ в конце дока. Как и инфо-панель, ставится к любому краю экрана и умеет прятаться в него. Можно скрыть панель задач Windows и пользоваться только доком.

### 🎨 Оформление
Светлая / тёмная / авто тема, палитры, несколько стилей панелей (стекло, сплошной, «парящий», неон), выбор шрифта, уважение к «меньше анимаций».

---

## Приватность

- Без аккаунтов и телеметрии.
- В сеть ходят только виджеты, которым это нужно по смыслу: погода (координаты города → Open-Meteo), новости, курсы, киберспорт, спорт. Выключили виджет — запросов нет.
- Все настройки, аватар, баннер и пути к обоям хранятся локально в `%APPDATA%\Haze\settings.json`. В репозиторий и в exe ничего личного не попадает.

---

## Структура репозитория

```
Haze/
├── README.md            ← вы здесь
├── CHANGELOG.md         ← что менялось от версии к версии
├── CONTRIBUTING.md      ← как собрать и прислать правку
├── LICENSE              ← MIT
├── .github/workflows/   ← автосборка Haze.exe на GitHub Actions
├── 0.1.0/               ← версия 0.1.0 (в ней же лежит её Haze.exe)
└── 0.1.1/               ← всё, что относится к версии 0.1.1
    ├── src/             ← исходники
    │   ├── main/        ← главный процесс Electron + PowerShell-мосты к Windows
    │   ├── renderer/    ← окна: обои, виджеты, панель, док, настройки, приветствие, браузер
    │   └── preload.js   ← мост между окнами и главным процессом
    ├── assets/          ← иконка приложения
    ├── scripts/         ← запуск/остановка из исходников (start.cmd, stop.cmd, Haze.vbs)
    ├── docs/            ← ТЗ (SPEC.md) и устройство проекта (ARCHITECTURE.md)
    ├── package.json
    └── package-lock.json
```

Каждая новая версия получает свою папку (`0.2.0/`, …) с исходниками, а её `Haze.exe` выкладывается в [Releases](../../releases) — его собирает GitHub Actions по тегу версии. exe внутри папки есть только у 0.1.0.

---

## Запуск из исходников

Нужен [Node.js](https://nodejs.org/) 20+.

```bat
cd 0.1.1
npm install
npm start            :: запустить
npm run stop         :: аккуратно закрыть запущенный Haze
npm run dist         :: собрать портативный dist\Haze.exe
```

Либо без консоли: `scripts\Haze.vbs` (двойной клик), остановка — `scripts\stop.cmd`.

### Сборка на GitHub

В репозитории есть workflow [`.github/workflows/build.yml`](.github/workflows/build.yml):

- **Вручную:** вкладка *Actions* → «Сборка Haze.exe» → *Run workflow*, указать папку версии (`0.1.1`). Готовый exe появится в артефактах запуска.
- **Релиз:** `git tag v0.1.1 && git push origin v0.1.1` — exe соберётся и сам выложится в *Releases*.

Подробнее про устройство кода — [`0.1.1/docs/ARCHITECTURE.md`](0.1.1/docs/ARCHITECTURE.md).

---

## Стек

Electron 45 · чистый HTML/CSS/JS без фреймворков · [koffi](https://koffi.dev/) для вызовов WinAPI · PowerShell-скрипты для громкости, SMTC и трея · шрифты [Fontsource](https://fontsource.org/) · сборка [electron-builder](https://www.electron.build/).

## Известные ограничения

- Только Windows. На macOS/Linux не запустится и не планируется.
- exe не подписан — SmartScreen будет ругаться.
- `Haze.exe` в папке версии хранится через Git LFS (GitHub не принимает обычные файлы больше 100 МБ). Если клонируете репозиторий без установленного [Git LFS](https://git-lfs.com/), вместо exe будет маленький текстовый «указатель» — скачайте exe из Releases.
- Портативный exe при каждом запуске распаковывается во временную папку, поэтому стартует пару секунд.
- Часть функций опирается на недокументированные механизмы Windows (виртуальные рабочие столы, «Не беспокоить») и может сломаться после обновления системы.

## Лицензия

[MIT](LICENSE) — делайте что хотите, только сохраните копирайт.
