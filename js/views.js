// Skybee — screens
import * as api from "./api.js";
import { session } from "./api.js";
import {
  $, esc, enc, num, ago, name, avatar, richText, linkify, renderPost, renderActor, renderFeedCard, followBtn,
  infinite, empty, spinner, toast, modal, profileHref, cachePost, actors, mutedBy, gateLine, pwa,
} from "./ui.js";
import { getLang } from "./compose.js";
import * as notify from "./notify.js";

const header = (title, back = false, right = "") =>
  `<div class="topbar">${back ? `<button class="ghost icon" data-act="back">←</button>` : ""}<h2>${title}</h2><div class="grow"></div>${right}</div>`;

/* ---------- generic paginated list ---------- */
function paged(el, fetchPage) {
  const list = document.createElement("div");
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
  });
}

// hideMuted: in feeds, posts with muted words disappear; elsewhere renderPost collapses them
const feedItems = (feed, hideMuted = false) => feed.map(it => {
  if (!it.post || (hideMuted && mutedBy(it.post))) return "";
  return renderPost(it.post, { reason: it.reason, parent: it.reply?.parent });
});

/* ================= HOME ================= */
export async function home(el) {
  el.innerHTML = `<div class="topbar"><button class="ghost icon only-mobile" data-act="accountMenu" title="Меню">☰</button><h2>🐝 Skybee</h2><div class="grow"></div><button class="ghost icon" data-act="refresh" title="Оновити">↻</button></div><div class="tabs" id="feedTabs"></div><div id="feedBody"></div>`;
  let tabs = [{ label: "Підписки", kind: "timeline" }];
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
  if (tabs.length === 1) tabs.push({ label: "Discover", kind: "feed", uri: api.DISCOVER });
  let sel = 0; try { sel = Math.min(+sessionStorage.getItem("skybee.tab") || 0, tabs.length - 1); } catch {}
  const tabEl = $("#feedTabs", el), body = $("#feedBody", el);
  let stop;
  const show = (i) => {
    sel = i; try { sessionStorage.setItem("skybee.tab", i); } catch {}
    tabEl.innerHTML = tabs.map((t, n) => `<button class="${n === i ? "on" : ""}" data-tab="${n}">${esc(t.label)}</button>`).join("");
    stop?.(); body.innerHTML = ""; body.parentElement.querySelectorAll(".sentinel").forEach(s => s.remove());
    const t = tabs[i];
    stop = paged(body, async (cursor) => {
      const d = t.kind === "timeline" ? await api.get("app.bsky.feed.getTimeline", { limit: 30, cursor })
        : t.kind === "list" ? await api.get("app.bsky.feed.getListFeed", { list: t.uri, limit: 30, cursor })
        : await api.get("app.bsky.feed.getFeed", { feed: t.uri, limit: 30, cursor });
      return { html: feedItems(d.feed, true), cursor: d.cursor };
    });
  };
  tabEl.addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (b) show(+b.dataset.tab); });
  el.querySelector("[data-act=refresh]").onclick = () => { scrollTo(0, 0); show(sel); };
  show(sel);
  return () => stop?.();
}

/* ================= SINGLE FEED / LIST ================= */
export async function feed(el, { uri }) {
  el.innerHTML = header("Фід", true) + spinner();
  const g = (await api.get("app.bsky.feed.getFeedGenerator", { feed: uri })).view;
  el.innerHTML = header(esc(g.displayName), true) + `
    <div class="card-row pad">${avatar({ avatar: g.avatar, displayName: g.displayName }, 56)}
      <div class="grow"><b>${esc(g.displayName)}</b><div class="muted small">Фід від <a href="${profileHref(g.creator)}">@${esc(g.creator.handle)}</a> · ♥ ${num(g.likeCount)}</div>
      ${g.description ? `<div class="small">${richText(g.description, g.descriptionFacets)}</div>` : ""}</div>
      <div class="col"><button class="btn sm" data-act="saveFeed" data-uri="${esc(uri)}">${g.viewer?.saved ? "Збережено ✓" : "Зберегти"}</button>
      <button class="ghost sm" data-act="likeFeed" data-uri="${esc(uri)}" data-cid="${esc(g.cid)}" data-like="${esc(g.viewer?.like || "")}">${g.viewer?.like ? "♥" : "♡"}</button></div>
    </div>`;
  return paged(el, async (cursor) => {
    const d = await api.get("app.bsky.feed.getFeed", { feed: uri, limit: 30, cursor });
    return { html: feedItems(d.feed, true), cursor: d.cursor };
  });
}

