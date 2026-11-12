// Skybee — app shell, router, global actions
import * as api from "./api.js";
import * as V from "./views.js";
import * as notify from "./notify.js";
import { $, esc, posts, actors, pwa, toast, menu, confirmBox, modal, lightbox, attachVideo, webUrl, avatar, name, actionsBar, gateLine } from "./ui.js";
import { openComposer, openGateEditor } from "./compose.js";

try { document.documentElement.dataset.theme = localStorage.getItem("skybee.theme") || "dark"; } catch {}

const app = $("#app");
let cleanup = null;

// Caches, timers and open screens all belong to the active account: when it changes, start from a clean page
const restart = () => { location.hash = "#/"; location.reload(); };

/* ---------- login ---------- */
const LOGIN_FIELDS = `
  <input name="handle" placeholder="@нік або email" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required>
  <div class="seg">
    <label><input type="radio" name="kind" value="app" checked> Пароль застосунку</label>
    <label><input type="radio" name="kind" value="main"> Основний пароль</label>
  </div>
  <input name="pass" type="password" placeholder="xxxx-xxxx-xxxx-xxxx" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" required>
  <label class="showpass"><input type="checkbox" name="show"> Показати пароль</label>
  <input name="code" placeholder="Код із листа" autocomplete="one-time-code" autocapitalize="characters" hidden>
  <p class="hint" data-hint></p>
  <p class="err"></p>
  <button class="btn wide">Увійти</button>`;
const LOGIN_HINT = {
  app: "<b>Пароль застосунку</b> безпечніший: його створюють окремо (bsky.app → Налаштування → Конфіденційність і безпека → Паролі застосунків) і можна будь-коли відкликати. Для чатів постав галочку доступу до повідомлень.",
  main: "<b>Основний пароль</b> дає повний доступ до акаунта. Він надсилається лише на сервер Bluesky і в Skybee не зберігається. Якщо ввімкнено підтвердження поштою, знадобиться код із листа.",
};

function bindLogin(f) {
  const btn = $("button", f), err = $(".err", f);
  const sync = () => {
    const main = f.kind.value === "main";
    $("[data-hint]", f).innerHTML = LOGIN_HINT[f.kind.value];
    f.pass.placeholder = main ? "Основний пароль" : "xxxx-xxxx-xxxx-xxxx";
    f.pass.type = f.show.checked ? "text" : "password";
    if (!main) { f.code.hidden = true; f.code.value = ""; }
  };
  f.addEventListener("change", sync); sync();
  f.onsubmit = async (e) => {
    e.preventDefault();
    btn.disabled = true; err.textContent = ""; btn.textContent = "Вхід…";
    try {
      await api.login(f.handle.value, f.pass.value, { main: f.kind.value === "main", code: f.code.value });
      // a page reload needs the session in storage; where storage is blocked, carry on in memory
      let stored = false; try { stored = !!localStorage.getItem("skybee.session"); } catch {}
      if (stored) restart(); else { document.querySelectorAll(".modal-bg").forEach(m => m.remove()); location.hash = "#/"; boot(); }
    } catch (ex) {
      err.textContent = ex.message;
      if (ex.code === "AuthFactorTokenRequired") { f.kind.value = "main"; sync(); f.code.hidden = false; f.code.focus(); }
    }
    btn.disabled = false; btn.textContent = "Увійти";
  };
}

function loginScreen() {
  app.innerHTML = `
  <div class="login">
    <h1>🐝 Skybee</h1>
    <p class="muted">Клієнт для Bluesky</p>
    <form class="card loginform">
      <p class="hint">Достатньо ввести нік, наприклад <b>@lejk309</b>, або email акаунта. Якщо акаунт не на bsky.social (Eurosky, свій домен) — повний handle.</p>
      ${LOGIN_FIELDS}
      <hr>
      <p class="hint">Ще немає акаунта в Bluesky?</p>
      <a class="ghost wide" href="https://bsky.app" target="_blank" rel="noopener">Зареєструватися на bsky.app ↗</a>
    </form>
  </div>`;
  bindLogin($("form", app));
}

