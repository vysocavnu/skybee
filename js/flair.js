// Skybee «оформлення»: a status bubble by the avatar, a track under the bio, a page colour and a toy.
// It lives in the user's own repo as one record, so any Skybee client can read it straight from their PDS;
// other Bluesky apps simply ignore the collection.
import * as api from "./api.js";
import { esc, modal, toast } from "./ui.js";

export const NSID = "io.github.vysocavnu.skybee.profile";
const STATUS_MAX = 60;
const cache = new Map(); // did → Promise<{ rec, pds } | null>

const isColor = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
const isHttps = (u) => typeof u === "string" && /^https:\/\/[^\s"'<>]+$/i.test(u);
const cut = (s, n) => (typeof s === "string" ? s.trim().slice(0, n) : "");
// dark text on light colours, light on dark
const inkFor = (c) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#1a1400" : "#ffffff";
};

// Records come from other people's repos: keep only well-formed fields
function clean(v) {
  if (!v || typeof v !== "object") return null;
  const out = {};
  if (cut(v.status, STATUS_MAX)) out.status = cut(v.status, STATUS_MAX);
  if (isColor(v.color)) out.color = v.color.toLowerCase();
  if (v.music && isHttps(v.music.url) && cut(v.music.title, 120)) {
    out.music = { url: v.music.url, title: cut(v.music.title, 120), artist: cut(v.music.artist, 120) };
    if (isHttps(v.music.cover)) out.music.cover = v.music.cover;
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

// Called right after the profile header is rendered; fills in the extras when they arrive
export async function decorate(el, p) {
  const head = el.querySelector(".phead");
  const got = await load(p.did);
  if (!got || !head?.isConnected) return; // nothing to show, or the user has already left the page
  const { rec, pds } = got;
  const banner = el.querySelector(".banner");
  if (rec.color) {
    for (const node of el.querySelectorAll(".banner, .phead, .tabs, #pbody")) {
      node.style.setProperty("--accent", rec.color);
      node.style.setProperty("--accent-ink", inkFor(rec.color));
    }
    head.classList.add("tinted");
    if (banner && !banner.style.backgroundImage) banner.style.backgroundImage = `linear-gradient(135deg, ${rec.color}, color-mix(in srgb, ${rec.color} 35%, var(--bg)))`;
  }
  if (rec.status) head.querySelector(".bigava")?.insertAdjacentHTML("beforeend", `<div class="sb-bubble" title="Статус у Skybee">${esc(rec.status)}</div>`);
  if (rec.music) {
    const m = rec.music;
    (head.querySelector(".bio") || head.querySelector(".counts"))?.insertAdjacentHTML("afterend",
      `<a class="sb-music" href="${esc(m.url)}" target="_blank" rel="noopener" title="Слухати">
        ${m.cover ? `<img src="${esc(m.cover)}" alt="" loading="lazy">` : `<span class="sb-note">🎵</span>`}
        <span class="grow"><b class="clip">${esc(m.title)}</b><span class="muted small clip">${esc(m.artist || "Музика")}</span></span>
        <span class="sb-play">▶</span></a>`);
  }
  if (rec.toy && banner) {
    const src = esc(toyUrl(pds, p.did, rec.toy));
    banner.insertAdjacentHTML("beforeend", `<img class="sb-toy" src="${src}" alt="Іграшка" data-act="lightboxOne" data-full="${src}">`);
  }
}

/* ---------- music lookup ---------- */
// Any streaming link → title, artist, cover. song.link knows most services; oEmbed is the fallback.
async function lookupTrack(url) {
  try {
    const d = await (await fetch(`https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(url)}`)).json();
    const e = d.entitiesByUniqueId?.[d.entityUniqueId];
    if (e?.title) return { title: e.title, artist: e.artistName || "", cover: e.thumbnailUrl || "" };
  } catch { /* try the service itself */ }
  const host = new URL(url).hostname.replace(/^www\./, "");
  const oembed = host.endsWith("spotify.com") ? "https://open.spotify.com/oembed?url="
    : host.endsWith("soundcloud.com") ? "https://soundcloud.com/oembed?format=json&url=" : "";
  if (!oembed) return null;
  try {
    const d = await (await fetch(oembed + encodeURIComponent(url))).json();
    return d.title ? { title: d.title, artist: d.author_name || "", cover: d.thumbnail_url || "" } : null;
  } catch { return null; }
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
  let cover = cur.music?.cover || "";
  const m = modal(`
    <h3>✨ Оформлення профілю</h3>
    <p class="muted small">Це бачать лише ті, хто користується Skybee. В інших застосунках Bluesky профіль виглядає як завжди.</p>
    <label class="field">Статус у бульбашці біля аватарки<input data-f="status" maxlength="${STATUS_MAX}" placeholder="Що у вас на думці?" value="${esc(cur.status || "")}"></label>
    <div class="field">Колір сторінки
      <div class="row"><input type="color" data-f="color" value="${cur.color || "#f5b301"}" style="width:64px;padding:2px;height:38px">
      <label class="row small"><input type="checkbox" data-f="usecolor" style="width:auto" ${cur.color ? "checked" : ""}> використовувати свій колір</label></div></div>
    <label class="field">Музика під біо — посилання на трек (Spotify, Apple Music, YouTube Music, Deezer, SoundCloud…)
      <div class="row"><input data-f="murl" type="url" placeholder="https://open.spotify.com/track/…" value="${esc(cur.music?.url || "")}"><button type="button" class="ghost sm" data-x="find" style="flex:none;white-space:nowrap">Знайти</button></div></label>
    <div class="row"><label class="field grow">Назва<input data-f="mtitle" maxlength="120" value="${esc(cur.music?.title || "")}"></label>
      <label class="field grow">Виконавець<input data-f="martist" maxlength="120" value="${esc(cur.music?.artist || "")}"></label></div>
    <label class="field">Іграшка — фото, яке сидітиме на банері (найкраще PNG з прозорим тлом)<input type="file" accept="image/*" data-f="toy"></label>
    ${cur.toy ? `<label class="row small"><input type="checkbox" data-f="notoy" style="width:auto"> прибрати іграшку</label>` : ""}
    <p class="err"></p>
    <div class="row end"><button class="ghost" data-x="0">Скасувати</button><button class="btn" data-x="1">Зберегти</button></div>`);
  const f = (k) => m.querySelector(`[data-f=${k}]`);
  const err = m.querySelector(".err");
  f("color").addEventListener("input", () => { f("usecolor").checked = true; });
  f("murl").addEventListener("input", () => { cover = ""; });
  m.addEventListener("click", async (e) => {
    const x = e.target.closest("[data-x]"); if (!x) return;
    err.textContent = "";
    if (x.dataset.x === "0") return m.close();
    if (x.dataset.x === "find") {
      const url = f("murl").value.trim();
      if (!isHttps(url)) { err.textContent = "Вставте посилання на трек (https://…)"; return; }
      x.disabled = true; x.textContent = "Шукаю…";
      const t = await lookupTrack(url);
      x.disabled = false; x.textContent = "Знайти";
      if (!t) { err.textContent = "Не вдалося розпізнати трек — впишіть назву й виконавця вручну"; return; }
      f("mtitle").value = t.title; f("martist").value = t.artist; cover = isHttps(t.cover) ? t.cover : "";
      return;
    }
    x.disabled = true; x.textContent = "Збереження…";
    try {
      const record = { $type: NSID, updatedAt: new Date().toISOString() };
      const status = cut(f("status").value, STATUS_MAX);
      if (status) record.status = status;
      if (f("usecolor").checked) record.color = f("color").value.toLowerCase();
      const murl = f("murl").value.trim();
      if (murl) {
        if (!isHttps(murl)) throw new Error("Посилання на трек має починатися з https://");
        let title = cut(f("mtitle").value, 120), artist = cut(f("martist").value, 120);
        if (!title) { // saved without pressing «Знайти»
          const t = await lookupTrack(murl);
          if (!t) throw new Error("Не вдалося розпізнати трек — впишіть назву вручну");
          title = t.title; artist = artist || t.artist; cover = isHttps(t.cover) ? t.cover : "";
        }
        record.music = { url: murl, title, artist };
        if (cover) record.music.cover = cover;
      }
      const file = f("toy").files[0];
      if (file) record.toy = { image: await api.uploadBlob(await prepareToy(file)) };
      else if (cur.toy && !f("notoy")?.checked) record.toy = cur.toy;
      await api.post("com.atproto.repo.putRecord", { repo: did, collection: NSID, rkey: "self", record, validate: false });
      cache.delete(did);
      m.close(); toast("Оформлення збережено"); onDone?.();
    } catch (ex) { err.textContent = ex.message; x.disabled = false; x.textContent = "Зберегти"; }
  });
}