export async function list(el, { uri }) {
  el.innerHTML = header("Список", true) + spinner();
  const d = await api.get("app.bsky.graph.getList", { list: uri, limit: 1 });
  const l = d.list;
  const curate = l.purpose === "app.bsky.graph.defs#curatelist";
  el.innerHTML = header(esc(l.name), true) + `
    <div class="card-row pad">${avatar({ avatar: l.avatar, displayName: l.name }, 56)}
      <div class="grow"><b>${esc(l.name)}</b><div class="muted small">${curate ? "Список" : "Модераційний список"} від <a href="${profileHref(l.creator)}">@${esc(l.creator.handle)}</a></div>
      ${l.description ? `<div class="small">${richText(l.description, l.descriptionFacets)}</div>` : ""}</div>
      ${curate ? `<button class="btn sm" data-act="saveFeed" data-uri="${esc(uri)}">Закріпити</button>` : ""}
    </div>
    <div class="tabs"><button class="on" data-lt="posts">Пости</button><button data-lt="people">Люди</button></div><div id="lb"></div>`;
  let stop;
  const lb = $("#lb", el);
  const show = (which) => {
    el.querySelectorAll("[data-lt]").forEach(b => b.classList.toggle("on", b.dataset.lt === which));
    stop?.(); lb.innerHTML = ""; el.querySelectorAll(".sentinel").forEach(s => s.remove());
    stop = paged(lb, which === "posts"
      ? async (cursor) => { const d = await api.get("app.bsky.feed.getListFeed", { list: uri, limit: 30, cursor }); return { html: feedItems(d.feed, true), cursor: d.cursor }; }
      : async (cursor) => { const d = await api.get("app.bsky.graph.getList", { list: uri, limit: 50, cursor }); return { html: d.items.map(i => renderActor(i.subject)), cursor: d.cursor }; });
  };
  el.addEventListener("click", e => { const b = e.target.closest("[data-lt]"); if (b) show(b.dataset.lt); });
  show(curate ? "posts" : "people");
  return () => stop?.();
}

