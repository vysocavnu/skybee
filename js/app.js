// Skybee — app shell, router, global actions
import * as api from "./api.js";
import * as V from "./views.js";
import { $, esc, posts, actors, toast, menu, confirmBox, modal, lightbox, attachVideo, webUrl, avatar, actionsBar } from "./ui.js";
import { openComposer } from "./compose.js";

try { document.documentElement.dataset.theme = localStorage.getItem("skybee.theme") || "dark"; } catch {}

const app = $("#app");
let cleanup = null;

/* ---------- login screen ---------- */
function loginScreen() {
  app.innerHTML = `
  <div class="login">
    <h1>🐝 Skybee</h1>
    <p class="muted">Клієнт для Bluesky</p>
    <form class="card">
      <p class="hint">Достатньо ввести нік, наприклад <b>@lejk309</b>. Якщо акаунт не на bsky.social (Eurosky, свій домен) — повний handle.</p>
      <input id="handle" placeholder="@нік" autocomplete="username" autocapitalize="off" required>
      <input id="pass" type="password" placeholder="Пароль застосунку xxxx-xxxx-xxxx-xxxx" autocomplete="current-password" required>
      <p class="hint">Використовуй <b>пароль застосунку</b> (bsky.app → Налаштування → Конфіденційність і безпека → Паролі застосунків). Для чатів постав галочку доступу до повідомлень.</p>
      <p class="err"></p>
      <button class="btn wide">Увійти</button>
      <hr>
      <p class="hint">Ще немає акаунта в Bluesky?</p>
      <a class="ghost wide" href="https://bsky.app" target="_blank" rel="noopener">Зареєструватися на bsky.app ↗</a>
    </form>
  </div>`;
  const f = $("form", app);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("button", f), err = $(".err", f);
    btn.disabled = true; err.textContent = "";
    try { await api.login($("#handle").value, $("#pass").value); location.hash = "#/"; boot(); }
    catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  };
}

/* ---------- shell ---------- */
const NAV = [
  ["#/", "🏠", "Головна"], ["#/search", "🔍", "Пошук"], ["#/notifications", "🔔", "Сповіщення", "nbadge"],
  ["#/messages", "💬", "Чати", "cbadge"], ["#/feeds", "#️⃣", "Фіди"], ["#/bookmarks", "🔖", "Закладки"],
  ["#/profile/me", "👤", "Профіль"], ["#/settings", "⚙️", "Налаштування"],
];
function shell() {
  app.innerHTML = `
  <nav class="side">
    <a class="logo" href="#/">🐝 <span>Skybee</span></a>
    ${NAV.map(([h, i, l, b]) => `<a href="${h}" data-nav="${h}"><span class="ni">${i}${b ? `<i class="dot" id="${b}"></i>` : ""}</span><span class="nl">${l}</span></a>`).join("")}
    <button class="btn compose-side" data-act="compose">✏️ <span>Новий пост</span></button>
  </nav>
  <main id="main"></main>
  <aside class="right">
    <form class="searchbar" id="sideSearch"><input type="search" placeholder="Пошук"></form>
    <div class="card small muted">🐝 Skybee · <a href="https://github.com/vysocavnu/skybee" target="_blank" rel="noopener">GitHub</a></div>
  </aside>
  <nav class="bottom">${NAV.filter((_, i) => [0, 1, 3, 2, 6].includes(i)).map(([h, i, , b]) => `<a href="${h}" data-nav="${h}"><span class="ni">${i}${b ? `<i class="dot" id="m${b}"></i>` : ""}</span></a>`).join("")}</nav>
  <button class="fab" data-act="compose">✏️</button>`;
  $("#sideSearch").onsubmit = (e) => { e.preventDefault(); const v = $("input", e.target).value.trim(); if (v) location.hash = `#/search?q=${encodeURIComponent(v)}`; };
}

/* ---------- badges ---------- */
async function badges() {
  if (!api.session) return;
  try {
    const { count } = await api.get("app.bsky.notification.getUnreadCount");
    for (const id of ["nbadge", "mnbadge"]) { const d = document.getElementById(id); if (d) { d.textContent = count > 30 ? "30+" : count || ""; d.hidden = !count; } }
  } catch {}
  try {
    const d = await api.chat("chat.bsky.convo.listConvos", { limit: 50 });
    const c = d.convos.reduce((s, x) => s + (x.muted ? 0 : x.unreadCount), 0);
    for (const id of ["cbadge", "mcbadge"]) { const e = document.getElementById(id); if (e) { e.textContent = c || ""; e.hidden = !c; } }
  } catch {}
}
window.addEventListener("skybee:badge", badges);

