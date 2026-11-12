// Skybee «оформлення»: a status bubble by the avatar, a track under the bio, a page colour and a toy.
// It lives in the user's own repo as one record, so any Skybee client can read it straight from their PDS;
// other Bluesky apps simply ignore the collection.
import { errText } from "./errors.js";
import * as api from "./api.js";
import { esc, modal, toast } from "./ui.js";

export const NSID = "io.github.vysocavnu.skybee.profile";
const STATUS_MAX = 60;
const cache = new Map(); // did → Promise<{ rec, pds } | null>

// Base colours; css/style.css mixes them into the theme, so the same pick is deep on dark themes and pale on the light one
export const PALETTE = [["#e5484d", "Червоний"], ["#f76b15", "Помаранчевий"], ["#f5b301", "Жовтий"], ["#30a46c", "Зелений"], ["#12a594", "Бірюзовий"],
  ["#0090ff", "Блакитний"], ["#6e56cf", "Фіолетовий"], ["#d6409f", "Рожевий"], ["#ad7f58", "Коричневий"], ["#8b8d98", "Сірий"]];
const isColor = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
const isHttps = (u) => typeof u === "string" && /^https:\/\/[^\s"'<>]+$/i.test(u);
const cut = (s, n) => (typeof s === "string" ? s.trim().slice(0, n) : "");
// text that reads on the plain colour: dark on yellow and the like, white on the rest
export const inkFor = (c) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? "#14110a" : "#ffffff";
};

// Records come from other people's repos: keep only well-formed fields
function clean(v) {
  if (!v || typeof v !== "object") return null;
  const out = {};
  if (cut(v.status, STATUS_MAX)) out.status = cut(v.status, STATUS_MAX);
  if (isColor(v.color)) out.color = v.color.toLowerCase();
  if (v.music && isHttps(v.music.url) && cut(v.music.title, 120)) {
    out.music = { url: v.music.url, title: cut(v.music.title, 120), artist: cut(v.music.artist, 120) };
    for (const k of ["cover", "preview"]) if (isHttps(v.music[k])) out.music[k] = v.music[k];
  }
  const cid = v.toy?.image?.ref?.$link;
  if (typeof cid === "string" && /^[a-z0-9]+$/i.test(cid)) out.toy = { image: v.toy.image };
  return Object.keys(out).length ? out : null;
}

export function load(did) {
  if (!cache.has(did)) cache.set(did, (async () => {
    const pds = did === api.session?.did ? api.session.pds : (await api.resolvePds(did)).pds;
    const r = await fetch(`${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${NSID}&rkey=self`);
    if (!r.ok) return null; // no record: this person has no Skybee look
    const rec = clean((await r.json()).value);
    return rec && { rec, pds };
  })().catch(() => null));
  return cache.get(did);
}

const toyUrl = (pds, did, toy) => `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(toy.image.ref.$link)}`;

// One preview plays at a time and stops when the user leaves the page
let audio = null;
function stopAudio() { audio?.pause(); audio = null; document.querySelectorAll(".sb-play.on").forEach(b => { b.classList.remove("on"); b.textContent = "▶"; }); }
window.addEventListener("hashchange", stopAudio);
function togglePreview(btn, src) {
  const mine = btn.classList.contains("on");
  stopAudio();
  if (mine) return;
  audio = new Audio(src);
  audio.onended = audio.onerror = stopAudio;
  audio.play().catch(stopAudio);
  btn.classList.add("on"); btn.textContent = "⏸";
}
const trackCard = (m, cls = "") => `<div class="sb-music ${cls}">
  ${m.cover ? `<img src="${esc(m.cover)}" alt="" loading="lazy">` : `<span class="sb-note">🎵</span>`}
  <a class="grow" href="${esc(m.url)}" target="_blank" rel="noopener" title="Відкрити в стрімінговому сервісі"><b class="clip">${esc(m.title)}</b><span class="muted small clip">${esc(m.artist || "Музика")}</span></a>
  ${m.preview ? `<button type="button" class="sb-play" data-preview="${esc(m.preview)}" title="Послухати уривок">▶</button>` : `<a class="sb-play" href="${esc(m.url)}" target="_blank" rel="noopener" title="Слухати">▶</a>`}</div>`;
// delegated: works for cards on the profile and inside the editor
document.addEventListener("click", (e) => { const b = e.target.closest(".sb-play[data-preview]"); if (b) togglePreview(b, b.dataset.preview); });

// Page colour: the middle column takes the colour of this person (profile or one of their posts).
// The router forgets the owner on every screen change and clears the colour if no screen claims it again
export function tint(el, did) {
  el._tint = did;
  load(did).then((got) => {
    if (el._tint !== did) return; // the user has already moved on
    const c = got?.rec.color;
    if (!c) return untint(el);
    el.style.setProperty("--sb", c); el.style.setProperty("--sb-ink", inkFor(c)); el.classList.add("sb-tint");
  });
}
// A card (own profile in the right column) in the person's colour; no colour → back to the usual look
export function paint(el, did) {
  load(did).then((got) => {
    const c = got?.rec.color;
    if (!c) { el.classList.remove("sb-tint"); el.style.removeProperty("--sb"); el.style.removeProperty("--sb-ink"); return; }
    el.style.setProperty("--sb", c); el.style.setProperty("--sb-ink", inkFor(c)); el.classList.add("sb-tint");
  });
}
export function untint(el) {
  el._tint = null;
  el.classList.remove("sb-tint"); el.style.removeProperty("--sb"); el.style.removeProperty("--sb-ink");
}

