// Skybee — the Android/iOS app (Capacitor, mobile/): small fixes that only matter inside the native shell.
// In a browser or the desktop app window.Capacitor is absent and this file does nothing.
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
  App?.addListener?.("backButton", ({ canGoBack }) => {
    const pop = document.querySelector(".popmenu");
    if (pop) { document.body.click(); pop.remove(); return; } // an open «⋯» menu closes first
    if (document.querySelector(".modal-bg")) { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); return; } // then a window
    if (document.body.classList.contains("drawer")) { document.body.classList.remove("drawer"); return; } // then the side menu
    canGoBack ? history.back() : App.exitApp();
  });
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
