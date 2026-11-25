// The context menu of a widget: pin, size, home, photo options, hide.
// Also the way back to the settings when there's no profile widget and the
// tray is hidden with the taskbar. Extracted from widgets.js unchanged (A3).
import { PHOTO_SHAPES } from "./shapes.js";

/** `ctx` — the widget context (settings getter, save, saveEntry); `placedAt` — the last unsaved spots. */
export function installWidgetMenu({ ctx, placedAt }) {
  document.addEventListener("contextmenu", async (e) => {
    const widget = e.target.closest?.(".widget");
    if (!widget || e.defaultPrevented) return; // launchers have their own menu
    e.preventDefault();
    const settings = ctx.s;
    const id = widget.dataset.id;
    const scaled = (settings.scales[id] || 1) !== 1 || Boolean(settings.sizes?.[id]);
    const choice = await window.cozy.popupMenu([
      { id: "settings", label: "Настройки Haze…" },
      { type: "separator" },
      { id: "lock", label: "Закрепить расстановку", checked: settings.layoutLocked },
      ...(scaled ? [{ id: "size", label: "Исходный размер" }] : []),
      ...(settings.layout[id] ? [{ id: "home", label: "Вернуть на место по умолчанию" }] : []),
      ...(id === "photo"
        ? [
            { type: "separator" },
            {
              label: "Форма",
              submenu: Object.entries(PHOTO_SHAPES).map(([k, label]) => ({ id: "shape:" + k, label, radio: true, checked: (settings.photoShape || "rounded") === k })),
            },
            {
              label: "Показывать",
              submenu: [
                { id: "fit:contain", label: "Фото целиком", radio: true, checked: (settings.photoFit || "contain") === "contain" },
                { id: "fit:cover", label: "Заполнить рамку", radio: true, checked: settings.photoFit === "cover" },
              ],
            },
            { id: "pick:image", label: "Выбрать фото…" },
            { id: "pick:folder", label: "Выбрать папку…" },
          ]
        : []),
      { type: "separator" },
      { id: "hide", label: "Убрать этот виджет" },
    ]);
    if (choice === "settings") window.cozy.openSettings();
    if (choice === "lock") ctx.save({ layoutLocked: !settings.layoutLocked });
    if (choice === "size") {
      await ctx.saveEntry("scales", id, undefined);
      await ctx.saveEntry("sizes", id, undefined);
    }
    if (choice === "home") {
      placedAt.delete(id);
      ctx.saveEntry("layout", id, undefined);
    }
    if (choice === "hide") ctx.save({ widgets: { ...settings.widgets, [id]: false } });
    if (choice?.startsWith("shape:")) ctx.save({ photoShape: choice.slice(6) });
    if (choice?.startsWith("fit:")) ctx.save({ photoFit: choice.slice(4) });
    if (choice?.startsWith("pick:")) {
      const p = await window.cozy.pickFile(choice.slice(5));
      if (p) ctx.save({ photoFolder: p });
    }
  });
}
