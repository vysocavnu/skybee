// Skybee desktop shell (Electron): one window with the web app inside, on its own Chromium —
// nothing from Edge or WebView2 is needed.
const { app, BrowserWindow, Menu, protocol, net, shell, dialog, Tray, nativeImage, ipcMain } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const fs = require("node:fs");
const crypto = require("node:crypto");

const BUNDLED = path.join(__dirname, "web"); // the web app as it was when this EXE was built
const HOME = "app://skybee/";
const SITE = (process.env.SKYBEE_SITE || "https://vysocavnu.github.io/skybee/").replace(/\/?$/, "/");

/* ---------- self-updating web part ----------
   The interface is the same static site that lives on GitHub Pages. On every start the shell downloads it in the
   background; if it differs from what we have and is newer than this build, it is kept in userData/web-cache and
   used from the next start on. A new EXE is only needed when the shell itself (this file) changes. */
const cacheDir = () => path.join(app.getPath("userData"), "web-cache");
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const bundledTime = () => readJson(path.join(BUNDLED, "build.json"))?.time || 0;

// Where to serve the web app from: the downloaded copy when it is newer than the bundled one
function pickWebRoot() {
  if (process.env.FLATPAK_ID) return BUNDLED;
  const cur = readJson(path.join(cacheDir(), "current.json"));
  const dir = cur && /^[a-f0-9]{16}$/.test(cur.dir || "") ? path.join(cacheDir(), cur.dir) : null;
  return dir && cur.time > bundledTime() && fs.existsSync(path.join(dir, "index.html")) ? dir : BUNDLED;
}

