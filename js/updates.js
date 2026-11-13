// Skybee — updates of the apps and the beta channel («Бета-тестування» in Settings → Про Skybee).
// Desktop: the shell (desktop/main.js) updates itself; with beta on it takes the builds from the «desktop-test» pre-release
// (every change in main) instead of the tagged releases. Phones: an app cannot replace itself, so Skybee checks GitHub
// once in a while and offers to download the new APK (or IPA); with beta on — the «mobile-test» build as well.
import { isNative } from "./native.js";
import { confirmBox } from "./ui.js";

const API = "https://api.github.com/repos/vysocavnu/skybee/releases";
const cap = window.Capacitor;
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

// Where the beta switch makes sense: the desktop shell that can update itself, and the phone apps
export async function betaState() {
  if (window.skybeeDesktop?.beta) {
    try { const r = await window.skybeeDesktop.beta(); return { on: !!r.on, available: !!r.available, desktop: true }; }
    catch { return { on: false, available: false, desktop: true }; }
  }
  if (isNative) return { on: read("skybee.beta") === "1", available: true, desktop: false };
  return { on: false, available: false };
}
export async function setBeta(on) {
  write("skybee.beta", on ? "1" : null);
  if (window.skybeeDesktop?.beta) await window.skybeeDesktop.beta(!!on);
}

// 1.2.10 > 1.2.9; the numbers only
const newer = (a, b) => {
  const x = String(a).split(/[.-]/).map(Number), y = String(b).split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

/* Phone apps: { state: "available" | "latest" | "error", version, url, beta } */
export async function checkPhone() {
  const App = cap?.Plugins?.App;
  let info; try { info = await App.getInfo(); } catch { return { state: "error", code: "app-info" }; }
  const file = cap.getPlatform() === "ios" ? "Skybee-unsigned.ipa" : "Skybee.apk";
  const asset = (rel) => rel?.assets?.find(a => a.name === file);
  const here = `${info.version} (збірка ${info.build})`;
  try {
    if (read("skybee.beta") === "1") {
      const rel = await (await fetch(`${API}/tags/mobile-test`, { cache: "no-store" })).json();
      const n = +(String(rel.name || "").match(/№\s*(\d+)/)?.[1] || 0); // the build number is in the pre-release's name
      if (n > +info.build && asset(rel)) return { state: "available", beta: true, version: `збірка ${n}`, url: asset(rel).browser_download_url, here };
    }
    const rel = await (await fetch(`${API}/latest`, { cache: "no-store" })).json();
    const v = String(rel.tag_name || "").replace(/^v/, "");
    if (v && newer(v, info.version) && asset(rel)) return { state: "available", beta: false, version: v, url: asset(rel).browser_download_url, here };
    return { state: "latest", version: here };
  } catch { return { state: "error", code: "network", version: here }; }
}

// Opens the download in the phone's browser (Android installs the APK over this one: the same signing key)
export const download = (url) => window.open(url, "_blank");

// On start: at most every 12 hours, and a version the user declined is not offered again
export async function autoCheck() {
  if (!isNative) return;
  const now = Date.now();
  if (now - (+read("skybee.updChecked") || 0) < 12 * 3600e3) return;
  write("skybee.updChecked", String(now));
  const r = await checkPhone();
  if (r.state !== "available" || read("skybee.updSkip") === r.url + r.version) return;
  const ios = cap.getPlatform() === "ios";
  if (await confirmBox(`Вийшла нова ${r.beta ? "бета-версія" : "версія"} Skybee (${r.version}). ${ios ? "Завантажити IPA? Встанови його через Sideloadly чи AltStore." : "Завантажити й встановити? Твої акаунти й налаштування залишаться."}`, "Завантажити")) download(r.url);
  else write("skybee.updSkip", r.url + r.version);
}
