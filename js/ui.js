// Skybee — rendering helpers
import { session, mutedWords, adultEnabled, labelPref, labelDef, labelName, labelerPref, labelerDids } from "./api.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = (s = "") => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const enc = encodeURIComponent;

// The Skybee bee: gold line art. Its gold follows the theme (--bee-hi / --bee-lo in style.css).
// Small sizes get thicker lines and no filigree on the wings, so it still reads at 16–24 px
export function bee(size = 24, full = size >= 40) {
  const w = size >= 120 ? 2.6 : size >= 40 ? 3.4 : size >= 24 ? 5 : 6;
  return `<svg class="bee" viewBox="0 0 100 100" aria-hidden="true" style="width:${size}px;height:${size}px;fill:none;stroke:url(#beeGold);stroke-width:${w};stroke-linecap:round;stroke-linejoin:round"><g transform="translate(6 0)"><path d="M56 50C43 39 30 22 32 4C47 12 59 30 56 50Z"/><path d="M56 50C44 35 23 19 5 15C17 33 39 45 56 50Z"/><path d="M56 50C42 41 22 39 10 47C24 55 42 55 56 50Z"/>${full ? `<g class="fl"><path d="M44 22c-4-1-6 3-3 5c3 2 6-1 4-4"/><path d="M50 36c-1-4-6-4-6 0c0 3 4 3 4 1"/><path d="M38 12c-2 2-1 6 3 6"/><path d="M24 25c-4 0-4 4-1 5c3 1 4-2 2-3"/><path d="M38 36c-2-3-7-2-6 2"/><path d="M26 46c-2-2-6-1-5 2c1 2 4 2 4 0"/><path d="M40 47c-3-2-7 0-5 3"/></g>` : ""}<path d="M44 57C51 53 59 58 58 67C57 79 43 92 28 99C23 91 22 82 26 74C30 65 37 59 44 57Z"/><path d="M32 64C39 64 46 67 51 72"/><path d="M28 73C35 73 41 76 46 81"/>${full ? `<path d="M26 83C31 83 36 85 39 88"/>` : ""}<path d="M60 66C66 62 68 57 64 52C61 48 63 45 67 45"/><ellipse cx="72" cy="43" rx="6.5" ry="9" transform="rotate(-30 72 43)"/><path d="M69 34C70 28 73 25 77 23"/><path d="M73 36C76 31 80 29 85 29"/></g></svg>`;
}
// the gradient every bee uses, put into the page once
if (!document.getElementById("beeGold")) document.body.insertAdjacentHTML("afterbegin",
  `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="beeGold" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" style="stop-color:var(--bee-hi)"/><stop offset="1" style="stop-color:var(--bee-lo)"/></linearGradient></defs></svg>`);

/* ---------- caches: post/profile objects by key, used by click actions ---------- */
export const posts = new Map();
export const actors = new Map();
export const cachePost = (p) => { if (p?.uri) posts.set(p.uri, p); return p; };
export const pwa = { install: null }; // the browser's «install this app» prompt, when it offers one

/* ---------- formatting ---------- */
export function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return "щойно";
  if (s < 3600) return `${Math.floor(s / 60)} хв`;
  if (s < 86400) return `${Math.floor(s / 3600)} год`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} д`;
  return new Date(iso).toLocaleDateString("uk-UA", { day: "numeric", month: "short", year: s > 86400 * 300 ? "numeric" : undefined });
}
export const fullDate = (iso) => new Date(iso).toLocaleString("uk-UA", { dateStyle: "long", timeStyle: "short" });
export function num(n = 0) {
  if (n < 1000) return String(n);
  if (n < 1e6) return (n / 1000).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, "") + " тис.";
  return (n / 1e6).toFixed(1).replace(/\.0$/, "") + " млн";
}
// «@lejk309» instead of «@lejk309.bsky.social»; other domains stay whole. Escaped, ready for HTML
export const shortHandle = (h = "") => h.replace(/\.bsky\.social$/i, "");
export const at = (h) => "@" + esc(shortHandle(h));
export const name = (a) => esc(a?.displayName || a?.handle || "");
// the name with a verification mark, for places where HTML is allowed
export const vname = (a) => name(a) + (a?.verification?.trustedVerifierStatus === "valid" ? ` <span class="verified" title="Довірений верифікатор">✪</span>`
  : a?.verification?.verifiedStatus === "valid" ? ` <span class="verified" title="Верифіковано">✔</span>` : "");
export const hiddenReplies = new Set(); // replies hidden by the author of the thread on screen
// «LIVE»: the person shows that they are streaming right now (app.bsky.actor.status)
export const isLive = (a) => { const s = a?.status; return s?.status === "app.bsky.actor.status#live" && s.isActive !== false && (!s.expiresAt || Date.parse(s.expiresAt) > Date.now()); };
export const avatar = (a, size = 44) => {
  const img = a?.avatar ? `<img class="avatar" style="width:${size}px;height:${size}px" src="${esc(a.avatar)}" alt="" loading="lazy">`
    : `<div class="avatar ph" style="width:${size}px;height:${size}px">${esc((a?.displayName || a?.handle || "?")[0].toUpperCase())}</div>`;
  return isLive(a) && size >= 28 ? `<span class="live-ava" title="Зараз в ефірі">${img}<b>LIVE</b></span>` : img;
};
export const profileHref = (a) => `#/profile/${enc(a.handle && a.handle !== "handle.invalid" ? a.handle : a.did)}`;
export const postHref = (p) => `#/profile/${enc(p.author?.did || p.uri.split("/")[2])}/post/${p.uri.split("/").pop()}`;
export const webUrl = (p) => `https://bsky.app/profile/${p.author?.handle || p.uri.split("/")[2]}/post/${p.uri.split("/").pop()}`;

