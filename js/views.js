// Skybee — screens
import * as api from "./api.js";
import { session } from "./api.js";
import {
  isLive, postHref, $, esc, enc, num, ago, name, avatar, richText, linkify, renderPost, renderActor, renderFeedCard, followBtn,
  infinite, empty, spinner, toast, modal, menu, profileHref, cachePost, actors, mutedBy, gateLine, pwa, vname, warnLabel, hiddenReplies, renderEmbed, at,
} from "./ui.js";
import * as notify from "./notify.js";
import * as flair from "./flair.js";
import * as src from "./sources.js";

export const MENU_BTN = `<button class="ghost icon only-mobile" data-act="drawer" title="Меню">☰</button>`; // phones: opens the side menu
export const header = (title, back = false, right = "") =>
  `<div class="topbar">${back ? `<button class="ghost icon" data-act="back">←</button>` : MENU_BTN}<h2>${title}</h2><div class="grow"></div>${right}</div>`;

/* ---------- generic paginated list ---------- */
// opts.cls: class of the list box («tiles» for the media grid); opts.root: the scrolling box (deck columns)
export function paged(el, fetchPage, { cls = "", root = null } = {}) {
  const list = document.createElement("div");
  if (cls) list.className = cls;
  el.appendChild(list);
  let cursor, first = true;
  return infinite(list, async () => {
    if (!first && !cursor) return false;
    const { html, cursor: next } = await fetchPage(cursor);
    if (first && !html.length) list.innerHTML = empty("Тут поки нічого немає");
    first = false;
    list.insertAdjacentHTML("beforeend", html.join(""));
    cursor = next;
    return !!next && html.length > 0;
  }, root);
}

/* ---------- list / media grid switch ---------- */
// Remembered per screen («home», «feed», «myfeed»…)
export const isGrid = (key) => { try { return localStorage.getItem("skybee.grid." + key) === "1"; } catch { return false; } };
export const gridBtn = (key) => `<button class="ghost icon" data-grid="${esc(key)}" title="${isGrid(key) ? "Звичайна стрічка" : "Сітка медіа: лише фото й відео"}">${isGrid(key) ? "☰" : "▦"}</button>`;
// one listener on the screen: flips the mode and redraws through `redraw`
export function onGrid(el, redraw) {
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-grid]"); if (!b) return;
    const k = b.dataset.grid, on = !isGrid(k);
    try { on ? localStorage.setItem("skybee.grid." + k, "1") : localStorage.removeItem("skybee.grid." + k); } catch {}
    b.outerHTML = gridBtn(k);
    redraw(on);
  });
}

// hideMuted: in feeds, posts with muted words disappear; elsewhere renderPost collapses them
export const feedItems = (feed, hideMuted = false, from) => feed.map(it => {
  if (!it.post || (hideMuted && (mutedBy(it.post) || warnLabel(it.post)?.hide))) return "";
  return renderPost(it.post, { reason: it.reason, parent: it.reply?.parent, feed: from, ctx: it.feedContext });
});

/* ================= HOME ================= */
// «Підписки» without replies / reposts / quotes, as chosen in the settings
function homeFilter(d) {
  const v = api.pref("feedViewPref", "home");
  d.feed = d.feed.filter(it => !(v.hideReplies && it.reply && !it.reason) && !(v.hideReposts && it.reason?.$type === "app.bsky.feed.defs#reasonRepost")
    && !(v.hideQuotePosts && /app\.bsky\.embed\.record(WithMedia)?#view/.test(it.post?.embed?.$type || "")));
  return d;
}
// The home screen's feeds: pinned feeds and lists, then own feeds pinned in Skybee. Shared with the right column
let tabsCache = null, tabsAt = 0;
export function homeTabs() {
  if (tabsCache && Date.now() - tabsAt < 60000) return tabsCache;
  tabsAt = Date.now();
  return tabsCache = (async () => {
  const tabs = [{ label: "Підписки", kind: "timeline" }];
  try {
    const saved = (await api.getSavedFeeds()).filter(i => i.pinned && i.type !== "timeline");
    const feedUris = saved.filter(i => i.type === "feed").map(i => i.value);
    const gens = feedUris.length ? (await api.get("app.bsky.feed.getFeedGenerators", { feeds: feedUris })).feeds : [];
    for (const i of saved) {
      if (i.type === "feed") { const g = gens.find(g => g.uri === i.value); if (g) tabs.push({ label: g.displayName, kind: "feed", uri: g.uri }); }
      if (i.type === "list") {
        try { const l = (await api.get("app.bsky.graph.getList", { list: i.value, limit: 1 })).list; tabs.push({ label: l.name, kind: "list", uri: l.uri }); } catch {}
      }
    }
  } catch {}
  if (tabs.length === 1) { // nothing pinned yet: the default feeds, in their set order
    try {
      const gens = (await api.get("app.bsky.feed.getFeedGenerators", { feeds: api.DEFAULT_FEEDS })).feeds;
      for (const uri of api.DEFAULT_FEEDS) { const g = gens.find(g => g.uri === uri); if (g) tabs.push({ label: g.displayName, kind: "feed", uri }); }
    } catch {}
    if (tabs.length === 1) tabs.push({ label: "Discover", kind: "feed", uri: api.DISCOVER });
  }
  // own feeds built in Skybee, pinned to the home screen
  try { for (const f of await src.myFeeds()) if (f.pinned) tabs.push({ label: f.name, kind: "my", uri: f.id }); } catch {}
  return tabs;
  })();
}
export const forgetHomeTabs = () => { tabsCache = null; };

export async function home(el) {
  el.innerHTML = `<div class="topbar">${MENU_BTN}<h2>🐝 Skybee</h2><div class="grow"></div>${gridBtn("home")}<button class="ghost icon" data-act="refresh" title="Оновити">↻</button></div><div class="tabs" id="feedTabs"></div><div id="feedBody"></div>`;
  const tabs = await homeTabs();
  let sel = 0; try { sel = Math.min(+sessionStorage.getItem("skybee.tab") || 0, tabs.length - 1); } catch {}
  const tabEl = $("#feedTabs", el), body = $("#feedBody", el);
  let stop;
  const show = (i) => {
    sel = i; try { sessionStorage.setItem("skybee.tab", i); } catch {}
    window.dispatchEvent(new CustomEvent("skybee:hometab", { detail: i }));
    tabEl.innerHTML = tabs.map((t, n) => `<button class="${n === i ? "on" : ""}" data-tab="${n}">${esc(t.label)}</button>`).join("");
    stop?.(); body.innerHTML = ""; body.parentElement.querySelectorAll(".sentinel").forEach(s => s.remove());
    const t = tabs[i], grid = isGrid("home");
    pill.hidden = true; latest = null;
    if (t.kind === "my") { stop = paged(body, src.feedPager({ type: "myfeed", value: t.uri }, { grid }), { cls: grid ? "tiles" : "" }); return; }
    latest = (cursor, limit = 30) => t.kind === "timeline" ? api.get("app.bsky.feed.getTimeline", { limit, cursor }).then(homeFilter)
      : t.kind === "list" ? api.get("app.bsky.feed.getListFeed", { list: t.uri, limit, cursor })
      : api.get("app.bsky.feed.getFeed", { feed: t.uri, limit, cursor }, api.feedHeaders());
    stop = paged(body, async (cursor) => {
      const d = await latest(cursor);
      return { html: grid ? src.tiles(d.feed) : feedItems(d.feed, true, t.kind === "feed" ? t.uri : undefined), cursor: d.cursor };
    }, { cls: grid ? "tiles" : "" });
  };
  // «↑ Нові пости»: once a minute the top of the feed is checked; the list itself is not touched until the pill is pressed
  let latest = null;
  const pill = document.createElement("button");
  pill.className = "newpill"; pill.hidden = true; pill.textContent = "↑ Нові пости";
  tabEl.after(pill);
  pill.onclick = () => { scrollTo({ top: 0 }); show(sel); };
  const watch = setInterval(async () => {
    if (document.hidden || !latest || !pill.hidden) return;
    try {
      const top = (await latest(undefined, 5)).feed.find(it => it.post)?.post.uri;
      const shown = body.querySelector("[data-uri]")?.dataset.uri;
      if (top && shown && top !== shown && !body.querySelector(`[data-uri="${CSS.escape(top)}"]`)) pill.hidden = false;
    } catch {}
  }, 60000);
  onGrid(el, () => show(sel));
  tabEl.addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (b) show(+b.dataset.tab); });
  el.querySelector("[data-act=refresh]").onclick = () => { scrollTo(0, 0); show(sel); };
  // a feed picked in the right column
  const pick = (e) => { scrollTo(0, 0); show(Math.min(e.detail, tabs.length - 1)); };
  window.addEventListener("skybee:pickfeed", pick);
  show(sel);
  return () => { stop?.(); clearInterval(watch); window.removeEventListener("skybee:pickfeed", pick); };
}

