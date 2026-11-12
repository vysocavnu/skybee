// Skybee desktop shell (Electron): one window with the web app inside, on its own Chromium —
// nothing from Edge or WebView2 is needed.
const { app, BrowserWindow, Menu, protocol, net, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const WEB = path.join(__dirname, "web");
const HOME = "app://skybee/";

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
    protocol.handle("app", async (req) => {
      const { pathname } = new URL(req.url);
      const file = path.join(WEB, decodeURIComponent(pathname === "/" ? "/index.html" : pathname));
      if (!file.startsWith(WEB + path.sep)) return new Response("", { status: 403 });
      try { return await net.fetch(pathToFileURL(file).toString()); }
      catch { return new Response("", { status: 404 }); }
    });
    createWindow();
    app.on("activate", () => { if (!win) createWindow(); });
  });
  app.on("window-all-closed", () => app.quit());
}
