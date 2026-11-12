// Copies the web app for the desktop (Electron, desktop/web/) or mobile (Capacitor, mobile/www/) bundle.
// The web version itself needs no build. Usage: node scripts/dist.mjs [desktop/web | mobile/www]
import { cpSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const target = process.argv[2] || "desktop/web";
const dist = root + target + "/";
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
for (const f of ["index.html", "favicon.ico", "css", "js", "icons", "manifest.webmanifest"]) cpSync(root + f, dist + f, { recursive: true });
// the shell compares this with the site's deploy time to decide whether a downloaded copy is newer
writeFileSync(dist + "build.json", JSON.stringify({ time: Date.now() }));
console.log(target + "/ готово");