/* ---------- rich text ---------- */
const te = new TextEncoder(), td = new TextDecoder();
export function linkify(s) {
  return esc(s)
    .replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)"']/g, u => `<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\//, "").slice(0, 40)}${u.length > 48 ? "…" : ""}</a>`)
    .replace(/(^|\s)@([a-zA-Z0-9.-]+\.[a-zA-Z]+)/g, (m, sp, h) => `${sp}<a href="#/profile/${h}">@${h}</a>`)
    .replace(/(^|\s)#([^\s#<]+)/gu, (m, sp, t) => `${sp}<a href="#/search?q=${enc("#" + t)}">#${t}</a>`);
}
export function richText(text = "", facets) {
  if (!facets?.length) return linkify(text);
  const bytes = te.encode(text);
  let out = "", pos = 0;
  for (const f of [...facets].sort((a, b) => a.index.byteStart - b.index.byteStart)) {
    const { byteStart: s, byteEnd: e } = f.index;
    if (s < pos || e > bytes.length) continue;
    out += esc(td.decode(bytes.slice(pos, s)));
    const seg = esc(td.decode(bytes.slice(s, e)));
    const ft = f.features?.[0] || {};
    if (ft.$type === "app.bsky.richtext.facet#link") out += `<a href="${esc(ft.uri)}" target="_blank" rel="noopener">${seg}</a>`;
    else if (ft.$type === "app.bsky.richtext.facet#mention") out += `<a href="#/profile/${enc(ft.did)}">${seg}</a>`;
    else if (ft.$type === "app.bsky.richtext.facet#tag") out += `<a href="#/tag/${enc(ft.tag)}">${seg}</a>`;
    else out += seg;
    pos = e;
  }
  return out + esc(td.decode(bytes.slice(pos)));
}

/* ---------- moderation labels ---------- */
// label → [text, adults only]. The visibility of each one is set in «Фільтри контенту»
const LABELS = { porn: ["Контент для дорослих", true], sexual: ["Відвертий контент", true], nudity: ["Оголеність", false], "graphic-media": ["Жорсткий контент", true] };
const LABEL_ALIAS = { gore: "graphic-media", nsfl: "graphic-media", nsfw: "porn" };
// → null (show as is) or { text, hide, locked }: `hide` removes the post from feeds, `locked` cannot be opened without the adult setting
export function warnLabel(p) {
  if (p.author?.did === session?.did) return null;
  let found = null;
  for (const l of [...(p.labels || []), ...(p.author?.labels || [])]) {
    if (l.neg) continue;
    if (l.val === "!hide") return { text: "Приховано модерацією", hide: true };
    if (l.val === "!warn") { found ||= { text: "Попередження про вміст" }; continue; }
    const key = LABEL_ALIAS[l.val] || l.val, def = LABELS[key];
    if (!def) {
      // a label from a moderation service the user subscribed to, by its own definition and the user's choice for it
      const ld = labelerDids.includes(l.src) && labelDef(l.src, l.val);
      if (!ld || ld.severity === "none" && ld.blurs === "none") continue;
      if (ld.adultOnly && !adultEnabled()) return { text: labelName(ld), hide: true, locked: true };
      const v = labelerPref(l.src, l.val);
      if (v === "hide") return { text: labelName(ld), hide: true };
      if (v === "warn" && ld.blurs !== "none") found ||= { text: labelName(ld) };
      continue;
    }
    if (def[1] && !adultEnabled()) return { text: def[0], hide: true, locked: true };
    const vis = labelPref(key);
    if (vis === "hide") return { text: def[0], hide: true };
    if (vis === "warn") found ||= { text: def[0] };
  }
  return found;
}
const blurWrap = (html, label) => !label || !html ? html
  : `<div class="blurbox"><div class="blurred">${html}</div>${label.locked
    ? `<a class="ghost unblur" href="#/settings/content">🔞 ${esc(label.text)} · увімкнути в налаштуваннях</a>`
    : `<button class="ghost unblur" data-act="unblur">⚠️ ${esc(label.text)} · Показати</button>`}</div>`;

