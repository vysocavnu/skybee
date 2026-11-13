// The only bridge between the web app and the desktop shell: the shell's version, «check for updates» and skybee:// links.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("skybeeDesktop", {
  version: () => ipcRenderer.invoke("skybee:version"),
  update: () => ipcRenderer.invoke("skybee:update"), // check for a new version of the app now
  onLink: (cb) => ipcRenderer.on("skybee:link", (_e, url) => cb(String(url))), // skybee://… opened in the browser
});