// Called right after the profile header is rendered; fills in the extras when they arrive
export async function decorate(el, p) {
  tint(el, p.did);
  const head = el.querySelector(".phead");
  const got = await load(p.did);
  if (!got || !head?.isConnected) return; // nothing to show, or the user has already left the page
  const { rec, pds } = got;
  const banner = el.querySelector(".banner");
  if (rec.color && banner && !banner.style.backgroundImage) banner.style.backgroundImage = `linear-gradient(135deg, ${rec.color}, color-mix(in srgb, ${rec.color} 35%, var(--bg)))`;
  if (rec.status) head.querySelector(".bigava")?.insertAdjacentHTML("beforeend", `<div class="sb-bubble" title="Статус у Skybee">${esc(rec.status)}</div>`);
  if (rec.music) (head.querySelector(".bio") || head.querySelector(".counts"))?.insertAdjacentHTML("afterend", trackCard(rec.music));
  if (rec.toy && banner) {
    const src = esc(toyUrl(pds, p.did, rec.toy));
    banner.insertAdjacentHTML("beforeend", `<img class="sb-toy" src="${src}" alt="Іграшка" data-act="lightboxOne" data-full="${src}">`);
  }
}

/* ---------- music search ---------- */
// The iTunes catalogue needs no key and gives a 30-second preview; JSONP is the fallback where fetch is refused
function jsonp(url) {
  return new Promise((res, rej) => {
    const cb = "skybeeJsonp" + Math.random().toString(36).slice(2), s = document.createElement("script");
    const done = (fn, v) => { delete window[cb]; s.remove(); fn(v); };
    window[cb] = (d) => done(res, d);
    s.onerror = () => done(rej, new Error("Немає з'єднання з каталогом музики"));
    s.src = `${url}&callback=${cb}`;
    document.head.appendChild(s);
  });
}
async function searchTracks(term) {
  const url = `https://itunes.apple.com/search?media=music&entity=song&limit=15&term=${encodeURIComponent(term)}`;
  let d;
  try { const r = await fetch(url); if (!r.ok) throw 0; d = await r.json(); } catch { d = await jsonp(url); }
  return (d.results || []).filter(t => t.trackName && isHttps(t.trackViewUrl)).map(t => ({
    url: t.trackViewUrl, title: cut(t.trackName, 120), artist: cut(t.artistName, 120),
    cover: (t.artworkUrl100 || "").replace("100x100", "300x300"), preview: t.previewUrl || "" }));
}
// A pasted streaming link → title, artist, cover. song.link knows most services; oEmbed is the fallback.
async function lookupTrack(url) {
  try {
    const d = await (await fetch(`https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(url)}`)).json();
    const e = d.entitiesByUniqueId?.[d.entityUniqueId];
    if (e?.title) return { url, title: cut(e.title, 120), artist: cut(e.artistName, 120), cover: e.thumbnailUrl || "" };
  } catch { /* try the service itself */ }
  const host = new URL(url).hostname.replace(/^www\./, "");
  const oembed = host.endsWith("spotify.com") ? "https://open.spotify.com/oembed?url="
    : host.endsWith("soundcloud.com") ? "https://soundcloud.com/oembed?format=json&url=" : "";
  if (!oembed) return null;
  try {
    const d = await (await fetch(oembed + encodeURIComponent(url))).json();
    return d.title ? { url, title: cut(d.title, 120), artist: cut(d.author_name, 120), cover: d.thumbnail_url || "" } : null;
  } catch { return null; }
}

// «+»: search by name or paste a link; resolves with the chosen track (or null)
function pickTrack() {
  return new Promise((resolve) => {
    let picked = null, list = [], seq = 0, timer;
    const m = modal(`
      <h3>🎵 Додати музику</h3>
      <input data-f="q" placeholder="Назва пісні, виконавець або посилання на трек" autocomplete="off">
      <div class="sb-results"><p class="muted small">Почніть вводити назву — пошук іде по каталогу Apple Music. Посилання зі Spotify, YouTube Music, Deezer чи SoundCloud теж підійде.</p></div>`,
      { onClose: () => { stopAudio(); resolve(picked); } });
    const box = m.querySelector(".sb-results"), q = m.querySelector("[data-f=q]");
    q.focus();
    const run = async () => {
      const term = q.value.trim(), my = ++seq;
      if (term.length < 2) return;
      box.innerHTML = `<p class="muted small">Шукаю…</p>`;
      try {
        if (isHttps(term)) { const t = await lookupTrack(term); list = t ? [t] : []; }
        else list = await searchTracks(term);
        if (my !== seq) return; // a newer search is already running
        box.innerHTML = list.length ? list.map((t, i) => `<div class="sb-pick" data-i="${i}">${trackCard(t, "flat")}</div>`).join("")
          : `<p class="muted small">Нічого не знайдено</p>`;
      } catch (ex) { if (my === seq) box.innerHTML = `<p class="err">${esc(errText(ex))}</p>`; }
    };
    q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 400); });
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") { clearTimeout(timer); run(); } });
    box.addEventListener("click", (e) => {
      const row = e.target.closest(".sb-pick");
      if (!row || e.target.closest(".sb-play")) return; // ▶ only plays the preview
      e.preventDefault();
      picked = list[row.dataset.i]; m.close();
    });
  });
}

