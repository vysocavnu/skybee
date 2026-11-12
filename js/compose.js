// Skybee — post composer
import * as api from "./api.js";
import { esc, modal, toast, avatar, name, richText, spinner, at } from "./ui.js";

const LANGS = [["uk", "Українська"], ["en", "English"], ["pl", "Polski"], ["be", "Беларуская"], ["ru", "Русский"], ["de", "Deutsch"], ["cs", "Čeština"], ["es", "Español"], ["ja", "日本語"]];
export const getLang = () => { try { return localStorage.getItem("skybee.lang") || "uk"; } catch { return "uk"; } };

/* ---------- who can reply (threadgate) ---------- */
// `allow`: undefined → anyone, [] → nobody, otherwise a list of rules (see api.js)
const RULE = "app.bsky.feed.threadgate#";
const RULES = [["mentionRule", "Згадані в пості"], ["followingRule", "Ті, за ким я стежу"], ["followerRule", "Мої читачі"]];
const gateLabel = (allow) => !allow ? "💬 Усі" : allow.length ? "🔒 Обрані" : "🔒 Ніхто";

// Renders the form into `box`. Returns { value() → allow, lists() → the chosen lists, for display }
function gateForm(box, allow, onChange) {
  let mode = !allow ? "all" : allow.length ? "some" : "none";
  const on = new Map((allow || []).map(r => [r.list || r.$type, r])); // checked rules by key
  let lists = null; // my lists; null while loading
  const value = () => mode === "all" ? undefined : mode === "none" ? [] : [...on.values()];
  const check = (key, label) => `<label class="radio"><input type="checkbox" value="${esc(key)}" ${on.has(key) ? "checked" : ""}> ${label}</label>`;
  const render = () => {
    const mine = new Set((lists || []).map(l => l.uri));
    box.innerHTML = `
      <div class="seg">${[["all", "Усі"], ["none", "Ніхто"], ["some", "Обрані"]].map(([k, l]) =>
        `<button type="button" data-g="${k}" class="${k === mode ? "on" : ""}">${l}</button>`).join("")}</div>
      ${mode !== "some" ? "" : `<div class="gate-rules">
        ${RULES.map(([k, l]) => check(RULE + k, l)).join("")}
        ${(lists || []).map(l => check(l.uri, `Список «${esc(l.name)}»`)).join("")}
        ${[...on.values()].filter(r => r.list && !mine.has(r.list)).map(r => check(r.list, "Список (недоступний)")).join("")}
        ${lists ? "" : `<p class="muted small">Завантаження списків…</p>`}
      </div>`}`;
  };
  box.addEventListener("click", e => {
    const b = e.target.closest("[data-g]"); if (!b) return;
    mode = b.dataset.g; render(); onChange?.(value());
  });
  box.addEventListener("change", e => {
    const key = e.target.value;
    if (!e.target.checked) on.delete(key);
    else if (on.size >= 5) { e.target.checked = false; toast("Можна обрати не більше 5 умов"); }
    else on.set(key, key.startsWith("at://") ? { $type: RULE + "listRule", list: key } : { $type: key });
    onChange?.(value());
  });
  render();
  api.getMyLists().catch(() => []).then(l => { lists = l; render(); });
  return { value, lists: () => (lists || []).filter(l => on.has(l.uri)) };
}