// index.html → its styles and scripts → their imports and url()s. Icons and the like fall back to the bundled copies.
function refs(file, text) {
  const out = [], add = (r) => { if (r && !/^([a-z]+:|\/\/|#)/i.test(r)) out.push(r.split(/[?#]/)[0]); };
  if (file.endsWith(".html")) for (const m of text.matchAll(/(?:href|src)="([^"]+\.(?:css|js))"/g)) add(m[1]);
  if (file.endsWith(".js")) for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+\.js)["']/g)) add(m[1]);
  if (file.endsWith(".css")) for (const m of text.matchAll(/url\(\s*["']?([^)"']+)["']?\s*\)/g)) add(m[1]);
  return out.map(r => path.posix.normalize(path.posix.join(path.posix.dirname(file), r))).filter(r => !r.startsWith("..") && !path.posix.isAbsolute(r));
}
const hashOf = (files) => {
  const h = crypto.createHash("sha256");
  for (const name of [...files.keys()].sort()) h.update(name).update("\0").update(files.get(name)).update("\0");
  return h.digest("hex").slice(0, 16);
};
function bundledHash() {
  const files = new Map(), queue = ["index.html"];
  while (queue.length) {
    const name = queue.shift();
    if (files.has(name)) continue;
    let buf; try { buf = fs.readFileSync(path.join(BUNDLED, name)); } catch { continue; }
    files.set(name, buf);
    queue.push(...refs(name, buf.toString("utf8")));
  }
  return hashOf(files);
}

async function updateWeb(activeRoot) {
  const files = new Map(), queue = ["index.html"];
  let time = 0, bytes = 0;
  while (queue.length) {
    const name = queue.shift();
    if (files.has(name)) continue;
    if (files.size >= 200) throw new Error("too many files");
    const r = await net.fetch(SITE + name, { cache: "no-store" });
    if (!r.ok) throw new Error(`${name}: ${r.status}`); // an incomplete copy is never stored
    const buf = Buffer.from(await r.arrayBuffer());
    if ((bytes += buf.length) > 30e6) throw new Error("too big");
    files.set(name, buf);
    time = Math.max(time, Date.parse(r.headers.get("last-modified") || "") || 0);
    queue.push(...refs(name, buf.toString("utf8")));
  }
  const hash = hashOf(files);
  if (time <= bundledTime() || hash === bundledHash()) return; // this build is as new as the site
  const dir = path.join(cacheDir(), hash);
  if (path.resolve(activeRoot) === path.resolve(dir)) return; // already running it
  for (const [name, buf] of files) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
  }
  fs.writeFileSync(path.join(cacheDir(), "current.json"), JSON.stringify({ dir: hash, time }));
  for (const d of fs.readdirSync(cacheDir())) { // old copies; the one in use stays until the next start
    const full = path.join(cacheDir(), d);
    if (d !== hash && d !== "current.json" && path.resolve(full) !== path.resolve(activeRoot)) fs.rmSync(full, { recursive: true, force: true });
  }
}

/* ---------- self-updating shell (the EXE itself) ----------
   On start and every 6 hours: electron-updater reads latest.yml from the newest GitHub release, downloads the new
   installer in the background (progress on the taskbar button) and asks to restart. «Later» is fine too: the update
   is installed when Skybee is closed. Only for the installed app — not when run from source (npm start). */
let updater = null, downloaded = null; // downloaded: the version waiting to be installed

/* Beta channel (Settings → Про Skybee → «Бета-тестування»): the builds of every change in main, from the «desktop-test»
   pre-release (its latest.yml / latest-linux.yml; versions like 0.3.1-beta.57, always above the last release).
   Turned off, the tagged releases again: the beta stays until a newer release comes out (no downgrade). */
const BETA_FEED = "https://github.com/vysocavnu/skybee/releases/download/desktop-test/";
const betaFile = () => path.join(app.getPath("userData"), "beta.json");
const betaOn = () => readJson(betaFile())?.on === true;
function applyChannel() {
  if (!updater) return;
  const beta = betaOn();
  updater.allowPrerelease = beta;
  updater.setFeedURL(beta ? { provider: "generic", url: BETA_FEED } : { provider: "github", owner: "vysocavnu", repo: "skybee", releaseType: "release" });
}
ipcMain.handle("skybee:beta", (_e, on) => {
  if (typeof on === "boolean") {
    try { fs.writeFileSync(betaFile(), JSON.stringify({ on })); } catch { throw new Error("cannot save"); }
    applyChannel();
  }
  return { on: betaOn(), available: !!updater };
});
function askRestart(version) {
  dialog.showMessageBox(win, {
    type: "info", title: "Оновлення Skybee", noLink: true, defaultId: 0, cancelId: 1,
    message: `Завантажено нову версію Skybee ${version}`,
    detail: "Перезапустити й оновити зараз? Якщо відкласти, оновлення встановиться саме, коли закриєш Skybee.",
    buttons: ["Оновити зараз", "Пізніше"],
  }).then(({ response }) => { if (response === 0) setImmediate(() => updater.quitAndInstall(true, true)); }); // silently, then start Skybee again
}
function setupShellUpdates() {
  if (!app.isPackaged) return;
  // Windows (installer) and the AppImage update themselves; Flatpak and tar.gz are updated by Flathub / by hand
  if (process.platform !== "win32" && !process.env.APPIMAGE) return;
  try { ({ autoUpdater: updater } = require("electron-updater")); } catch { return; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  applyChannel(); // releases, or the beta builds when «Бета-тестування» is on
  let asked = false;
  updater.on("before-quit-for-update", () => { quitting = true; });
  updater.on("download-progress", (p) => win?.setProgressBar(Math.max(0.01, (p.percent || 0) / 100)));
  updater.on("error", () => win?.setProgressBar(-1)); // offline, GitHub down…: quietly try again later
  updater.on("update-downloaded", (info) => {
    win?.setProgressBar(-1);
    downloaded = info.version;
    if (!asked) { asked = true; askRestart(info.version); }
  });
  const check = () => updater.checkForUpdates().catch(() => {});
  setTimeout(check, 8000);
  setInterval(check, 6 * 3600e3);
}

/* «Перевірити оновлення» (Settings → Про Skybee, and the tray menu). Result:
   { state: "latest" | "downloading" | "ready" | "flatpak" | "manual" | "dev" | "error", version, code? } */
async function checkUpdatesNow() {
  const current = app.getVersion();
  if (!updater) return { state: process.env.FLATPAK_ID ? "flatpak" : app.isPackaged ? "manual" : "dev", version: current };
  if (downloaded) { askRestart(downloaded); return { state: "ready", version: downloaded }; }
  try {
    const r = await updater.checkForUpdates();
    if (!r?.isUpdateAvailable) return { state: "latest", version: current };
    return { state: "downloading", version: r.updateInfo.version }; // autoDownload: the restart question comes when it is done
  } catch (e) {
    return { state: "error", version: current, code: String(e?.code || e?.statusCode || "network").slice(0, 60) };
  }
}
ipcMain.handle("skybee:update", () => checkUpdatesNow());

// ES modules and localStorage need a real origin, file:// gives neither
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let win = null, tray = null, quitting = false;
// Developer tools only when run from source (or with SKYBEE_DEVTOOLS=1): in the installed app «paste this into the
// console» is a classic way to steal the session from someone
const devTools = !app.isPackaged || process.env.SKYBEE_DEVTOOLS === "1";
const startHidden = process.argv.includes("--hidden"); // started with Windows: straight to the tray

// The window shows again (from the tray, a second launch or a notification click)
function show() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

/* ---------- tray: Skybee keeps running after the window is closed ----------
   so system notifications keep coming (the web app polls once a minute). «Вийти» in the tray menu quits for real. */
function setupTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "icon.png")).resize({ width: 16, height: 16 }));
  tray.setToolTip("Skybee");
  const build = () => Menu.buildFromTemplate([
    { label: "Відкрити Skybee", click: show },
    { label: "Запускати разом із Windows", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin,
      click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked, args: ["--hidden"] }) },
    { label: "Перевірити оновлення", click: async () => {
      const r = await checkUpdatesNow();
      if (r.state === "ready") return; // the restart question is already on screen
      const text = {
        latest: [`У тебе найновіша версія Skybee (${r.version}).`, ""],
        downloading: [`Знайдено нову версію Skybee ${r.version}.`, "Вона завантажується у фоні; коли буде готова, Skybee запропонує перезапуститися."],
        flatpak: ["Цю версію Skybee оновлює Flathub.", "Відкрий «Програми» (GNOME Software чи Discover) або виконай: flatpak update"],
        manual: ["Ця збірка не оновлюється сама.", "Завантаж нову версію зі сторінки релізів Skybee на GitHub."],
        dev: ["Skybee запущено з вихідного коду — оновлення вимкнені.", ""],
        error: ["Не вдалося перевірити оновлення.", `Перевір підключення до інтернету й спробуй ще раз пізніше. (${r.code})`],
      }[r.state];
      dialog.showMessageBox({ type: r.state === "error" ? "warning" : "info", title: "Оновлення Skybee", message: text[0], detail: text[1], buttons: ["OK"], noLink: true });
    } },
    { type: "separator" },
    { label: "Вийти", click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(build());
  tray.on("click", show);
  tray.on("right-click", () => tray.setContextMenu(build()));
}

