// Позиції виконавців щодо війни — з сайту starsaboutwar.in.ua (не Skybee). Дані збирає раз на добу GitHub Actions
// (scripts/stars-sync.mjs → data/stars.json); тут — пошук виконавця за ім'ям і позначки для «✨ Оформлення».
// Ім'я порівнюється без регістру, пробілів і розділових знаків, кирилиця — латиницею (обидва способи: українською й
// російською, бо «Джиган» = Dzhyhan = Dzhigan). Трек з кількома виконавцями (feat., &, x) — позиція кожного по черзі.
import { esc } from "./ui.js";

const SITE = "https://vysocavnu.github.io/skybee/"; // the apps read the file from the site: always the newest
export const SOURCE = "https://starsaboutwar.in.ua";
export const STATUS = {
  za: { t: "Підтримує війну", cls: "za", icon: "🔴" },
  proty: { t: "Проти війни", cls: "proty", icon: "🟢" },
  movchat: { t: "Мовчить", cls: "movchat", icon: "⚪" },
  spirno: { t: "Спірно", cls: "spirno", icon: "🟡" },
  none: { t: "Немає даних", cls: "none", icon: "" },
};

const UK = { а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh", з: "z", и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "iu", я: "ia", "'": "", "’": "" };
const RU = { ...UK, г: "g", е: "e", ё: "e", и: "i", й: "y", х: "h", ы: "y", э: "e", ъ: "", ю: "yu", я: "ya", щ: "sch" };
const latin = (s, map) => [...s].map(ch => map[ch] ?? ch).join("");
// every way to write a name: as it is (Latin), and Cyrillic read the Ukrainian and the Russian way
export function keys(name) {
  const base = String(name || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/^the\s+/, "").replace(/&/g, "and");
  return [...new Set([latin(base, UK), latin(base, RU)].map(k => k.replace(/[^a-z0-9]/g, "")).filter(k => k.length > 1))];
}

let ready = null;
// → { find(name) → entry | null } ; entry: { slug, status, names, excerpt, url }
export function stars() {
  return ready ||= (async () => {
    const url = location.protocol.startsWith("http") ? "data/stars.json" : SITE + "data/stars.json";
    const r = await fetch(url);
    if (!r.ok) throw new Error("stars " + r.status);
    const d = await r.json();
    const index = new Map();
    for (const [slug, status, names, excerpt] of d.artists || []) {
      if (!STATUS[status]) continue;
      const e = { slug, status, names, excerpt: String(excerpt || ""), url: `${SOURCE}/${encodeURIComponent(slug)}` };
      for (const n of [...names, slug.replace(/-/g, " ")]) for (const k of keys(n)) if (!index.has(k)) index.set(k, e);
    }
    return { find: (name) => { for (const k of keys(name)) { const e = index.get(k); if (e) return e; } return null; } };
  })().catch((e) => { ready = null; throw e; });
}

// «A feat. B & C», «A x B», «A, B» → [A, B, C]
export const splitArtists = (s) => String(s || "").split(/\s*(?:,|&|\+|\/|;|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\s[x×]\s|\sі\s|\sи\s|\sand\s)\s*/i).map(x => x.trim()).filter(Boolean);

// → [{ name, entry|null }] for every artist of a track
export async function check(artist) {
  const db = await stars();
  return splitArtists(artist).map(name => ({ name, entry: db.find(name) }));
}

// a line of coloured marks: «🔴 A — Підтримує війну · B — Немає даних»
export function marks(list) {
  return list.map(({ name, entry }) => {
    const st = STATUS[entry?.status || "none"];
    return `<span class="saw-mark saw-${st.cls}">${st.icon ? st.icon + " " : ""}${list.length > 1 ? `<b>${esc(name)}</b> — ` : ""}${entry
      ? `<a href="${esc(entry.url)}" target="_blank" rel="noopener">${st.t}</a>` : st.t}</span>`;
  }).join("");
}

// the full answer under a track on a profile: each artist, the excerpt, the link to the source
export function details(list) {
  return list.map(({ name, entry }) => {
    const st = STATUS[entry?.status || "none"];
    return `<div class="saw-item"><div class="saw-mark saw-${st.cls}">${st.icon ? st.icon + " " : ""}<b>${esc(name)}</b> — ${st.t}</div>${
      entry?.excerpt ? `<p class="small">${esc(entry.excerpt)}</p>` : ""}${
      entry ? `<a class="small" href="${esc(entry.url)}" target="_blank" rel="noopener">Читати повністю на starsaboutwar.in.ua ↗</a>` : ""}</div>`;
  }).join("") + `<p class="muted small saw-src">Позиції й тексти — <a href="${SOURCE}" target="_blank" rel="noopener">starsaboutwar.in.ua</a>. Це їхня оцінка, не Skybee.</p>`;
}
