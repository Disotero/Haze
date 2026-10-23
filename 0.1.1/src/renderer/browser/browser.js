// Toolbar of the Haze browser shell; the page itself is a separate view
// managed by the main process (see main/browser.js).
import { bindTheme } from "../shared/theme.js";
import { icons } from "../widgets/icons.js";

const $ = (id) => document.getElementById(id);
const reload = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.4-5.7L20 8.5"/><path d="M20 4v4.5h-4.5"/></svg>';
const stop = icons.close;

$("back").innerHTML = icons.chevL;
$("forward").innerHTML = icons.chevR;
$("reload").innerHTML = reload;
$("external").innerHTML = icons.globe;
$("mode").innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="5" width="16" height="14" rx="3"/><path d="M4 9.5h16"/></svg>';


document.querySelectorAll("[data-cmd]").forEach((b) => (b.onclick = () => window.cozy.browserCmd(b.dataset.cmd)));
$("form").onsubmit = (e) => {
  e.preventDefault();
  window.cozy.browserCmd("go", $("url").value);
  $("url").blur();
};
$("url").addEventListener("focus", () => $("url").select());

window.cozy.onBrowserState((st) => {
  if (document.activeElement !== $("url")) $("url").value = st.url;
  $("title").textContent = st.title;
  $("slimTitle").textContent = st.title;
  document.body.dataset.mode = st.mode;
  document.body.classList.toggle("peek", st.peek);
  $("back").disabled = !st.canBack;
  $("forward").disabled = !st.canForward;
  $("reload").innerHTML = st.loading ? stop : reload;
  $("loading").classList.toggle("on", st.loading);
  try {
    $("fav").src = `https://www.google.com/s2/favicons?domain=${new URL(st.url).hostname}&sz=32`;
  } catch {
    $("fav").removeAttribute("src");
  }
});

await bindTheme();
window.cozy.browserState();
