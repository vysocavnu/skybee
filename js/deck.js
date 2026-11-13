// Skybee — deck (several columns side by side) and the own-feed builder («Мої стрічки»)
import { errText } from "./errors.js";
import * as api from "./api.js";
import * as src from "./sources.js";
import { $, esc, enc, toast, modal, confirmBox, menu, empty, at } from "./ui.js";
import { header, paged, notifPager, NFILTERS, isGrid, gridBtn, onGrid, MENU_BTN } from "./views.js";

/* ---------- choosing a source ---------- */
async function savedChoices() {
  const out = { feeds: [], lists: [] };
  try {
    const items = await api.getSavedFeeds();
    const fu = items.filter(i => i.type === "feed").map(i => i.value);
    const gens = fu.length ? (await api.get("app.bsky.feed.getFeedGenerators", { feeds: fu })).feeds : [];
    out.feeds = gens.map(g => ({ uri: g.uri, label: g.displayName }));
    if (!out.feeds.length) {
      const d = await api.get("app.bsky.feed.getFeedGenerators", { feeds: api.DEFAULT_FEEDS });
      out.feeds = d.feeds.map(g => ({ uri: g.uri, label: g.displayName }));
    }
    const seen = new Set();
    for (const l of await api.getMyLists().catch(() => [])) { seen.add(l.uri); out.lists.push({ uri: l.uri, label: l.name }); }
    for (const i of items.filter(i => i.type === "list" && !seen.has(i.value))) {
      try { const l = (await api.get("app.bsky.graph.getList", { list: i.value, limit: 1 })).list; out.lists.push({ uri: l.uri, label: l.name }); } catch {}
    }
  } catch {}
  return out;
}

