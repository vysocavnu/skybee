// Skybee «оформлення»: a status bubble by the avatar, a track under the bio, a page colour and a toy.
// It lives in the user's own repo as one record, so any Skybee client can read it straight from their PDS;
// other Bluesky apps simply ignore the collection.
import { errText } from "./errors.js";
import * as api from "./api.js";
import { esc, modal, toast, confirmBox } from "./ui.js";
import * as saw from "./stars.js";

export const NSID = "io.github.vysocavnu.skybee.profile";
const STATUS_MAX = 60;
const cache = new Map(); // did → Promise<{ rec, pds } | null>

// Profile colour: a gradient of two colours (record fields `color` → `color2`). css/style.css mixes them into the theme,
// so the same pick is deep on dark themes and bright on the light one. A record with only `color` is a plain colour.
export const GRADIENTS = [["#ff8a00", "#ff3b5c", "Захід"], ["#ffd84a", "#ff6a1a", "Мед"], ["#3ee67a", "#3ef0d8", "М'ята"], ["#a8e063", "#56ab2f", "Лайм"],
  ["#c471f5", "#5b6cf9", "Аметист"], ["#f7d96b", "#c9930a", "Золото"], ["#12e0d0", "#e0127a", "Неон"], ["#ef5b6b", "#3ed47a", "Кавун"],
  ["#1e7bff", "#2be0e0", "Океан"], ["#ff7eb3", "#ff3d6e", "Фламінго"], ["#6a3093", "#2b5cd6", "Ніч"], ["#ad7f58", "#e8c39e", "Кава"],
  ["#e0c3fc", "#8ec5fc", "Лаванда"], ["#eb3349", "#8e0e00", "Вишня"], ["#8e9eab", "#3b4655", "Сталь"]];
const isColor = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
const isHttps = (u) => typeof u === "string" && /^https:\/\/[^\s"'<>]+$/i.test(u);
// Covers and previews load by themselves when a profile is opened, so they may only come from the music services' own
// CDNs: an address of the profile owner's choosing would tell them the IP and the time of everyone who looked
const MEDIA_HOSTS = ["mzstatic.com", "itunes.apple.com", "scdn.co", "spotifycdn.com", "ytimg.com", "googleusercontent.com", "dzcdn.net", "sndcdn.com", "tidal.com", "bcbits.com"];
const media = (u) => (isMedia(u) ? u : "");
const isMedia = (u) => { if (!isHttps(u)) return false; try { const h = new URL(u).hostname; return MEDIA_HOSTS.some(d => h === d || h.endsWith("." + d)); } catch { return false; } };
const cut = (s, n) => (typeof s === "string" ? s.trim().slice(0, n) : "");
// text that reads on the plain colour: dark on yellow and the like, white on the rest
const lum = (c) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)); return (r * 299 + g * 587 + b * 114) / 1000; };
// for a gradient: what reads on both ends of it
export const inkFor = (c, c2 = c) => ((lum(c) + lum(c2)) / 2 > 160 ? "#14110a" : "#ffffff");
// the colours of a record: [from, to, third or ""], or null
export const colorsOf = (rec) => (rec?.color ? [rec.color, rec.color2 || rec.color, rec.color3 || ""] : null);
export const gradientName = (c1, c2) => GRADIENTS.find(([a, b]) => a === c1 && b === c2)?.[2] || "";

// Records come from other people's repos: keep only well-formed fields
function clean(v) {
  if (!v || typeof v !== "object") return null;
  const out = {};
  if (cut(v.status, STATUS_MAX)) out.status = cut(v.status, STATUS_MAX);
  if (isColor(v.color)) out.color = v.color.toLowerCase();
  if (out.color && isColor(v.color2)) out.color2 = v.color2.toLowerCase();
  if (out.color2 && isColor(v.color3)) out.color3 = v.color3.toLowerCase();
  if (out.color && v.flow === false) out.flow = false; // the owner stopped the flowing
  if (v.music && isHttps(v.music.url) && cut(v.music.title, 120)) {
    out.music = { url: v.music.url, title: cut(v.music.title, 120), artist: cut(v.music.artist, 120) };
    for (const k of ["cover", "preview"]) if (isMedia(v.music[k])) out.music[k] = v.music[k];
  }
  const cid = v.toy?.image?.ref?.$link;
  if (typeof cid === "string" && /^[a-z0-9]+$/i.test(cid)) out.toy = { image: v.toy.image };
  return Object.keys(out).length ? out : null;
}

