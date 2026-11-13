// Copies the web app for the desktop (Electron, desktop/web/) or mobile (Capacitor, mobile/www/) bundle.
// The web version itself needs no build. Usage: node scripts/dist.mjs [desktop/web | mobile/www]
import { cpSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const target = process.argv[2] || "desktop/web";
const dist = root + target + "/";
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
for (const f of ["index.html", "favicon.ico", "css", "js", "icons", "manifest.webmanifest"]) cpSync(root + f, dist + f, { recursive: true });
// Capacitor (Android) puts its native bridge into the page as an inline script, which the Content-Security-Policy in
// index.html would block. So for the phones the policy is only carried along (meta name="skybee-csp") and native.js turns
// it on right after start — the bridge has already run by then, and everything after it is under the policy.
if (target.startsWith("mobile")) {
  const html = readFileSync(dist + "index.html", "utf8");
  const out = html.replace('<meta http-equiv="Content-Security-Policy"', '<meta name="skybee-csp"');
  if (out === html) throw new Error("index.html: не знайдено Content-Security-Policy");
  writeFileSync(dist + "index.html", out);
}
// the shell compares this with the site's deploy time to decide whether a downloaded copy is newer
writeFileSync(dist + "build.json", JSON.stringify({ time: Date.now() }));
console.log(target + "/ готово");
