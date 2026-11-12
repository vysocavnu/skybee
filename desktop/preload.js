// The only bridge between the web app and the desktop shell: the sign-up captcha (it needs a window that can see
// where bsky.social redirects to, which a web page cannot) and the shell's version.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("skybeeDesktop", {
  captcha: (url, state) => ipcRenderer.invoke("skybee:captcha", url, state),
  version: () => ipcRenderer.invoke("skybee:version"),
});
