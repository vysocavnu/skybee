// Interface languages. The code is written in Ukrainian; another language is a dictionary js/i18n/<code>.js
// { "український текст": "translation" } and this module swaps the text on the page as it appears
// (text nodes and title/placeholder/aria-label), so nothing else in the code has to change.
// {0}, {1}… in a key stand for parts that change (numbers, names): «{0} хв» ↔ «{0} min».
// People's own words (posts, bios, chats, names in fields) are never touched: SKIP below.
// The keys come from scripts/i18n-extract.mjs → i18n/keys.json.

// [code, name in that language, group, dictionary file]. Ukrainian spellings and dialects fall back to the plain
// Ukrainian text wherever their dictionary has no entry of its own.
export const UI_LANGS = [
  ["uk", "Українська (правопис 2019)", "uk"],
  ["uk-x-1928", "Українська (харківський правопис 1928)", "uk", () => import("./i18n/uk-1928.js")],
  ["en", "English", "eu", () => import("./i18n/en.js")],
];
// Soviet spellings of 1933–1990, written to bring Ukrainian closer to Russian, are deliberately not offered.
const KEY = "skybee.ui.lang";
const read = () => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } };
const known = (c) => UI_LANGS.some(l => l[0] === c);
// nothing chosen yet: the browser's language if Skybee speaks it, else Ukrainian
const auto = () => { for (const l of navigator.languages || []) { const b = String(l).toLowerCase().split("-")[0]; if (b === "uk" || b === "ru" || b === "be") return "uk"; if (known(b)) return b; } return "uk"; };
export const uiLang = known(read()) ? read() : auto();
export const setUiLang = (c) => { try { localStorage.setItem(KEY, c); } catch {} };
// locale for dates and numbers (private-use tags like uk-x-1928 → uk)
export const locale = uiLang.split("-x-")[0];