/* ================= SINGLE FEED / LIST ================= */
export async function feed(el, { uri }) {
  el.innerHTML = header("Фід", true) + spinner();
  const g = (await api.get("app.bsky.feed.getFeedGenerator", { feed: uri })).view;
  el.innerHTML = header(esc(g.displayName), true, gridBtn("feed")) + `
    <div class="card-row pad">${avatar({ avatar: g.avatar, displayName: g.displayName }, 56)}
      <div class="grow"><b>${esc(g.displayName)}</b><div class="muted small">Фід від <a href="${profileHref(g.creator)}">${at(g.creator.handle)}</a> · ♥ ${num(g.likeCount)}</div>
      ${g.description ? `<div class="small">${richText(g.description, g.descriptionFacets)}</div>` : ""}</div>
      <div class="col"><button class="btn sm" data-act="saveFeed" data-uri="${esc(uri)}">${g.viewer?.saved ? "Збережено ✓" : "Зберегти"}</button>
      <button class="ghost sm" data-act="likeFeed" data-uri="${esc(uri)}" data-cid="${esc(g.cid)}" data-like="${esc(g.viewer?.like || "")}">${g.viewer?.like ? "♥" : "♡"}</button></div>
    </div><div id="fbody"></div>`;
  const body = $("#fbody", el);
  let stop;
  const show = () => {
    stop?.(); body.innerHTML = ""; el.querySelectorAll(".sentinel").forEach(x => x.remove());
    const grid = isGrid("feed");
    stop = paged(body, async (cursor) => {
      const d = await api.get("app.bsky.feed.getFeed", { feed: uri, limit: 30, cursor }, api.feedHeaders());
      return { html: grid ? src.tiles(d.feed) : feedItems(d.feed, true, uri), cursor: d.cursor };
    }, { cls: grid ? "tiles" : "" });
  };
  onGrid(el, show); show();
  return () => stop?.();
}

export async function list(el, { uri }) {
  el.innerHTML = header("Список", true) + spinner();
  const d = await api.get("app.bsky.graph.getList", { list: uri, limit: 1 });
  const l = d.list;
  const curate = l.purpose === "app.bsky.graph.defs#curatelist", mine = l.creator.did === session.did;
  el.innerHTML = header(esc(l.name), true, (curate ? gridBtn("list") : "") + `<button class="ghost icon" data-act="listMenu" data-uri="${esc(uri)}">⋯</button>`) + `
    <div class="card-row pad">${avatar({ avatar: l.avatar, displayName: l.name }, 56)}
      <div class="grow"><b>${esc(l.name)}</b><div class="muted small">${curate ? "Список" : "Модераційний список"} від <a href="${profileHref(l.creator)}">${at(l.creator.handle)}</a></div>
      ${l.description ? `<div class="small">${richText(l.description, l.descriptionFacets)}</div>` : ""}</div>
      <div class="col">${curate ? `<button class="btn sm" data-act="saveFeed" data-uri="${esc(uri)}">Закріпити</button>` : ""}
      ${mine ? `<button class="ghost sm" data-act="listAddPeople" data-uri="${esc(uri)}">＋ Люди</button>` : ""}</div>
    </div>
    ${l.viewer?.muted ? `<p class="pad muted small">🙈 Ви приховали всіх учасників цього списку</p>` : ""}${l.viewer?.blocked ? `<p class="pad muted small">⛔ Ви заблокували всіх учасників цього списку</p>` : ""}
    <div class="tabs"><button class="on" data-lt="posts">Пости</button><button data-lt="people">Люди</button></div><div id="lb"></div>`;
  let stop;
  const lb = $("#lb", el);
  const show = (which) => {
    el.querySelectorAll("[data-lt]").forEach(b => b.classList.toggle("on", b.dataset.lt === which));
    stop?.(); lb.innerHTML = ""; el.querySelectorAll(".sentinel").forEach(s => s.remove());
    const grid = which === "posts" && isGrid("list");
    stop = paged(lb, which === "posts"
      ? async (cursor) => { const d = await api.get("app.bsky.feed.getListFeed", { list: uri, limit: 30, cursor }); return { html: grid ? src.tiles(d.feed) : feedItems(d.feed, true), cursor: d.cursor }; }
      : async (cursor) => { const d = await api.get("app.bsky.graph.getList", { list: uri, limit: 50, cursor }); return { html: d.items.map(i => renderActor(i.subject, mine ? `<div><button class="ghost sm" data-act="listRemove" data-item="${esc(i.uri)}">Прибрати зі списку</button></div>` : "")), cursor: d.cursor }; },
      { cls: grid ? "tiles" : "" });
  };
  onGrid(el, () => show("posts"));
  el.addEventListener("click", e => { const b = e.target.closest("[data-lt]"); if (b) show(b.dataset.lt); });
  show(curate ? "posts" : "people");
  return () => stop?.();
}

/* ================= THREAD ================= */
export async function thread(el, { actor, rkey, read = false }) {
  el.innerHTML = header("Пост", true) + spinner();
  let did = actor;
  if (!did.startsWith("did:")) did = (await api.get("com.atproto.identity.resolveHandle", { handle: actor })).did;
  flair.tint(el, did); // the post keeps its author's page colour
  const uri = `at://${did}/app.bsky.feed.post/${rkey}`;
  if (read) return reader(el, uri);
  const { thread: t } = await api.get("app.bsky.feed.getPostThread", { uri, depth: 10, parentHeight: 30 });
  if (t.$type !== "app.bsky.feed.defs#threadViewPost") {
    el.innerHTML = header("Пост", true) + empty(t.$type?.includes("Blocked") ? "Пост заблоковано" : "Пост не знайдено або видалено");
    return;
  }
  const parents = [];
  for (let p = t.parent; p; p = p.parent) {
    if (p.$type === "app.bsky.feed.defs#threadViewPost") parents.unshift(renderPost(p.post, { thread: true, line: true }));
    else { parents.unshift(`<div class="muted pad small">${p.$type?.includes("Blocked") ? "Заблокований пост" : "Пост видалено"}</div>`); break; }
  }
  const sort = api.pref("threadViewPref").sort; // the author's own replies always come first
  const order = (a, b) => sort === "oldest" ? a.indexedAt.localeCompare(b.indexedAt) : sort === "newest" ? b.indexedAt.localeCompare(a.indexedAt) : (b.likeCount || 0) - (a.likeCount || 0);
  // the gate belongs to the first post of the thread, which may be above the opened one
  let root = t;
  while (root.parent?.$type === "app.bsky.feed.defs#threadViewPost") root = root.parent;
  hiddenReplies.clear();
  for (const u of root.post.threadgate?.record?.hiddenReplies || []) hiddenReplies.add(u);
  const hidden = []; // replies hidden by the thread's author go under a fold at the bottom
  const replies = (node, depth = 0) => (node.replies || [])
    .filter(r => r.$type === "app.bsky.feed.defs#threadViewPost" && !(hiddenReplies.has(r.post.uri) && hidden.push(r.post)))
    .sort((a, b) => (b.post.author.did === t.post.author.did) - (a.post.author.did === t.post.author.did) || order(a.post, b.post))
    .map(r => `<div class="reply d${Math.min(depth, 4)}">${renderPost(r.post, { thread: true, line: !!r.replies?.length && depth < 5 })}${depth < 5 ? replies(r, depth + 1) : ""}</div>`).join("");
  const noReply = !!t.post.viewer?.replyDisabled;
  const gate = gateLine(root.post, { noReply, mine: !!session && root.post.author.did === session.did && !root.post.record?.reply });
  // «read as one text»: when the author continued the thread with their own replies
  const by = t.post.author.did, chain = t.parent?.post?.author?.did === by || (t.replies || []).some(r => r.post?.author?.did === by);
  const readBtn = chain ? `<a class="ghost sm" href="${location.hash.split("?")[0]}?read" title="Лише пости автора гілки, одним текстом">📖 Читати</a>` : "";
  el.innerHTML = header("Пост", true, readBtn) + parents.join("") + renderPost(t.post, { focus: true }) + gate +
    (noReply ? "" : !session ? `<a class="replybox" href="#/login"><span class="muted">Увійди, щоб відповісти…</span></a>`
      : `<div class="replybox" data-act="reply" data-uri="${esc(t.post.uri)}">${avatar(actors.get(session.did) || {}, 32)}<span class="muted">Напиши відповідь…</span></div>`) +
    (replies(t) || empty("Відповідей ще немає")) +
    (hidden.length ? `<details class="hidden-replies"><summary class="muted pad">Приховані відповіді: ${hidden.length}</summary>${hidden.map(p => renderPost(p, { thread: true })).join("")}</details>` : "");
  el.querySelector(".post.focus")?.scrollIntoView({ block: "start" });
  scrollBy(0, -60 - (document.querySelector(".guestbar")?.offsetHeight || 0));
}