/* ---------- router ---------- */
async function route() {
  if (!api.session) return loginScreen();
  cleanup?.(); cleanup = null;
  document.querySelector(".popmenu")?.remove();
  document.querySelectorAll(".modal-bg").forEach(m => m.close ? m.close() : m.remove());
  const main = $("#main");
  let [path, qs] = location.hash.slice(1).split("?");
  path = path || "/";
  const q = Object.fromEntries(new URLSearchParams(qs || ""));
  const seg = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (seg[0] === "profile" && seg[1] === "me") { location.replace(`#/profile/${api.session.handle}${seg.length > 2 ? "/" + seg.slice(2).join("/") : ""}`); return; }
  document.querySelectorAll("[data-nav]").forEach(a => {
    const h = a.dataset.nav.slice(1);
    a.classList.toggle("on", h === "/" ? path === "/" : path.startsWith(h.replace("/me", "/" + api.session.handle)));
  });
  main.innerHTML = "";
  const keepScroll = sessionStorage.getItem("skybee.scroll:" + location.hash);
  scrollTo(0, 0);
  try {
    let r;
    if (path === "/") r = V.home(main);
    else if (seg[0] === "search") r = V.search(main, q);
    else if (seg[0] === "notifications") r = V.notifications(main, { filter: seg[1] });
    else if (seg[0] === "messages") r = seg[1] ? V.convo(main, { id: seg[1] }) : V.messages(main);
    else if (seg[0] === "feeds") r = V.feeds(main);
    else if (seg[0] === "feed") r = V.feed(main, { uri: seg[1] });
    else if (seg[0] === "list") r = V.list(main, { uri: seg[1] });
    else if (seg[0] === "bookmarks") r = V.bookmarks(main);
    else if (seg[0] === "settings") r = seg[1] ? V.modList(main, { kind: seg[1] }) : V.settings(main);
    else if (seg[0] === "profile" && seg[2] === "post" && seg[4]) r = V.postUsers(main, { actor: seg[1], rkey: seg[3], kind: seg[4] });
    else if (seg[0] === "profile" && seg[2] === "post") r = V.thread(main, { actor: seg[1], rkey: seg[3] });
    else if (seg[0] === "profile" && (seg[2] === "followers" || seg[2] === "follows")) r = V.follows(main, { actor: seg[1], kind: seg[2] });
    else if (seg[0] === "profile") r = V.profile(main, { actor: seg[1], tab: seg[2] });
    else main.innerHTML = `<p class="pad">Сторінку не знайдено. <a href="#/">На головну</a></p>`;
    cleanup = await r;
    if (keepScroll) setTimeout(() => scrollTo(0, +keepScroll), 50);
  } catch (e) {
    main.insertAdjacentHTML("beforeend", `<div class="card"><p class="err">${esc(e.message)}</p><button class="ghost" data-act="back">← Назад</button></div>`);
  }
}
window.addEventListener("hashchange", route);
addEventListener("scroll", () => { try { sessionStorage.setItem("skybee.scroll:" + location.hash, scrollY); } catch {} }, { passive: true });

/* ---------- helpers for actions ---------- */
const postOf = (el) => posts.get(el.closest("[data-uri]")?.dataset.uri);
const refreshPostEl = (uri) => {
  // re-render action bars of every copy of this post on screen
  const p = posts.get(uri);
  document.querySelectorAll(`[data-uri="${CSS.escape(uri)}"] > .body > .actions, [data-uri="${CSS.escape(uri)}"] > .actions`)
    .forEach(bar => { bar.outerHTML = actionsBar(p, bar.classList.contains("big")); });
};

async function reloadView() { const y = scrollY; await route(); scrollTo(0, y); }

