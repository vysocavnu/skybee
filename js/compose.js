// Skybee — post composer
import * as api from "./api.js";
import { esc, modal, toast, avatar, name, richText, spinner } from "./ui.js";

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

// Change who can reply to an own post that starts a thread; onDone(allow, lists) is called after saving
export async function openGateEditor(p, onDone) {
  const m = modal(`<h3>Хто може відповідати</h3><div class="gatebox">${spinner()}</div><p class="err"></p>
    <div class="row end"><button class="ghost" data-x="0">Скасувати</button><button class="btn" data-x="1" disabled>Зберегти</button></div>`);
  const err = m.querySelector(".err"), save = m.querySelector("[data-x='1']");
  let form;
  m.addEventListener("click", async (e) => {
    const x = e.target.closest("[data-x]"); if (!x) return;
    if (x.dataset.x === "0") return m.close();
    save.disabled = true; err.textContent = "";
    try {
      const allow = form.value();
      await api.setThreadgate(p.uri, allow);
      m.close(); onDone?.(allow, form.lists());
    } catch (ex) { err.textContent = ex.message; save.disabled = false; }
  });
  try {
    const cur = await api.getThreadgate(p.uri);
    form = gateForm(m.querySelector(".gatebox"), cur?.allow);
    save.disabled = false;
  } catch (ex) { m.querySelector(".gatebox").innerHTML = ""; err.textContent = ex.message; }
}

/* ---------- composer ---------- */
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime", "video/mpeg"];
const MAX_VIDEO = 300e6; // the largest video Bluesky accepts
const isMotion = (f) => VIDEO_TYPES.includes(f.type) || f.type === "image/gif"; // GIFs stay animated only as videos

// Pixel size of a video or GIF file, or null when the browser cannot read it
const mediaSize = (file, gif) => new Promise(res => {
  const url = URL.createObjectURL(file), el = document.createElement(gif ? "img" : "video");
  const done = (width, height) => { clearTimeout(timer); URL.revokeObjectURL(url); res(width && height ? { width, height } : null); };
  const timer = setTimeout(done, 5000);
  el.addEventListener(gif ? "load" : "loadedmetadata", () => done(el.videoWidth || el.naturalWidth, el.videoHeight || el.naturalHeight));
  el.addEventListener("error", () => done());
  el.preload = "metadata"; el.src = url;
});