/* ---------- muted words ---------- */
// Same matching rules as the official client, so a word muted there hides the same posts here.
const NO_SPACE_LANGS = ["ja", "zh", "ko", "th", "vi"]; // no spaces between words → plain substring search

// → the first of `words` that hides this text, or null
export function matchMuted(words, { text, facets, tags, langs, actor }) {
  const body = (text || "").toLowerCase(), nowIso = new Date().toISOString();
  const substring = NO_SPACE_LANGS.includes(langs?.[0] || "");
  const allTags = [...(tags || []), ...(facets || []).flatMap(f => (f.features || []).filter(x => x.$type === "app.bsky.richtext.facet#tag").map(x => x.tag))]
    .map(t => t.toLowerCase());
  for (const w of words) {
    const word = (w.value || "").toLowerCase();
    if (!word || (w.expiresAt && w.expiresAt < nowIso)) continue;
    if (w.actorTarget === "exclude-following" && actor?.viewer?.following) continue;
    if (allTags.includes(word)) return w;
    if (!w.targets?.includes("content")) continue; // a tag-only word
    if ((word.length === 1 || substring) && body.includes(word)) return w;
    if (word.length > body.length) continue;
    if (word === body) return w;
    if (/\s|\p{P}/u.test(word) && body.includes(word)) return w; // a phrase
    for (const raw of body.split(/\s/)) {
      const token = raw.replace(/^\p{P}+|\p{P}+$/gu, "");
      if (raw === word || token === word) return w;
      // punctuation inside a token: «s.p.o.i.l.e.r» or «spoiler-free»; tokens with «/» (links, «and/or») are left alone
      if (word.length > token.length || !/\p{P}/u.test(token) || token.includes("/")) continue;
      const spaced = token.replace(/\p{P}+/gu, " ");
      if (spaced === word || spaced.replace(/\s/g, "") === word || token.split(/\p{P}+/u).includes(word)) return w;
    }
  }
  return null;
}

// → the muted word that hides this post (its text, tags, image descriptions, link card or quoted post), or null
export function mutedBy(p) {
  if (!mutedWords.length || !p?.author || p.author.did === session?.did) return null; // own posts are never hidden
  const E = "app.bsky.embed.", rec = p.record || {}, e = p.embed;
  const alts = (em, v) => em?.$type === E + "images" + v ? em.images.map(i => i.alt) : em?.$type === E + "gallery" + v ? em.items.map(i => i.alt) : [];
  const card = (em, v) => em?.$type === E + "external" + v ? [`${em.external.title} ${em.external.description}`] : [];
  const parts = [[rec.text, rec.langs, p.author, rec], ...alts(rec.embed, "").map(t => [t, rec.langs, p.author]), ...card(e, "#view").map(t => [t, [], p.author])];
  const q = e?.$type === E + "record#view" ? e.record : e?.$type === E + "recordWithMedia#view" ? e.record?.record : null;
  if (q?.$type === E + "record#viewRecord") {
    const v = q.value || {};
    parts.push([v.text, v.langs, q.author, v]);
    if (e.$type === E + "record#view") { // the quoted post's own media, as written in its record
      const m = v.embed?.$type === E + "recordWithMedia" ? v.embed.media : v.embed;
      parts.push(...alts(m, "").map(t => [t, v.langs, q.author]), ...card(m, "").map(t => [t, [], q.author]));
    } else parts.push(...alts(e.media, "#view").map(t => [t, rec.langs, q.author]), ...card(e.media, "#view").map(t => [t, [], q.author]));
  }
  for (const [text, langs, actor, src] of parts) {
    const w = matchMuted(mutedWords, { text, langs, actor, facets: src?.facets, tags: src?.tags });
    if (w) return w;
  }
  return null;
}