ipcMain.handle("skybee:version", () => app.getVersion());
const external = (url) => { if (/^(https?|mailto):/i.test(url)) shell.openExternal(url); };

/* ---------- skybee:// links ----------
   Sign-up happens in the browser; when it is done, the page there opens skybee://login?handle=… and the OS hands it
   to Skybee — as the start argument, to the running copy (second-instance) or, on macOS, as open-url. */
const LINK = "skybee";
let pendingLink = null;
const linkIn = (argv = []) => argv.find(a => typeof a === "string" && a.toLowerCase().startsWith(LINK + "://")) || null;
function deliverLink(url) {
  if (!url) return;
  if (!app.isReady() || !win) { pendingLink = url; if (app.isReady()) createWindow(); return; }
  show();
  if (win.webContents.isLoading()) pendingLink = url; else win.webContents.send("skybee:link", url);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 820, minWidth: 360, minHeight: 520,
    title: "Skybee", icon: path.join(__dirname, "icon.png"), backgroundColor: "#0f1218",
    autoHideMenuBar: true,
    show: !startHidden || !!pendingLink,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true, devTools,
      preload: path.join(__dirname, "preload.js"), backgroundThrottling: false }, // keeps polling for notifications while hidden
  });
  // closing the window only hides it: Skybee stays in the tray and keeps notifying
  let told = false;
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault(); win.hide();
    if (!told && tray) { told = true; tray.displayBalloon?.({ title: "Skybee працює у фоні", content: "Сповіщення й далі приходитимуть. Вийти — правою кнопкою на значку Skybee біля годинника.", iconType: "info" }); }
  });
  // a click on a notification switches the page (location.hash): bring the hidden window back
  win.webContents.on("did-navigate-in-page", () => { if (win && !win.isVisible()) show(); });
  // target=_blank links and window.open go to the system browser
  win.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(HOME)) { e.preventDefault(); external(url); } });
  win.webContents.on("context-menu", (_e, p) => {
    const items = [];
    if (p.linkURL) items.push({ label: "Копіювати посилання", click: () => require("electron").clipboard.writeText(p.linkURL) });
    if (p.mediaType === "image") items.push({ label: "Копіювати зображення", click: () => win.webContents.copyImageAt(p.x, p.y) });
    if (p.isEditable) items.push({ label: "Вирізати", role: "cut", enabled: p.editFlags.canCut }, { label: "Вставити", role: "paste", enabled: p.editFlags.canPaste });
    if (p.selectionText) items.push({ label: "Копіювати", role: "copy" });
    if (p.isEditable) items.push({ label: "Виділити все", role: "selectAll" });
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
  win.webContents.on("before-input-event", (e, k) => {
    if (k.type !== "keyDown") return;
    if (k.key === "F5" || (k.control && k.key.toLowerCase() === "r")) { win.webContents.reload(); e.preventDefault(); }
    if (k.key === "F11") { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (k.key === "F12" && devTools) { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  win.webContents.on("did-finish-load", () => { if (pendingLink) { win.webContents.send("skybee:link", pendingLink); pendingLink = null; } });
  win.on("closed", () => { win = null; });
  win.loadURL(HOME);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  // a second launch only brings the running window to the front — or carries a skybee:// link to it
  pendingLink = linkIn(process.argv);
  app.on("second-instance", (_e, argv) => { const l = linkIn(argv); l ? deliverLink(l) : show(); });
  app.on("open-url", (e, url) => { e.preventDefault(); deliverLink(url); }); // macOS
  // Windows: registered for the current user at every start; Linux: the .desktop file (MimeType) does it
  if (!process.env.FLATPAK_ID) {
    try { process.defaultApp ? app.setAsDefaultProtocolClient(LINK, process.execPath, [path.resolve(process.argv[1] || ".")]) : app.setAsDefaultProtocolClient(LINK); } catch {}
  }
  app.on("before-quit", () => { quitting = true; });
  app.setAppUserModelId("io.github.vysocavnu.skybee"); // Windows shows notifications under this name
  Menu.setApplicationMenu(null);
  app.whenReady().then(() => {
    const root = pickWebRoot();
    protocol.handle("app", async (req) => {
      const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/$/, "/index.html");
      for (const base of root === BUNDLED ? [BUNDLED] : [root, BUNDLED]) { // what the download lacks comes from the bundle
        const file = path.join(base, rel);
        if (!file.startsWith(base + path.sep)) return new Response("", { status: 403 });
        try { return await net.fetch(pathToFileURL(file).toString()); } catch { /* try the next one */ }
      }
      return new Response("", { status: 404 });
    });
    // Electron grants every permission by default — to Skybee and to the players it embeds (YouTube, Spotify…) alike.
    // Only what Skybee uses is allowed: notifications for its own page; full screen, copying and DRM audio for everyone.
    const ALLOWED = new Set(["fullscreen", "clipboard-sanitized-write", "mediaKeySystem"]);
    const allow = (perm, origin) => ALLOWED.has(perm) || (perm === "notifications" && String(origin || "").startsWith(HOME));
    const ses = require("electron").session.defaultSession;
    ses.setPermissionRequestHandler((wc, perm, cb, d) => cb(allow(perm, d?.requestingUrl || wc?.getURL())));
    ses.setPermissionCheckHandler((wc, perm, origin) => allow(perm, origin && origin + "/"));
    createWindow();
    try { setupTray(); } catch { /* no tray on this system: closing the window quits */ quitting = true; }
    // Flathub forbids apps that fetch and run their own code past it: there updates come only through Flathub
    if (!process.env.FLATPAK_ID) setTimeout(() => updateWeb(root).catch(() => { /* offline or the site is down: try again next start */ }), 3000);
    setupShellUpdates();
    app.on("activate", () => { if (!win) createWindow(); });
  });
  app.on("window-all-closed", () => { if (quitting) app.quit(); });
}