/* ---------- global click handling ---------- */
document.addEventListener("click", async (e) => {
  // unblur / lightbox / video first
  const t = e.target;
  const actEl = t.closest("[data-act]");
  const act = actEl?.dataset.act;

  if (!act) {
    const v = t.closest("video[data-src]"); if (v) { attachVideo(v); return; }
    // card navigation (ignore clicks on links, buttons, inputs, videos)
    if (t.closest("a, button, input, textarea, select, video, label")) return;
    const card = t.closest("[data-href]");
    if (card && !getSelection().toString()) { location.hash = card.dataset.href; }
    return;
  }
  e.preventDefault(); e.stopPropagation();
  const p = postOf(actEl);
  try {
    switch (act) {
      case "back": history.length > 1 ? history.back() : (location.hash = "#/"); break;
      case "compose": openComposer({}, reloadView); break;
      case "unblur": actEl.parentElement.classList.add("shown"); actEl.remove(); break;
      case "lightbox": {
        const imgs = [...actEl.parentElement.querySelectorAll("img")];
        lightbox(imgs.map(i => i.dataset.full || i.src), +actEl.dataset.i, imgs.map(i => i.alt));
        break;
      }
      case "lightboxOne": lightbox([actEl.dataset.full]); break;

      case "reply": {
        const target = p || posts.get(actEl.dataset.uri);
        openComposer({ replyTo: target }, () => { target.replyCount = (target.replyCount || 0) + 1; reloadView(); });
        break;
      }
      case "like": {
        actEl.disabled = true;
        if (p.viewer?.like) { await api.unlike(p.viewer.like); p.viewer.like = undefined; p.likeCount--; }
        else { const r = await api.like(p); p.viewer = { ...(p.viewer || {}), like: r.uri }; p.likeCount++; }
        refreshPostEl(p.uri); break;
      }
      case "repostMenu": {
        const c = await menu(actEl, [
          { act: p.viewer?.repost ? "unrepost" : "repost", label: p.viewer?.repost ? "🔁 Скасувати поширення" : "🔁 Поширити" },
          { act: "quote", label: "❝ Цитувати" },
        ]);
        if (c === "repost") { const r = await api.repost(p); p.viewer = { ...(p.viewer || {}), repost: r.uri }; p.repostCount++; refreshPostEl(p.uri); toast("Поширено"); }
        if (c === "unrepost") { await api.unrepost(p.viewer.repost); p.viewer.repost = undefined; p.repostCount--; refreshPostEl(p.uri); }
        if (c === "quote") openComposer({ quote: p }, reloadView);
        break;
      }
      case "bookmark": {
        if (p.viewer?.bookmarked) { await api.unbookmark(p.uri); p.viewer.bookmarked = false; toast("Прибрано із закладок"); }
        else { await api.bookmark(p); p.viewer = { ...(p.viewer || {}), bookmarked: true }; toast("Додано в закладки 🔖"); }
        refreshPostEl(p.uri); break;
      }
      case "translate": window.open(`https://translate.google.com/?sl=auto&tl=uk&text=${encodeURIComponent(p.record?.text || "")}`, "_blank"); break;
      case "postMenu": {
        const mine = p.author.did === api.session.did;
        const c = await menu(actEl, [
          { act: "translate", label: "🌐 Перекласти" },
          { act: "copyText", label: "📋 Копіювати текст" },
          { act: "copyLink", label: "🔗 Копіювати посилання" },
          { act: "muteThread", label: "🔕 Приховати гілку" },
          "-",
          ...(mine ? [{ act: "delete", label: "🗑️ Видалити пост", danger: true }] : [
            { act: "muteUser", label: `🙈 Приховати @${p.author.handle}` },
            { act: "blockUser", label: `⛔ Заблокувати @${p.author.handle}`, danger: true },
            { act: "report", label: "🚩 Поскаржитись", danger: true },
          ]),
        ]);
        if (c === "translate") window.open(`https://translate.google.com/?sl=auto&tl=uk&text=${encodeURIComponent(p.record?.text || "")}`, "_blank");
        if (c === "copyText") { await navigator.clipboard.writeText(p.record?.text || ""); toast("Скопійовано"); }
        if (c === "copyLink") { await navigator.clipboard.writeText(webUrl(p)); toast("Посилання скопійовано"); }
        if (c === "muteThread") { await api.muteThread(p.record?.reply?.root?.uri || p.uri); toast("Гілку приховано"); }
        if (c === "delete" && await confirmBox("Видалити цей пост назавжди?", "Видалити", true)) {
          await api.deletePost(p.uri); document.querySelectorAll(`[data-uri="${CSS.escape(p.uri)}"]`).forEach(x => x.remove()); toast("Пост видалено");
        }
        if (c === "muteUser") { await api.mute(p.author.did); toast("Акаунт приховано"); }
        if (c === "blockUser" && await confirmBox(`Заблокувати @${p.author.handle}?`, "Заблокувати", true)) { await api.block(p.author.did); toast("Заблоковано"); }
        if (c === "report") reportDialog({ $type: "com.atproto.repo.strongRef", uri: p.uri, cid: p.cid });
        break;
      }

      case "follow": {
        const did = actEl.dataset.did; actEl.disabled = true;
        const r = await api.follow(did);
        const a = actors.get(did); if (a) a.viewer = { ...(a.viewer || {}), following: r.uri };
        actEl.outerHTML = `<button class="ghost sm" data-act="unfollow" data-did="${did}" data-uri="${r.uri}">Ви стежите</button>`;
        break;
      }
      case "unfollow": {
        const did = actEl.dataset.did;
        const uri = actEl.dataset.uri || actors.get(did)?.viewer?.following || (await api.get("app.bsky.actor.getProfile", { actor: did })).viewer?.following;
        if (!uri) break;
        await api.unfollow(uri);
        const a = actors.get(did); if (a?.viewer) a.viewer.following = undefined;
        actEl.outerHTML = `<button class="btn sm" data-act="follow" data-did="${did}">Стежити</button>`;
        break;
      }
      case "unblock": {
        const did = actEl.dataset.did;
        const uri = actors.get(did)?.viewer?.blocking || (await api.get("app.bsky.actor.getProfile", { actor: did })).viewer?.blocking;
        if (uri) { await api.unblock(uri); toast("Розблоковано"); reloadView(); }
        break;
      }
      case "unmute": await api.unmute(actEl.dataset.did); toast("Акаунт знову видно"); actEl.remove(); break;
      case "dm": await V.startDm(actEl.dataset.did); break;
      case "editProfile": V.editProfile(actors.get(api.session.did) || {}, reloadView); break;
      case "profileMenu": {
        const a = actors.get(actEl.dataset.did); const mine = a.did === api.session.did;
        const c = await menu(actEl, [
          { act: "copy", label: "🔗 Копіювати посилання" },
          { act: "search", label: "🔍 Шукати в постах" },
          ...(mine ? [] : [
            a.viewer?.muted ? { act: "unmute", label: "👁️ Показувати" } : { act: "mute", label: "🙈 Приховати" },
            a.viewer?.blocking ? { act: "unblock", label: "Розблокувати" } : { act: "block", label: "⛔ Заблокувати", danger: true },
            { act: "report", label: "🚩 Поскаржитись", danger: true },
          ]),
        ]);
        if (c === "copy") { await navigator.clipboard.writeText(`https://bsky.app/profile/${a.handle}`); toast("Скопійовано"); }
        if (c === "search") location.hash = `#/search?q=${encodeURIComponent("from:" + a.handle + " ")}`;
        if (c === "mute") { await api.mute(a.did); toast("Приховано"); reloadView(); }
        if (c === "unmute") { await api.unmute(a.did); toast("Знову видно"); reloadView(); }
        if (c === "block" && await confirmBox(`Заблокувати @${a.handle}?`, "Заблокувати", true)) { await api.block(a.did); reloadView(); }
        if (c === "unblock") { await api.unblock(a.viewer.blocking); reloadView(); }
        if (c === "report") reportDialog({ $type: "com.atproto.admin.defs#repoRef", did: a.did });
        break;
      }

      case "saveFeed": {
        const uri = actEl.dataset.uri;
        const saved = (await api.getSavedFeeds()).some(i => i.value === uri);
        if (saved) { await api.unsaveFeed(uri); actEl.textContent = "+"; toast("Фід прибрано"); }
        else { await api.saveFeed(uri, true); actEl.textContent = "✓"; toast("Фід збережено і закріплено на головній"); }
        document.querySelector("#main")?.dispatchEvent(new Event("skybee:feedsChanged"));
        break;
      }
      case "unsaveFeed": await api.unsaveFeed(actEl.dataset.uri); $("#main").dispatchEvent(new Event("skybee:feedsChanged")); break;
      case "pinFeed": await api.togglePin(actEl.dataset.uri); $("#main").dispatchEvent(new Event("skybee:feedsChanged")); break;
      case "likeFeed": {
        if (actEl.dataset.like) { await api.deleteRecord("app.bsky.feed.like", actEl.dataset.like); actEl.dataset.like = ""; actEl.textContent = "♡"; }
        else { const r = await api.createRecord("app.bsky.feed.like", { subject: { uri: actEl.dataset.uri, cid: actEl.dataset.cid } }); actEl.dataset.like = r.uri; actEl.textContent = "♥"; }
        break;
      }

      case "markRead": await api.post("app.bsky.notification.updateSeen", { seenAt: new Date().toISOString() }); document.querySelectorAll(".unread").forEach(x => x.classList.remove("unread")); badges(); break;
      case "newDm": newDmDialog(); break;
      case "convoMenu": {
        const id = actEl.dataset.id, muted = actEl.dataset.muted === "1";
        const c = await menu(actEl, [{ act: "mute", label: muted ? "🔔 Увімкнути сповіщення" : "🔕 Вимкнути сповіщення" }, { act: "leave", label: "🚪 Вийти з чату", danger: true }]);
        if (c === "mute") { await api.chatPost(muted ? "chat.bsky.convo.unmuteConvo" : "chat.bsky.convo.muteConvo", { convoId: id }); toast("Готово"); reloadView(); }
        if (c === "leave" && await confirmBox("Вийти з цього чату? Історія зникне у вас.", "Вийти", true)) { await api.chatPost("chat.bsky.convo.leaveConvo", { convoId: id }); location.hash = "#/messages"; }
        break;
      }
      case "logout": if (await confirmBox("Вийти з акаунта?", "Вийти", true)) { api.logout(); location.hash = "#/"; boot(); } break;
    }
  } catch (ex) { toast(ex.message); }
  finally { if (actEl?.isConnected) actEl.disabled = false; }
});