/* ================= THREAD ================= */
export async function thread(el, { actor, rkey }) {
  el.innerHTML = header("Пост", true) + spinner();
  let did = actor;
  if (!did.startsWith("did:")) did = (await api.get("com.atproto.identity.resolveHandle", { handle: actor })).did;
  const uri = `at://${did}/app.bsky.feed.post/${rkey}`;
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
  const replies = (node, depth = 0) => (node.replies || [])
    .filter(r => r.$type === "app.bsky.feed.defs#threadViewPost")
    .sort((a, b) => (b.post.author.did === t.post.author.did) - (a.post.author.did === t.post.author.did) || (b.post.likeCount || 0) - (a.post.likeCount || 0))
    .map(r => `<div class="reply d${Math.min(depth, 4)}">${renderPost(r.post, { thread: true, line: !!r.replies?.length && depth < 5 })}${depth < 5 ? replies(r, depth + 1) : ""}</div>`).join("");
  // the gate belongs to the first post of the thread, which may be above the opened one
  let root = t;
  while (root.parent?.$type === "app.bsky.feed.defs#threadViewPost") root = root.parent;
  const noReply = !!t.post.viewer?.replyDisabled;
  const gate = gateLine(root.post, { noReply, mine: root.post.author.did === session.did && !root.post.record?.reply });
  el.innerHTML = header("Пост", true) + parents.join("") + renderPost(t.post, { focus: true }) + gate +
    (noReply ? "" : `<div class="replybox" data-act="reply" data-uri="${esc(t.post.uri)}">${avatar(actors.get(session.did) || {}, 32)}<span class="muted">Напиши відповідь…</span></div>`) +
    (replies(t) || empty("Відповідей ще немає"));
  el.querySelector(".post.focus")?.scrollIntoView({ block: "start" });
  scrollBy(0, -60);
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
  const me = p.did === session.did;
  const v = p.viewer || {};
  const blocked = v.blocking || v.blockedBy;
  const tabs = [["posts", "Пости"], ["replies", "Відповіді"], ["media", "Медіа"], ["videos", "Відео"]];
  if (me) tabs.push(["likes", "Вподобання"]);
  if (p.associated?.feedgens) tabs.push(["feeds", "Фіди"]);
  if (p.associated?.lists) tabs.push(["lists", "Списки"]);
  if (p.associated?.starterPacks) tabs.push(["packs", "Стартові набори"]);
  el.innerHTML = header(name(p), true, `<button class="ghost icon" data-act="profileMenu" data-did="${p.did}">⋯</button>`) + `
    <div class="banner" ${p.banner ? `style="background-image:url('${esc(p.banner)}')"` : ""}></div>
    <div class="phead">
      <div class="row between">
        <div class="bigava" ${p.avatar ? `data-act="lightboxOne" data-full="${esc(p.avatar)}"` : ""}>${avatar(p, 88)}</div>
        <div class="row">
          ${me ? `<button class="ghost sm" data-act="editProfile">Редагувати профіль</button>`
               : `${!blocked && p.associated?.chat?.allowIncoming !== "none" ? `<button class="ghost sm icon" data-act="dm" data-did="${p.did}" title="Написати">✉️</button>` : ""}${followBtn(p)}`}
        </div>
      </div>
      <h1>${name(p)}</h1>
      <div class="muted">@${esc(p.handle)} ${v.followedBy ? '<span class="pill">Стежить за вами</span>' : ""} ${v.muted ? '<span class="pill">Приховано</span>' : ""}</div>
      ${blocked ? "" : `<div class="counts">
        <a href="${profileHref(p)}/followers"><b>${num(p.followersCount)}</b> читачів</a>
        <a href="${profileHref(p)}/follows"><b>${num(p.followsCount)}</b> підписок</a>
        <span><b>${num(p.postsCount)}</b> постів</span></div>
      ${p.description ? `<div class="bio">${linkify(p.description)}</div>` : ""}
      ${v.knownFollowers?.count ? `<div class="muted small">Серед читачів: ${v.knownFollowers.followers.slice(0, 2).map(f => name(f)).join(", ")}${v.knownFollowers.count > 2 ? ` і ще ${v.knownFollowers.count - 2}` : ""}</div>` : ""}`}
    </div>
    ${blocked ? empty(v.blocking ? "Ви заблокували цей акаунт" : "Цей акаунт заблокував вас") :
      `<div class="tabs scroll">${tabs.map(([k, l]) => `<a class="${k === tab ? "on" : ""}" href="${profileHref(p)}${k === "posts" ? "" : "/" + k}">${l}</a>`).join("")}</div><div id="pbody"></div>`}`;
  if (blocked) return;
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
    return { html: d.lists.map(l => `<div class="actor" data-href="#/list/${enc(l.uri)}">${avatar({ avatar: l.avatar, displayName: l.name }, 44)}<div class="who"><b>${esc(l.name)}</b><span class="muted">${l.listItemCount ?? ""} учасників</span>${l.description ? `<div class="desc">${esc(l.description)}</div>` : ""}</div></div>`), cursor: d.cursor };
  });
  if (tab === "packs") return paged(body, async (cursor) => {
    const d = await api.get("app.bsky.graph.getActorStarterPacks", { actor: p.did, limit: 30, cursor });
    return { html: d.starterPacks.map(s => `<a class="actor" href="https://bsky.app/starter-pack/${esc(p.handle)}/${s.uri.split("/").pop()}" target="_blank">🎒<div class="who"><b>${esc(s.record?.name)}</b><span class="muted">${esc(s.record?.description || "")}</span></div></a>`), cursor: d.cursor };
  });
}