/* ---------- reading mode: a long thread by one author as one continuous text ---------- */
async function reader(el, uri) {
  let { thread: t } = await api.get("app.bsky.feed.getPostThread", { uri, depth: 0, parentHeight: 1000 });
  while (t.parent?.$type === "app.bsky.feed.defs#threadViewPost" && t.parent.post.author.did === t.post.author.did) t = t.parent;
  const top = t.post, me = top.author.did;
  ({ thread: t } = await api.get("app.bsky.feed.getPostThread", { uri: top.uri, depth: 1000, parentHeight: 0 }));
  const chain = [];
  for (let n = t; n; ) {
    chain.push(cachePost(n.post));
    n = (n.replies || []).filter(r => r.$type === "app.bsky.feed.defs#threadViewPost" && r.post.author.did === me)
      .sort((a, b) => a.post.indexedAt.localeCompare(b.post.indexedAt))[0];
  }
  const a = top.author, open = location.hash.split("?")[0];
  el.innerHTML = header("Читання", true, `<a class="ghost sm" href="${open}" title="Звичайний вигляд з відповідями">💬 Гілка</a>`) + `
    <article class="reader">
      <div class="row"><a href="${profileHref(a)}">${avatar(a, 44)}</a><div class="who"><a href="${profileHref(a)}"><b>${vname(a)}</b></a><span class="muted small">${at(a.handle)} · ${new Date(top.record?.createdAt || top.indexedAt).toLocaleDateString("uk-UA", { dateStyle: "long" })} · ${chain.length} ${chain.length === 1 ? "пост" : chain.length < 5 ? "пости" : "постів"}</span></div></div>
      ${chain.map((p, i) => `<section data-uri="${esc(p.uri)}"><div class="text">${richText(p.record?.text, p.record?.facets)}</div>${renderEmbed(p.embed, warnLabel(p))}
        <a class="muted small rnum" href="${postHref(p)}">${i + 1}/${chain.length}</a></section>`).join("")}
    </article>`;
}

/* ================= POST: likes / reposts / quotes ================= */
export async function postUsers(el, { actor, rkey, kind }) {
  let did = actor.startsWith("did:") ? actor : (await api.get("com.atproto.identity.resolveHandle", { handle: actor })).did;
  const uri = `at://${did}/app.bsky.feed.post/${rkey}`;
  const title = { likes: "Вподобали", reposts: "Поширили", quotes: "Цитати" }[kind];
  el.innerHTML = header(title, true);
  return paged(el, async (cursor) => {
    if (kind === "likes") { const d = await api.get("app.bsky.feed.getLikes", { uri, limit: 50, cursor }); return { html: d.likes.map(l => renderActor(l.actor)), cursor: d.cursor }; }
    if (kind === "reposts") { const d = await api.get("app.bsky.feed.getRepostedBy", { uri, limit: 50, cursor }); return { html: d.repostedBy.map(a => renderActor(a)), cursor: d.cursor }; }
    const d = await api.get("app.bsky.feed.getQuotes", { uri, limit: 30, cursor }); return { html: d.posts.map(p => renderPost(p)), cursor: d.cursor };
  });
}

/* ================= PROFILE ================= */
export async function profile(el, { actor, tab = "posts" }) {
  el.innerHTML = header("Профіль", true) + spinner();
  const p = await api.get("app.bsky.actor.getProfile", { actor });
  actors.set(p.did, p);
  const me = !!session && p.did === session.did;
  const v = p.viewer || {};
  const blocked = v.blocking || v.blockedBy;
  const tabs = [["posts", "Пости"], ["replies", "Відповіді"], ["media", "Медіа"], ["videos", "Відео"]];
  if (me) tabs.push(["likes", "Вподобання"]);
  if (p.associated?.feedgens) tabs.push(["feeds", "Фіди"]);
  if (p.associated?.lists) tabs.push(["lists", "Списки"]);
  if (p.associated?.starterPacks || me) tabs.push(["packs", "Стартові набори"]);
  const site = p.website && /^https?:\/\//.test(p.website) ? p.website : "";
  el.innerHTML = header(name(p), true, `<button class="ghost icon" data-act="profileMenu" data-did="${p.did}">⋯</button>`) + `
    <div class="banner" ${p.banner ? `style="background-image:url('${esc(p.banner)}')"` : ""}></div>
    <div class="phead">
      <div class="row between">
        <div class="bigava" ${p.avatar ? `data-act="lightboxOne" data-full="${esc(p.avatar)}"` : ""}>${avatar(p, 88)}</div>
        <div class="row">
          ${me ? `<button class="ghost sm" data-act="editFlair" title="Статус, музика, колір та іграшка — для користувачів Skybee">✨ Оформлення</button><button class="ghost sm" data-act="editProfile">Редагувати профіль</button>`
               : `${!blocked && p.associated?.chat?.allowIncoming !== "none" ? `<button class="ghost sm icon" data-act="dm" data-did="${p.did}" title="Написати">✉️</button>` : ""}${followBtn(p)}`}
        </div>
      </div>
      <h1>${vname(p)}</h1>
      <div class="muted">${at(p.handle)}${p.pronouns ? ` · ${esc(p.pronouns)}` : ""} ${v.followedBy && v.following ? '<span class="pill">Взаємна підписка</span>' : v.followedBy ? '<span class="pill">Стежить за вами</span>' : ""} ${v.muted ? '<span class="pill">Приховано</span>' : ""}${v.mutedByList ? ` <a class="pill" href="#/list/${enc(v.mutedByList.uri)}">Приховано списком «${esc(v.mutedByList.name)}»</a>` : ""}${v.blockingByList ? ` <a class="pill" href="#/list/${enc(v.blockingByList.uri)}">Заблоковано списком «${esc(v.blockingByList.name)}»</a>` : ""}</div>
      ${labelPills(p) ? `<div>${labelPills(p)}</div>` : ""}
      ${blocked ? "" : `<div class="counts">
        <a href="${profileHref(p)}/followers"><b>${num(p.followersCount)}</b> читачів</a>
        <a href="${profileHref(p)}/follows"><b>${num(p.followsCount)}</b> підписок</a>
        <span><b>${num(p.postsCount)}</b> постів</span></div>
      ${p.description ? `<div class="bio">${linkify(p.description)}</div>` : ""}
      ${liveCard(p)}
      ${site ? `<div class="small">🔗 <a href="${esc(site)}" target="_blank" rel="noopener">${esc(site.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a></div>` : ""}
      ${p.createdAt ? `<div class="muted small">📅 У Bluesky з ${new Date(p.createdAt).toLocaleDateString("uk-UA", { month: "long", year: "numeric" })}</div>` : ""}
      ${v.knownFollowers?.count ? `<a class="muted small" href="${profileHref(p)}/known" style="display:block">Серед читачів: ${v.knownFollowers.followers.slice(0, 2).map(f => name(f)).join(", ")}${v.knownFollowers.count > 2 ? ` і ще ${v.knownFollowers.count - 2}` : ""}</a>` : ""}`}
    </div>
    ${blocked ? empty(v.blocking ? "Ви заблокували цей акаунт" : "Цей акаунт заблокував вас") :
      `<div class="tabs scroll">${tabs.map(([k, l]) => `<a class="${k === tab ? "on" : ""}" href="${profileHref(p)}${k === "posts" ? "" : "/" + k}">${l}</a>`).join("")}</div><div id="pbody"></div>`}`;
  if (blocked) return;
  flair.decorate(el, p); // Skybee extras arrive on their own, the page does not wait for them
  if (p.associated?.labeler && session) labelerCard($(".phead", el), p).catch(() => {});
  const body = $("#pbody", el);
  const filters = { posts: "posts_and_author_threads", replies: "posts_with_replies", media: "posts_with_media", videos: "posts_with_video" };
  if (filters[tab]) return paged(body, async (cursor) => {
    const d = await api.get("app.bsky.feed.getAuthorFeed", { actor: p.did, filter: filters[tab], includePins: tab === "posts", limit: 30, cursor });
    return { html: feedItems(d.feed), cursor: d.cursor };
  });
  if (tab === "likes") return paged(body, async (cursor) => {
    const d = await api.get("app.bsky.feed.getActorLikes", { actor: p.did, limit: 30, cursor });
    return { html: feedItems(d.feed), cursor: d.cursor };
  });
  if (tab === "feeds") return paged(body, async (cursor) => {
    const d = await api.get("app.bsky.feed.getActorFeeds", { actor: p.did, limit: 30, cursor });
    return { html: d.feeds.map(renderFeedCard), cursor: d.cursor };
  });
  if (tab === "lists") return paged(body, async (cursor) => {
    const d = await api.get("app.bsky.graph.getLists", { actor: p.did, limit: 30, cursor });
    return { html: d.lists.map(renderListCard), cursor: d.cursor };
  });
  if (tab === "packs" && me) body.insertAdjacentHTML("beforebegin", `<div class="pad row"><a class="btn sm" href="#/starter-packs/new">🎒 Створити стартовий набір</a></div>`);
  if (tab === "packs") return paged(body, async (cursor) => {
    const d = await api.get("app.bsky.graph.getActorStarterPacks", { actor: p.did, limit: 30, cursor });
    return { html: d.starterPacks.map(s => `<a class="actor" href="#/starter-pack/${enc(p.did)}/${s.uri.split("/").pop()}"><span class="bigemoji">🎒</span><div class="who"><b>${esc(s.record?.name)}</b><span class="muted">${esc(s.record?.description || "")}</span></div></a>`), cursor: d.cursor };
  });
}

