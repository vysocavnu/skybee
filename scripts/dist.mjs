// Copies the web app into dist/ for the Tauri bundle (the web version itself needs no build).
import { cpSync, rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = root + "dist/";
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
for (const f of ["index.html", "css", "js", "icons", "manifest.webmanifest"]) cpSync(root + f, dist + f, { recursive: true });
console.log("dist/ готово");