export async function follows(el, { actor, kind }) {
  el.innerHTML = header(kind === "followers" ? "Читачі" : "Підписки", true);
  return paged(el, async (cursor) => {
    const d = await api.get(kind === "followers" ? "app.bsky.graph.getFollowers" : "app.bsky.graph.getFollows", { actor, limit: 50, cursor });
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

export async function notifications(el, { filter }) {
  el.innerHTML = header("Сповіщення", false, `<button class="ghost sm" data-act="markRead">Позначити прочитаним</button>`) +
    `<div class="tabs"><a href="#/notifications" class="${!filter ? "on" : ""}">Усі</a><a href="#/notifications/mentions" class="${filter ? "on" : ""}">Згадки</a></div>`;
  const seenAt = new Date().toISOString();
  let marked = false;
  return paged(el, async (cursor) => {
    const d = await api.get("app.bsky.notification.listNotifications", {
      limit: 40, cursor, reasons: filter ? ["mention", "reply", "quote"] : undefined });
    if (!marked) { marked = true; api.post("app.bsky.notification.updateSeen", { seenAt }).then(() => window.dispatchEvent(new Event("skybee:badge"))).catch(() => {}); }
    // fetch post views for subjects and post-type notifications
    const uris = new Set();
    for (const n of d.notifications) {
      if (["reply", "mention", "quote", "subscribed-post"].includes(n.reason)) uris.add(n.uri);
      else if (n.reasonSubject?.includes("app.bsky.feed.post")) uris.add(n.reasonSubject);
    }
    const postsBy = new Map();
    const arr = [...uris];
    for (let i = 0; i < arr.length; i += 25) {
      const r = await api.get("app.bsky.feed.getPosts", { uris: arr.slice(i, i + 25) });
      r.posts.forEach(p => postsBy.set(p.uri, cachePost(p)));
    }
    // group like/repost/follow by reason+subject
    const groups = [];
    for (const n of d.notifications) {
      const key = ["reply", "mention", "quote", "subscribed-post"].includes(n.reason) ? n.uri : n.reason + "|" + (n.reasonSubject || "");
      const g = groups.find(g => g.key === key && !["reply", "mention", "quote"].includes(n.reason));
      if (g) g.items.push(n); else groups.push({ key, reason: n.reason, items: [n] });
    }
    const html = groups.map(g => {
      const n = g.items[0], unread = g.items.some(i => !i.isRead) ? " unread" : "";
      if (["reply", "mention", "quote", "subscribed-post"].includes(g.reason)) {
        const p = postsBy.get(n.uri);
        if (!p) return "";
        const tag = { reply: "відповів(-ла)", mention: "згадав(-ла) вас", quote: "процитував(-ла) ваш пост", "subscribed-post": "новий пост" }[g.reason];
        return `<div class="nwrap${unread}"><div class="ntag muted small">${tag}</div>${renderPost(p)}</div>`;
      }
      const who = g.items.map(i => i.author);
      const subj = postsBy.get(n.reasonSubject);
      const others = who.length > 1 ? ` і ще ${who.length - 1}` : "";
      return `<div class="notif${unread}" ${subj ? `data-href="${"#/profile/" + enc(subj.author.did) + "/post/" + subj.uri.split("/").pop()}"` : `data-href="${profileHref(n.author)}"`}>
        <div class="nicon r-${g.reason}">${NICON[g.reason] || "🔔"}</div>
        <div class="grow">
          <div class="avas">${who.slice(0, 6).map(a => `<a href="${profileHref(a)}">${avatar(a, 30)}</a>`).join("")}</div>
          <div><a href="${profileHref(n.author)}"><b>${name(n.author)}</b></a>${others} ${NREASON[g.reason] || g.reason} <span class="muted small">· ${ago(n.indexedAt)}</span></div>
          ${subj ? `<div class="muted small clip">${esc(subj.record?.text || "")}</div>` : ""}
          ${g.reason === "follow" && g.items.length === 1 ? followBtn(n.author) : ""}
        </div></div>`;
    });
    return { html, cursor: d.cursor };
  });
}

/* ================= SEARCH ================= */
export async function search(el, { q = "", tab = "top" }) {
  el.innerHTML = header("Пошук") + `
    <form class="searchbar"><input type="search" placeholder="Пошук постів, людей, фідів" value="${esc(q)}" autofocus></form>
    ${q ? `<div class="tabs">${[["top", "Топ"], ["latest", "Найновіші"], ["people", "Люди"], ["feeds", "Фіди"]].map(([k, l]) =>
      `<a class="${k === tab ? "on" : ""}" href="#/search?q=${enc(q)}&tab=${k}">${l}</a>`).join("")}</div>` : ""}
    <div id="sbody"></div>`;
  $("form", el).onsubmit = (e) => { e.preventDefault(); const v = $("input", el).value.trim(); if (v) location.hash = `#/search?q=${enc(v)}&tab=${tab}`; };
  const body = $("#sbody", el);
  if (!q) {
    body.innerHTML = `<h3 class="pad">Кого почитати</h3>`;
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
  el.innerHTML = header("Фіди") + `<h3 class="pad">Мої фіди</h3><div id="mine">${spinner()}</div><h3 class="pad">Знайти нові фіди</h3>
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
        <button class="ghost sm" data-act="pinFeed" data-uri="${esc(i.value)}" title="${i.pinned ? "Відкріпити з головної" : "Закріпити на головній"}">${i.pinned ? "📌" : "📍"}</button>
        <button class="ghost sm" data-act="unsaveFeed" data-uri="${esc(i.value)}" title="Видалити">✕</button></div>`);
    }
    mine.innerHTML = rows.join("") || empty("Збережених фідів немає");
  };
  await renderMine();
  el.addEventListener("skybee:feedsChanged", renderMine);
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
export async function messages(el) {
  el.innerHTML = header("Повідомлення", false, `<button class="ghost sm" data-act="newDm">✉️ Нове</button>`);
  try {
    return paged(el, async (cursor) => {
      const d = await api.chat("chat.bsky.convo.listConvos", { limit: 30, cursor });
      return {
        html: d.convos.map(c => {
          const other = c.members.find(m => m.did !== session.did) || c.members[0];
          const last = c.lastMessage;
          const txt = last?.$type === "chat.bsky.convo.defs#deletedMessageView" ? "Повідомлення видалено" : (last?.text || "");
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
  const seen = new Set();
  const render = (msgs, prepend = false) => {
    const html = msgs.filter(m => !seen.has(m.id)).map(m => {
      seen.add(m.id);
      const mine = m.sender?.did === session.did;
      const del = m.$type === "chat.bsky.convo.defs#deletedMessageView";
      return `<div class="msg${mine ? " mine" : ""}" data-mid="${m.id}" title="${esc(new Date(m.sentAt).toLocaleString("uk-UA"))}">
        <div class="bubble${del ? " muted" : ""}">${del ? "Повідомлення видалено" : richText(m.text, m.facets)}${m.embed ? `<div class="small muted">📎 вкладення</div>` : ""}</div></div>`;
    }).join("");
    box.insertAdjacentHTML(prepend ? "afterbegin" : "beforeend", html);
  };
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
    const text = ta.value.trim(); if (!text) return;
    ta.value = "";
    try {
      const facets = await api.detectFacets(text);
      const m = await api.chatPost("chat.bsky.convo.sendMessage", { convoId: id, message: facets.length ? { text, facets } : { text } });
      render([m]); scrollTo(0, document.body.scrollHeight);
    } catch (ex) { toast(ex.message); ta.value = text; }
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

/* ================= SETTINGS ================= */
export async function settings(el) {
  const theme = document.documentElement.dataset.theme || "dark";
  // every account signed in on this device; avatars and names arrive a moment later
  const accountRows = (profiles = []) => api.accounts.map(a => {
    const p = profiles.find(p => p.did === a.did) || a, active = a.did === session.did;
    return `<div class="accrow">${avatar(p, 40)}
      <div class="who"><b>${name(p)}</b><span class="muted small">@${esc(a.handle)}${active ? ` · сервер ${esc((a.pds || "").replace(/^https?:\/\//, ""))}` : ""}</span></div>
      ${active ? `<span class="pill">активний</span><button class="ghost sm danger" data-act="logout">Вийти</button>`
        : `<button class="ghost sm" data-act="switchAccount" data-did="${esc(a.did)}">Перемкнути</button><button class="ghost sm" data-act="removeAccount" data-did="${esc(a.did)}" title="Вийти з цього акаунта">✕</button>`}
    </div>`;
  }).join("");
  el.innerHTML = header("Налаштування") + `
    <div class="card">
      <h3>Акаунти</h3>
      <div id="acclist">${accountRows()}</div>
      <div class="row wrap">
        <button class="ghost sm" data-act="addAccount">➕ Додати акаунт</button>
        <a class="ghost sm" href="https://bsky.app/settings/app-passwords" target="_blank" rel="noopener">Паролі застосунків ↗</a>
      </div>
    </div>
    <div class="card">
      <h3>Вигляд</h3>
      <div class="seg">${[["dark", "Темна"], ["dim", "Сутінки"], ["light", "Світла"]].map(([k, l]) => `<button data-theme-set="${k}" class="${k === theme ? "on" : ""}">${l}</button>`).join("")}</div>
    </div>
    <div class="card">
      <h3>Мова постів за замовчуванням</h3>
      <select id="deflang">${[["uk", "Українська"], ["en", "English"], ["pl", "Polski"], ["be", "Беларуская"], ["ru", "Русский"]].map(([c, n]) => `<option value="${c}" ${c === getLang() ? "selected" : ""}>${n}</option>`).join("")}</select>
    </div>
    <div class="card">
      <h3>Сповіщення</h3>
      <label class="radio"><input type="checkbox" id="sysnotify" ${notify.enabled() ? "checked" : ""} ${notify.supported() ? "" : "disabled"}> Системні сповіщення про нові події та повідомлення</label>
      <p class="small muted">${notify.supported()
        ? "Надходять, поки Skybee відкритий — у вкладці (навіть фоновій) або як встановлений застосунок. Коли Skybee закрито, сповіщень немає: для цього потрібен власний сервер."
        : "Цей браузер не підтримує системні сповіщення."}</p>
    </div>
    <div class="card"><h3>Модерація</h3>
      <a class="rowlink" href="#/settings/words">Приховані слова →</a>
      <a class="rowlink" href="#/settings/mutes">Приховані акаунти →</a>
      <a class="rowlink" href="#/settings/blocks">Заблоковані акаунти →</a>
      <a class="rowlink" href="https://bsky.app/moderation" target="_blank" rel="noopener">Фільтри контенту ↗</a>
    </div>
    <div class="card"><h3>Про Skybee</h3><p class="small muted">🐝 Skybee — відкритий клієнт Bluesky. <a href="https://github.com/vysocavnu/skybee" target="_blank" rel="noopener">Код на GitHub</a></p>
      <button class="ghost sm" data-act="install" ${pwa.install ? "" : "hidden"}>📲 Встановити як застосунок</button></div>`;
  el.querySelectorAll("[data-theme-set]").forEach(b => b.onclick = () => {
    const t = b.dataset.themeSet; document.documentElement.dataset.theme = t;
    try { localStorage.setItem("skybee.theme", t); } catch {}
    el.querySelectorAll("[data-theme-set]").forEach(x => x.classList.toggle("on", x === b));
  });
  $("#deflang", el).onchange = (e) => { try { localStorage.setItem("skybee.lang", e.target.value); } catch {} toast("Збережено"); };
  $("#sysnotify", el).onchange = async (e) => {
    if (!e.target.checked) { notify.disable(); return toast("Сповіщення вимкнено"); }
    if (await notify.enable()) return toast("Сповіщення увімкнено");
    e.target.checked = false;
    toast("Браузер не дозволив сповіщення. Дозволь їх для цього сайту в налаштуваннях браузера.", 5000);
  };
  api.get("app.bsky.actor.getProfiles", { actors: api.accounts.map(a => a.did).slice(0, 25) })
    .then(d => { const box = $("#acclist", el); if (box) box.innerHTML = accountRows(d.profiles); }).catch(() => {});
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