// A moderation service's profile: subscribe, and choose for each of its labels — show, warn or hide
async function labelerCard(head, p) {
  const [v] = await api.loadLabelers([p.did]);
  if (!v || !head.isConnected) return;
  const defs = v.policies?.labelValueDefinitions || [];
  const box = document.createElement("div");
  box.className = "card labeler";
  const draw = () => {
    const on = api.labelerDids.includes(p.did) || p.did === api.BSKY_MOD;
    box.innerHTML = `<div class="row between"><b>🛡️ Сервіс модерації</b>${p.did === api.BSKY_MOD ? `<span class="pill">Увімкнено завжди</span>`
        : `<button class="${on ? "ghost" : "btn"} sm" data-sub>${on ? "Відписатися" : "Підписатися"}</button>`}</div>
      <p class="hint">${on ? "Його мітки діють у Skybee. Обери, що робити з кожною:" : "Підпишись, щоб його мітки з'являлися на постах і профілях."}${v.likeCount ? ` · ♥ ${num(v.likeCount)}` : ""}</p>
      ${defs.map(d => `<div class="lrow"><div class="grow"><b>${esc(api.labelName(d))}</b>${d.adultOnly ? ' <span class="pill">18+</span>' : ""}<div class="muted small">${esc(api.labelDesc(d))}</div></div>
        ${on && p.did !== api.BSKY_MOD ? `<select data-lv="${esc(d.identifier)}">${[["ignore", "Показувати"], ["warn", "Попереджати"], ["hide", "Приховувати"]].map(([k, l]) =>
          `<option value="${k}" ${api.labelerPref(p.did, d.identifier) === k ? "selected" : ""}>${l}</option>`).join("")}</select>` : ""}</div>`).join("") || `<p class="muted small">Сервіс не описав своїх міток</p>`}`;
  };
  draw();
  head.appendChild(box);
  box.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-sub]"); if (!b) return;
    b.disabled = true;
    try { const on = !api.labelerDids.includes(p.did); await api.setLabelerSubscribed(p.did, on); toast(on ? "Підписано на сервіс модерації" : "Відписано"); draw(); }
    catch (ex) { toast(ex.message); b.disabled = false; }
  });
  box.addEventListener("change", async (e) => {
    const s = e.target.closest("[data-lv]"); if (!s) return;
    try { await api.setLabelerPref(p.did, s.dataset.lv, s.value); toast("Збережено"); } catch (ex) { toast(ex.message); }
  });
}

// labels from subscribed services that tell something about the account (not hidden or ignored), as pills under the name
function labelPills(p) {
  return (p.labels || []).filter(l => !l.neg && api.labelerDids.includes(l.src)).map(l => {
    const d = api.labelDef(l.src, l.val);
    return d && api.labelerPref(l.src, l.val) !== "ignore" ? `<span class="pill lpill" title="${esc(api.labelDesc(d))}">🏷️ ${esc(api.labelName(d))}</span>` : "";
  }).join(" ");
}

// the stream the person is live on, as a card under the bio
function liveCard(p) {
  if (!isLive(p)) return "";
  const x = p.status.embed?.external || {};
  let host = ""; try { host = new URL(x.uri).hostname.replace(/^www\./, ""); } catch {}
  return `<a class="livecard" href="${esc(x.uri || "#")}" target="_blank" rel="noopener">${x.thumb ? `<img src="${esc(x.thumb)}" alt="">` : ""}
    <span class="grow"><b class="livedot">● В ефірі</b> <span class="small muted">${esc(host)}</span><span class="clip">${esc(x.title || x.uri || "Трансляція")}</span></span></a>`;
}

export const renderListCard = (l) => `<div class="actor" data-href="#/list/${enc(l.uri)}">${avatar({ avatar: l.avatar, displayName: l.name }, 44)}
  <div class="who"><b>${esc(l.name)}</b><span class="muted">${l.purpose === api.MODLIST ? "Модераційний список" : "Список"}${l.listItemCount != null ? ` · учасників: ${l.listItemCount}` : ""}${l.viewer?.muted ? " · приховано" : ""}${l.viewer?.blocked ? " · заблоковано" : ""}</span>
  ${l.description ? `<div class="desc">${esc(l.description)}</div>` : ""}</div></div>`;

export async function follows(el, { actor, kind }) {
  el.innerHTML = header({ followers: "Читачі", follows: "Підписки", known: "Спільні читачі" }[kind], true);
  return paged(el, async (cursor) => {
    const d = await api.get({ followers: "app.bsky.graph.getFollowers", follows: "app.bsky.graph.getFollows", known: "app.bsky.graph.getKnownFollowers" }[kind], { actor, limit: 50, cursor });
    return { html: (d.followers || d.follows).map(a => renderActor(a)), cursor: d.cursor };
  });
}

export function editProfile(p, onDone) {
  const m = modal(`
    <h3>Редагувати профіль</h3>
    <label class="field">Банер<input type="file" accept="image/*" data-f="banner"></label>
    <label class="field">Аватар<input type="file" accept="image/*" data-f="avatar"></label>
    <label class="field">Ім'я<input data-f="name" maxlength="64" value="${esc(p.displayName || "")}"></label>
    <label class="field">Про себе<textarea data-f="desc" maxlength="256" rows="4">${esc(p.description || "")}</textarea></label>
    <label class="field">Займенники<input data-f="pronouns" maxlength="20" value="${esc(p.pronouns || "")}"></label>
    <label class="field">Сайт<input data-f="website" type="url" placeholder="https://" value="${esc(p.website || "")}"></label>
    <p class="err"></p>
    <div class="row end"><button class="ghost" data-x="0">Скасувати</button><button class="btn" data-x="1">Зберегти</button></div>`);
  m.addEventListener("click", async (e) => {
    const x = e.target.closest("[data-x]"); if (!x) return;
    if (x.dataset.x === "0") return m.close();
    x.disabled = true; x.textContent = "Збереження…";
    try {
      const rec = await api.getOwnProfileRecord();
      rec.$type = "app.bsky.actor.profile";
      rec.displayName = m.querySelector("[data-f=name]").value.trim();
      rec.description = m.querySelector("[data-f=desc]").value.trim();
      for (const k of ["pronouns", "website"]) { const val = m.querySelector(`[data-f=${k}]`).value.trim(); if (val) rec[k] = val; else delete rec[k]; }
      for (const k of ["avatar", "banner"]) {
        const f = m.querySelector(`[data-f=${k}]`).files[0];
        if (f) rec[k] = await api.uploadBlob((await api.prepareImage(f, k === "banner" ? 3000 : 1000)).blob);
      }
      await api.putOwnProfileRecord(rec);
      m.close(); toast("Профіль оновлено"); onDone?.();
    } catch (ex) { m.querySelector(".err").textContent = ex.message; x.disabled = false; x.textContent = "Зберегти"; }
  });
}

/* ================= NOTIFICATIONS ================= */
const NREASON = notify.NREASON;
const NICON = { like: "♥", "like-via-repost": "♥", repost: "🔁", "repost-via-repost": "🔁", follow: "👤", "starterpack-joined": "🎒", verified: "✅", unverified: "✖️", "subscribed-post": "🔔" };

// Filters above the list: reasons go to the server; «від тих, за ким стежу» is filtered here
export const NFILTERS = [
  ["", "Усе"], ["following", "Від тих, за ким стежу"], ["mentions", "Згадки"], ["replies", "Відповіді"], ["quotes", "Цитати"],
  ["follows", "Нові читачі"], ["likes", "Вподобання"], ["reposts", "Поширення"], ["posts", "Нові пости"],
];
const NREASONS = {
  mentions: ["mention", "reply", "quote"], replies: ["reply"], quotes: ["quote"], follows: ["follow"],
  likes: ["like", "like-via-repost"], reposts: ["repost", "repost-via-repost"], posts: ["subscribed-post"],
};

export async function notifications(el, { filter = "" }) {
  if (!NFILTERS.some(f => f[0] === filter)) filter = "";
  el.innerHTML = header("Сповіщення", false, `<button class="ghost sm" data-act="markRead">Позначити прочитаним</button>`) +
    `<div class="nchips">${NFILTERS.map(([k, l]) => `<a class="nchip${k === filter ? " on" : ""}" href="#/notifications${k ? "/" + k : ""}">${l}</a>`).join("")}</div>`;
  el.querySelector(".nchip.on")?.scrollIntoView({ inline: "center", block: "nearest" });
  const seenAt = new Date().toISOString();
  let marked = false;
  const page = notifPager({ filter });
  return paged(el, async (cursor) => {
    const r = await page(cursor);
    if (!marked) { marked = true; api.post("app.bsky.notification.updateSeen", { seenAt }).then(() => window.dispatchEvent(new Event("skybee:badge"))).catch(() => {}); }
    return r;
  });
}