const flairAll = () => { try { return localStorage.getItem("skybee.flairAll") === "1"; } catch { return false; } };
export function load(did) {
  if (!cache.has(did)) cache.set(did, (async () => {
    const pds = did === api.session?.did ? api.session.pds : (await api.resolvePds(did)).pds;
    if (!api.pdsOk(pds)) return null; // resolvePds already refuses such servers; the own session is checked here too
    // someone else's own server would see the IP and the time of everyone opening their profile: only on request
    if (did !== api.session?.did && !api.bskyHost(pds) && !flairAll()) return null;
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
    const c = colorsOf(got?.rec);
    if (!c) return untint(el);
    setColors(el, c, got.rec.flow === false);
  });
}
// A card (own profile in the right column) in the person's colours; no colour → back to the usual look
export function paint(el, did) {
  load(did).then((got) => { const c = colorsOf(got?.rec); c ? setColors(el, c, got.rec.flow === false) : untint(el); });
}
// One colour only (a record from before gradients): its partner is the same colour turned a little round the colour
// wheel and lightened, so the page still flows between two shades of it
function partner(c) {
  let [r, g, b] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0, l = (mx + mn) / 2; const sat = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 24 + 360) % 360; l = Math.min(.82, l + .08);
  const k = (n) => (n + h / 30) % 12, a = sat * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))).toString(16).padStart(2, "0");
  return "#" + f(0) + f(8) + f(4);
}
// [c1, c2, c3] → the custom properties of the gradient (one colour gets a partner shade, two colours flow back through c1)
const VARS = ["--sb", "--sb2", "--sb3", "--sb-ink"];
function putColors(el, [c1, c2, c3], still, cls) {
  if (c2 === c1) c2 = partner(c1);
  el.style.setProperty("--sb", c1); el.style.setProperty("--sb2", c2); el.style.setProperty("--sb3", c3 || c1);
  el.style.setProperty("--sb-ink", inkFor(c1, c2)); el.classList.add(cls); el.classList.toggle("sb-still", !!still);
}
const setColors = (el, c, still) => putColors(el, c, still, "sb-tint");
export function untint(el) {
  el._tint = null;
  el.classList.remove("sb-tint", "sb-still"); for (const k of VARS) el.style.removeProperty(k);
}

/* ---------- the author's colours on their posts, in every feed ----------
   Each new post on screen asks for its author's Skybee look (once per person, cached); the post gets a calm wash of the
   gradient. Off in Налаштування → Вміст і медіа («Кольори профілів на постах»). */
export const postColorsOn = () => { try { return localStorage.getItem("skybee.postColors") !== "0"; } catch { return true; } };
function tintPost(art) {
  art.dataset.sbp = "1";
  const did = (art.dataset.uri || "").split("/")[2];
  if (!did?.startsWith("did:")) return;
  load(did).then((got) => { const c = colorsOf(got?.rec); if (c && art.isConnected) putColors(art, c, got.rec.flow === false, "sb-post"); });
}
if (typeof MutationObserver !== "undefined") {
  let queued = false;
  const scan = () => { queued = false; if (!postColorsOn() || !api.session) return; document.querySelectorAll("article.post[data-uri]:not([data-sbp])").forEach(tintPost); };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(scan); } }).observe(document.documentElement, { childList: true, subtree: true });
}

// Called right after the profile header is rendered; fills in the extras when they arrive
export async function decorate(el, p) {
  tint(el, p.did);
  const head = el.querySelector(".phead");
  const got = await load(p.did);
  if (!got || !head?.isConnected) return; // nothing to show, or the user has already left the page
  const { rec, pds } = got;
  const banner = el.querySelector(".banner");
  const cs = colorsOf(rec);
  if (cs && cs[1] === cs[0]) cs[1] = partner(cs[0]);
  if (cs && banner && !banner.style.backgroundImage) {
    banner.style.backgroundImage = `linear-gradient(125deg, ${cs[0]}, ${cs[1]}, ${cs[2] || cs[0]}, ${cs[1]}, ${cs[0]})`;
    banner.classList.add("sb-flow"); banner.classList.toggle("sb-still", rec.flow === false);
  }
  if (rec.status) head.querySelector(".bigava")?.insertAdjacentHTML("beforeend", `<div class="sb-bubble" title="Статус у Skybee">${esc(rec.status)}</div>`);
  if (rec.music) {
    // under the track: «Підтримує війну? ⬇️» — opens the positions of its artists, a short text and the source
    (head.querySelector(".bio") || head.querySelector(".counts"))?.insertAdjacentHTML("afterend", trackCard(rec.music)
      + `<details class="saw-q"><summary>Підтримує війну? ⬇️</summary><div class="saw-body"><p class="muted small">Перевіряю…</p></div></details>`);
    const box = head.parentElement.querySelector(".saw-q .saw-body");
    saw.check(rec.music.artist).then(res => { if (box) box.innerHTML = saw.details(res); })
      .catch(() => { if (box) box.innerHTML = `<p class="muted small">Не вдалося перевірити — спробуй пізніше.</p>`; });
  }
  if (rec.toy && banner) {
    const src = esc(toyUrl(pds, p.did, rec.toy));
    banner.insertAdjacentHTML("beforeend", `<img class="sb-toy" src="${src}" alt="Іграшка" data-act="lightboxOne" data-full="${src}">`);
  }
}