const opts = (arr, sel) => arr.map(([v, l]) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(l)}</option>`).join("");

// Resolves with { type, value?, sort?, label, as? } or null. deck = true also offers notifications, own feeds and the account
export function pickSource({ deck = false, title = "Додати джерело" } = {}) {
  return new Promise(async (resolve) => {
    const types = Object.keys(src.TYPES).filter(t => deck || !["notifications", "myfeed"].includes(t));
    const multi = deck && api.accounts.length > 1;
    let done = false;
    const m = modal(`<h3>${esc(title)}</h3>
      <label class="field">Що показувати<select data-f="type">${opts(types.map(t => [t, `${src.ICON[t]} ${src.TYPES[t]}`]), "timeline")}</select></label>
      <div data-extra></div>
      ${multi ? `<label class="field">Від імені акаунта<select data-f="as">${opts(api.accounts.map(a => [a.did, "@" + a.handle]), api.session.did)}</select></label>` : ""}
      <p class="err"></p>
      <div class="row end"><button class="ghost" data-x="0">Скасувати</button><button class="btn" data-x="1">Додати</button></div>`,
      { onClose: () => { if (!done) resolve(null); } });
    const extra = $("[data-extra]", m), err = $(".err", m), sel = $("[data-f=type]", m);
    let choices = null;
    const draw = async () => {
      const t = sel.value;
      if (t === "timeline") extra.innerHTML = `<p class="hint">Пости тих, за ким ти стежиш.</p>`;
      if (t === "search") extra.innerHTML = `<label class="field">Слова, #тег або from:нік<input data-f="q" placeholder="Наприклад: #україна або bluesky"></label>
        <label class="field">Порядок<select data-f="sort">${opts([["latest", "Найновіші"], ["top", "Найкращі"]], "latest")}</select></label>`;
      if (t === "author") extra.innerHTML = `<label class="field">Нік<input data-f="q" placeholder="@нік" autocapitalize="none"></label>
        <label class="field">Які пости<select data-f="sort">${opts([["posts_and_author_threads", "Пости"], ["posts_with_replies", "Пости й відповіді"], ["posts_with_media", "Лише медіа"], ["posts_no_replies", "Без відповідей"]], "posts_and_author_threads")}</select></label>`;
      if (t === "notifications") extra.innerHTML = `<label class="field">Які<select data-f="sort">${opts(NFILTERS.map(([k, l]) => [k, k === "mentions" ? "Згадки, відповіді й цитати" : l]), "")}</select></label>`;
      if (t === "feed" || t === "list") {
        extra.innerHTML = `<p class="muted small">Завантаження…</p>`;
        choices ||= await savedChoices();
        if (sel.value !== t) return;
        const arr = t === "feed" ? choices.feeds : choices.lists;
        extra.innerHTML = `${arr.length ? `<label class="field">${t === "feed" ? "Збережений фід" : "Список"}<select data-f="pick">${opts(arr.map(x => [x.uri, x.label]))}</select></label>` : ""}
          <label class="field">${arr.length ? "Або посилання" : "Посилання"} на ${t === "feed" ? "фід" : "список"} з bsky.app<input data-f="q" placeholder="https://bsky.app/profile/…/${t === "feed" ? "feed" : "lists"}/…"></label>`;
      }
      if (t === "myfeed") {
        const mine = await src.myFeeds().catch(() => []);
        if (sel.value !== t) return;
        extra.innerHTML = mine.length ? `<label class="field">Стрічка<select data-f="pick">${opts(mine.map(f => [f.id, f.name]))}</select></label>`
          : `<p class="hint">Власних стрічок ще немає. <a href="#/myfeeds/new">Створити</a></p>`;
      }
    };
    sel.onchange = draw; draw();
    m.addEventListener("click", async (e) => {
      const x = e.target.closest("[data-x]"); if (!x) return;
      if (x.dataset.x === "0") return m.close();
      const t = sel.value, f = (k) => $(`[data-f=${k}]`, m)?.value?.trim() || "";
      err.textContent = ""; x.disabled = true;
      try {
        let s = { type: t, label: src.TYPES[t] };
        if (t === "search") { if (!f("q")) throw new Error("Введи, що шукати"); s = { type: t, value: f("q"), sort: f("sort"), label: f("q") }; }
        if (t === "author") {
          if (!f("q")) throw new Error("Введи нік");
          const p = await api.get("app.bsky.actor.getProfile", { actor: api.normalizeHandle(f("q")) });
          s = { type: t, value: p.did, sort: f("sort"), label: p.displayName || "@" + p.handle };
        }
        if (t === "notifications") s = { type: t, sort: f("sort"), label: f("sort") ? NFILTERS.find(x => x[0] === f("sort"))[1] : "Сповіщення" };
        if (t === "feed" || t === "list") {
          if (f("q")) {
            const got = await src.sourceFromUrl(f("q"));
            if (!got || got.type !== t) throw new Error(`Це не посилання на ${t === "feed" ? "фід" : "список"}`);
            s = got;
            s.label = t === "feed" ? (await api.get("app.bsky.feed.getFeedGenerator", { feed: s.value })).view.displayName
              : (await api.get("app.bsky.graph.getList", { list: s.value, limit: 1 })).list.name;
          } else if (f("pick")) {
            const arr = t === "feed" ? choices.feeds : choices.lists;
            s = { type: t, value: f("pick"), label: arr.find(c => c.uri === f("pick"))?.label || src.TYPES[t] };
          } else throw new Error("Обери або встав посилання");
        }
        if (t === "myfeed") {
          if (!f("pick")) throw new Error("Спершу створи стрічку");
          s = { type: t, value: f("pick"), label: (await src.myFeed(f("pick")))?.name || src.TYPES[t] };
        }
        if (multi && f("as") !== api.session.did) s.as = f("as");
        done = true; m.close(); resolve(s);
      } catch (ex) { err.textContent = errText(ex); x.disabled = false; }
    });
  });
}

/* ================= DECK ================= */
const DECK = () => "skybee.deck." + api.session.did;
function loadCols() {
  try { const c = JSON.parse(localStorage.getItem(DECK())); if (Array.isArray(c)) return c; } catch {}
  return [{ id: "c1", type: "timeline", label: "Підписки" }, { id: "c2", type: "notifications", label: "Сповіщення" }, { id: "c3", type: "notifications", sort: "mentions", label: "Згадки" }];
}
const saveCols = (c) => { try { localStorage.setItem(DECK(), JSON.stringify(c)); } catch {} };

export async function deck(el) {
  document.body.classList.add("deckmode");
  let cols = loadCols();
  const stops = new Map();
  // compact or roomy columns (narrower, denser posts — handy on a big monitor), remembered on this device
  const compact = () => { try { return localStorage.getItem("skybee.deckCompact") === "1"; } catch { return false; } };
  const densBtn = () => `<button class="ghost sm" data-d="density" title="Щільність колонок">${compact() ? "▤ <span class=\"dl\">Компактно</span>" : "▥ <span class=\"dl\">Звичайно</span>"}</button>`;
  el.innerHTML = `<div class="topbar">${MENU_BTN}<h2>Колонки</h2><div class="grow"></div>${densBtn()}<button class="btn sm" data-d="add">＋ Колонка</button></div><div class="deck${compact() ? " compact" : ""}"></div>`;
  const row = $(".deck", el);
  const account = (c) => api.accounts.find(a => a.did === c.as);
  const colHtml = (c) => {
    const who = account(c);
    return `<section class="dcol" data-id="${esc(c.id)}">
      <header class="dhead"><span class="dtitle clip" title="${esc(c.label)}">${src.ICON[c.type] || ""} <b>${esc(c.label)}</b>${who ? ` <small class="muted">${at(who.handle)}</small>` : ""}</span>
        ${c.type === "notifications" ? "" : `<button class="ghost icon" data-d="grid" title="${c.grid ? "Звичайна стрічка" : "Сітка медіа"}">${c.grid ? "☰" : "▦"}</button>`}
        <button class="ghost icon" data-d="refresh" title="Оновити">↻</button>
        <button class="ghost icon" data-d="menu" title="Ще">⋯</button></header>
      <div class="dbody"></div></section>`;
  };
  const load = (c) => {
    const box = row.querySelector(`.dcol[data-id="${CSS.escape(c.id)}"] .dbody`);
    if (!box) return;
    stops.get(c.id)?.(); box.innerHTML = ""; box.scrollTop = 0;
    box.parentElement.querySelector("[data-d=refresh]")?.classList.remove("fresh");
    const as = account(c);
    const pager = c.type === "notifications" ? notifPager({ filter: c.sort || undefined, as }) : src.feedPager(c, { as, grid: !!c.grid });
    stops.set(c.id, paged(box, pager, { cls: c.grid ? "tiles" : "", root: box }));
  };
  const draw = () => {
    for (const s of stops.values()) s(); stops.clear();
    row.innerHTML = cols.map(colHtml).join("") + (cols.length ? "" : empty("Додай першу колонку: стрічку, пошук, сповіщення чи список"));
    cols.forEach(load);
  };
  const add = async () => {
    const s = await pickSource({ deck: true, title: "Нова колонка" });
    if (!s) return;
    cols.push({ id: api.tid(), ...s }); saveCols(cols); draw();
    row.scrollTo({ left: row.scrollWidth, behavior: "smooth" });
  };
  el.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-d]"); if (!b) return;
    e.preventDefault();
    if (b.dataset.d === "add") return add();
    if (b.dataset.d === "density") {
      try { localStorage.setItem("skybee.deckCompact", compact() ? "0" : "1"); } catch {}
      row.classList.toggle("compact", compact()); b.outerHTML = densBtn(); return;
    }
    const id = b.closest(".dcol")?.dataset.id, i = cols.findIndex(c => c.id === id), c = cols[i];
    if (!c) return;
    if (b.dataset.d === "refresh") load(c);
    if (b.dataset.d === "grid") { c.grid = !c.grid; saveCols(cols); b.outerHTML = `<button class="ghost icon" data-d="grid" title="${c.grid ? "Звичайна стрічка" : "Сітка медіа"}">${c.grid ? "☰" : "▦"}</button>`; load(c); }
    if (b.dataset.d === "menu") {
      const act = await menu(b, [
        ...(i > 0 ? [{ act: "left", label: "← Посунути ліворуч" }] : []),
        ...(i < cols.length - 1 ? [{ act: "right", label: "Посунути праворуч →" }] : []),
        { act: "rename", label: "✏️ Перейменувати" },
        "-", { act: "del", label: "✕ Прибрати колонку", danger: true },
      ]);
      if (act === "left" || act === "right") { const j = act === "left" ? i - 1 : i + 1; [cols[i], cols[j]] = [cols[j], cols[i]]; saveCols(cols); draw(); }
      if (act === "rename") { const n = prompt("Назва колонки", c.label); if (n?.trim()) { c.label = n.trim(); saveCols(cols); draw(); } }
      if (act === "del") { cols.splice(i, 1); saveCols(cols); draw(); }
    }
  });
  draw();
  // monitoring without jumping: every two minutes each column quietly checks its first page;
  // when there is something new, the ↻ button gets a dot — the posts on screen are never replaced on their own
  const firstKey = (html) => html.join("").match(/data-(?:uri|href)="([^"]+)"/)?.[1];
  const timer = setInterval(async () => {
    if (document.hidden) return;
    for (const c of cols) {
      const col = row.querySelector(`.dcol[data-id="${CSS.escape(c.id)}"]`), shown = col?.querySelector(".dbody [data-uri], .dbody [data-href]");
      if (!shown || col.querySelector("[data-d=refresh].fresh")) continue;
      try {
        const as = account(c);
        const pager = c.type === "notifications" ? notifPager({ filter: c.sort || undefined, as }) : src.feedPager(c, { as, grid: !!c.grid });
        const top = firstKey((await pager()).html);
        const now = shown.dataset.uri || shown.dataset.href;
        if (top && top !== now) col.querySelector("[data-d=refresh]")?.classList.add("fresh");
      } catch {}
    }
  }, 120000);
  return () => { clearInterval(timer); for (const s of stops.values()) s(); document.body.classList.remove("deckmode"); };
}

/* ================= OWN FEEDS ================= */
const SORTS = [["new", "Найновіші"], ["likes", "Найпопулярніші"], ["hot", "Гарячі (популярні й свіжі)"]];
const MEDIA = [["any", "Будь-які"], ["media", "Лише з фото чи відео"], ["images", "Лише фото"], ["video", "Лише відео"], ["links", "Лише з посиланнями"], ["text", "Лише текст"]];
const REPLIES = [["all", "Пости й відповіді"], ["none", "Без відповідей"], ["only", "Лише відповіді"]];

export function describe(f) {
  const bits = [(f.sources.length ? f.sources.map(s => `${src.ICON[s.type]} ${s.label}`).join(", ") : "🏠 Підписки")];
  if (f.include?.length) bits.push("слова: " + f.include.join(", "));
  if (f.exclude?.length) bits.push("без: " + f.exclude.join(", "));
  if (f.replies !== "all") bits.push(REPLIES.find(r => r[0] === f.replies)[1].toLowerCase());
  if (f.hideReposts) bits.push("без поширень");
  if (f.hideQuotes) bits.push("без цитат");
  if (f.media !== "any") bits.push(MEDIA.find(r => r[0] === f.media)[1].toLowerCase());
  if (f.langs?.length) bits.push("мови: " + f.langs.join(", "));
  if (f.minLikes) bits.push(`від ${f.minLikes} ♥`);
  if (f.maxAgeHours) bits.push(`за ${f.maxAgeHours} год`);
  bits.push(SORTS.find(s => s[0] === f.sort)[1].toLowerCase());
  return bits.join(" · ");
}

export async function myFeeds(el) {
  el.innerHTML = header("Мої стрічки", true, `<a class="btn sm" href="#/myfeeds/new">＋ Нова</a>`) + `
    <p class="pad hint">Збирай власні стрічки з підписок, фідів, списків, пошуку й профілів, з ключовими словами, фільтрами й сортуванням.
    Вони працюють прямо в Skybee і зберігаються у твоєму акаунті, тож є на всіх пристроях. Можна закріпити на головній або додати колонкою.</p><div id="mf"></div>`;
  const box = $("#mf", el);
  const draw = (list) => {
    box.innerHTML = list.length ? list.map(f => `<div class="actor" data-href="${src.myFeedHref(f)}"><span class="bigemoji">🧩</span>
      <div class="who"><b>${esc(f.name)}</b><span class="muted small">${esc(describe(f))}</span></div>
      <button class="ghost sm" data-f="pin" data-id="${esc(f.id)}" title="${f.pinned ? "Прибрати з головної" : "Закріпити на головній"}">${f.pinned ? "📌" : "📍"}</button>
      <button class="ghost sm" data-f="deck" data-id="${esc(f.id)}" title="Додати колонкою">📰</button>
      <a class="ghost sm" href="#/myfeeds/${enc(f.id)}" title="Змінити">✏️</a>
      <button class="ghost sm" data-f="del" data-id="${esc(f.id)}" title="Видалити">✕</button></div>`).join("")
      : empty("Ще жодної. Натисни «＋ Нова», щоб зібрати першу");
  };
  draw(await src.myFeeds());
  src.myFeeds(true).then(draw).catch(() => {});
  box.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-f]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const list = await src.myFeeds(), f = list.find(x => x.id === b.dataset.id);
    if (!f) return;
    try {
      if (b.dataset.f === "pin") { f.pinned = !f.pinned; await src.saveMyFeeds(list); window.dispatchEvent(new Event("skybee:tabsChanged")); toast(f.pinned ? "Закріплено на головній" : "Прибрано з головної"); }
      if (b.dataset.f === "deck") {
        const cols = loadCols(); cols.push({ id: api.tid(), type: "myfeed", value: f.id, label: f.name }); saveCols(cols);
        toast("Додано в колонки"); location.hash = "#/deck"; return;
      }
      if (b.dataset.f === "del") {
        if (!await confirmBox(`Видалити стрічку «${f.name}»?`, "Видалити", true)) return;
        await src.saveMyFeeds(list.filter(x => x !== f)); toast("Видалено");
      }
      draw(await src.myFeeds());
    } catch (ex) { toast(errText(ex)); }
  });
}

export async function myFeedView(el, { id }) {
  const f = await src.myFeed(id);
  if (!f) { el.innerHTML = header("Стрічка", true) + empty("Такої стрічки немає"); return; }
  el.innerHTML = header("🧩 " + esc(f.name), true, gridBtn("myfeed") + `<a class="ghost icon" href="#/myfeeds/${enc(f.id)}" title="Змінити">✏️</a>`) +
    `<p class="pad muted small">${esc(describe(f))}</p><div id="mfb"></div>`;
  const body = $("#mfb", el);
  let stop;
  const show = () => {
    stop?.(); body.innerHTML = ""; el.querySelectorAll(".sentinel").forEach(x => x.remove());
    const grid = isGrid("myfeed");
    stop = paged(body, src.feedPager({ type: "myfeed", value: f.id }, { grid }), { cls: grid ? "tiles" : "" });
  };
  onGrid(el, show); show();
  return () => stop?.();
}

export async function myFeedEdit(el, { id }) {
  const list = await src.myFeeds(true).catch(() => src.myFeeds());
  const old = list.find(f => f.id === id);
  const f = old ? JSON.parse(JSON.stringify(old)) : src.blankFeed();
  el.innerHTML = header(old ? "Змінити стрічку" : "Нова стрічка", true) + `
    <form class="card builder">
      <label class="field">Назва<input data-f="name" maxlength="40" required value="${esc(f.name)}" placeholder="Наприклад: Українські художники"></label>
      <div class="field">Звідки брати пости<div data-srcs></div><button type="button" class="ghost sm" data-b="addsrc">＋ Джерело</button>
        <p class="hint">Без джерел — твої підписки. Кілька джерел зливаються в одну стрічку без повторів.</p></div>
      <label class="field">Мають містити хоч одне з (через кому)<input data-f="include" value="${esc(f.include.join(", "))}" placeholder="слово, фраза, #тег"></label>
      <label class="field">Не мають містити (через кому)<input data-f="exclude" value="${esc(f.exclude.join(", "))}" placeholder="спойлер, реклама"></label>
      <label class="field">Відповіді<select data-f="replies">${opts(REPLIES, f.replies)}</select></label>
      <label class="field">Медіа<select data-f="media">${opts(MEDIA, f.media)}</select></label>
      <label class="check"><input type="checkbox" data-f="hideReposts"${f.hideReposts ? " checked" : ""}> Без поширень</label>
      <label class="check"><input type="checkbox" data-f="hideQuotes"${f.hideQuotes ? " checked" : ""}> Без цитат</label>
      <div class="row wrap">
        <label class="field grow">Мови (коди через кому)<input data-f="langs" value="${esc(f.langs.join(", "))}" placeholder="uk, en"></label>
        <label class="field grow">Мінімум вподобань<input data-f="minLikes" type="number" min="0" value="${f.minLikes || ""}" placeholder="0"></label>
        <label class="field grow">Не старші за (годин)<input data-f="maxAgeHours" type="number" min="0" value="${f.maxAgeHours || ""}" placeholder="будь-які"></label>
      </div>
      <label class="field">Сортування<select data-f="sort">${opts(SORTS, f.sort)}</select></label>
      <p class="hint">Сортування за популярністю впорядковує кожну порцію, що підвантажується.</p>
      <p class="err"></p>
      <div class="row end"><button type="button" class="ghost" data-b="preview">👁 Переглянути</button><button class="btn">Зберегти</button></div>
    </form><div id="prev"></div>`;
  const form = $("form", el), srcs = $("[data-srcs]", el), err = $(".err", el);
  const drawSrcs = () => {
    srcs.innerHTML = f.sources.map((s, i) => `<div class="srcrow">${src.ICON[s.type]} <span class="grow clip">${esc(s.label)}${s.type === "search" ? ` <small class="muted">(${s.sort === "top" ? "найкращі" : "найновіші"})</small>` : ""}</span>
      <button type="button" class="ghost sm" data-rm="${i}" title="Прибрати">✕</button></div>`).join("");
  };
  drawSrcs();
  const read = () => {
    const v = (k) => $(`[data-f=${k}]`, form);
    f.name = v("name").value.trim();
    f.include = src.parseWords(v("include").value); f.exclude = src.parseWords(v("exclude").value);
    f.replies = v("replies").value; f.media = v("media").value; f.sort = v("sort").value;
    f.hideReposts = v("hideReposts").checked; f.hideQuotes = v("hideQuotes").checked;
    f.langs = src.parseWords(v("langs").value);
    f.minLikes = Math.max(0, +v("minLikes").value || 0); f.maxAgeHours = Math.max(0, +v("maxAgeHours").value || 0);
    return f;
  };
  let stop;
  form.addEventListener("click", async (e) => {
    const rm = e.target.closest("[data-rm]");
    if (rm) { f.sources.splice(+rm.dataset.rm, 1); drawSrcs(); return; }
    const b = e.target.closest("[data-b]"); if (!b) return;
    if (b.dataset.b === "addsrc") { const s = await pickSource(); if (s) { f.sources.push(s); drawSrcs(); } }
    if (b.dataset.b === "preview") {
      read();
      const prev = $("#prev", el);
      stop?.(); prev.innerHTML = `<h3 class="pad">Попередній перегляд</h3>`; el.querySelectorAll("#prev ~ .sentinel").forEach(x => x.remove());
      const page = src.runFeed(f);
      const box = document.createElement("div"); prev.appendChild(box);
      stop = paged(box, async () => { const { items, more } = await page(); return { html: src.postsHtml(items, false), cursor: more ? "more" : undefined }; });
      prev.scrollIntoView({ behavior: "smooth" });
    }
  });
  form.onsubmit = async (e) => {
    e.preventDefault(); read(); err.textContent = "";
    if (!f.name) { err.textContent = "Дай стрічці назву"; return; }
    const btn = $("button.btn", form); btn.disabled = true;
    try {
      const all = await src.myFeeds(true).catch(() => list);
      const i = all.findIndex(x => x.id === f.id);
      if (i < 0) all.push(f); else all[i] = f;
      await src.saveMyFeeds(all);
      toast("Збережено"); location.hash = src.myFeedHref(f);
    } catch (ex) { err.textContent = errText(ex); btn.disabled = false; }
  };
  return () => stop?.();
}
