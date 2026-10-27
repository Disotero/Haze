// The frosted backdrop is clipped to the widget cards. The widgets window
// and the live-glass window both do it, and their shapes must match to the
// pixel — so both use this one implementation.

export function roundedRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  return `M${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x + r}A${r},${r} 0 0 1 ${x},${y + h - r}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z`;
}

// The backdrop covers the whole screen, not just this window (which starts
// below the top bar), so the blurred copy lines up with the real wallpaper.
export function alignToScreen(el) {
  Object.assign(el.style, {
    left: -window.screenX + "px",
    top: -window.screenY + "px",
    width: screen.width + "px",
    height: screen.height + "px",
  });
}

/** The window moved without resizing (top bar toggled): is `el` off? */
export const misaligned = (el) => el.offsetLeft !== -window.screenX || el.offsetTop !== -window.screenY;