/* ---------- music search ---------- */
// The iTunes catalogue needs no key, allows reading from any site (CORS) and gives a 30-second preview.
// (There used to be a JSONP fallback: it ran a script from Apple inside Skybee, which a Content-Security-Policy forbids.)
async function searchTracks(term) {
  const url = `https://itunes.apple.com/search?media=music&entity=song&limit=15&term=${encodeURIComponent(term)}`;
  let d;
  try { const r = await fetch(url); if (!r.ok) throw 0; d = await r.json(); } catch { throw new Error("Немає з'єднання з каталогом музики"); }
  return (d.results || []).filter(t => t.trackName && isHttps(t.trackViewUrl)).map(t => ({
    url: t.trackViewUrl, title: cut(t.trackName, 120), artist: cut(t.artistName, 120),
    cover: media((t.artworkUrl100 || "").replace("100x100", "300x300")), preview: media(t.previewUrl) }));
}
// A pasted streaming link → title, artist, cover. song.link knows most services; oEmbed is the fallback.
async function lookupTrack(url) {
  try {
    const d = await (await fetch(`https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(url)}`)).json();
    const e = d.entitiesByUniqueId?.[d.entityUniqueId];
    if (e?.title) return { url, title: cut(e.title, 120), artist: cut(e.artistName, 120), cover: media(e.thumbnailUrl) };
  } catch { /* try the service itself */ }
  const host = new URL(url).hostname.replace(/^www\./, "");
  const oembed = host.endsWith("spotify.com") ? "https://open.spotify.com/oembed?url="
    : host.endsWith("soundcloud.com") ? "https://soundcloud.com/oembed?format=json&url=" : "";
  if (!oembed) return null;
  try {
    const d = await (await fetch(oembed + encodeURIComponent(url))).json();
    return d.title ? { url, title: cut(d.title, 120), artist: cut(d.author_name, 120), cover: media(d.thumbnail_url) } : null;
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
        box.innerHTML = list.length ? list.map((t, i) => `<div class="sb-pick" data-i="${i}">${trackCard(t, "flat")}<div class="saw-line" data-saw="${i}"></div></div>`).join("")
          : `<p class="muted small">Нічого не знайдено</p>`;
        // under each track: the position of every artist on the war (starsaboutwar.in.ua)
        list.forEach((t, i) => saw.check(t.artist).then((res) => {
          t.saw = res; const el = box.querySelector(`[data-saw="${i}"]`);
          if (el && my === seq) el.innerHTML = saw.marks(res);
        }).catch(() => { const el = box.querySelector(`[data-saw="${i}"]`); if (el) el.innerHTML = `<span class="muted small">Не вдалося перевірити виконавця</span>`; }));
      } catch (ex) { if (my === seq) box.innerHTML = `<p class="err">${esc(errText(ex))}</p>`; }
    };
    q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 400); });
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") { clearTimeout(timer); run(); } });
    box.addEventListener("click", async (e) => {
      const row = e.target.closest(".sb-pick");
      if (!row || e.target.closest(".sb-play, .saw-line a")) return; // ▶ only plays the preview; the source link opens the site
      e.preventDefault();
      const t = list[row.dataset.i];
      const bad = (t.saw || []).filter(x => x.entry?.status === "za").map(x => x.name);
      if (bad.length && !await confirmBox(`За даними starsaboutwar.in.ua ${bad.join(", ")} ${bad.length > 1 ? "підтримують" : "підтримує"} війну. Все одно поставити цей трек у профіль?`, "Так, поставити", true)) return;
      picked = t; m.close();
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
  let music = cur.music || null, [c1, c2, c3] = colorsOf(cur) || ["", "", ""];
  let own = [c1 || "#c471f5", c2 || "#5b6cf9", c3 || ""]; // «свій» gradient: starts from the current one; the third colour is optional
  let flow = cur.flow !== false;
  const m = modal(`
    <h3>✨ Оформлення профілю</h3>
    <p class="muted small">Це бачать лише ті, хто користується Skybee. В інших застосунках Bluesky профіль виглядає як завжди.</p>
    <label class="field">Статус у бульбашці біля аватарки<input data-f="status" maxlength="${STATUS_MAX}" placeholder="Що у вас на думці?" value="${esc(cur.status || "")}"></label>
    <div class="field">Колір сторінки — градієнт: на світлій темі яскравий, на темній і в сутінках глибокий темний
      <div class="sb-grads"><button type="button" class="sb-gr none" data-g="" title="Без кольору">✕</button>${
        GRADIENTS.map(([a, b, n]) => `<button type="button" class="sb-gr" data-g="${a} ${b}" title="${n}" aria-label="${n}" style="background:linear-gradient(90deg, ${a}, ${b}, ${a}, ${b})"></button>`).join("")}</div>
      <div class="sb-own">свій:
        <label class="sb-dot" title="Перший колір"><input type="color" data-own="0"></label><span class="sb-arrow">→</span>
        <label class="sb-dot" title="Другий колір"><input type="color" data-own="1"></label><span class="sb-arrow">→</span>
        <span class="sb-third"></span></div>
      <p class="muted small sb-gname"></p>
      <label class="stoggle"><span class="grow">Переливання<small class="muted">Кольори повільно перетікають один в одний — на сторінці профілю й на твоїх постах</small></span><input type="checkbox" data-f="flow" ${flow ? "checked" : ""}><i></i></label></div>
    <div class="field">Музика під біо<div data-f="music"></div></div>
    <label class="field">Іграшка — фото, яке сидітиме на банері (найкраще PNG з прозорим тлом)<input type="file" accept="image/*" data-f="toy"></label>
    ${cur.toy ? `<label class="row small"><input type="checkbox" data-f="notoy" style="width:auto"> прибрати іграшку</label>` : ""}
    <p class="err"></p>
    <div class="row end"><button class="ghost" data-x="0">Скасувати</button><button class="btn" data-x="1">Зберегти</button></div>`);
  const f = (k) => m.querySelector(`[data-f=${k}]`);
  const err = m.querySelector(".err");
  const drawColor = () => {
    const key = c1 && !c3 ? `${c1} ${c2}` : c1 ? "-" : "";
    m.querySelectorAll(".sb-gr").forEach(b => b.classList.toggle("on", b.dataset.g === key));
    const name = c1 && !c3 && gradientName(c1, c2);
    const isOwn = !!c1 && !name;
    // the third colour: a «＋» until it is added, then a dot with a small «✕» to take it away
    m.querySelector(".sb-third").innerHTML = own[2]
      ? `<label class="sb-dot" title="Третій колір"><input type="color" data-own="2"></label><button type="button" class="ghost sm icon sb-rm3" data-x="rm3" title="Прибрати третій колір">✕</button>`
      : `<button type="button" class="sb-dot sb-add3" data-x="add3" title="Додати третій колір">＋</button>`;
    m.querySelectorAll("[data-own]").forEach((i) => { const n = +i.dataset.own; i.value = own[n]; i.parentElement.style.background = own[n]; i.parentElement.classList.toggle("on", isOwn);
      i.oninput = () => { own[n] = i.value.toLowerCase(); [c1, c2, c3] = own; drawColor(); }; });
    m.querySelector(".sb-gname").textContent = !c1 ? "Без кольору — сторінка як завжди" : name ? `Градієнт «${name}»` : c3 ? "Свій градієнт із трьох кольорів" : "Свій градієнт";
  };

  const drawMusic = () => {
    f("music").innerHTML = music
      ? `<div class="row">${trackCard(music, "grow")}<button type="button" class="ghost sm icon" data-x="nomusic" title="Прибрати">✕</button></div>
         <button type="button" class="linklike small" data-x="music">Замінити</button>`
      : `<button type="button" class="ghost sb-add" data-x="music"><b>+</b> Додати музику</button>`;
  };
  drawColor(); drawMusic();
  m.addEventListener("click", async (e) => {
    const gr = e.target.closest(".sb-gr");
    if (gr) { [c1 = "", c2 = ""] = gr.dataset.g ? gr.dataset.g.split(" ") : []; c3 = ""; if (c1) own = [c1, c2, ""]; return drawColor(); }
    const x0 = e.target.closest("[data-x]")?.dataset.x;
    if (x0 === "add3") { own[2] = partner(own[1]); [c1, c2, c3] = own; return drawColor(); }
    if (x0 === "rm3") { own[2] = ""; [c1, c2, c3] = own; return drawColor(); }
    if (e.target.closest(".sb-dot")) { if (!c1 || gradientName(c1, c2) && !c3) { [c1, c2, c3] = own; drawColor(); } return; } // the picker opens by itself
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
      if (isColor(c1)) {
        record.color = c1;
        if (isColor(c2) && c2 !== c1) { record.color2 = c2; if (isColor(c3)) record.color3 = c3; }
        if (!f("flow").checked) record.flow = false;
      }
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