// Change who can reply to and quote an own post; onDone(allow, lists) is called after saving.
// Replies carry no reply gate of their own (`p.record.reply`), only the quote setting.
export async function openGateEditor(p, onDone) {
  const isRoot = !p.record?.reply;
  const m = modal(`<h3>Взаємодія з постом</h3><div class="gatebox">${spinner()}</div>
    <label class="radio"><input type="checkbox" data-noquote disabled> Заборонити цитувати цей пост</label><p class="err"></p>
    <div class="row end"><button class="ghost" data-x="0">Скасувати</button><button class="btn" data-x="1" disabled>Зберегти</button></div>`);
  const err = m.querySelector(".err"), save = m.querySelector("[data-x='1']"), nq = m.querySelector("[data-noquote]");
  let form, wasOff = false;
  m.addEventListener("click", async (e) => {
    const x = e.target.closest("[data-x]"); if (!x) return;
    if (x.dataset.x === "0") return m.close();
    save.disabled = true; err.textContent = "";
    try {
      const allow = form?.value();
      if (form) await api.setThreadgate(p.uri, allow);
      if (nq.checked !== wasOff) await api.setQuotesDisabled(p.uri, nq.checked);
      m.close(); onDone?.(allow, form?.lists() || []);
    } catch (ex) { err.textContent = ex.message; save.disabled = false; }
  });
  try {
    const [cur, pg] = await Promise.all([isRoot ? api.getThreadgate(p.uri) : null, api.getPostgate(p.uri)]);
    const box = m.querySelector(".gatebox");
    if (isRoot) { box.insertAdjacentHTML("beforebegin", `<p class="small muted">Хто може відповідати</p>`); form = gateForm(box, cur?.allow); } else box.remove();
    wasOff = nq.checked = !!pg?.embeddingRules?.length; nq.disabled = false;
    save.disabled = false;
  } catch (ex) { m.querySelector(".gatebox").innerHTML = ""; err.textContent = ex.message; }
}

/* ---------- composer ---------- */
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime", "video/mpeg"];
const MAX_VIDEO = 300e6; // the largest video Bluesky accepts
const MAX_THREAD = 25;
const isMotion = (f) => VIDEO_TYPES.includes(f.type) || f.type === "image/gif"; // GIFs stay animated only as videos
const WARNINGS = [["", "Без позначки"], ["sexual", "Відвертий вміст"], ["nudity", "Оголеність"], ["porn", "Для дорослих"], ["graphic-media", "Жорсткий вміст"]];

// Pixel size of a video or GIF file, or null when the browser cannot read it
const mediaSize = (file, gif) => new Promise(res => {
  const url = URL.createObjectURL(file), el = document.createElement(gif ? "img" : "video");
  const done = (width, height) => { clearTimeout(timer); URL.revokeObjectURL(url); res(width && height ? { width, height } : null); };
  const timer = setTimeout(done, 5000);
  el.addEventListener(gif ? "load" : "loadedmetadata", () => done(el.videoWidth || el.naturalWidth, el.videoHeight || el.naturalHeight));
  el.addEventListener("error", () => done());
  el.preload = "metadata"; el.src = url;
});

// An unfinished new post survives closing the composer (text only: files cannot be stored)
const DRAFT = "skybee.draft";
const draft = {
  get: () => { try { return localStorage.getItem(DRAFT) || ""; } catch { return ""; } },
  set: (v) => { try { v ? localStorage.setItem(DRAFT, v) : localStorage.removeItem(DRAFT); } catch {} },
};