const TEXTY = ["reply", "mention", "quote", "subscribed-post"];
const dayOf = (iso) => {
  const d = new Date(iso), t = new Date(); t.setHours(0, 0, 0, 0);
  const days = Math.round((t - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  return days <= 0 ? "Сьогодні" : days === 1 ? "Вчора" : d.toLocaleDateString("uk-UA", { day: "numeric", month: "long", ...(d.getFullYear() !== t.getFullYear() ? { year: "numeric" } : {}) });
};
const postLink = (p) => "#/profile/" + enc(p.author.did) + "/post/" + p.uri.split("/").pop();
const plural = (n, one, few, many) => n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;

// One page of notifications, grouped, with day headings; also used by deck columns (`as`: another signed-in account)
export const notifPager = ({ filter, as } = {}) => {
  let lastDay = "";
  return async (cursor) => {
    const o = as ? { as } : undefined;
    let d, list = [];
    // «від тих, за ким стежу» may empty a page: read on a few pages until there is something
    for (let round = 0; round < 5; round++) {
      d = await api.get("app.bsky.notification.listNotifications", { limit: 40, cursor, reasons: NREASONS[filter] }, o);
      list = filter === "following" ? d.notifications.filter(n => n.author?.viewer?.following) : d.notifications;
      cursor = d.cursor;
      if (list.length || !cursor || filter !== "following") break;
    }
    // fetch post views for subjects and post-type notifications
    const uris = new Set();
    for (const n of list) {
      if (TEXTY.includes(n.reason)) uris.add(n.uri);
      else if (n.reasonSubject?.includes("app.bsky.feed.post")) uris.add(n.reasonSubject);
    }
    const postsBy = new Map();
    const arr = [...uris];
    for (let i = 0; i < arr.length; i += 25) {
      const r = await api.get("app.bsky.feed.getPosts", { uris: arr.slice(i, i + 25) }, o);
      r.posts.forEach(p => postsBy.set(p.uri, cachePost(p)));
    }
    // 1) several people → one post (like/repost/follow by reason + subject)
    const groups = [];
    for (const n of list) {
      const key = TEXTY.includes(n.reason) ? n.uri : n.reason + "|" + (n.reasonSubject || "");
      const g = !TEXTY.includes(n.reason) && groups.find(g => g.key === key);
      if (g) g.items.push(n); else groups.push({ key, reason: n.reason, items: [n] });
    }
    // 2) one person → several posts: «вподобав(-ла) 5 ваших постів»
    const merged = [];
    for (const g of groups) {
      const solo = ["like", "repost"].includes(g.reason) && g.items.length === 1;
      const into = solo && merged.find(m => m.by === g.items[0].author.did && m.reason === g.reason);
      if (into) { into.items.push(g.items[0]); continue; }
      merged.push(solo ? { ...g, by: g.items[0].author.did } : g);
    }
    const html = [];
    for (const g of merged) {
      const n = g.items[0], unread = g.items.some(i => !i.isRead) ? " unread" : "";
      const day = dayOf(n.indexedAt);
      if (day !== lastDay) { lastDay = day; html.push(`<h4 class="nday">${esc(day)}</h4>`); }
      if (TEXTY.includes(g.reason)) {
        const p = postsBy.get(n.uri);
        if (!p) continue;
        const tag = { reply: "відповів(-ла)", mention: "згадав(-ла) вас", quote: "процитував(-ла) ваш пост", "subscribed-post": "новий пост" }[g.reason];
        html.push(`<div class="nwrap${unread}"><div class="ntag muted small">${tag}</div>${renderPost(p)}</div>`);
        continue;
      }
      if (g.by && g.items.length > 1) { // one person, several of your posts
        const subs = g.items.map(i => postsBy.get(i.reasonSubject)).filter(Boolean);
        const k = g.items.length;
        html.push(`<div class="notif${unread}" data-href="${profileHref(n.author)}">
          <div class="nicon r-${g.reason}">${NICON[g.reason]}</div>
          <div class="grow">
            <div class="avas"><a href="${profileHref(n.author)}">${avatar(n.author, 30)}</a></div>
            <div><a href="${profileHref(n.author)}"><b>${name(n.author)}</b></a> ${g.reason === "like" ? "вподобав(-ла)" : "поширив(-ла)"} ${k} ${plural(k, "ваш пост", "ваші пости", "ваших постів")} <span class="muted small">· ${ago(n.indexedAt)}</span></div>
            ${subs[0] ? `<div class="muted small clip">${esc(subs[0].record?.text || "")}</div>` : ""}
            ${subs.length > 1 ? `<details class="nall"><summary class="linklike small">Показати всі →</summary>${subs.map(p =>
              `<a class="nsub small clip" href="${postLink(p)}">${esc(p.record?.text || "Пост без тексту")}</a>`).join("")}</details>` : ""}
          </div></div>`);
        continue;
      }
      const who = g.items.map(i => i.author);
      const subj = postsBy.get(n.reasonSubject);
      const others = who.length > 1 ? ` і ще ${who.length - 1}` : "";
      html.push(`<div class="notif${unread}" data-href="${subj ? postLink(subj) : profileHref(n.author)}">
        <div class="nicon r-${g.reason}">${NICON[g.reason] || "🔔"}</div>
        <div class="grow">
          <div class="avas">${who.slice(0, 6).map(a => `<a href="${profileHref(a)}">${avatar(a, 30)}</a>`).join("")}</div>
          <div class="nline"><span class="grow"><a href="${profileHref(n.author)}"><b>${name(n.author)}</b></a>${others} ${NREASON[g.reason] || g.reason} <span class="muted small">· ${ago(n.indexedAt)}</span></span>
            ${g.reason === "follow" && g.items.length === 1 ? followBtn(n.author) : ""}</div>
          ${subj ? `<div class="muted small clip">${esc(subj.record?.text || "")}</div>` : ""}
        </div></div>`);
    }
    return { html, cursor };
  };
};

/* ================= HASHTAG ================= */
export async function hashtag(el, { tag, tab = "top" }) {
  tag = tag.replace(/^#/, "");
  const muted = () => api.mutedWords.find(w => (w.value || "").toLowerCase() === tag.toLowerCase());
  const btn = () => `<button class="ghost sm" data-mtag>${muted() ? "👁️ Показувати тег" : "🙈 Приховати тег"}</button>`;
  el.innerHTML = header("#" + esc(tag), true, `<span data-mbox>${btn()}</span>`) +
    `<div class="tabs">${[["top", "Топ"], ["latest", "Найновіші"]].map(([k, l]) => `<a class="${k === tab ? "on" : ""}" href="#/tag/${enc(tag)}${k === "top" ? "" : "/latest"}">${l}</a>`).join("")}</div>`;
  el.querySelector("[data-mbox]").addEventListener("click", async () => {
    try {
      const w = muted();
      if (w) { await api.removeMutedWord(w); toast(`#${tag} знову видно`); }
      else { await api.addMutedWord({ value: tag, targets: ["tag"], actorTarget: "all" }); toast(`Пости з #${tag} приховано`); }
      el.querySelector("[data-mbox]").innerHTML = btn();
    } catch (ex) { toast(ex.message); }
  });
  return paged(el, async (cursor) => {
    const d = await api.get("app.bsky.feed.searchPosts", { q: "#" + tag, sort: tab, limit: 30, cursor });
    return { html: d.posts.map(p => renderPost(p)), cursor: d.cursor };
  });
}

/* ================= EXPLORE (the search screen before anything is typed) ================= */
// The same interests as in Bluesky: they shape Discover and the suggestions
export const INTERESTS = [["animals", "🐾 Тварини"], ["art", "🎨 Мистецтво"], ["books", "📚 Книжки"], ["comedy", "😂 Гумор"], ["comics", "💥 Комікси"],
  ["culture", "🎭 Культура"], ["dev", "💻 Розробка"], ["education", "🎓 Освіта"], ["food", "🍜 Їжа"], ["gaming", "🎮 Ігри"], ["journalism", "📰 Журналістика"],
  ["movies", "🎬 Кіно"], ["music", "🎵 Музика"], ["nature", "🌿 Природа"], ["news", "🗞️ Новини"], ["pets", "🐶 Домашні улюбленці"], ["photography", "📷 Фото"],
  ["politics", "🏛️ Політика"], ["science", "🔬 Наука"], ["sports", "⚽ Спорт"], ["tech", "🤖 Технології"], ["tv", "📺 Серіали"], ["writers", "✍️ Письменники"]];
async function explore(box) {
  await api.getPrefs().catch(() => {});
  let mine = new Set(api.pref("interestsPref").tags || []);
  const chips = () => INTERESTS.map(([k, l]) => `<button class="chip${mine.has(k) ? " on" : ""}" data-int="${k}">${l}</button>`).join("");
  box.innerHTML = `<div class="pad"><h3>Мої інтереси</h3><p class="hint">Від них залежать Discover і підказки, кого почитати.</p><div class="chips" data-ints>${chips()}</div></div>
    <div data-sfeeds></div><div data-packs></div>`;
  box.querySelector("[data-ints]").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-int]"); if (!b) return;
    const k = b.dataset.int, was = new Set(mine);
    mine.has(k) ? mine.delete(k) : mine.add(k);
    b.classList.toggle("on", mine.has(k));
    try { await api.updatePref("interestsPref", { tags: [...mine] }); } catch (ex) { mine = was; b.classList.toggle("on", mine.has(k)); toast(ex.message); }
  });
  api.get("app.bsky.feed.getSuggestedFeeds", { limit: 6 }).then(d => {
    if (d.feeds?.length) box.querySelector("[data-sfeeds]").innerHTML = `<h3 class="pad">Фіди, які варто спробувати</h3>${d.feeds.map(renderFeedCard).join("")}`;
  }).catch(() => {});
  api.get("app.bsky.unspecced.getSuggestedStarterPacks", { limit: 6 }).then(d => {
    const packs = d.starterPacks || [];
    if (packs.length) box.querySelector("[data-packs]").innerHTML = `<h3 class="pad">Стартові набори</h3>${packs.map(sp =>
      `<a class="actor" href="#/starter-pack/${enc(sp.creator.did)}/${sp.uri.split("/").pop()}"><span class="bigemoji">🎒</span><div class="who"><b>${esc(sp.record?.name || "Стартовий набір")}</b>
        <span class="muted small">від ${at(sp.creator.handle)}${sp.listItemCount ? ` · людей: ${sp.listItemCount}` : ""}</span></div></a>`).join("")}`;
  }).catch(() => {});
}