const CYR = /[А-ЯЁЇІЄҐа-яїієґ]/;
const dict = new Map(), pats = [];
const PH = /\{\d+\}/g;
let MAX = 0; // the longest key: longer text on the page is never interface text (and is not run through the patterns)
async function load() {
  const entry = UI_LANGS.find(l => l[0] === uiLang);
  if (!entry?.[3]) return;
  let d = {};
  try { d = (await entry[3]()).default || {}; } catch { return; }
  const pieces = [];
  for (const [k, v] of Object.entries(d)) {
    if (typeof v !== "string" || !v) continue;
    MAX = Math.max(MAX, k.length);
    put(k, v);
    // where {0} turns out to be an element (an icon, a link), the page shows the text around it as separate pieces:
    // «Знайомтеся: {0} і» → «Знайомтеся:» and «і». Same order of {n} on both sides → the pieces match one to one
    const ks = k.match(PH), vs = v.match(PH);
    if (ks && vs && ks.join() === vs.join()) {
      const kp = k.split(PH), vp = v.split(PH);
      kp.forEach((x, i) => { x = x.trim(); const y = vp[i].trim(); if (x && y && CYR.test(x)) pieces.push([x, y]); });
    }
  }
  for (const [x, y] of pieces) if (!dict.has(x)) dict.set(x, y);
  // the most specific pattern first: «і ще {0} {1}» before «і ще {0}»
  pats.sort((p, q) => q[3] - p[3] || q[1].length - p[1].length);
}
function put(k, v) {
  if (!dict.has(k)) dict.set(k, v); // t("до {0}", date) looks the template up as it is
  if (!/\{\d+\}/.test(k)) return;
  // a short template («{0} хв», «{0}К», «до {0}») takes only a number, or it would catch any text that ends or starts so
  const lit = k.replace(PH, "").trim(), part = lit.length <= 3 ? "([\\d\\s.,:+−-]{1,24}?)" : "([\\s\\S]{1,160}?)";
  const order = (k.match(PH) || []).map(x => +x.slice(1, -1));
  const re = new RegExp("^" + k.split(PH).map(x => x.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&")).join(part) + "$");
  pats.push([re, order, v, lit.length]);
}
let active = false;
// No top-level await (Safari before 15 cannot parse it): app.js waits for this before the first screen
export const ready = load().then(() => { active = dict.size > 0; if (active) start(); }, () => {});

const memo = new Map();
// t("текст", a, b): the translation (or the text itself) with {0}, {1} filled in — for alerts, notifications, titles
export function t(s, ...args) {
  let r = active ? lookup(String(s)) ?? String(s) : String(s);
  return args.length ? r.replace(/\{(\d+)\}/g, (m, n) => (args[n] ?? m)) : r;
}
function lookup(s) {
  if (s.length > MAX + 40) return undefined;
  if (memo.has(s)) return memo.get(s);
  let r = dict.get(s);
  if (r === undefined) for (const [re, order, v] of pats) {
    const m = s.match(re);
    if (!m) continue;
    const parts = []; order.forEach((n, i) => { parts[n] = m[i + 1]; });
    // the changing parts may hold words of their own («3 ваші пости»)
    r = v.replace(/\{(\d+)\}/g, (_, n) => { const p = parts[n] ?? ""; return /[А-ЯЇІЄҐа-яїієґ]/.test(p) ? (lookup(p.trim()) ?? p) : p; });
    break;
  }
  // «Поширити · 3 хв» — pieces joined with a dot are tried one by one
  if (r === undefined && s.includes(" · ")) {
    const bits = s.split(" · "), tr = bits.map(b => lookup(b) ?? b);
    if (tr.some((x, i) => x !== bits[i])) r = tr.join(" · ");
  }
  // «🚀 Коротко: …», «— усі пости…», «· щойно»: an emoji or a dash glued on by the markup around the text
  if (r == null) {
    const a = s.match(/^[^\p{L}\p{N}«"(]+/u)?.[0] || "", b = s.slice(a.length).match(/[^\p{L}\p{N}»").!?…]+$/u)?.[0] || "";
    const mid = s.slice(a.length, s.length - b.length);
    if ((a || b) && mid) { const x = lookup(mid); if (x != null) r = a + x + b; }
  }
  if (memo.size > 5000) memo.clear();
  memo.set(s, r ?? null);
  return r ?? undefined;
}
const tr = (s) => {
  if (!CYR.test(s)) return null;
  const core = s.replace(/\s+/g, " ").trim();
  const r = lookup(core);
  if (r == null || r === core) return null;
  const lead = s.match(/^\s*/)[0] ? " " : "", tail = s.match(/\s*$/)[0] ? " " : "";
  return lead + r + tail;
};

// people's words: posts, bios, descriptions, chats, and anything typed
const SKIP = ".text, .desc, .bio, .bubble, .rich, .ext, .sb-bubble, .rquote, .tile, img, video, .noi18n, [contenteditable], textarea, pre, code, script, style";
const ATTRS = ["title", "placeholder", "aria-label", "label"];
const done = new WeakMap(); // node → the text we put there (so our own change is not translated again)

function node(n) {
  if (n.nodeType === 3) {
    const p = n.parentElement;
    if (!p || done.get(n) === n.data || p.closest(SKIP)) return;
    const r = tr(n.data);
    if (r != null) { n.data = r; done.set(n, r); }
    return;
  }
  if (n.nodeType !== 1) return;
  attrs(n);
  if (n.closest(SKIP)) return;
  n.querySelectorAll?.("[title], [placeholder], [aria-label], optgroup[label]").forEach(attrs);
  const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
  let x; while ((x = w.nextNode())) node(x);
}
function attrs(el) {
  if (el.closest(SKIP) && !el.matches("textarea, [contenteditable]")) return;
  for (const a of ATTRS) {
    const v = el.getAttribute?.(a);
    if (!v || done.get(el)?.[a] === v) continue;
    const r = tr(v);
    if (r != null) { el.setAttribute(a, r.trim()); const m = done.get(el) || {}; m[a] = r.trim(); done.set(el, m); }
  }
}

function start() {
  document.documentElement.lang = locale;
  const run = () => {
    node(document.body);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === "childList") m.addedNodes.forEach(node);
        else if (m.type === "characterData") node(m.target);
        else if (m.type === "attributes") attrs(m.target);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    // the window title
    const ti = () => { const r = tr(document.title); if (r != null) document.title = r.trim(); };
    ti(); const tEl = document.querySelector("title"); if (tEl) new MutationObserver(ti).observe(tEl, { childList: true, characterData: true, subtree: true });
  };
  if (document.body) run(); else addEventListener("DOMContentLoaded", run, { once: true });
  // native dialogs get their text straight from the code
  const c = window.confirm, p = window.prompt, al = window.alert;
  const tt = (s) => (s === undefined ? s : t(s));
  window.confirm = (s) => c.call(window, tt(s));
  window.prompt = (s, d) => p.call(window, tt(s), d);
  window.alert = (s) => al.call(window, tt(s));
}