// opts: { replyTo: postView, quote: postView, text }
export function openComposer(opts = {}, onDone) {
  const { quote } = opts;
  let replyTo = opts.replyTo;
  const plain = !replyTo && !quote && opts.text == null; // an ordinary new post: its text is kept as a draft
  // A thread is a list of posts; the one being edited lives in the variables below and its slot in `thread` is null
  const thread = [null];
  let cur = 0;
  const images = []; // {file, url, alt}
  let video = null;  // {file, url, alt, gif} — one video or GIF instead of images
  let card = null, cardFor = null;
  let allow = replyTo ? undefined : api.defaultGate(); // only the first post of a thread carries a gate
  let noQuote = false;
  let gate = null;   // the «who can reply» form, created when first opened
  let busy = null;   // AbortController while the post is being sent
  let sentAny = false;
  const lang = getLang();
  const sendLabel = () => thread.length > 1 ? `Опублікувати все (${thread.length})` : replyTo ? "Відповісти" : "Опублікувати";
  const filled = (x) => x.text.trim() || x.images.length || x.video || x.card?.gif;
  const snapshot = () => ({ text: ta.value, images: [...images], video, card, cardFor });
  const all = () => thread.map((x, i) => i === cur ? snapshot() : x);
  const dirty = () => all().some(filled);
  const mayClose = () => !busy && (!dirty() || plain && thread.length === 1 && !images.length && !video || confirm("Скасувати чернетку?"));
  const m = modal(`
    <div class="composer">
      <div class="row between">
        <button class="ghost" data-c="cancel">Скасувати</button>
        <button class="btn" data-c="send"></button>
      </div>
      ${replyTo ? `<div class="ctx">${avatar(replyTo.author, 28)}<div><b>${name(replyTo.author)}</b><div class="text small">${richText((replyTo.record?.text || "").slice(0, 300), replyTo.record?.facets)}</div></div></div>` : ""}
      <div class="parts" data-parts="before"></div>
      <textarea placeholder="${replyTo ? "Напиши відповідь" : "Що нового?"}" maxlength="3000">${esc(opts.text ?? (plain ? draft.get() : ""))}</textarea>
      <div class="results mentions"></div>
      <div class="previews"></div>
      <div class="cardpv"></div>
      <div class="parts" data-parts="after"></div>
      ${quote ? `<div class="quote"><div class="meta">${avatar(quote.author, 18)} <b>${name(quote.author)}</b> <span>${at(quote.author.handle)}</span></div><div class="text">${richText(quote.record?.text, quote.record?.facets)}</div></div>` : ""}
      <p class="err"></p>
      <div class="gatebox" hidden><p class="small muted">Хто може відповідати</p><div data-gateform></div>
        <label class="radio"><input type="checkbox" data-noquote> Заборонити цитувати цей пост</label></div>
      <div class="row between tools">
        <div class="row">
          <label class="ghost icon" title="Додати фото, відео або GIF">🖼️<input type="file" accept="image/*,${VIDEO_TYPES.join(",")}" multiple hidden></label>
          <button class="ghost icon gifbtn" data-c="gif" title="Знайти GIF">GIF</button>
          <select data-lang title="Мова поста">${LANGS.map(([c, n]) => `<option value="${c}" ${c === lang ? "selected" : ""}>${n}</option>`).join("")}</select>
          <select data-warn title="Попередження про вміст медіа">${WARNINGS.map(([v, l]) => `<option value="${v}">${v ? "⚠️ " : ""}${l}</option>`).join("")}</select>
          ${replyTo ? "" : `<button class="ghost sm" data-c="gate" title="Хто може відповідати й цитувати">${gateLabel(allow)}</button>`}
        </div>
        <div class="row"><span class="counter">0 / 300</span><button class="ghost icon" data-c="addpart" title="Додати ще один пост у гілку">＋</button></div>
      </div>
    </div>`, {
    wide: true,
    canClose: mayClose, // Esc or a click outside must not silently drop a draft
    onClose: () => {
      busy?.abort();
      if (plain && !sentAny) draft.set(thread.length === 1 ? ta.value.trim() : "");
      for (const x of all()) for (const f of [...x.images, x.video]) if (f) URL.revokeObjectURL(f.url);
    },
  });

  const ta = m.querySelector("textarea"), counter = m.querySelector(".counter"), err = m.querySelector(".err");
  const pv = m.querySelector(".previews"), cardpv = m.querySelector(".cardpv"), send = m.querySelector("[data-c=send]");
  const gateBtn = m.querySelector("[data-c=gate]"), gateBox = m.querySelector(".gatebox"), mentions = m.querySelector(".mentions");
  const before = m.querySelector("[data-parts=before]"), after = m.querySelector("[data-parts=after]"), addBtn = m.querySelector("[data-c=addpart]");
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);

  const altInput = (key, value) => `<input placeholder="ALT — опис для незрячих" value="${esc(value)}" data-alt="${key}">`;
  const renderPreviews = () => {
    pv.classList.toggle("one", !!video);
    pv.innerHTML = video
      ? `<div class="pvimg">${video.gif ? `<img src="${video.url}" alt="">` : `<video src="${video.url}" controls muted playsinline></video>`}
          <button class="x" data-rm="v">✕</button>${altInput("v", video.alt)}
          ${video.gif ? "" : `<div class="caps">${(video.captions ||= []).map((c, i) => `<span class="pill">💬 ${esc(c.lang)} · ${esc(c.file.name)} <button class="linklike" data-rmcap="${i}">✕</button></span>`).join("")}
            <label class="linklike small">＋ Субтитри (.vtt)<input type="file" accept=".vtt,text/vtt" data-cap hidden></label>
            <select data-caplang class="small">${LANGS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div>`}</div>`
      : images.map((im, i) => `<div class="pvimg"><img src="${im.url}" alt=""><button class="x" data-rm="${i}">✕</button>${altInput(i, im.alt)}</div>`).join("");
  };
  const renderCard = () => {
    cardpv.innerHTML = card && !images.length && !video && !(quote && cur === 0)
      ? `<div class="ext">${card.image ? `<img src="${esc(card.image)}" alt="">` : ""}<div><b>${esc(card.title)}</b><small>${esc(card.description.slice(0, 120))}</small></div><button class="x" data-c="nocard">✕</button></div>` : "";
  };
  // the other posts of the thread: a click opens one for editing
  const renderParts = () => {
    const part = (x, i) => i === cur ? "" : `<div class="part" data-part="${i}"><span class="muted small">${i + 1}.</span>
      <span class="grow clip">${esc(x.text.trim().slice(0, 120)) || `<i class="muted">порожній пост</i>`}</span>
      ${x.video ? "🎞️" : x.images.length ? `🖼️${x.images.length}` : ""}<button class="x" data-rmpart="${i}">✕</button></div>`;
    before.innerHTML = thread.slice(0, cur).map(part).join("");
    after.innerHTML = thread.map((x, i) => i > cur ? part(x, i) : "").join("");
    send.textContent = sendLabel();
    ta.placeholder = cur ? "Продовження гілки" : replyTo ? "Напиши відповідь" : "Що нового?";
  };
  let cardTimer;
  const update = () => {
    const n = api.graphemes(ta.value);
    counter.textContent = `${n} / 300`;
    counter.classList.toggle("over", n > 300);
    send.disabled = !!busy || n > 300 || !dirty();
    addBtn.disabled = !!busy || n > 300 || !filled(snapshot()) || thread.length >= MAX_THREAD;
    clearTimeout(cardTimer);
    const url = ta.value.match(/https?:\/\/[^\s]+/)?.[0]?.replace(/[.,;:!?)"']+$/, "");
    if (card?.gif) return; // a picked GIF stays until it is removed
    if (url && url !== cardFor) cardTimer = setTimeout(async () => {
      cardFor = url; const c = await api.fetchLinkCard(url); if (cardFor === url) { card = c; renderCard(); }
    }, 600);
    if (!url) { card = null; cardFor = null; renderCard(); }
  };
  // puts the edited post back into the list and opens post `i` instead
  const open = (i) => {
    thread[cur] = snapshot();
    const x = thread[i]; thread[i] = null; cur = i;
    ta.value = x.text; images.length = 0; images.push(...x.images); video = x.video; card = x.card; cardFor = x.cardFor;
    mentions.innerHTML = "";
    renderParts(); renderPreviews(); renderCard(); update(); ta.focus();
  };
  // forgets posts that are already published, so that a retry continues the thread after them
  const dropSent = (n, last) => {
    thread.splice(0, n); cur -= n; replyTo = last; sentAny = true;
    renderParts(); update();
  };

  /* @mention suggestions */
  let mentionTimer;
  const mentionAt = () => ta.value.slice(0, ta.selectionStart).match(/(^|[\s(])@([\w.-]{1,40})$/);
  ta.addEventListener("input", () => {
    update();
    clearTimeout(mentionTimer);
    const hit = mentionAt();
    if (!hit) { mentions.innerHTML = ""; return; }
    mentionTimer = setTimeout(async () => {
      try {
        const d = await api.get("app.bsky.actor.searchActorsTypeahead", { q: hit[2], limit: 5 });
        if (mentionAt()?.[2] !== hit[2]) return;
        mentions.innerHTML = d.actors.map(a => `<button type="button" class="actor plain" data-handle="${esc(a.handle)}">${avatar(a, 28)}<div class="who"><b>${name(a)}</b><span class="muted small">${at(a.handle)}</span></div></button>`).join("");
      } catch { mentions.innerHTML = ""; }
    }, 200);
  });
  mentions.addEventListener("click", e => {
    const b = e.target.closest("[data-handle]"), hit = mentionAt(); if (!b || !hit) return;
    const end = ta.selectionStart, start = end - hit[2].length;
    ta.setRangeText(b.dataset.handle + " ", start, end, "end");
    mentions.innerHTML = ""; ta.focus(); update();
  });
  renderParts(); update();

  const addFiles = (files) => {
    for (const f of files) {
      if (isMotion(f)) {
        if (images.length) toast("Відео чи GIF не можна поєднати з фото");
        else if (video) toast("До поста можна додати лише одне відео чи GIF");
        else if (f.size > MAX_VIDEO) toast("Файл завеликий: максимум 300 МБ");
        else video = { file: f, url: URL.createObjectURL(f), alt: "", gif: f.type === "image/gif" };
      } else if (f.type.startsWith("image/")) {
        if (video) { toast("Фото не можна поєднати з відео чи GIF"); break; }
        if (images.length >= 4) { toast("Максимум 4 зображення"); break; }
        images.push({ file: f, url: URL.createObjectURL(f), alt: "" });
      }
    }
    renderPreviews(); renderCard(); update();
  };
  m.querySelector("input[type=file]").addEventListener("change", e => { addFiles(e.target.files); e.target.value = ""; });
  ta.addEventListener("paste", e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } });
  ta.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send.click(); } });
  m.querySelector(".modal").addEventListener("dragover", e => e.preventDefault());
  m.querySelector(".modal").addEventListener("drop", e => { e.preventDefault(); addFiles(e.dataTransfer.files); });
  m.querySelector("[data-noquote]").addEventListener("change", e => { noQuote = e.target.checked; });
  pv.addEventListener("input", e => {
    const k = e.target.dataset.alt;
    if (k === "v") video.alt = e.target.value; else if (k) images[k].alt = e.target.value;
  });
  // captions for a video: WebVTT files, one per language (Bluesky takes up to 20, 20 KB each)
  pv.addEventListener("change", e => {
    if (!e.target.matches("[data-cap]")) return;
    const f = e.target.files[0]; e.target.value = "";
    if (!f || !video) return;
    if (f.size > 20000) return toast("Файл субтитрів завеликий: максимум 20 КБ");
    const lang = pv.querySelector("[data-caplang]").value;
    video.captions = (video.captions || []).filter(c => c.lang !== lang).concat({ lang, file: f });
    renderPreviews();
  });
  pv.addEventListener("click", e => {
    const rc = e.target.closest("[data-rmcap]");
    if (rc && video) { e.preventDefault(); video.captions.splice(+rc.dataset.rmcap, 1); renderPreviews(); return; }
    const b = e.target.closest("[data-rm]"); if (!b || busy) return;
    if (b.dataset.rm === "v") { URL.revokeObjectURL(video.url); video = null; }
    else URL.revokeObjectURL(images.splice(+b.dataset.rm, 1)[0].url);
    renderPreviews(); renderCard(); update();
  });

  m.addEventListener("click", async (e) => {
    const rm = e.target.closest("[data-rmpart]"), part = e.target.closest("[data-part]");
    if (rm && !busy) {
      const i = +rm.dataset.rmpart;
      for (const f of [...thread[i].images, thread[i].video]) if (f) URL.revokeObjectURL(f.url);
      thread.splice(i, 1); if (i < cur) cur--;
      renderParts(); renderCard(); update(); return;
    }
    if (part && !busy) return open(+part.dataset.part);
    const c = e.target.closest("[data-c]")?.dataset.c;
    if (c === "cancel") { if (busy) busy.abort(); else if (mayClose()) m.close(); }
    if (c === "nocard") { card = null; cardFor = null; renderCard(); update(); }
    if (c === "gif" && !busy) {
      if (images.length || video) return toast("GIF не можна поєднати з фото чи відео");
      const g = await gifPicker();
      if (g) { card = g; cardFor = null; renderCard(); update(); }
    }
    if (c === "addpart" && !busy) {
      thread.splice(cur + 1, 0, { text: "", images: [], video: null, card: null, cardFor: null });
      open(cur + 1);
    }
    if (c === "gate") {
      gateBox.hidden = !gateBox.hidden;
      gate ||= gateForm(gateBox.querySelector("[data-gateform]"), allow, v => { allow = v; gateBtn.textContent = gateLabel(v); });
    }
    if (c === "send" && !busy) {
      const queue = all().filter(filled);
      if (!queue.length) return;
      const over = queue.findIndex(x => api.graphemes(x.text.trim()) > 300);
      if (over >= 0) { err.textContent = `Пост ${over + 1} довший за 300 символів`; return; }
      let needAlt = false; try { needAlt = localStorage.getItem("skybee.requireAlt") === "1"; } catch {}
      if (needAlt && queue.some(x => [...x.images, x.video].some(f => f && !f.alt.trim()))) { err.textContent = "Додай опис (ALT) до кожного фото чи відео — так задано в налаштуваннях"; return; }
      // empty posts in the middle are dropped; the list on screen becomes exactly what is being sent
      thread.splice(0, thread.length, ...queue); cur = queue.length - 1;
      { const x = thread[cur]; thread[cur] = null; ta.value = x.text; images.length = 0; images.push(...x.images); video = x.video; card = x.card; cardFor = x.cardFor; }
      renderParts(); renderPreviews(); renderCard();
      const ctrl = busy = new AbortController();
      const status = (text) => { send.textContent = text; };
      send.disabled = addBtn.disabled = true; err.textContent = "";
      let done = 0, prev = replyTo;
      const first = !sentAny;
      try {
        for (const x of queue) {
          const label = (t) => status(queue.length > 1 ? `${done + 1}/${queue.length}: ${t}` : t);
          label("Надсилання…");
          const lead = first && done === 0; // the quote and the gates belong to the first post of the thread
          prev = await publish({ text: x.text.trim(), images: x.images, video: x.video, card: x.images.length || x.video || (quote && lead) ? null : x.card,
            replyTo: prev, quote: lead ? quote : null, lang: m.querySelector("[data-lang]").value, warn: m.querySelector("[data-warn]").value,
            allow: lead && !opts.replyTo ? allow : undefined, noQuote: lead && !opts.replyTo && noQuote, signal: ctrl.signal, status: label });
          done++;
        }
        busy = null; sentAny = true;
        if (plain) draft.set("");
        m.close(); toast(queue.length > 1 ? "Гілку опубліковано 🐝" : opts.replyTo ? "Відповідь надіслано" : "Опубліковано 🐝");
        onDone?.();
      } catch (ex) {
        busy = null;
        if (done) dropSent(done, prev);
        err.textContent = (ctrl.signal.aborted ? "Надсилання скасовано" : ex.message) + (done ? ` · опубліковано постів: ${done}, решта лишилась тут` : "");
        renderParts(); update();
      }
    }
  });
}

