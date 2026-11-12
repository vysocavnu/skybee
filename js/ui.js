// Skybee — rendering helpers
import { session, mutedWords } from "./api.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = (s = "") => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const enc = encodeURIComponent;

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
export const name = (a) => esc(a?.displayName || a?.handle || "");
export const avatar = (a, size = 44) =>
  a?.avatar ? `<img class="avatar" style="width:${size}px;height:${size}px" src="${esc(a.avatar)}" alt="" loading="lazy">`
            : `<div class="avatar ph" style="width:${size}px;height:${size}px">${esc((a?.displayName || a?.handle || "?")[0].toUpperCase())}</div>`;
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
    else if (ft.$type === "app.bsky.richtext.facet#tag") out += `<a href="#/search?q=${enc("#" + ft.tag)}">${seg}</a>`;
    else out += seg;
    pos = e;
  }
  return out + esc(td.decode(bytes.slice(pos)));
}

/* ---------- moderation labels ---------- */
const ADULT = new Set(["porn", "sexual", "nudity", "graphic-media", "gore"]);
const LABEL_UA = { porn: "Контент для дорослих", sexual: "Відвертий контент", nudity: "Оголеність", "graphic-media": "Жорсткий контент", gore: "Жорсткий контент" };
export function warnLabel(p) {
  const l = [...(p.labels || []), ...(p.author?.labels || [])].find(l => ADULT.has(l.val) && !l.neg);
  return l ? LABEL_UA[l.val] : null;
}
const blurWrap = (html, label) => label
  ? `<div class="blurbox"><div class="blurred">${html}</div><button class="ghost unblur" data-act="unblur">⚠️ ${esc(label)} · Показати</button></div>` : html;

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
    return `<a class="quote card-row" href="#/feed/${enc(r.uri)}">${avatar({ avatar: r.avatar, displayName: r.displayName }, 36)}<div><b>${esc(r.displayName)}</b><small>Фід від @${esc(r.creator.handle)}</small></div></a>`;
  if (t === "app.bsky.graph.defs#listView")
    return `<a class="quote card-row" href="#/list/${enc(r.uri)}">${avatar({ avatar: r.avatar, displayName: r.name }, 36)}<div><b>${esc(r.name)}</b><small>Список від @${esc(r.creator.handle)}</small></div></a>`;
  if (t === "app.bsky.embed.record#viewRecord") {
    const fake = { uri: r.uri, cid: r.cid, author: r.author, record: r.value, labels: r.labels };
    const label = warnLabel(fake);
    const media = (r.embeds || []).map(e => e.$type === "app.bsky.embed.record#view" || e.$type === "app.bsky.embed.recordWithMedia#view"
      ? renderEmbed(e.media ? { ...e.media } : null, label) : renderEmbed(e, label)).join("");
    return `<div class="quote" data-href="${postHref(fake)}">
      <div class="meta">${avatar(r.author, 18)} <b>${name(r.author)}</b> <span>@${esc(r.author.handle)} · ${ago(r.indexedAt)}</span></div>
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

export function renderPost(p, { reason, parent, thread = false, focus = false, line = false } = {}) {
  cachePost(p);
  const a = p.author, rec = p.record || {};
  const label = warnLabel(p);
  const muted = focus ? null : mutedBy(p); // an opened post is always shown
  const top = [];
  if (reason?.$type === "app.bsky.feed.defs#reasonRepost")
    top.push(`<div class="reason">${I.repost} <a href="${profileHref(reason.by)}">${name(reason.by)}</a> поширив(-ла)</div>`);
  if (reason?.$type === "app.bsky.feed.defs#reasonPin") top.push(`<div class="reason">📌 Закріплено</div>`);
  if (parent?.author && !thread) top.push(`<div class="reason">↩︎ У відповідь <a href="${profileHref(parent.author)}">${name(parent.author)}</a></div>`);
  const langs = rec.langs?.length && !rec.langs.includes("uk") ? `<button class="linklike small" data-act="translate">Перекласти</button>` : "";
  if (focus) return `
  <article class="post focus" data-uri="${esc(p.uri)}">
    <div class="row">${avatar(a, 48)}
      <div class="who"><a href="${profileHref(a)}"><b>${name(a)}</b></a><span class="muted">@${esc(a.handle)}</span></div>
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
  <article class="post${line ? " has-line" : ""}${muted ? " mw-hidden" : ""}" data-uri="${esc(p.uri)}" data-href="${postHref(p)}">
    ${muted ? `<button class="mw-note linklike small" data-act="showMuted">🙈 @${esc(a.handle)} · приховано через слово «${esc(muted.value)}» · Показати</button>` : ""}
    <div class="left"><a href="${profileHref(a)}">${avatar(a)}</a>${line ? `<div class="tline"></div>` : ""}</div>
    <div class="body">
      ${top.join("")}
      <div class="meta"><a href="${profileHref(a)}"><b>${name(a)}</b></a> <span>@${esc(a.handle)}</span> · <a href="${postHref(p)}" title="${esc(fullDate(p.indexedAt))}">${ago(p.indexedAt)}</a></div>
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
    <div class="who"><b>${name(a)}</b><span class="muted">@${esc(a.handle)}${a.viewer?.followedBy ? ' <span class="pill">Стежить за вами</span>' : ""}</span>
      ${a.description ? `<div class="desc">${esc(a.description.slice(0, 160))}</div>` : ""}${extra}</div>
    ${followBtn(a)}
  </div>`;
}

export function renderFeedCard(f) {
  return `<div class="actor" data-href="#/feed/${enc(f.uri)}">
    ${avatar({ avatar: f.avatar, displayName: f.displayName }, 44)}
    <div class="who"><b>${esc(f.displayName)}</b><span class="muted">Фід від @${esc(f.creator.handle)} · ♥ ${num(f.likeCount)}</span>
      ${f.description ? `<div class="desc">${esc(f.description.slice(0, 200))}</div>` : ""}</div>
    <button class="ghost sm" data-act="saveFeed" data-uri="${esc(f.uri)}">${f.viewer?.saved ? "✓" : "+"}</button>
  </div>`;
}

/* ---------- toast / modal / menu ---------- */
export function toast(msg, ms = 2500) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
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

export function lightbox(urls, i = 0, alts = []) {
  const m = modal(`<div class="lb"><img src="${esc(urls[i])}" alt=""><p class="alt"></p>
    ${urls.length > 1 ? `<button class="lb-prev">‹</button><button class="lb-next">›</button>` : ""}</div>`, { wide: true });
  m.classList.add("dark");
  const img = m.querySelector("img"), alt = m.querySelector(".alt");
  const show = () => { img.src = urls[i]; alt.textContent = alts[i] || ""; };
  show();
  m.querySelector(".lb-prev")?.addEventListener("click", () => { i = (i - 1 + urls.length) % urls.length; show(); });
  m.querySelector(".lb-next")?.addEventListener("click", () => { i = (i + 1) % urls.length; show(); });
  img.addEventListener("click", () => m.close());
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
  if (video.canPlayType("application/vnd.apple.mpegurl")) { video.src = src; return; }
  await loadHls();
  const hls = new window.Hls();
  hls.loadSource(src); hls.attachMedia(video);
}

/* ---------- infinite scroll ---------- */
export function infinite(container, loader) {
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
    if (done && !sentinel.querySelector(".err")) sentinel.innerHTML = `<p class="muted center small">Це все 🐝</p>`;
    else if (!done) { io.unobserve(sentinel); io.observe(sentinel); }
  }, { rootMargin: "800px" });
  io.observe(sentinel);
  return () => io.disconnect();
}

export const empty = (msg) => `<p class="muted center pad">${esc(msg)}</p>`;
export const spinner = () => `<div class="sentinel"><div class="spinner"></div></div>`;
