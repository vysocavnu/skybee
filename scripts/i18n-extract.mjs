// Collects every piece of interface text (Ukrainian) from js/*.js and index.html into i18n/keys.json —
// the list a translator works from. Usage: node scripts/i18n-extract.mjs
// A piece = one text node or one title/placeholder/aria-label as the page shows it; ${…} inside it becomes {0}, {1}…
// (js/i18n.js matches those against the page with the same numbering).
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const CYR = /[А-ЯЁЇІЄҐа-яїієґ]/;
const ATTRS = /\b(title|placeholder|aria-label|data-tip|label)\s*=\s*$/i;
const keys = new Map(); // key → first place seen

const norm = (s) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, " ").trim();
function add(raw, where) {
  // renumber the expression markers in order of appearance
  let n = 0; const map = new Map();
  let s = norm(raw).replace(/\u0001(\d+)\u0002/g, (_, i) => { if (!map.has(i)) map.set(i, n++); return `{${map.get(i)}}`; });
  if (!CYR.test(s)) return;
  s = s.replace(/^(\{\d+\}\s*)+$/, "");
  if (!s) return;
  if (!keys.has(s)) keys.set(s, where);
}

// Splits markup into text nodes and translatable attribute values
function fromMarkup(s, where) {
  let text = "", i = 0;
  const flush = () => { add(text, where); text = ""; };
  while (i < s.length) {
    const c = s[i];
    if (c === "<" && /[a-zA-Z\/!]/.test(s[i + 1] || "")) {
      flush();
      const end = tagEnd(s, i);
      const tag = s.slice(i, end + 1);
      for (const m of tag.matchAll(/\b(?:title|placeholder|aria-label|data-tip|label|alt)\s*=\s*"([^"]*)"/gi)) add(m[1], where);
      for (const m of tag.matchAll(/\b(?:title|placeholder|aria-label|data-tip|label|alt)\s*=\s*'([^']*)'/gi)) add(m[1], where);
      i = end + 1;
    } else { text += c; i++; }
  }
  flush();
}
function tagEnd(s, i) {
  let q = null;
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === ">") return j;
  }
  return s.length - 1;
}

// A small JS scanner: finds string and template literals (templates may nest), skipping comments and regex literals.
// code() reads JavaScript until the end (or, inside ${…}, until its closing brace).
function scan(src, file) {
  let i = 0, line = 1;
  const where = () => `${file}:${line}`;
  const esc = (c) => ({ n: "\n", t: "\t" }[c] ?? c);
  function readString(q) { // i at the opening quote
    let out = ""; i++;
    while (i < src.length && src[i] !== q) {
      if (src[i] === "\\") { out += esc(src[i + 1]); i += 2; continue; }
      if (src[i] === "\n") line++;
      out += src[i++];
    }
    i++; return out;
  }
  function readTemplate() { // the text with \u0001k\u0002 markers in place of ${…}; what is inside them is scanned as code
    let out = "", k = 0; i++;
    while (i < src.length && src[i] !== "`") {
      if (src[i] === "\\") { out += esc(src[i + 1]); i += 2; continue; }
      if (src[i] === "$" && src[i + 1] === "{") { i += 2; code(true); out += `\u0001${k++}\u0002`; continue; }
      if (src[i] === "\n") line++;
      out += src[i++];
    }
    i++; return out;
  }
  function code(inner) {
    let depth = 0, prev = "";
    const regexOk = () => !prev || /[(,=:\[!&|?{};+\-*%<>~^]$/.test(prev) || /^(return|typeof|case|in|of|delete|void|throw|new|else|do|await|yield)$/.test(prev);
    while (i < src.length) {
      const c = src[i], d = src[i + 1];
      if (c === "\n") { line++; i++; continue; }
      if (/\s/.test(c)) { i++; continue; }
      if (c === "/" && d === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
      if (c === "/" && d === "*") { const e = src.indexOf("*/", i + 2); line += (src.slice(i, e).match(/\n/g) || []).length; i = e + 2; continue; }
      if (c === '"' || c === "'") { const w = where(); fromMarkup(readString(c), w); prev = "x"; continue; }
      if (c === "`") { const w = where(); fromMarkup(readTemplate(), w); prev = "x"; continue; }
      if (c === "/" && regexOk()) {
        i++; let cls = false;
        while (i < src.length) { const r = src[i]; if (r === "\\") { i += 2; continue; } if (r === "[") cls = true; else if (r === "]") cls = false; else if (r === "/" && !cls) break; else if (r === "\n") break; i++; }
        i++; while (/[a-z]/i.test(src[i] || "")) i++;
        prev = "x"; continue;
      }
      if (/[A-Za-z0-9_$]/.test(c)) { let w = ""; while (/[A-Za-z0-9_$]/.test(src[i] || "")) w += src[i++]; prev = w; continue; }
      if (c === "{") depth++;
      if (c === "}") { if (inner && depth === 0) { i++; return; } depth--; }
      prev = c; i++;
    }
  }
  code(false);
}

const SKIP = new Set(["stars.js", "i18n.js"]); // stars.js: transliteration tables and the site's own wording
for (const f of readdirSync(root + "js").filter(f => f.endsWith(".js") && !SKIP.has(f)).sort()) scan(readFileSync(root + "js/" + f, "utf8"), "js/" + f);
fromMarkup(readFileSync(root + "index.html", "utf8").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ""), "index.html");

mkdirSync(root + "i18n", { recursive: true });
const out = Object.fromEntries([...keys].sort((a, b) => a[1].localeCompare(b[1], "en", { numeric: true })));
writeFileSync(root + "i18n/keys.json", JSON.stringify(out, null, 1) + "\n");
console.log(keys.size, "pieces → i18n/keys.json");
