// Skybee — the Android/iOS app (Capacitor, mobile/): small fixes that only matter inside the native shell.
// In a browser or the desktop app window.Capacitor is absent and this file does nothing — except the swipe back, which the desktop app gets too.
const cap = window.Capacitor;
export const isNative = !!cap?.isNativePlatform?.();

if (isNative) {
  document.documentElement.classList.add("native", "native-" + cap.getPlatform());
  // Links to other sites open in the phone's browser: the shell sends any navigation away from the app there,
  // but a WebView ignores target=_blank and window.open — so turn those into a plain navigation.
  const open = (url) => { if (/^https?:/i.test(url)) location.href = url; };
  window.open = (url) => { open(String(url || "")); return null; };
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.('a[target="_blank"]');
    if (!a || !a.href) return;
    e.preventDefault();
    open(a.href);
  }, true);
  // Android «Back»: one screen back inside Skybee, out of the app on the first screen
  const App = cap.Plugins?.App;
  App?.addListener?.("backButton", ({ canGoBack }) => { if (!closeTop()) canGoBack ? history.back() : App.exitApp(); });
}

// What «Back» closes before it leaves the screen: an open «⋯» menu, then a window, then the side menu. True if something closed.
function closeTop() {
  const pop = document.querySelector(".popmenu");
  if (pop) { document.body.click(); pop.remove(); return true; }
  if (document.querySelector(".modal-bg, .msheet-bg")) { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); return true; }
  if (document.body.classList.contains("drawer")) { document.body.classList.remove("drawer"); return true; }
  return false;
}

/* ---------- swipe back (the apps: Android, iOS, the desktop app on a touch screen) ---------- */
// A finger from the left edge pulled to the right: one step back, like «Back» on Android and the edge swipe on iPhone.
// A round arrow follows the finger and turns gold once letting go will go back; pulling back or moving up/down cancels.
if (isNative || window.skybeeDesktop) {
  const EDGE = 32, GO = 80;
  let x0 = null, y0 = 0, dx = 0, on = false, arrow = null;
  const drop = () => { arrow?.remove(); arrow = null; x0 = null; on = false; };
  addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    drop();
    if (e.touches.length !== 1 || t.clientX > EDGE || document.querySelector(".lb")) return; // the photo viewer has its own gestures
    x0 = t.clientX; y0 = t.clientY; dx = 0;
  }, { passive: true });
  addEventListener("touchmove", (e) => {
    if (x0 == null) return;
    const t = e.touches[0];
    dx = t.clientX - x0;
    const dy = Math.abs(t.clientY - y0);
    if (!on) {
      if (dy > 14 && dy > dx) return drop(); // scrolling up or down, not a swipe
      if (dx < 14) return;
      on = true;
      arrow = document.createElement("div"); arrow.className = "swipeback"; arrow.textContent = "←";
      document.body.appendChild(arrow);
    }
    arrow.style.top = y0 + "px";
    arrow.style.transform = `translate(${Math.min(Math.max(dx, 0), GO * 1.4) * .7 - 44}px, -50%)`;
    arrow.classList.toggle("ready", dx >= GO);
  }, { passive: true });
  const end = () => {
    const go = on && dx >= GO;
    drop();
    if (go && !closeTop() && history.length > 1 && !/^#?\/?$/.test(location.hash)) history.back();
  };
  addEventListener("touchend", end, { passive: true });
  addEventListener("touchcancel", drop, { passive: true });
}

// skybee://… links (the browser hands the user back after sign-up): fn(url) for the link that started the app
// and for every later one. In the desktop app the same comes through skybeeDesktop.onLink.
export function onLink(fn) {
  if (window.skybeeDesktop?.onLink) window.skybeeDesktop.onLink(fn);
  const App = isNative && cap.Plugins?.App;
  if (!App) return;
  App.addListener?.("appUrlOpen", (e) => e?.url && fn(e.url));
  App.getLaunchUrl?.().then((r) => r?.url && fn(r.url)).catch(() => {});
}