/* ---------- dialogs ---------- */
function reportDialog(subject) {
  const R = [["com.atproto.moderation.defs#reasonSpam", "Спам"], ["com.atproto.moderation.defs#reasonMisleading", "Оманливий контент"],
    ["com.atproto.moderation.defs#reasonSexual", "Небажаний сексуальний контент"], ["com.atproto.moderation.defs#reasonRude", "Цькування, грубість"],
    ["com.atproto.moderation.defs#reasonViolation", "Порушення правил"], ["com.atproto.moderation.defs#reasonOther", "Інше"]];
  const m = modal(`<h3>Поскаржитись</h3>${R.map(([v, l], i) => `<label class="radio"><input type="radio" name="r" value="${v}" ${i === 0 ? "checked" : ""}> ${l}</label>`).join("")}
    <textarea placeholder="Деталі (необов'язково)" maxlength="2000" rows="3"></textarea>
    <div class="row end"><button class="ghost" data-x="0">Скасувати</button><button class="btn danger" data-x="1">Надіслати</button></div>`);
  m.addEventListener("click", async (e) => {
    const x = e.target.closest("[data-x]"); if (!x) return;
    if (x.dataset.x === "1") {
      try { await api.report(subject, m.querySelector("input:checked").value, m.querySelector("textarea").value || undefined); toast("Скаргу надіслано. Дякуємо!"); }
      catch (ex) { toast(ex.message); return; }
    }
    m.close();
  });
}