// One more account: after signing in it becomes the active one
function addAccountDialog() {
  const m = modal(`<h3>Додати акаунт</h3><form class="loginform">${LOGIN_FIELDS}</form>`);
  bindLogin($("form", m));
  $("input", m).focus();
}

/* ---------- shell ---------- */
const NAV = [
  ["#/", "🏠", "Головна"], ["#/search", "🔍", "Пошук"], ["#/notifications", "🔔", "Сповіщення", "nbadge"],
  ["#/messages", "💬", "Чати", "cbadge"], ["#/feeds", "#️⃣", "Фіди"], ["#/bookmarks", "🔖", "Закладки"],
  ["#/profile/me", "👤", "Профіль"], ["#/settings", "⚙️", "Налаштування"],
];
const meChip = () => {
  const me = actors.get(api.session.did) || api.session;
  return `${avatar(me, 36)}<span class="nl"><b>${name(me)}</b><small>@${esc(api.session.handle)}</small></span>`;
};
function shell() {
  app.innerHTML = `
  <nav class="side">
    <a class="logo" href="#/">🐝 <span>Skybee</span></a>
    ${NAV.map(([h, i, l, b]) => `<a href="${h}" data-nav="${h}"><span class="ni">${i}${b ? `<i class="dot" id="${b}"></i>` : ""}</span><span class="nl">${l}</span></a>`).join("")}
    <button class="btn compose-side" data-act="compose">✏️ <span>Новий пост</span></button>
    <button class="me" data-act="accountMenu" title="Акаунти">${meChip()}</button>
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
  let count = 0, convos = null;
  try {
    ({ count } = await api.get("app.bsky.notification.getUnreadCount"));
    for (const id of ["nbadge", "mnbadge"]) { const d = document.getElementById(id); if (d) { d.textContent = count > 30 ? "30+" : count || ""; d.hidden = !count; } }
  } catch {}
  try {
    ({ convos } = await api.chat("chat.bsky.convo.listConvos", { limit: 50 }));
    const c = convos.reduce((s, x) => s + (x.muted ? 0 : x.unreadCount), 0);
    for (const id of ["cbadge", "mcbadge"]) { const e = document.getElementById(id); if (e) { e.textContent = c || ""; e.hidden = !c; } }
  } catch {}
  notify.check(count, convos).catch(() => {});
}
window.addEventListener("skybee:badge", badges);

/* ---------- router ---------- */
async function route() {
  await api.prefsReady; // muted words must be known before the first post is drawn
  if (!api.session) return loginScreen();
  cleanup?.(); cleanup = null;
  document.querySelector(".popmenu")?.remove();
  document.querySelectorAll(".modal-bg").forEach(m => m.close ? m.close() : m.remove());
  const main = $("#main");
  if (!main) return; // signed in a moment ago, the page is about to reload
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
    else if (seg[0] === "settings") r = seg[1] === "words" ? V.mutedWords(main) : seg[1] ? V.modList(main, { kind: seg[1] }) : V.settings(main);
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

// «Who can reply» for an own thread. The app view learns about the change with a delay, so the line is redrawn from what was saved
function editGate(p) {
  openGateEditor(p, (allow, lists) => {
    p.threadgate = { ...p.threadgate, record: { ...p.threadgate?.record, allow }, lists };
    document.querySelectorAll(`.gate[data-uri="${CSS.escape(p.uri)}"]`).forEach(g => { g.outerHTML = gateLine(p, { mine: true }); });
    toast("Збережено");
  });
}

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
      case "showMuted": actEl.closest(".post").classList.remove("mw-hidden"); actEl.remove(); break;
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
      case "editGate": editGate(p); break;
      case "postMenu": {
        const mine = p.author.did === api.session.did;
        const c = await menu(actEl, [
          { act: "translate", label: "🌐 Перекласти" },
          { act: "copyText", label: "📋 Копіювати текст" },
          { act: "copyLink", label: "🔗 Копіювати посилання" },
          { act: "muteThread", label: "🔕 Приховати гілку" },
          "-",
          ...(mine ? [
            // the gate belongs to the first post of a thread, replies have none
            ...(p.record?.reply ? [] : [{ act: "gate", label: "💬 Хто може відповідати" }]),
            { act: "delete", label: "🗑️ Видалити пост", danger: true },
          ] : [
            { act: "muteUser", label: `🙈 Приховати @${p.author.handle}` },
            { act: "blockUser", label: `⛔ Заблокувати @${p.author.handle}`, danger: true },
            { act: "report", label: "🚩 Поскаржитись", danger: true },
          ]),
        ]);
        if (c === "translate") window.open(`https://translate.google.com/?sl=auto&tl=uk&text=${encodeURIComponent(p.record?.text || "")}`, "_blank");
        if (c === "copyText") { await navigator.clipboard.writeText(p.record?.text || ""); toast("Скопійовано"); }
        if (c === "copyLink") { await navigator.clipboard.writeText(webUrl(p)); toast("Посилання скопійовано"); }
        if (c === "muteThread") { await api.muteThread(p.record?.reply?.root?.uri || p.uri); toast("Гілку приховано"); }
        if (c === "gate") editGate(p);
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

      /* ----- accounts ----- */
      case "accountMenu": {
        const others = api.accounts.filter(a => a.did !== api.session.did);
        const c = await menu(actEl, [
          // the phone layout has no side menu: these screens are reachable only from here
          ...(matchMedia("(max-width: 640px)").matches
            ? [{ act: "#/feeds", label: "#️⃣ Фіди" }, { act: "#/bookmarks", label: "🔖 Закладки" }, { act: "#/settings", label: "⚙️ Налаштування" }, "-"] : []),
          ...others.map(a => ({ act: a.did, label: `↔️ @${esc(a.handle)}` })),
          { act: "add", label: "➕ Додати акаунт" },
        ]);
        if (c?.startsWith("#/")) location.hash = c;
        else if (c === "add") addAccountDialog();
        else if (c && api.switchAccount(c)) restart();
        break;
      }
      case "addAccount": addAccountDialog(); break;
      case "switchAccount": if (api.switchAccount(actEl.dataset.did)) restart(); break;
      case "removeAccount": {
        const a = api.accounts.find(a => a.did === actEl.dataset.did);
        if (a && await confirmBox(`Вийти з акаунта @${a.handle}?`, "Вийти", true)) { api.removeAccount(a.did); reloadView(); }
        break;
      }
      case "logout": if (await confirmBox(`Вийти з акаунта @${api.session.handle}?`, "Вийти", true)) { api.logout(); restart(); } break;
      case "install": {
        const prompt = pwa.install; pwa.install = null; actEl.hidden = true;
        if (prompt) { prompt.prompt(); await prompt.userChoice; }
        break;
      }
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

/* ---------- other tabs ---------- */
// Another tab refreshed the tokens, signed out or switched the account: take over what it saved
window.addEventListener("storage", (e) => {
  if (e.key !== "skybee.session" && e.key !== "skybee.accounts") return;
  if (e.key === "skybee.session" && !e.newValue) return location.reload(); // signed out there
  const was = api.session?.did;
  api.loadSession();
  if (api.session?.did !== was) location.reload();
});

/* ---------- PWA ---------- */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
  // a click on a system notification: sw.js asks the open tab to show the right screen
  navigator.serviceWorker.addEventListener("message", (e) => { if (e.data?.type === "skybee:open") location.hash = e.data.hash; });
}
window.addEventListener("beforeinstallprompt", (e) => {
  pwa.install = e;
  document.querySelector("[data-act=install]")?.removeAttribute("hidden");
});

/* ---------- boot ---------- */
function boot() {
  api.loadSession();
  if (!api.session) return loginScreen();
  api.primePrefs();
  shell();
  route();
  badges();
  clearInterval(window.__skybeeBadge);
  window.__skybeeBadge = setInterval(badges, 60000);
  // own profile: the avatar for the account button and the reply box
  api.get("app.bsky.actor.getProfile", { actor: api.session.did })
    .then(p => { actors.set(p.did, p); const me = $(".me"); if (me) me.innerHTML = meChip(); }).catch(() => {});
}
boot();
