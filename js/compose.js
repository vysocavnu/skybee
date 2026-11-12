// Skybee — post composer
import * as api from "./api.js";
import { esc, modal, toast, avatar, name, richText } from "./ui.js";

const LANGS = [["uk", "Українська"], ["en", "English"], ["pl", "Polski"], ["be", "Беларуская"], ["ru", "Русский"], ["de", "Deutsch"], ["cs", "Čeština"], ["es", "Español"], ["ja", "日本語"]];
export const getLang = () => { try { return localStorage.getItem("skybee.lang") || "uk"; } catch { return "uk"; } };

// opts: { replyTo: postView, quote: postView, text }
export function openComposer(opts = {}, onDone) {
  const { replyTo, quote } = opts;
  const images = []; // {file, url, alt}
  let card = null, cardFor = null;
  const lang = getLang();
  const m = modal(`
    <div class="composer">
      <div class="row between">
        <button class="ghost" data-c="cancel">Скасувати</button>
        <button class="btn" data-c="send">${replyTo ? "Відповісти" : "Опублікувати"}</button>
      </div>
      ${replyTo ? `<div class="ctx">${avatar(replyTo.author, 28)}<div><b>${name(replyTo.author)}</b><div class="text small">${richText((replyTo.record?.text || "").slice(0, 300), replyTo.record?.facets)}</div></div></div>` : ""}
      <textarea placeholder="${replyTo ? "Напиши відповідь" : "Що нового?"}" maxlength="3000">${esc(opts.text || "")}</textarea>
      <div class="previews"></div>
      <div class="cardpv"></div>
      ${quote ? `<div class="quote"><div class="meta">${avatar(quote.author, 18)} <b>${name(quote.author)}</b> <span>@${esc(quote.author.handle)}</span></div><div class="text">${richText(quote.record?.text, quote.record?.facets)}</div></div>` : ""}
      <p class="err"></p>
      <div class="row between tools">
        <div class="row">
          <label class="ghost icon" title="Додати фото">🖼️<input type="file" accept="image/*" multiple hidden></label>
          <select title="Мова поста">${LANGS.map(([c, n]) => `<option value="${c}" ${c === lang ? "selected" : ""}>${n}</option>`).join("")}</select>
        </div>
        <span class="counter">0 / 300</span>
      </div>
    </div>`, { wide: true });

  const ta = m.querySelector("textarea"), counter = m.querySelector(".counter"), err = m.querySelector(".err");
  const pv = m.querySelector(".previews"), cardpv = m.querySelector(".cardpv"), send = m.querySelector("[data-c=send]");
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);

  const renderPreviews = () => {
    pv.innerHTML = images.map((im, i) => `
      <div class="pvimg"><img src="${im.url}" alt=""><button class="x" data-rm="${i}">✕</button>
      <input placeholder="ALT — опис для незрячих" value="${esc(im.alt)}" data-alt="${i}"></div>`).join("");
  };
  const renderCard = () => {
    cardpv.innerHTML = card && !images.length && !quote
      ? `<div class="ext">${card.image ? `<img src="${esc(card.image)}" alt="">` : ""}<div><b>${esc(card.title)}</b><small>${esc(card.description.slice(0, 120))}</small></div><button class="x" data-c="nocard">✕</button></div>` : "";
  };
  let cardTimer;
  const update = () => {
    const n = api.graphemes(ta.value);
    counter.textContent = `${n} / 300`;
    counter.classList.toggle("over", n > 300);
    send.disabled = n > 300 || (!ta.value.trim() && !images.length);
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
      if (!f.type.startsWith("image/")) continue;
      if (images.length >= 4) { toast("Максимум 4 зображення"); break; }
      images.push({ file: f, url: URL.createObjectURL(f), alt: "" });
    }
    renderPreviews(); renderCard(); update();
  };
  m.querySelector("input[type=file]").addEventListener("change", e => { addFiles(e.target.files); e.target.value = ""; });
  ta.addEventListener("paste", e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } });
  m.querySelector(".modal").addEventListener("dragover", e => e.preventDefault());
  m.querySelector(".modal").addEventListener("drop", e => { e.preventDefault(); addFiles(e.dataTransfer.files); });
  pv.addEventListener("input", e => { if (e.target.dataset.alt) images[e.target.dataset.alt].alt = e.target.value; });
  pv.addEventListener("click", e => { const b = e.target.closest("[data-rm]"); if (b) { images.splice(+b.dataset.rm, 1); renderPreviews(); renderCard(); update(); } });

  m.addEventListener("click", async (e) => {
    const c = e.target.closest("[data-c]")?.dataset.c;
    if (c === "cancel") { if (!ta.value.trim() || confirm("Скасувати чернетку?")) m.close(); }
    if (c === "nocard") { card = null; renderCard(); }
    if (c === "send") {
      send.disabled = true; err.textContent = ""; send.textContent = "Надсилання…";
      try {
        await publish({ text: ta.value.trim(), images, card: images.length || quote ? null : card, replyTo, quote, lang: m.querySelector("select").value });
        m.close(); toast(replyTo ? "Відповідь надіслано" : "Опубліковано 🐝");
        onDone?.();
      } catch (ex) {
        err.textContent = ex.message; send.disabled = false; send.textContent = replyTo ? "Відповісти" : "Опублікувати";
      }
    }
  });
}

async function publish({ text, images, card, replyTo, quote, lang }) {
  const record = { text, langs: [lang] };
  const facets = await api.detectFacets(text);
  if (facets.length) record.facets = facets;

  if (replyTo) {
    const parent = api.strongRef(replyTo);
    const root = replyTo.record?.reply?.root || parent;
    record.reply = { root, parent };
  }

  let media = null;
  if (images.length) {
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
    record.embed = media && media.$type === "app.bsky.embed.images"
      ? { $type: "app.bsky.embed.recordWithMedia", record: rec, media } : rec;
  } else if (media) record.embed = media;

  return api.createRecord("app.bsky.feed.post", record);
}
