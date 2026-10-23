import { bindTheme } from "../shared/theme.js";

// What can be changed and where; each card opens its settings page.
const CARDS = [
  {
    page: "wallpaper",
    title: "Обои",
    text: "Встроенная анимация, своё видео, GIF, картинка или Wallpaper Engine.",
    icon: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 15l5-4 4 3 3-2 6 4"/><circle cx="15.5" cy="9.5" r="1.5"/>',
  },
  {
    page: "widgets",
    title: "Виджеты",
    text: "Включи нужные и расставь мышью. Размер — уголком или Ctrl + колесо, правый клик — меню.",
    icon: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  },
  {
    page: "presets",
    title: "Пресеты",
    text: "Готовые раскладки виджетов в один клик — и свои, если сохранить.",
    icon: '<path d="M12 3l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.8z"/>',
  },
  {
    page: "profile",
    title: "Профиль",
    text: "Имя, аватар и картинка-баннер в карточке профиля.",
    icon: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1.2-3.6 4-5.5 7-5.5s5.8 1.9 7 5.5"/>',
  },
  {
    page: "look",
    title: "Оформление",
    text: "Светлая или тёмная тема, палитра, стиль панелей и шрифт.",
    icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor"/>',
  },
  {
    page: "topbar",
    title: "Инфо-панель",
    text: "Звук, сеть, погода, время и «сейчас играет» — сверху, снизу или сбоку.",
    icon: '<rect x="3" y="4" width="18" height="4" rx="2"/><path d="M3 12h18M3 16h12M3 20h8" opacity=".45"/>',
  },
  {
    page: "dock",
    title: "Док и трей",
    text: "Приложения у любого края экрана. Можно спрятать панель задач Windows.",
    icon: '<rect x="3" y="15" width="18" height="5" rx="2.5"/><path d="M7 17.5h.01M12 17.5h.01M17 17.5h.01" stroke-width="3"/>',
  },
  {
    page: "weather",
    title: "Погода и время",
    text: "Свой город для погоды и часовые пояса для мировых часов.",
    icon: '<circle cx="9" cy="9" r="3.5"/><path d="M9 2.5v1.5M2.5 9H4M4.4 4.4l1 1M13.6 4.4l-1 1"/><path d="M8 20h9a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.5A2.8 2.8 0 0 0 8 20z"/>',
  },
];

document.getElementById("cards").innerHTML = CARDS.map(
  (c, i) => `<button class="card" data-page="${c.page}" style="--i:${i}">
      <span class="ico"><svg viewBox="0 0 24 24">${c.icon}</svg></span>
      <b>${c.title}</b>
      <span class="text">${c.text}</span>
      <span class="go">Открыть →</span>
    </button>`
).join("");

document.getElementById("cards").addEventListener("click", (e) => {
  const card = e.target.closest(".card");
  if (card) window.cozy.welcomeOpen(card.dataset.page);
});
document.getElementById("settings").onclick = () => window.cozy.welcomeOpen("");
document.getElementById("start").onclick = () => window.cozy.welcomeDone();
document.getElementById("close").onclick = () => window.cozy.welcomeDone();
document.addEventListener("keydown", (e) => e.key === "Escape" && window.cozy.welcomeDone());

const info = await window.cozy.welcomeInfo();
document.getElementById("weNote").hidden = !info.weChosen;
await bindTheme();
document.getElementById("start").focus();