/* ================= SEARCH ================= */
// Search operators as form fields: they are written into the query as from:, mentions:, lang:, since:, until:, domain:
const SOPS = [["from", "Від кого", "@нік або me"], ["mentions", "Згадує", "@нік"], ["lang", "Мова", "uk"], ["since", "Від дати", ""], ["until", "До дати", ""], ["domain", "Посилання на сайт", "youtube.com"]];
function splitQuery(q) {
  const ops = {};
  const text = q.replace(/(?:^|\s)(from|mentions|lang|since|until|domain):(\S+)/g, (_, k, v) => { ops[k] = v; return " "; }).replace(/\s+/g, " ").trim();
  return { text, ops };
}
export async function search(el, { q = "", tab = "top" }) {
  const { text, ops } = splitQuery(q);
  const nOps = Object.keys(ops).length;
  el.innerHTML = header("Пошук") + `
    <form class="searchbar"><input type="search" placeholder="Пошук постів, людей, фідів" value="${esc(text)}" autofocus>
      <details class="sfilters"${nOps ? " open" : ""}><summary class="small">⚙️ Фільтри${nOps ? ` (${nOps})` : ""}</summary>
        <div class="sfgrid">${SOPS.map(([k, l, ph]) => `<label class="field">${l}<input data-op="${k}" ${k === "since" || k === "until" ? `type="date" value="${esc((ops[k] || "").slice(0, 10))}"` : `value="${esc(ops[k] || "")}" placeholder="${ph}"`} autocapitalize="none"></label>`).join("")}</div>
        <div class="row end"><button type="button" class="ghost sm" data-clearops>Скинути</button><button class="btn sm">Шукати</button></div>
      </details></form>
    ${q ? `<div class="tabs">${[["top", "Топ"], ["latest", "Найновіші"], ["people", "Люди"], ["feeds", "Фіди"]].map(([k, l]) =>
      `<a class="${k === tab ? "on" : ""}" href="#/search?q=${enc(q)}&tab=${k}">${l}</a>`).join("")}</div>` : ""}
    <div id="sbody"></div>`;
  $("form", el).onsubmit = (e) => {
    e.preventDefault();
    const parts = [$("input", el).value.trim()];
    el.querySelectorAll("[data-op]").forEach(i => { const v = i.value.trim().replace(/^@/, ""); if (v) parts.push(`${i.dataset.op}:${v}`); });
    const v = parts.filter(Boolean).join(" ");
    if (v) location.hash = `#/search?q=${enc(v)}&tab=${tab === "people" || tab === "feeds" ? "top" : tab}`;
  };
  el.querySelector("[data-clearops]").onclick = () => el.querySelectorAll("[data-op]").forEach(i => { i.value = ""; });
  const body = $("#sbody", el);
  // people matching what is being typed
  const inp = $("input", el), sug = document.createElement("div");
  sug.className = "results"; $("form", el).after(sug);
  let tm;
  inp.addEventListener("input", () => {
    clearTimeout(tm);
    const v = inp.value.trim();
    if (!v || v === text) { sug.innerHTML = ""; return; }
    tm = setTimeout(async () => {
      try {
        const d = await api.get("app.bsky.actor.searchActorsTypeahead", { q: v, limit: 5 });
        if (inp.value.trim() === v) sug.innerHTML = d.actors.map(a => `<a class="actor" href="${profileHref(a)}">${avatar(a, 32)}<div class="who"><b>${vname(a)}</b><span class="muted small">${at(a.handle)}</span></div></a>`).join("");
      } catch {}
    }, 250);
  });
  if (!q) {
    body.innerHTML = `<div id="explore"></div><h3 class="pad">Кого почитати</h3>`;
    explore($("#explore", body)).catch(() => {});
    const tr = await api.get("app.bsky.unspecced.getTrendingTopics", {}).catch(() => null);
    if (tr?.topics?.length) body.insertAdjacentHTML("afterbegin", `<div class="pad"><h3>Тренди</h3><div class="chips">${tr.topics.slice(0, 12).map(t =>
      `<a class="chip" href="${t.link?.startsWith("/profile/") && t.link.includes("/feed/") ? "#/feed/" + enc("at://" + t.link.split("/")[2] + "/app.bsky.feed.generator/" + t.link.split("/").pop()) : "#/search?q=" + enc(t.topic)}">${esc(t.topic)}</a>`).join("")}</div></div>`);
    return paged(body, async (cursor) => {
      const d = await api.get("app.bsky.actor.getSuggestions", { limit: 25, cursor });
      return { html: d.actors.map(a => renderActor(a)), cursor: d.cursor };
    });
  }
  if (tab === "people") return paged(body, async (cursor) => {
    const d = await api.get("app.bsky.actor.searchActors", { q, limit: 25, cursor });
    return { html: d.actors.map(a => renderActor(a)), cursor: d.cursor };
  });
  if (tab === "feeds") return paged(body, async (cursor) => {
    const d = await api.get("app.bsky.unspecced.getPopularFeedGenerators", { query: q, limit: 30, cursor });
    return { html: d.feeds.map(renderFeedCard), cursor: d.cursor };
  });
  return paged(body, async (cursor) => {
    const d = await api.get("app.bsky.feed.searchPosts", { q, sort: tab === "latest" ? "latest" : "top", limit: 25, cursor });
    return { html: d.posts.map(p => renderPost(p)), cursor: d.cursor };
  });
}

/* ================= FEEDS ================= */
export async function feeds(el) {
  el.innerHTML = header("Фіди", false, `<a class="ghost sm" href="#/myfeeds">🧩 Мої стрічки</a>`) + `
    <div class="card"><b>🧩 Конструктор стрічок</b><p class="hint">Збери власну стрічку з підписок, фідів, списків, пошуку й профілів: ключові слова, виключення, без відповідей чи поширень, лише медіа, сортування.</p>
      <div class="row"><a class="btn sm" href="#/myfeeds/new">Створити стрічку</a><a class="ghost sm" href="#/myfeeds">Мої стрічки</a><a class="ghost sm" href="#/deck">📰 Колонки</a></div></div>
    <h3 class="pad">Мої фіди</h3><div id="mine">${spinner()}</div><h3 class="pad">Рекомендовані</h3><div id="rec"></div><h3 class="pad">Знайти нові фіди</h3>
    <form class="searchbar"><input type="search" placeholder="Пошук фідів"></form><div id="disc"></div>`;
  const mine = $("#mine", el);
  const renderMine = async () => {
    const items = (await api.getSavedFeeds()).filter(i => i.type !== "timeline");
    const fu = items.filter(i => i.type === "feed").map(i => i.value);
    const gens = fu.length ? (await api.get("app.bsky.feed.getFeedGenerators", { feeds: fu })).feeds : [];
    const rows = [];
    for (const i of items) {
      let title = i.value, ava = null, href = "";
      if (i.type === "feed") { const g = gens.find(g => g.uri === i.value); if (!g) continue; title = g.displayName; ava = g.avatar; href = `#/feed/${enc(g.uri)}`; }
      else { try { const l = (await api.get("app.bsky.graph.getList", { list: i.value, limit: 1 })).list; title = l.name; ava = l.avatar; href = `#/list/${enc(l.uri)}`; } catch { continue; } }
      rows.push(`<div class="actor" data-href="${href}">${avatar({ avatar: ava, displayName: title }, 36)}<div class="who"><b>${esc(title)}</b><span class="muted small">${i.type === "list" ? "Список" : "Фід"}</span></div>
        <button class="ghost sm" data-act="moveFeed" data-dir="-1" data-uri="${esc(i.value)}" title="Вище">↑</button>
        <button class="ghost sm" data-act="moveFeed" data-dir="1" data-uri="${esc(i.value)}" title="Нижче">↓</button>
        <button class="ghost sm" data-act="pinFeed" data-uri="${esc(i.value)}" title="${i.pinned ? "Відкріпити з головної" : "Закріпити на головній"}">${i.pinned ? "📌" : "📍"}</button>
        <button class="ghost sm" data-act="unsaveFeed" data-uri="${esc(i.value)}" title="Видалити">✕</button></div>`);
    }
    mine.innerHTML = rows.join("") || empty("Збережених фідів немає");
  };
  await renderMine();
  el.addEventListener("skybee:feedsChanged", renderMine);
  api.get("app.bsky.feed.getFeedGenerators", { feeds: api.DEFAULT_FEEDS }).then(d => {
    const rec = $("#rec", el);
    if (rec) rec.innerHTML = api.DEFAULT_FEEDS.map(u => d.feeds.find(g => g.uri === u)).filter(Boolean).map(renderFeedCard).join("");
  }).catch(() => {});
  const disc = $("#disc", el);
  let stop;
  const load = (query) => {
    stop?.(); disc.innerHTML = ""; el.querySelectorAll("#disc ~ .sentinel").forEach(s => s.remove());
    stop = paged(disc, async (cursor) => {
      const d = await api.get("app.bsky.unspecced.getPopularFeedGenerators", { query: query || undefined, limit: 30, cursor });
      return { html: d.feeds.map(renderFeedCard), cursor: d.cursor };
    });
  };
  $("form", el).onsubmit = (e) => { e.preventDefault(); load($("input", el).value.trim()); };
  load();
  return () => stop?.();
}

/* ================= BOOKMARKS ================= */
export async function bookmarks(el) {
  el.innerHTML = header("Закладки");
  return paged(el, async (cursor) => {
    const d = await api.get("app.bsky.bookmark.getBookmarks", { limit: 30, cursor });
    return { html: d.bookmarks.map(b => b.item?.$type === "app.bsky.feed.defs#postView" || b.item?.uri && b.item?.author ? renderPost(b.item) : `<div class="muted pad small">Пост недоступний</div>`), cursor: d.cursor };
  });
}

/* ================= MESSAGES ================= */
export async function messages(el, { requests = false } = {}) {
  el.innerHTML = header("Повідомлення", false, `<button class="ghost sm" data-act="newDm">✉️ Нове</button>`) +
    `<div class="tabs"><a href="#/messages" class="${requests ? "" : "on"}">Чати</a><a href="#/messages/requests" class="${requests ? "on" : ""}">Запити</a></div>`;
  try {
    return paged(el, async (cursor) => {
      const d = await api.chat("chat.bsky.convo.listConvos", { limit: 30, cursor, status: requests ? "request" : "accepted" });
      return {
        html: d.convos.map(c => {
          const other = c.members.find(m => m.did !== session.did) || c.members[0];
          const last = c.lastMessage;
          const txt = last?.$type === "chat.bsky.convo.defs#deletedMessageView" ? "Повідомлення видалено" : (last?.text || (last?.embed ? "📎 Пост" : ""));
          return `<div class="actor${c.unreadCount ? " unread" : ""}" data-href="#/messages/${c.id}">${avatar(other, 48)}
            <div class="who"><b>${name(other)}</b>${c.muted ? " 🔕" : ""}<span class="muted clip">${last?.sender?.did === session.did ? "Ви: " : ""}${esc(txt)}</span></div>
            <div class="col end"><span class="muted small">${last ? ago(last.sentAt) : ""}</span>${c.unreadCount ? `<span class="badge">${c.unreadCount}</span>` : ""}</div></div>`;
        }),
        cursor: d.cursor,
      };
    });
  } catch (e) { el.insertAdjacentHTML("beforeend", dmError(e)); }
}

const dmError = (e) => `<div class="card pad"><p class="err">${esc(e.message)}</p><p class="small muted">Щоб працювали чати, створи пароль застосунку з галочкою <b>«Allow access to your direct messages»</b> і увійди з ним знову.</p></div>`;

// chat helpers: quick reactions, more emoji, the quoted line of a reply
const QUICK = ["❤️", "👍", "😆", "👀", "😢"];
const MORE_EMOJI = ["😂", "🥹", "😍", "🥰", "😘", "😊", "😉", "😎", "🤔", "😮", "😱", "😡", "🤯", "🥲", "😭", "🙏", "👏", "🙌", "💪", "🤝", "👌", "✌️", "🔥", "✨", "🎉", "💯", "💔", "💛", "💙", "🐝", "🌻", "🇺🇦"];
const excerpt = (t = "") => { const q = quoteOf({ text: t }); t = (q ? q.rest : t).replace(/\s+/g, " ").trim(); return t.length > 80 ? t.slice(0, 79) + "…" : t; };
function quoteOf(m) {
  const t = m.text || "";
  if (!t.startsWith("> ")) return null;
  const i = t.indexOf("\n");
  return i < 0 ? null : { text: t.slice(2, i).trim(), rest: t.slice(i + 1) };
}

export async function convo(el, { id }) {
  el.innerHTML = header("Чат", true) + spinner();
  let c;
  try { c = (await api.chat("chat.bsky.convo.getConvo", { convoId: id })).convo; }
  catch (e) { el.innerHTML = header("Чат", true) + dmError(e); return; }
  const other = c.members.find(m => m.did !== session.did) || c.members[0];
  el.innerHTML = header(`<a href="${profileHref(other)}">${name(other)}</a>`, true, `<button class="ghost icon" data-act="convoMenu" data-id="${id}" data-muted="${c.muted ? 1 : 0}">⋯</button>`) +
    `<div class="chat"><div class="msgs"></div></div>
     <form class="chatbar"><textarea rows="1" maxlength="1000" placeholder="Повідомлення"></textarea><button class="btn">➤</button></form>`;
  const box = $(".msgs", el), form = $("form", el), ta = $("textarea", form);
  if (c.status === "request") { // a stranger wrote first: nothing is sent back until the chat is accepted
    form.insertAdjacentHTML("beforebegin", `<div class="card center" id="chatreq"><p>${name(other)} хоче написати вам. Прийняти запит?</p>
      <div class="row" style="justify-content:center"><button class="btn sm" data-accept>Прийняти</button><button class="ghost sm danger" data-act="convoLeave" data-id="${id}">Відхилити</button></div></div>`);
    $("[data-accept]", el).onclick = async () => {
      try { await api.chatPost("chat.bsky.convo.acceptConvo", { convoId: id }); $("#chatreq", el).remove(); toast("Запит прийнято"); } catch (ex) { toast(ex.message); }
    };
  }
  const seen = new Set(), byId = new Map();
  const bubble = (m) => {
    const mine = m.sender?.did === session.did;
    const del = m.$type === "chat.bsky.convo.defs#deletedMessageView";
    const counts = new Map();
    for (const r of m.reactions || []) counts.set(r.value, { n: (counts.get(r.value)?.n || 0) + 1, mine: counts.get(r.value)?.mine || r.sender?.did === session.did });
    return `<div class="msg${mine ? " mine" : ""}" data-mid="${m.id}" title="${esc(new Date(m.sentAt).toLocaleString("uk-UA"))}">
      <div class="mcol">${!del && quoteOf(m) ? `<div class="mquote" data-jump="${esc(quoteOf(m).text)}">↩︎ ${esc(quoteOf(m).text)}</div>` : ""}<div class="bubble${del ? " muted" : ""}">${del ? "Повідомлення видалено" : quoteOf(m) ? richText(quoteOf(m).rest) : richText(m.text, m.facets)}</div>
      ${m.embed && !del ? `<div class="membed">${renderEmbed(m.embed)}</div>` : ""}
      ${counts.size ? `<div class="reacts">${[...counts].map(([v, x]) => `<button class="react${x.mine ? " on" : ""}" data-react="${esc(v)}">${esc(v)}${x.n > 1 ? " " + x.n : ""}</button>`).join("")}</div>` : ""}</div></div>`;
  };
  const render = (msgs, prepend = false) => {
    const html = msgs.filter(m => !seen.has(m.id)).map(m => { seen.add(m.id); byId.set(m.id, m); return bubble(m); }).join("");
    box.insertAdjacentHTML(prepend ? "afterbegin" : "beforeend", html);
  };
  const redraw = (m) => { byId.set(m.id, m); const n = box.querySelector(`[data-mid="${CSS.escape(m.id)}"]`); if (n) n.outerHTML = bubble(m); };
  const react = async (m, value) => {
    const on = (m.reactions || []).some(r => r.value === value && r.sender?.did === session.did);
    const d = await api.chatPost(on ? "chat.bsky.convo.removeReaction" : "chat.bsky.convo.addReaction", { convoId: id, messageId: m.id, value });
    if (d?.message) redraw(d.message);
  };
  // a tap on a message opens its sheet: quick reactions (and more), when it was sent, reply, translate, copy, delete for me
  let replyTo = null;
  const replyBar = document.createElement("div");
  replyBar.className = "replybar"; replyBar.hidden = true;
  form.prepend(replyBar); // inside the fixed input bar, above the text field
  const setReply = (m) => {
    replyTo = m;
    replyBar.hidden = !m;
    if (m) replyBar.innerHTML = `<span class="grow clip">↩︎ Відповідь ${m.sender?.did === session.did ? "собі" : name(other)}: <span class="muted">${esc(excerpt(m.text))}</span></span><button type="button" class="ghost icon" data-noreply title="Скасувати">✕</button>`;
    if (m) ta.focus();
  };
  replyBar.addEventListener("click", (e) => { if (e.target.closest("[data-noreply]")) setReply(null); });
  const sheet = (m, row) => {
    const sent = new Date(m.sentAt), today = sent.toDateString() === new Date().toDateString();
    const when = today ? sent.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" }) : sent.toLocaleString("uk-UA", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    const wrap = document.createElement("div");
    wrap.className = "msheet-bg";
    wrap.innerHTML = `<div class="msheet${row.classList.contains("mine") ? " mine" : ""}">
      <div class="mreacts">${QUICK.map(v => `<button data-r="${v}">${v}</button>`).join("")}<button class="more" data-more title="Більше">＋</button></div>
      <div class="memoji" hidden>${MORE_EMOJI.map(v => `<button data-r="${v}">${v}</button>`).join("")}</div>
      <div class="bubble">${esc(m.text || "")}</div>
      <div class="mactions">
        <div class="muted small">Надіслано ${today ? "о " : ""}${esc(when)}</div>
        <button data-a="reply">↩︎ Відповісти</button>
        ${m.text ? `<button data-a="translate">🌐 Перекласти</button><button data-a="copy">📋 Копіювати текст повідомлення</button>` : ""}
        ${row.classList.contains("mine") ? "" : `<button data-a="report" class="danger">🚩 Поскаржитися</button>`}
        <button data-a="del" class="danger">🗑️ Видалити для мене</button>
      </div></div>`;
    const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    wrap.addEventListener("click", async (e) => {
      if (e.target === wrap) return close();
      if (e.target.closest("[data-more]")) { wrap.querySelector(".memoji").hidden = false; e.target.closest("[data-more]").remove(); return; }
      const r = e.target.closest("[data-r]"), a = e.target.closest("[data-a]")?.dataset.a;
      if (!r && !a) return;
      close();
      try {
        if (r) await react(m, r.dataset.r);
        if (a === "reply") setReply(m);
        if (a === "translate") window.open(`https://translate.google.com/?sl=auto&tl=uk&text=${encodeURIComponent(m.text || "")}`, "_blank");
        if (a === "copy") { await navigator.clipboard.writeText(quoteOf(m)?.rest ?? m.text ?? ""); toast("Скопійовано"); }
        if (a === "del") { await api.chatPost("chat.bsky.convo.deleteMessageForSelf", { convoId: id, messageId: m.id }); row.remove(); }
        // the moderators see exactly this message (and the chat it is in)
        if (a === "report") window.dispatchEvent(new CustomEvent("skybee:report", { detail: { $type: "chat.bsky.convo.defs#messageRef", did: m.sender.did, convoId: id, messageId: m.id } }));
      } catch (ex) { toast(ex.message); }
    });
    document.body.appendChild(wrap);
  };
  box.addEventListener("click", async (e) => {
    const jump = e.target.closest("[data-jump]");
    if (jump) { // the replied message, when it is loaded
      const t = [...byId.values()].find(x => x.text && excerpt(x.text) === jump.dataset.jump);
      const n = t && box.querySelector(`[data-mid="${CSS.escape(t.id)}"]`);
      if (n) { n.scrollIntoView({ block: "center", behavior: "smooth" }); n.classList.add("flash"); setTimeout(() => n.classList.remove("flash"), 1200); }
      return;
    }
    if (e.target.closest("a, video, img, [data-href]")) return;
    const row = e.target.closest("[data-mid]"), m = byId.get(row?.dataset.mid);
    if (!m || m.$type === "chat.bsky.convo.defs#deletedMessageView") return;
    e.stopPropagation();
    const r = e.target.closest("[data-react]");
    if (r) { try { await react(m, r.dataset.react); } catch (ex) { toast(ex.message); } return; }
    sheet(m, row);
  });
  const first = await api.chat("chat.bsky.convo.getMessages", { convoId: id, limit: 50 });
  render(first.messages.reverse());
  scrollTo(0, document.body.scrollHeight);
  let older = first.cursor;
  if (older) {
    box.insertAdjacentHTML("beforebegin", `<button class="ghost more" data-older>Раніші повідомлення</button>`);
    el.querySelector("[data-older]").onclick = async (e) => {
      const d = await api.chat("chat.bsky.convo.getMessages", { convoId: id, limit: 50, cursor: older });
      render(d.messages.reverse(), true); older = d.cursor; if (!older) e.target.remove();
    };
  }
  api.chatPost("chat.bsky.convo.updateRead", { convoId: id }).then(() => window.dispatchEvent(new Event("skybee:badge"))).catch(() => {});
  ta.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const typed = ta.value.trim(); if (!typed) return;
    // a reply goes as a quoted first line («> …»), which reads well in any other client too
    const text = replyTo ? `> ${excerpt(replyTo.text)}\n${typed}` : typed;
    const was = replyTo;
    ta.value = ""; setReply(null);
    try {
      const facets = await api.detectFacets(text);
      const m = await api.chatPost("chat.bsky.convo.sendMessage", { convoId: id, message: facets.length ? { text, facets } : { text } });
      render([m]); scrollTo(0, document.body.scrollHeight);
    } catch (ex) { toast(ex.message); ta.value = typed; setReply(was); }
  };
  const poll = setInterval(async () => {
    try {
      const d = await api.chat("chat.bsky.convo.getMessages", { convoId: id, limit: 20 });
      const fresh = d.messages.reverse().filter(m => !seen.has(m.id));
      if (fresh.length) {
        const atBottom = innerHeight + scrollY >= document.body.scrollHeight - 80;
        render(fresh); if (atBottom) scrollTo(0, document.body.scrollHeight);
        api.chatPost("chat.bsky.convo.updateRead", { convoId: id }).catch(() => {});
      }
    } catch {}
  }, 5000);
  return () => clearInterval(poll);
}