function newDmDialog() {
  const m = modal(`<h3>Нове повідомлення</h3><input type="search" placeholder="Пошук людей" autofocus><div class="results"></div>`);
  const inp = $("input", m), res = $(".results", m);
  let tm;
  inp.addEventListener("input", () => {
    clearTimeout(tm);
    tm = setTimeout(async () => {
      const q = inp.value.trim(); if (!q) { res.innerHTML = ""; return; }
      const d = await api.get("app.bsky.actor.searchActorsTypeahead", { q, limit: 8 });
      res.innerHTML = d.actors.map(a => `<button class="actor plain" data-did="${a.did}" ${a.associated?.chat?.allowIncoming === "none" ? "disabled title='Не приймає повідомлення'" : ""}>${avatar(a, 36)}<div class="who"><b>${esc(a.displayName || a.handle)}</b><span class="muted">@${esc(a.handle)}</span></div></button>`).join("");
    }, 250);
  });
  res.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-did]"); if (!b) return;
    try { await V.startDm(b.dataset.did); m.close(); } catch (ex) { toast(ex.message); }
  });
}

/* ---------- keyboard shortcuts ---------- */
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "n" && api.session && !document.querySelector(".modal-bg")) { e.preventDefault(); openComposer({}, reloadView); }
  if (e.key === "/" && api.session) { e.preventDefault(); location.hash = "#/search"; }
});

/* ---------- boot ---------- */
function boot() {
  api.loadSession();
  if (!api.session) return loginScreen();
  shell();
  route();
  badges();
  clearInterval(window.__skybeeBadge);
  window.__skybeeBadge = setInterval(badges, 60000);
}
boot();