// opts: { replyTo: postView, quote: postView, text }
export function openComposer(opts = {}, onDone) {
  const { replyTo, quote } = opts;
  const images = []; // {file, url, alt}
  let video = null;  // {file, url, alt, gif} — one video or GIF instead of images
  let card = null, cardFor = null;
  let allow = replyTo ? undefined : api.defaultGate(); // only the first post of a thread carries a gate
  let gate = null;   // the «who can reply» form, created when first opened
  let busy = null;   // AbortController while the post is being sent
  const lang = getLang();
  const sendLabel = replyTo ? "Відповісти" : "Опублікувати";
  const dirty = () => ta.value.trim() || images.length || video;
  const mayClose = () => !busy && (!dirty() || confirm("Скасувати чернетку?"));
  const m = modal(`
    <div class="composer">
      <div class="row between">
        <button class="ghost" data-c="cancel">Скасувати</button>
        <button class="btn" data-c="send">${sendLabel}</button>
      </div>
      ${replyTo ? `<div class="ctx">${avatar(replyTo.author, 28)}<div><b>${name(replyTo.author)}</b><div class="text small">${richText((replyTo.record?.text || "").slice(0, 300), replyTo.record?.facets)}</div></div></div>` : ""}
      <textarea placeholder="${replyTo ? "Напиши відповідь" : "Що нового?"}" maxlength="3000">${esc(opts.text || "")}</textarea>
      <div class="previews"></div>
      <div class="cardpv"></div>
      ${quote ? `<div class="quote"><div class="meta">${avatar(quote.author, 18)} <b>${name(quote.author)}</b> <span>@${esc(quote.author.handle)}</span></div><div class="text">${richText(quote.record?.text, quote.record?.facets)}</div></div>` : ""}
      <p class="err"></p>
      <div class="gatebox" hidden></div>
      <div class="row between tools">
        <div class="row">
          <label class="ghost icon" title="Додати фото, відео або GIF">🖼️<input type="file" accept="image/*,${VIDEO_TYPES.join(",")}" multiple hidden></label>
          <select title="Мова поста">${LANGS.map(([c, n]) => `<option value="${c}" ${c === lang ? "selected" : ""}>${n}</option>`).join("")}</select>
          ${replyTo ? "" : `<button class="ghost sm" data-c="gate" title="Хто може відповідати">${gateLabel(allow)}</button>`}
        </div>
        <span class="counter">0 / 300</span>
      </div>
    </div>`, {
    wide: true,
    canClose: mayClose, // Esc or a click outside must not silently drop a draft
    onClose: () => { busy?.abort(); for (const x of [...images, video]) if (x) URL.revokeObjectURL(x.url); },
  });

  const ta = m.querySelector("textarea"), counter = m.querySelector(".counter"), err = m.querySelector(".err");
  const pv = m.querySelector(".previews"), cardpv = m.querySelector(".cardpv"), send = m.querySelector("[data-c=send]");
  const gateBtn = m.querySelector("[data-c=gate]"), gateBox = m.querySelector(".gatebox");
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);

  const altInput = (key, value) => `<input placeholder="ALT — опис для незрячих" value="${esc(value)}" data-alt="${key}">`;
  const renderPreviews = () => {
    pv.classList.toggle("one", !!video);
    pv.innerHTML = video
      ? `<div class="pvimg">${video.gif ? `<img src="${video.url}" alt="">` : `<video src="${video.url}" controls muted playsinline></video>`}
          <button class="x" data-rm="v">✕</button>${altInput("v", video.alt)}</div>`
      : images.map((im, i) => `<div class="pvimg"><img src="${im.url}" alt=""><button class="x" data-rm="${i}">✕</button>${altInput(i, im.alt)}</div>`).join("");
  };
  const renderCard = () => {
    cardpv.innerHTML = card && !images.length && !video && !quote
      ? `<div class="ext">${card.image ? `<img src="${esc(card.image)}" alt="">` : ""}<div><b>${esc(card.title)}</b><small>${esc(card.description.slice(0, 120))}</small></div><button class="x" data-c="nocard">✕</button></div>` : "";
  };
  let cardTimer;
  const update = () => {
    const n = api.graphemes(ta.value);
    counter.textContent = `${n} / 300`;
    counter.classList.toggle("over", n > 300);
    send.disabled = !!busy || n > 300 || !dirty();
    clearTimeout(cardTimer);
    const url = ta.value.match(/https?:\/\/[^\s]+/)?.[0]?.replace(/[.,;:!?)"']+$/, "");
    if (url && url !== cardFor) cardTimer = setTimeout(async () => {
      cardFor = url; card = await api.fetchLinkCard(url); renderCard();
    }, 600);
    if (!url) { card = null; cardFor = null; renderCard(); }
  };
  ta.addEventListener("input", update);
  update();

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
  m.querySelector(".modal").addEventListener("dragover", e => e.preventDefault());
  m.querySelector(".modal").addEventListener("drop", e => { e.preventDefault(); addFiles(e.dataTransfer.files); });
  pv.addEventListener("input", e => {
    const k = e.target.dataset.alt;
    if (k === "v") video.alt = e.target.value; else if (k) images[k].alt = e.target.value;
  });
  pv.addEventListener("click", e => {
    const b = e.target.closest("[data-rm]"); if (!b || busy) return;
    if (b.dataset.rm === "v") { URL.revokeObjectURL(video.url); video = null; }
    else URL.revokeObjectURL(images.splice(+b.dataset.rm, 1)[0].url);
    renderPreviews(); renderCard(); update();
  });

  m.addEventListener("click", async (e) => {
    const c = e.target.closest("[data-c]")?.dataset.c;
    if (c === "cancel") { if (busy) busy.abort(); else if (mayClose()) m.close(); }
    if (c === "nocard") { card = null; renderCard(); }
    if (c === "gate") {
      gateBox.hidden = !gateBox.hidden;
      gate ||= gateForm(gateBox, allow, v => { allow = v; gateBtn.textContent = gateLabel(v); });
    }
    if (c === "send" && !busy) {
      let needAlt = false; try { needAlt = localStorage.getItem("skybee.requireAlt") === "1"; } catch {}
      if (needAlt && [...images, video].some(x => x && !x.alt.trim())) { err.textContent = "Додай опис (ALT) до кожного фото чи відео — так задано в налаштуваннях"; return; }
      const ctrl = busy = new AbortController();
      const status = (text) => { send.textContent = text; };
      send.disabled = true; err.textContent = ""; status("Надсилання…");
      try {
        await publish({ text: ta.value.trim(), images, video, card: images.length || video || quote ? null : card, replyTo, quote,
          lang: m.querySelector("select").value, allow, signal: ctrl.signal, status });
        busy = null;
        m.close(); toast(replyTo ? "Відповідь надіслано" : "Опубліковано 🐝");
        onDone?.();
      } catch (ex) {
        busy = null; status(sendLabel);
        err.textContent = ctrl.signal.aborted ? "Надсилання скасовано" : ex.message;
        update();
      }
    }
  });
}

async function publish({ text, images, video, card, replyTo, quote, lang, allow, signal, status }) {
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

  if (quote) {
    const rec = { $type: "app.bsky.embed.record", record: api.strongRef(quote) };
    record.embed = media && media.$type !== "app.bsky.embed.external"
      ? { $type: "app.bsky.embed.recordWithMedia", record: rec, media } : rec;
  } else if (media) record.embed = media;

  signal.throwIfAborted(); // cancelled while media was uploading: do not publish
  return api.createPost(record, replyTo ? undefined : allow);
}