/* ---------- embeds ---------- */
// Links that can play right in the post: video services get a picture with ▶, music a «listen here» button.
// The player itself (an iframe) appears only after a click, so nothing is loaded from those sites before that.
export const playersOn = () => { try { return localStorage.getItem("skybee.players") !== "0"; } catch { return true; } };
export function playerOf(uri) {
  if (!playersOn()) return null;
  let u; try { u = new URL(uri); } catch { return null; }
  const h = u.hostname.replace(/^(www|m|music)\./, ""), path = u.pathname;
  let m;
  if (h === "youtube.com" || h === "youtu.be") {
    const id = h === "youtu.be" ? path.slice(1, 12) : u.searchParams.get("v") || path.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/)?.[1];
    if (!/^[\w-]{11}$/.test(id || "")) return null;
    const t = parseInt(u.searchParams.get("t")) || 0;
    return { video: true, ratio: path.startsWith("/shorts/") ? "9/16" : "16/9", src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1${t ? "&start=" + t : ""}` };
  }
  if (h === "vimeo.com" && (m = path.match(/^\/(\d+)/))) return { video: true, ratio: "16/9", src: `https://player.vimeo.com/video/${m[1]}?autoplay=1` };
  if (h === "twitch.tv" && location.protocol.startsWith("http")) { // Twitch wants to know the site that shows it
    if ((m = path.match(/^\/videos\/(\d+)/))) return { video: true, ratio: "16/9", src: `https://player.twitch.tv/?video=${m[1]}&parent=${location.hostname}` };
    if ((m = path.match(/^\/([\w]+)\/?$/))) return { video: true, ratio: "16/9", src: `https://player.twitch.tv/?channel=${m[1]}&parent=${location.hostname}` };
  }
  if (h === "open.spotify.com" && (m = path.match(/^\/(?:intl-[\w-]+\/)?(track|album|playlist|episode|show|artist)\/(\w+)/)))
    return { height: ["track", "episode"].includes(m[1]) ? 152 : 352, src: `https://open.spotify.com/embed/${m[1]}/${m[2]}` };
  if (h === "soundcloud.com" && path.split("/").filter(Boolean).length >= 2)
    return { height: path.includes("/sets/") ? 300 : 166, src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(u.origin + path)}&auto_play=true&visual=false` };
  if (u.hostname === "music.apple.com" && /\/(album|playlist|song)\//.test(path))
    return { height: u.searchParams.get("i") || path.includes("/song/") ? 175 : 450, src: `https://embed.music.apple.com${path}${u.search}` };
  return null;
}

export function renderEmbed(embed, label) {
  if (!embed) return "";
  const t = embed.$type;
  if (t === "app.bsky.embed.images#view") {
    const imgs = embed.images;
    return blurWrap(`<div class="imgs n${imgs.length}">${imgs.map((i, n) =>
      `<img src="${esc(i.thumb)}" data-full="${esc(i.fullsize)}" data-act="lightbox" data-i="${n}" alt="${esc(i.alt)}" title="${esc(i.alt)}" loading="lazy">`).join("")}</div>`, label);
  }
  if (t === "app.bsky.embed.video#view") {
    const ar = embed.aspectRatio ? `aspect-ratio:${embed.aspectRatio.width}/${embed.aspectRatio.height}` : "aspect-ratio:16/9";
    const gif = embed.presentation === "gif"; // a GIF posted as a video: no controls, a click plays it in a silent loop
    return blurWrap(`<div class="video${gif ? " gif" : ""}" style="${ar}"><video ${gif ? "data-gif loop muted" : "controls"} playsinline preload="none" poster="${esc(embed.thumbnail || "")}" data-src="${esc(embed.playlist)}" title="${esc(embed.alt || "")}"></video></div>`, label);
  }
  if (t === "app.bsky.embed.external#view") {
    const x = embed.external;
    if (/^https:\/\/media\.tenor\.com\//.test(x.uri))
      return `<div class="imgs n1"><img src="${esc(x.uri)}" alt="${esc(x.title)}" loading="lazy"></div>`;
    let host = ""; try { host = new URL(x.uri).hostname.replace(/^www\./, ""); } catch {}
    const pl = playerOf(x.uri);
    if (pl?.video) return `<div class="playwrap pvid" style="aspect-ratio:${pl.ratio}">
      ${x.thumb ? `<img src="${esc(x.thumb)}" alt="" loading="lazy">` : ""}<button class="bigplay" data-act="player" data-src="${esc(pl.src)}" title="Дивитися тут">▶</button>
      <a class="ptitle" href="${esc(x.uri)}" target="_blank" rel="noopener"><small>${esc(host)}</small> ${esc(x.title || x.uri)}</a></div>`;
    if (pl) return `<div class="playwrap" data-h="${pl.height}"><a class="ext" href="${esc(x.uri)}" target="_blank" rel="noopener">
      ${x.thumb ? `<img src="${esc(x.thumb)}" alt="" loading="lazy">` : ""}
      <div><small>${esc(host)}</small><b>${esc(x.title || x.uri)}</b><small>${esc((x.description || "").slice(0, 160))}</small></div></a>
      <button class="ghost sm playbtn" data-act="player" data-src="${esc(pl.src)}">▶ Слухати тут</button></div>`;
    return `<a class="ext" href="${esc(x.uri)}" target="_blank" rel="noopener">
      ${x.thumb ? `<img src="${esc(x.thumb)}" alt="" loading="lazy">` : ""}
      <div><small>${esc(host)}</small><b>${esc(x.title || x.uri)}</b><small>${esc((x.description || "").slice(0, 160))}</small></div></a>`;
  }
  if (t === "app.bsky.embed.record#view") return renderRecord(embed.record);
  if (t === "app.bsky.embed.recordWithMedia#view") return renderEmbed(embed.media, label) + renderRecord(embed.record.record);
  return "";
}

function renderRecord(r) {
  if (!r) return "";
  const t = r.$type;
  if (t === "app.bsky.embed.record#viewNotFound") return `<div class="quote muted">Пост видалено</div>`;
  if (t === "app.bsky.embed.record#viewBlocked") return `<div class="quote muted">Пост заблоковано</div>`;
  if (t === "app.bsky.embed.record#viewDetached") return `<div class="quote muted">Автор від'єднав цитату</div>`;
  if (t === "app.bsky.feed.defs#generatorView")
    return `<a class="quote card-row" href="#/feed/${enc(r.uri)}">${avatar({ avatar: r.avatar, displayName: r.displayName }, 36)}<div><b>${esc(r.displayName)}</b><small>Фід від ${at(r.creator.handle)}</small></div></a>`;
  if (t === "app.bsky.graph.defs#listView")
    return `<a class="quote card-row" href="#/list/${enc(r.uri)}">${avatar({ avatar: r.avatar, displayName: r.name }, 36)}<div><b>${esc(r.name)}</b><small>Список від ${at(r.creator.handle)}</small></div></a>`;
  if (t === "app.bsky.graph.defs#starterPackViewBasic")
    return `<a class="quote card-row" href="#/starter-pack/${enc(r.creator.did)}/${r.uri.split("/").pop()}"><span class="bigemoji">🎒</span><div><b>${esc(r.record?.name || "Стартовий набір")}</b><small>Стартовий набір від ${at(r.creator.handle)}</small></div></a>`;
  if (t === "app.bsky.labeler.defs#labelerView")
    return `<a class="quote card-row" href="${profileHref(r.creator)}">${avatar(r.creator, 36)}<div><b>${name(r.creator)}</b><small>Сервіс модерації</small></div></a>`;
  if (t === "app.bsky.embed.record#viewRecord") {
    const fake = { uri: r.uri, cid: r.cid, author: r.author, record: r.value, labels: r.labels };
    const label = warnLabel(fake);
    const media = (r.embeds || []).map(e => e.$type === "app.bsky.embed.record#view" || e.$type === "app.bsky.embed.recordWithMedia#view"
      ? renderEmbed(e.media ? { ...e.media } : null, label) : renderEmbed(e, label)).join("");
    return `<div class="quote" data-href="${postHref(fake)}">
      <div class="meta">${avatar(r.author, 18)} <b>${vname(r.author)}</b> <span>${at(r.author.handle)} · ${ago(r.indexedAt)}</span></div>
      <div class="text">${richText(r.value?.text, r.value?.facets)}</div>${media}</div>`;
  }
  return "";
}

/* ---------- post card ---------- */
const I = {
  reply: `<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4A8 8 0 1 1 20 12z"/></svg>`,
  repost: `<svg viewBox="0 0 24 24"><path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/></svg>`,
  like: `<svg viewBox="0 0 24 24"><path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-3 4.5 4.5 0 0 1 8 3c0 6-8 11-8 11z"/></svg>`,
  bm: `<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg>`,
  more: `<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>`,
};
export const icons = I;

export function actionsBar(p, big = false) {
  const v = p.viewer || {};
  const noReply = v.replyDisabled;
  return `<div class="actions${big ? " big" : ""}">
    <button data-act="reply" ${noReply ? "disabled title='Відповіді обмежено'" : ""}>${I.reply}<span>${num(p.replyCount)}</span></button>
    <button data-act="repostMenu" class="${v.repost ? "on-repost" : ""}">${I.repost}<span>${num(p.repostCount + (p.quoteCount || 0))}</span></button>
    <button data-act="like" class="${v.like ? "on-like" : ""}">${I.like}<span>${num(p.likeCount)}</span></button>
    <button data-act="bookmark" class="${v.bookmarked ? "on-bm" : ""}" title="Закладка">${I.bm}</button>
    <button data-act="postMenu" title="Більше">${I.more}</button>
  </div>`;
}

/* ---------- threadgate: who can reply ---------- */
const RULE_UA = { mentionRule: "згадані в пості", followingRule: "ті, за ким стежить автор", followerRule: "читачі автора" };

// The line under a thread: who can reply. `root` is the thread's first post; `mine` adds the edit button.
export function gateLine(root, { mine = false, noReply = false } = {}) {
  const tg = root.threadgate, allow = tg?.record?.allow;
  if (!allow && !noReply && !mine) return "";
  const text = !allow ? (noReply ? "Відповіді обмежено" : "Відповідати можуть усі")
    : !allow.length ? "Відповіді вимкнено"
    : "Відповідати можуть: " + allow.map(r => {
        const kind = r.$type?.split("#")[1];
        if (kind !== "listRule") return RULE_UA[kind] || "інші";
        const l = tg.lists?.find(l => l.uri === r.list);
        return l ? `список <a href="#/list/${enc(l.uri)}">${esc(l.name)}</a>` : "учасники списку";
      }).join(", ");
  return `<div class="gate muted small" data-uri="${esc(root.uri)}">${allow || noReply ? "🔒" : "💬"} ${text}${
    mine ? ` · <button class="linklike" data-act="editGate">Змінити</button>` : ""}</div>`;
}

// feed / ctx: the custom feed the post came from and its feedContext, for «show more / less like this»
export function renderPost(p, { reason, parent, thread = false, focus = false, line = false, feed, ctx } = {}) {
  cachePost(p);
  const a = p.author, rec = p.record || {};
  const label = warnLabel(p);
  const muted = focus ? null : mutedBy(p); // an opened post is always shown
  const top = [];
  if (reason?.$type === "app.bsky.feed.defs#reasonRepost")
    top.push(`<div class="reason">${I.repost} <a href="${profileHref(reason.by)}">${name(reason.by)}</a> поширив(-ла)</div>`);
  if (reason?.$type === "app.bsky.feed.defs#reasonPin") top.push(`<div class="reason">📌 Закріплено</div>`);
  if (parent?.author && !thread) top.push(`<div class="reason">↩︎ У відповідь <a href="${profileHref(parent.author)}">${name(parent.author)}</a></div>`);
  if (hiddenReplies.has(p.uri)) top.push(`<div class="reason">🙈 Автор гілки приховав цю відповідь</div>`);
  const langs = rec.langs?.length && !rec.langs.includes("uk") ? `<button class="linklike small" data-act="translate">Перекласти</button>` : "";
  if (focus) return `
  <article class="post focus" data-uri="${esc(p.uri)}">
    <div class="row">${avatar(a, 48)}
      <div class="who"><a href="${profileHref(a)}"><b>${vname(a)}</b></a><span class="muted">${at(a.handle)}</span></div>
      ${followBtn(a)}
    </div>
    <div class="text big">${richText(rec.text, rec.facets)}</div>
    ${renderEmbed(p.embed, label)}
    ${langs}
    <div class="muted small" style="margin:10px 0">${fullDate(rec.createdAt || p.indexedAt)}</div>
    <div class="stats">
      <a href="${postHref(p)}/reposts"><b>${num(p.repostCount)}</b> поширень</a>
      <a href="${postHref(p)}/quotes"><b>${num(p.quoteCount)}</b> цитат</a>
      <a href="${postHref(p)}/likes"><b>${num(p.likeCount)}</b> вподобань</a>
    </div>
    ${actionsBar(p, true)}
  </article>`;
  return `
  <article class="post${line ? " has-line" : ""}${muted ? " mw-hidden" : ""}" data-uri="${esc(p.uri)}" data-href="${postHref(p)}"${feed ? ` data-feed="${esc(feed)}"${ctx ? ` data-fctx="${esc(ctx)}"` : ""}` : ""}>
    ${muted ? `<button class="mw-note linklike small" data-act="showMuted">🙈 ${at(a.handle)} · приховано через слово «${esc(muted.value)}» · Показати</button>` : ""}
    <div class="left"><a href="${profileHref(a)}">${avatar(a)}</a>${line ? `<div class="tline"></div>` : ""}</div>
    <div class="body">
      ${top.join("")}
      <div class="meta"><a href="${profileHref(a)}"><b>${vname(a)}</b></a> <span>${at(a.handle)}</span> · <a href="${postHref(p)}" title="${esc(fullDate(p.indexedAt))}">${ago(p.indexedAt)}</a></div>
      <div class="text">${richText(rec.text, rec.facets)}</div>
      ${renderEmbed(p.embed, label)}
      ${langs}
      ${actionsBar(p)}
    </div>
  </article>`;
}

export function followBtn(a) {
  if (!session || a.did === session.did) return "";
  if (a.viewer?.blocking) return `<button class="ghost sm" data-act="unblock" data-did="${a.did}">Розблокувати</button>`;
  return a.viewer?.following
    ? `<button class="ghost sm" data-act="unfollow" data-did="${a.did}">Ви стежите</button>`
    : `<button class="btn sm" data-act="follow" data-did="${a.did}">${a.viewer?.followedBy ? "Стежити у відповідь" : "Стежити"}</button>`;
}

export function renderActor(a, extra = "") {
  actors.set(a.did, a);
  return `<div class="actor" data-href="${profileHref(a)}">
    ${avatar(a, 44)}
    <div class="who"><b>${vname(a)}</b><span class="muted">${at(a.handle)}${a.viewer?.followedBy ? ' <span class="pill">Стежить за вами</span>' : ""}</span>
      ${a.description ? `<div class="desc">${esc(a.description.slice(0, 160))}</div>` : ""}${extra}</div>
    ${followBtn(a)}
  </div>`;
}

export function renderFeedCard(f) {
  return `<div class="actor" data-href="#/feed/${enc(f.uri)}">
    ${avatar({ avatar: f.avatar, displayName: f.displayName }, 44)}
    <div class="who"><b>${esc(f.displayName)}</b><span class="muted">Фід від ${at(f.creator.handle)} · ♥ ${num(f.likeCount)}</span>
      ${f.description ? `<div class="desc">${esc(f.description.slice(0, 200))}</div>` : ""}</div>
    <button class="ghost sm" data-act="saveFeed" data-uri="${esc(f.uri)}">${f.viewer?.saved ? "✓" : "+"}</button>
  </div>`;
}

/* ---------- toast / modal / menu ---------- */
export function toast(msg, ms = 2500) {
  const t = document.createElement("div");
  t.className = "toast"; t.innerHTML = esc(msg).replace(/🐝/g, bee(18)); // the text stays text; only the bee becomes the drawing
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("out"), ms);
  setTimeout(() => t.remove(), ms + 400);
}

// canClose() may refuse when the user dismisses the modal (Esc, click outside); onClose() runs whenever it closes
export function modal(html, { wide = false, canClose, onClose } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "modal-bg";
  wrap.innerHTML = `<div class="modal${wide ? " wide" : ""}">${html}</div>`;
  const dismiss = () => { if (!canClose || canClose()) close(); };
  wrap.addEventListener("click", e => { if (e.target === wrap) dismiss(); });
  const onKey = (e) => { if (e.key === "Escape") dismiss(); };
  document.addEventListener("keydown", onKey);
  function close() { wrap.remove(); document.removeEventListener("keydown", onKey); onClose?.(); }
  document.body.appendChild(wrap);
  wrap.close = close;
  return wrap;
}

export function confirmBox(text, okLabel = "Так", danger = false) {
  return new Promise(res => {
    const m = modal(`<p>${esc(text)}</p><div class="row end"><button class="ghost" data-x="0">Скасувати</button><button class="btn${danger ? " danger" : ""}" data-x="1">${esc(okLabel)}</button></div>`);
    m.addEventListener("click", e => { const x = e.target.closest("[data-x]"); if (x) { m.close(); res(x.dataset.x === "1"); } });
  });
}

// items: [{label, act, danger}] ; returns chosen act or null
export function menu(anchor, items) {
  document.querySelector(".popmenu")?.remove();
  return new Promise(res => {
    const m = document.createElement("div");
    m.className = "popmenu";
    m.innerHTML = items.map(i => i === "-" ? "<hr>" : `<button data-m="${esc(i.act)}" class="${i.danger ? "danger" : ""}">${i.label}</button>`).join("");
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    const w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + "px";
    m.style.top = (r.bottom + h + 8 > innerHeight ? r.top - h - 4 : r.bottom + 4) + scrollY + "px";
    const done = (v) => { m.remove(); document.removeEventListener("click", outside, true); res(v); };
    const outside = (e) => { if (!m.contains(e.target)) { e.stopPropagation(); e.preventDefault(); done(null); } };
    m.addEventListener("click", e => { const b = e.target.closest("[data-m]"); if (b) done(b.dataset.m); });
    setTimeout(() => document.addEventListener("click", outside, true));
  });
}

// Photo viewer: a click (or double tap) zooms in where you point, the wheel zooms smoothly, a zoomed photo is dragged around.
// ⬇ saves the full-size file; ✕, Esc or a click beside the photo closes it
export function lightbox(urls, i = 0, alts = []) {
  const m = modal(`<div class="lb"><div class="lb-bar"><span class="lb-n small"></span><div class="grow"></div>
      <button class="lb-btn" data-lb="save" title="Зберегти фото">⬇</button><button class="lb-btn" data-lb="close" title="Закрити">✕</button></div>
    <div class="lb-stage"><img src="${esc(urls[i])}" alt="" draggable="false"></div><p class="alt"></p>
    ${urls.length > 1 ? `<button class="lb-prev">‹</button><button class="lb-next">›</button>` : ""}</div>`, { wide: true });
  m.classList.add("dark");
  const img = m.querySelector("img"), alt = m.querySelector(".alt"), stage = m.querySelector(".lb-stage");
  let z = 1, x = 0, y = 0;
  const apply = () => { img.style.transform = `translate(${x}px, ${y}px) scale(${z})`; img.classList.toggle("zoomed", z > 1); };
  const reset = () => { z = 1; x = 0; y = 0; apply(); };
  const zoomAt = (nz, cx, cy) => { // keep the point under the cursor in place
    nz = Math.min(6, Math.max(1, nz));
    const r = stage.getBoundingClientRect(), px = cx - r.left - r.width / 2, py = cy - r.top - r.height / 2;
    x = px - (px - x) * nz / z; y = py - (py - y) * nz / z; z = nz;
    if (z === 1) { x = 0; y = 0; }
    apply();
  };
  const show = () => { img.src = urls[i]; alt.textContent = alts[i] || ""; m.querySelector(".lb-n").textContent = urls.length > 1 ? `${i + 1} / ${urls.length}` : ""; reset(); };
  show();
  m.querySelector(".lb-prev")?.addEventListener("click", () => { i = (i - 1 + urls.length) % urls.length; show(); });
  m.querySelector(".lb-next")?.addEventListener("click", () => { i = (i + 1) % urls.length; show(); });
  let moved = false, drag = null;
  img.addEventListener("pointerdown", (e) => { moved = false; if (z > 1) { drag = { sx: e.clientX - x, sy: e.clientY - y }; img.setPointerCapture(e.pointerId); } });
  img.addEventListener("pointermove", (e) => { if (!drag) return; moved = true; x = e.clientX - drag.sx; y = e.clientY - drag.sy; apply(); });
  img.addEventListener("pointerup", () => { drag = null; });
  img.addEventListener("click", (e) => { if (moved) return; z > 1 ? reset() : zoomAt(2.5, e.clientX, e.clientY); });
  stage.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(z * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY); }, { passive: false });
  stage.addEventListener("click", (e) => { if (e.target === stage) m.close(); });
  const arrows = (e) => {
    if (!m.isConnected) return document.removeEventListener("keydown", arrows);
    if (e.key === "ArrowLeft") m.querySelector(".lb-prev")?.click();
    if (e.key === "ArrowRight") m.querySelector(".lb-next")?.click();
  };
  document.addEventListener("keydown", arrows);
  m.querySelector("[data-lb=close]").addEventListener("click", () => m.close());
  m.querySelector("[data-lb=save]").addEventListener("click", async () => {
    const url = urls[i];
    try {
      const blob = await (await fetch(url)).blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `skybee-${url.split("/").pop().split("@")[0].slice(-16)}.${(blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg")}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch { window.open(url, "_blank"); } // the server did not allow reading it here: the browser saves it from a new tab
  });
}

/* ---------- video (HLS) ---------- */
let hlsLoading = null;
function loadHls() {
  if (window.Hls) return Promise.resolve();
  return hlsLoading ||= new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js";
    s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
}
export async function attachVideo(video) {
  const gif = "gif" in video.dataset;
  if (video.dataset.ready) { if (gif) video.paused ? video.play().catch(() => {}) : video.pause(); return; }
  video.dataset.ready = "1";
  if (gif) video.autoplay = true; // starts as soon as the stream is attached
  const src = video.dataset.src;
  const play = () => video.play().catch(() => {}); // the click that attached the stream also starts it
  // hls.js first: new Chromium (Chrome, the desktop app) says it plays HLS itself, but its own player fails on many Bluesky streams.
  // The browser's player only where hls.js cannot work (Safari, iPhone) or could not be loaded.
  let hlsOk = false;
  try { await loadHls(); hlsOk = window.Hls?.isSupported(); } catch {}
  if (!hlsOk) {
    if (video.canPlayType("application/vnd.apple.mpegurl")) { video.src = src; play(); }
    else videoError(video);
    return;
  }
  const hls = new window.Hls({ subtitleDisplay: true });
  // captions come inside the stream: turn on the one in the reader's language (or the first one); the player's CC button switches them
  hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
    play();
    const t = hls.subtitleTracks || [];
    if (!t.length) return;
    const i = t.findIndex(x => (x.lang || "").startsWith("uk"));
    hls.subtitleTrack = i >= 0 ? i : 0;
  });
  let retried = false;
  hls.on(window.Hls.Events.ERROR, (_e, d) => {
    if (!d.fatal) return;
    if (d.type === window.Hls.ErrorTypes.MEDIA_ERROR && !retried) { retried = true; hls.recoverMediaError(); return; }
    if (d.type === window.Hls.ErrorTypes.NETWORK_ERROR && !retried) { retried = true; hls.startLoad(); return; }
    hls.destroy(); videoError(video);
  });
  hls.loadSource(src); hls.attachMedia(video);
}
function videoError(video) {
  video.dataset.ready = "";
  video.closest(".video")?.insertAdjacentHTML("beforeend", `<div class="verr">Не вдалося відтворити відео. <button class="linklike" data-act="retryVideo">Спробувати ще</button></div>`);
}

/* ---------- infinite scroll ---------- */
// root: the scrolling box when it is not the page itself (deck columns)
export function infinite(container, loader, root = null) {
  const sentinel = document.createElement("div");
  sentinel.className = "sentinel";
  sentinel.innerHTML = `<div class="spinner"></div>`;
  container.after(sentinel);
  let busy = false, done = false;
  const io = new IntersectionObserver(async ([e]) => {
    if (!e.isIntersecting || busy || done) return;
    busy = true;
    try { done = !(await loader()); }
    catch (err) { sentinel.innerHTML = `<p class="err">${esc(err.message)}</p>`; done = true; }
    busy = false;
    if (done && !sentinel.querySelector(".err")) sentinel.innerHTML = `<p class="muted center small theend">Це все ${bee(18)}</p>`;
    else if (!done) { io.unobserve(sentinel); io.observe(sentinel); }
  }, { root, rootMargin: "800px" });
  io.observe(sentinel);
  return () => io.disconnect();
}

export const empty = (msg) => `<p class="muted center pad">${esc(msg)}</p>`;
export const spinner = () => `<div class="sentinel"><div class="spinner"></div></div>`;
