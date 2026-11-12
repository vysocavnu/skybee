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
function setupShellUpdates() {
  if (!app.isPackaged) return;
  // Windows (installer) and the AppImage update themselves; Flatpak and tar.gz are updated by Flathub / by hand
  if (process.platform !== "win32" && !process.env.APPIMAGE) return;
  let autoUpdater;
  try { ({ autoUpdater } = require("electron-updater")); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  let asked = false;
  autoUpdater.on("before-quit-for-update", () => { quitting = true; });
  autoUpdater.on("download-progress", (p) => win?.setProgressBar(Math.max(0.01, (p.percent || 0) / 100)));
  autoUpdater.on("error", () => win?.setProgressBar(-1)); // offline, GitHub down…: quietly try again later
  autoUpdater.on("update-downloaded", async (info) => {
    win?.setProgressBar(-1);
    if (asked) return;
    asked = true;
    const { response } = await dialog.showMessageBox(win, {
      type: "info", title: "Оновлення Skybee", noLink: true, defaultId: 0, cancelId: 1,
      message: `Завантажено нову версію Skybee ${info.version}`,
      detail: "Перезапустити й оновити зараз? Якщо відкласти, оновлення встановиться саме, коли закриєш Skybee.",
      buttons: ["Оновити зараз", "Пізніше"],
    });
    if (response === 0) setImmediate(() => autoUpdater.quitAndInstall(true, true)); // silently, then start Skybee again
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 8000);
  setInterval(check, 6 * 3600e3);
}

// ES modules and localStorage need a real origin, file:// gives neither
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let win = null, tray = null, quitting = false;
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
    { type: "separator" },
    { label: "Вийти", click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(build());
  tray.on("click", show);
  tray.on("right-click", () => tray.setContextMenu(build()));
}

/* ---------- sign-up captcha ----------
   bsky.social asks new accounts to pass a captcha at /gate/signup; when solved it redirects to bsky.app with ?state&code.
   A child window watches for that redirect and hands the code back to the web app. */
ipcMain.handle("skybee:version", () => app.getVersion());
ipcMain.handle("skybee:captcha", (_e, url, state) => new Promise((resolve) => {
  let u; try { u = new URL(url); } catch { return resolve(null); }
  if (u.protocol !== "https:" || !u.pathname.startsWith("/gate/")) return resolve(null);
  const w = new BrowserWindow({ parent: win, modal: true, width: 480, height: 720, title: "Перевірка", autoHideMenuBar: true,
    backgroundColor: "#ffffff", webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  let done = false;
  const finish = (code) => { if (done) return; done = true; resolve(code); if (!w.isDestroyed()) w.close(); };
  const look = (e, next) => {
    let n; try { n = new URL(next); } catch { return; }
    if (n.host === u.host) return; // still the captcha page
    e?.preventDefault?.();
    finish(n.searchParams.get("state") === state ? n.searchParams.get("code") : null);
  };
  w.webContents.on("will-navigate", look);
  w.webContents.on("will-redirect", look);
  w.webContents.setWindowOpenHandler(({ url: x }) => { external(x); return { action: "deny" }; });
  w.on("closed", () => finish(null));
  w.loadURL(url);
}));
const external = (url) => { if (/^(https?|mailto):/i.test(url)) shell.openExternal(url); };

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 820, minWidth: 360, minHeight: 520,
    title: "Skybee", icon: path.join(__dirname, "icon.png"), backgroundColor: "#0f1218",
    autoHideMenuBar: true,
    show: !startHidden,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true,
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
    if (k.key === "F12") { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  win.on("closed", () => { win = null; });
  win.loadURL(HOME);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  // a second launch only brings the running window to the front
  app.on("second-instance", show);
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
    createWindow();
    try { setupTray(); } catch { /* no tray on this system: closing the window quits */ quitting = true; }
    setTimeout(() => updateWeb(root).catch(() => { /* offline or the site is down: try again next start */ }), 3000);
    setupShellUpdates();
    app.on("activate", () => { if (!win) createWindow(); });
  });
  app.on("window-all-closed", () => { if (quitting) app.quit(); });
}