export async function startDm(did) {
  const d = await api.chat("chat.bsky.convo.getConvoForMembers", { members: [did] });
  location.hash = `#/messages/${d.convo.id}`;
}

/* ---------- muted words ---------- */
export async function mutedWords(el) {
  el.innerHTML = header("Приховані слова", true) + `
    <form class="card">
      <p class="small muted">Пости з такими словами, фразами чи тегами зникають зі стрічок, а в гілках, пошуку, профілях і сповіщеннях згортаються. Ваші власні пости не приховуються.</p>
      <input name="word" placeholder="Слово, фраза або #тег" maxlength="100" autocapitalize="off" required>
      <div class="row wrap">
        <select name="days" title="На який час">${[["", "Назавжди"], ["1", "На 24 години"], ["7", "На 7 днів"], ["30", "На 30 днів"]].map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
        <select name="where" title="Де шукати"><option value="content">У тексті й тегах</option><option value="tag">Лише в тегах</option></select>
      </div>
      <label class="radio"><input type="checkbox" name="following"> Не приховувати пости тих, за ким я стежу</label>
      <p class="err"></p>
      <button class="btn">Приховати</button>
    </form>
    <div id="words">${spinner()}</div>`;
  const form = $("form", el), box = $("#words", el), err = $(".err", form);
  let shown = []; // the words as rendered: a row's delete button refers to this list
  const render = () => {
    const nowIso = new Date().toISOString();
    shown = api.mutedWords;
    box.innerHTML = shown.map((w, i) => {
      const info = [
        w.targets?.includes("content") ? "у тексті й тегах" : "лише в тегах",
        w.actorTarget === "exclude-following" ? "крім тих, за ким я стежу" : "",
        !w.expiresAt ? "назавжди" : w.expiresAt < nowIso ? "термін минув" : `до ${new Date(w.expiresAt).toLocaleString("uk-UA", { dateStyle: "medium", timeStyle: "short" })}`,
      ].filter(Boolean).join(" · ");
      return `<div class="actor static"><div class="who"><b>${esc(w.value)}</b><span class="muted small">${info}</span></div>
        <button class="ghost sm" data-word="${i}" title="Більше не приховувати">✕</button></div>`;
    }).join("") || empty("Прихованих слів немає");
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const value = api.sanitizeMutedWord(form.word.value), days = +form.days.value, btn = $("button", form);
    if (!value) return;
    btn.disabled = true; err.textContent = "";
    try {
      await api.addMutedWord({ value, targets: form.where.value === "tag" ? ["tag"] : ["content", "tag"],
        actorTarget: form.following.checked ? "exclude-following" : "all",
        expiresAt: days ? new Date(Date.now() + days * 864e5).toISOString() : undefined });
      form.word.value = ""; render(); toast("Слово приховано");
    } catch (ex) { err.textContent = ex.message; }
    btn.disabled = false;
  };
  box.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-word]"); if (!b) return;
    b.disabled = true;
    try { await api.removeMutedWord(shown[b.dataset.word]); render(); }
    catch (ex) { toast(ex.message); b.disabled = false; }
  });
  await api.getPrefs(true);
  render();
}

export async function modList(el, { kind }) {
  el.innerHTML = header(kind === "mutes" ? "Приховані акаунти" : "Заблоковані акаунти", true);
  return paged(el, async (cursor) => {
    const d = await api.get(kind === "mutes" ? "app.bsky.graph.getMutes" : "app.bsky.graph.getBlocks", { limit: 50, cursor });
    const list = d.mutes || d.blocks;
    return {
      html: list.map(a => renderActor(a, kind === "mutes"
        ? `<button class="ghost sm" data-act="unmute" data-did="${a.did}">Показувати</button>` : "")),
      cursor: d.cursor,
    };
  });
}