// → the published post as { uri, cid, record }, enough to reply to it
/* ---------- GIF search (Tenor) ----------
   Like the official app: the post carries a link to the GIF on media.tenor.com (with its size), and the clients show it animated.
   Tenor needs an API key: each user puts their own free key in Settings → Content and media (it stays on the device). */
export const tenorKey = () => { try { return localStorage.getItem("skybee.tenorKey") || ""; } catch { return ""; } };
function gifPicker() {
  return new Promise((resolve) => {
    const key = tenorKey();
    if (!key) {
      toast("Щоб шукати GIF, додай свій ключ Tenor у Налаштування → Вміст і медіа", 5000);
      return resolve(null);
    }
    let done = false;
    const m = modal(`<h3>GIF</h3><input type="search" placeholder="Пошук GIF" autofocus><div class="gifgrid"></div><p class="hint">Через Tenor</p>`,
      { wide: true, onClose: () => { if (!done) resolve(null); } });
    const grid = m.querySelector(".gifgrid"), inp = m.querySelector("input");
    let items = [], tm;
    const load = async (q) => {
      grid.innerHTML = spinner();
      try {
        const u = new URL(`https://tenor.googleapis.com/v2/${q ? "search" : "featured"}`);
        for (const [k, v] of Object.entries({ key, client_key: "skybee", limit: 40, media_filter: "gif,tinygif", contentfilter: "medium", locale: "uk_UA", ...(q ? { q } : {}) })) u.searchParams.set(k, v);
        const r = await fetch(u);
        if (!r.ok) throw new Error(r.status === 400 || r.status === 403 ? "Ключ Tenor не підходить — перевір його в налаштуваннях" : `Помилка ${r.status}`);
        items = ((await r.json()).results || []).filter(x => x.media_formats?.gif && x.media_formats?.tinygif);
        grid.innerHTML = items.map((x, i) => `<button class="gifitem" data-g="${i}" title="${esc(x.content_description || "")}"><img src="${esc(x.media_formats.tinygif.url)}" alt="${esc(x.content_description || "")}" loading="lazy"></button>`).join("") || `<p class="muted center pad">Нічого не знайдено</p>`;
      } catch (ex) { grid.innerHTML = `<p class="err">${esc(ex.message)}</p>`; }
    };
    inp.addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(() => load(inp.value.trim()), 350); });
    grid.addEventListener("click", (e) => {
      const b = e.target.closest("[data-g]"); if (!b) return;
      const x = items[+b.dataset.g], g = x.media_formats.gif, [w, h] = g.dims || [0, 0];
      const title = x.content_description || x.title || "GIF";
      done = true; m.close();
      resolve({ gif: true, uri: `${g.url}?hh=${h}&ww=${w}`, title, description: `Alt: ${title}`, image: x.media_formats.tinygif.url });
    });
    load("");
  });
}