/* ---------- toy image ---------- */
// Small PNG so a cut-out picture keeps its transparent background
async function prepareToy(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 320 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const png = await new Promise(res => canvas.toBlob(res, "image/png"));
  if (png.size <= 900_000) return png;
  return new Promise(res => canvas.toBlob(res, "image/webp", 0.85));
}

/* ---------- editor ---------- */
export async function edit(onDone) {
  const did = api.session.did;
  cache.delete(did);
  const got = await load(did);
  const cur = got?.rec || {};
  let music = cur.music || null, color = cur.color || "";
  const m = modal(`
    <h3>✨ Оформлення профілю</h3>
    <p class="muted small">Це бачать лише ті, хто користується Skybee. В інших застосунках Bluesky профіль виглядає як завжди.</p>
    <label class="field">Статус у бульбашці біля аватарки<input data-f="status" maxlength="${STATUS_MAX}" placeholder="Що у вас на думці?" value="${esc(cur.status || "")}"></label>
    <div class="field">Колір сторінки — на світлій темі яскравий, на темній і в сутінках глибокий темний
      <div class="sb-swatches"><button type="button" class="sb-sw none" data-c="" title="Без кольору">✕</button>${
        PALETTE.map(([c, n]) => `<button type="button" class="sb-sw" data-c="${c}" title="${n}" style="background:${c}"></button>`).join("")}</div></div>
    <div class="field">Музика під біо<div data-f="music"></div></div>
    <label class="field">Іграшка — фото, яке сидітиме на банері (найкраще PNG з прозорим тлом)<input type="file" accept="image/*" data-f="toy"></label>
    ${cur.toy ? `<label class="row small"><input type="checkbox" data-f="notoy" style="width:auto"> прибрати іграшку</label>` : ""}
    <p class="err"></p>
    <div class="row end"><button class="ghost" data-x="0">Скасувати</button><button class="btn" data-x="1">Зберегти</button></div>`);
  const f = (k) => m.querySelector(`[data-f=${k}]`);
  const err = m.querySelector(".err");
  const drawColor = () => m.querySelectorAll(".sb-sw").forEach(b => b.classList.toggle("on", b.dataset.c === color));
  const drawMusic = () => {
    f("music").innerHTML = music
      ? `<div class="row">${trackCard(music, "grow")}<button type="button" class="ghost sm icon" data-x="nomusic" title="Прибрати">✕</button></div>
         <button type="button" class="linklike small" data-x="music">Замінити</button>`
      : `<button type="button" class="ghost sb-add" data-x="music"><b>+</b> Додати музику</button>`;
  };
  drawColor(); drawMusic();
  m.addEventListener("click", async (e) => {
    const sw = e.target.closest(".sb-sw");
    if (sw) { color = sw.dataset.c; return drawColor(); }
    const x = e.target.closest("[data-x]"); if (!x) return;
    err.textContent = "";
    if (x.dataset.x === "0") return m.close();
    if (x.dataset.x === "nomusic") { stopAudio(); music = null; return drawMusic(); }
    if (x.dataset.x === "music") { const t = await pickTrack(); if (t) { music = t; drawMusic(); } return; }
    x.disabled = true; x.textContent = "Збереження…";
    try {
      const record = { $type: NSID, updatedAt: new Date().toISOString() };
      const status = cut(f("status").value, STATUS_MAX);
      if (status) record.status = status;
      if (isColor(color)) record.color = color;
      if (music) {
        record.music = { url: music.url, title: music.title, artist: music.artist || "" };
        for (const k of ["cover", "preview"]) if (isHttps(music[k])) record.music[k] = music[k];
      }
      const file = f("toy").files[0];
      if (file) record.toy = { image: await api.uploadBlob(await prepareToy(file)) };
      else if (cur.toy && !f("notoy")?.checked) record.toy = cur.toy;
      await api.post("com.atproto.repo.putRecord", { repo: did, collection: NSID, rkey: "self", record, validate: false });
      cache.delete(did);
      const card = document.getElementById("sideProf"); if (card) paint(card, did); // the right column follows the new colour
      m.close(); toast("Оформлення збережено"); onDone?.();
    } catch (ex) { err.textContent = errText(ex); x.disabled = false; x.textContent = "Зберегти"; }
  });
}
