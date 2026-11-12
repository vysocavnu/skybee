// Skybee desktop shell (Electron): one window with the web app inside, on its own Chromium —
// nothing from Edge or WebView2 is needed.
const { app, BrowserWindow, Menu, protocol, net, shell } = require("electron");
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

// ES modules and localStorage need a real origin, file:// gives neither
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let win = null;
const external = (url) => { if (/^(https?|mailto):/i.test(url)) shell.openExternal(url); };

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 820, minWidth: 360, minHeight: 520,
    title: "Skybee", icon: path.join(__dirname, "icon.png"), backgroundColor: "#0f1218",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
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
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
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
    setTimeout(() => updateWeb(root).catch(() => { /* offline or the site is down: try again next start */ }), 3000);
    app.on("activate", () => { if (!win) createWindow(); });
  });
  app.on("window-all-closed", () => app.quit());
}
