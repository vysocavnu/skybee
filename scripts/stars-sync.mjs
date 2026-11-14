// Збирає дані starsaboutwar.in.ua у data/stars.json — для позначок «Підтримує війну / Проти / Мовчить / Спірно»
// під треками в «✨ Оформленні» (js/stars.js). Сайт не має API і не дозволяє читати себе з інших сайтів (CORS),
// тож раз на добу це робить GitHub Actions (.github/workflows/stars.yml), а Skybee читає готовий файл.
//
// Бере з чотирьох категорій сайту ім'я, адресу сторінки й позицію; зі сторінки виконавця — лише короткий уривок
// (перші речення, до ~320 знаків): повний текст і оцінка належать авторам сайту, Skybee веде на їхню сторінку.
// Уривки нових виконавців докачуються, старі беруться з попереднього файлу — сайт не навантажуємо.
// Запуск: node scripts/stars-sync.mjs   (з хмарної сесії за проксі: NODE_USE_ENV_PROXY=1 node scripts/stars-sync.mjs)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const SITE = "https://starsaboutwar.in.ua";
const OUT = new URL("../data/stars.json", import.meta.url);
const CATS = [["za-viinu", "za"], ["proty-viiny", "proty"], ["movchuny", "movchat"], ["spirni", "spirno"]];
const STEP = 50;
const HEADERS = { "User-Agent": "SkybeeBot/1.0 (+https://github.com/vysocavnu/skybee; once a day)", "Accept-Language": "uk" };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const unent = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
  .replace(/&laquo;/g, "«").replace(/&raquo;/g, "»").replace(/&nbsp;/g, " ").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&amp;/g, "&");
const text = (html) => unent(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

async function get(path, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(SITE + path, { headers: HEADERS });
      if (r.ok) return await r.text();
      if (r.status === 404) return null;
      throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (i >= tries) throw new Error(`${path}: ${e.message}`);
      await sleep(2000 * i);
    }
  }
}

// a category page: cards with a picture (alt = name) and a title link
function cards(html) {
  const out = [];
  for (const m of html.matchAll(/<div class="uk-card[^"]*">([\s\S]*?)<\/h3>/g)) {
    const block = m[1];
    const slug = block.match(/href="\/([a-z0-9-]+)"/)?.[1];
    if (!slug) continue;
    const alt = unent(block.match(/<img[^>]*\salt="([^"]*)"/)?.[1] || "").trim();
    const title = text(block.match(/<h3[^>]*>([\s\S]*)$/)?.[1] || "");
    out.push({ slug, names: [...new Set([title, alt].filter(Boolean))] });
  }
  return out;
}

// from the «Позиція … щодо війни» part of the artist's page (not the biography above it): its first paragraphs, at most
// ~320 characters, and the points of that part (its sub-headings, e.g. «Підтримка анексії Криму») — a summary with
// a link to the full text on the site
function summary(html) {
  const art = html.match(/itemprop="articleBody"[^>]*>([\s\S]*?)(?:<h4[^>]*>\s*Розділ коментарів|<footer|$)/)?.[1] || "";
  const at = art.search(/<h2[^>]*>[^<]*(?:війн|войн)/i);
  const part = at >= 0 ? art.slice(at) : art;
  const points = [...part.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)].map(m => text(m[1])).filter(Boolean).slice(0, 6);
  let t = "";
  for (const m of part.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
    const para = text(m[1]);
    if (!para || /^Навігація/.test(para)) continue;
    t += (t ? " " : "") + para;
    if (t.length > 200) break;
  }
  if (t.length > 320) {
    const cut = t.slice(0, 320), end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    t = end > 120 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…";
  }
  return [t.trim(), points];
}

let prev = {};
try { for (const [slug, , , ex, points] of JSON.parse(readFileSync(OUT, "utf8")).artists) if (Array.isArray(points)) prev[slug] = [ex, points]; } catch { /* first run */ }

const artists = new Map(); // slug → [slug, status, names, excerpt]
for (const [cat, status] of CATS) {
  for (let start = 0; start < 5000; start += STEP) {
    const html = await get(`/${cat}${start ? `?start=${start}` : ""}`);
    const found = html ? cards(html) : [];
    let fresh = 0;
    for (const c of found) if (!artists.has(c.slug)) { artists.set(c.slug, [c.slug, status, c.names, "", []]); fresh++; }
    console.log(`${cat} @${start}: ${found.length} cards, ${fresh} new`);
    if (!fresh) break;
    await sleep(400);
  }
}
if (artists.size < 100) { console.error(`Only ${artists.size} artists — the site looks broken; data/stars.json is left as it was.`); process.exit(1); }

let fetched = 0;
for (const a of artists.values()) {
  if (prev[a[0]]) { [a[3], a[4]] = prev[a[0]]; continue; }
  try { const html = await get("/" + a[0]); if (html) [a[3], a[4]] = summary(html); fetched++; } catch (e) { console.warn(e.message); }
  await sleep(300);
}

const list = [...artists.values()].sort((x, y) => x[0].localeCompare(y[0]));
let old = null; try { old = JSON.stringify(JSON.parse(readFileSync(OUT, "utf8")).artists); } catch {}
if (old === JSON.stringify(list)) { console.log(`No changes (${list.length} artists).`); process.exit(0); }
mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  source: SITE,
  note: "Позиції й тексти — starsaboutwar.in.ua, не Skybee. Кожен запис: [адреса сторінки, позиція za|proty|movchat|spirno, імена, уривок про позицію, пункти].",
  updated: new Date().toISOString(),
  artists: list,
}) + "\n");
console.log(`Saved ${list.length} artists (${fetched} new excerpts).`);
