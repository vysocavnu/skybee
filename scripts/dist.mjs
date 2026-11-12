// Copies the web app into dist/ for the desktop (Electron) bundle (the web version itself needs no build).
import { cpSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = root + "desktop/web/";
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
for (const f of ["index.html", "css", "js", "icons", "manifest.webmanifest"]) cpSync(root + f, dist + f, { recursive: true });
// the shell compares this with the site's deploy time to decide whether a downloaded copy is newer
writeFileSync(dist + "build.json", JSON.stringify({ time: Date.now() }));
console.log("desktop/web/ готово");