async function publish({ text, images, video, card, replyTo, quote, lang, warn, allow, noQuote, signal, status }) {
  const record = { text, langs: [lang] };
  const facets = await api.detectFacets(text);
  if (facets.length) record.facets = facets;

  if (replyTo) {
    const parent = api.strongRef(replyTo);
    const root = replyTo.record?.reply?.root || parent;
    record.reply = { root, parent };
  }

  let media = null;
  if (video) {
    const size = await mediaSize(video.file, video.gif);
    const blob = await api.uploadVideo(video.file, { signal, onProgress: (stage, pct) =>
      status(stage === "upload" ? `Завантаження відео: ${pct}%` : `Обробка відео${pct ? `: ${pct}%` : "…"}`) });
    media = { $type: "app.bsky.embed.video", video: blob };
    if (video.alt) media.alt = video.alt;
    if (size) media.aspectRatio = size;
    if (video.gif) media.presentation = "gif"; // clients loop it silently, like a GIF
    if (video.captions?.length) media.captions = await Promise.all(video.captions.slice(0, 20).map(async c =>
      ({ lang: c.lang, file: await api.uploadBlob(new Blob([c.file], { type: "text/vtt" })) })));
    status("Надсилання…");
  } else if (images.length) {
    const out = [];
    for (const im of images) {
      const { blob, width, height } = await api.prepareImage(im.file);
      const ref = await api.uploadBlob(blob);
      out.push({ image: ref, alt: im.alt || "", aspectRatio: { width, height } });
    }
    media = { $type: "app.bsky.embed.images", images: out };
  } else if (card) {
    const external = { uri: card.uri, title: card.title, description: card.description };
    if (card.image) {
      try {
        const r = await fetch(card.image);
        if (r.ok) external.thumb = await api.uploadBlob((await api.prepareImage(await r.blob(), 1000)).blob);
      } catch { /* no thumbnail */ }
    }
    media = { $type: "app.bsky.embed.external", external };
  }
  // the author's own warning covers the media of the post
  if (warn && (video || images.length)) record.labels = { $type: "com.atproto.label.defs#selfLabels", values: [{ val: warn }] };

  if (quote) {
    const rec = { $type: "app.bsky.embed.record", record: api.strongRef(quote) };
    record.embed = media && media.$type !== "app.bsky.embed.external"
      ? { $type: "app.bsky.embed.recordWithMedia", record: rec, media } : rec;
  } else if (media) record.embed = media;

  signal.throwIfAborted(); // cancelled while media was uploading: do not publish
  const ref = await api.createPost(record, allow, noQuote);
  return { ...ref, record };
}
