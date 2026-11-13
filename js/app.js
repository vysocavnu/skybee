// Skybee — app shell, router, global actions
import { errText } from "./errors.js";
import "./splash.js"; // the welcome scene, first of all
import { isNative, onLink } from "./native.js"; // Android/iOS app: links to the browser, the Back button, skybee:// links
import * as api from "./api.js";
import * as V from "./views.js";
import * as M from "./more.js";
import * as S from "./settings.js";
import * as notify from "./notify.js";
import * as flair from "./flair.js";
import * as D from "./deck.js";
import * as N from "./newbie.js";
import * as U from "./updates.js";
import { bee, isLive, $, esc, posts, actors, pwa, toast, menu, confirmBox, modal, lightbox, attachVideo, webUrl, avatar, name, actionsBar, gateLine, hiddenReplies, at, num, ico } from "./ui.js";
import { openComposer, openGateEditor } from "./compose.js";

try { S.applyLook(); } catch {}
matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", () => S.applyLook()); // «as in the system» follows the OS live

const app = $("#app");
let cleanup = null;

// Caches, timers and open screens all belong to the active account: when it changes, start from a clean page
const restart = () => { location.hash = "#/"; location.reload(); };
const hashQuery = () => new URLSearchParams(location.hash.split("?")[1] || "");
// the Skybee site: the apps open sign-up there, in the browser; it sends the user back with skybee://login?handle=…
const SITE = "https://vysocavnu.github.io/skybee/";
const inApp = () => !!window.skybeeDesktop || isNative;
const fullHandle = (h) => { h = String(h || "").trim().toLowerCase().replace(/^@/, "").replace(/[^a-z0-9.@-]/g, ""); return !h || h.includes(".") || h.includes("@") ? h : h + ".bsky.social"; };
// a login form opened after sign-up: the new handle is filled in, the main password chosen (there is no app password yet).
// Anyone can make such a link, so it says plainly whose handle it is and warns not to type a password by someone else's link
function prefillLogin(f, handle) {
  if (handle) f.handle.value = handle;
  f.kind.value = "main";
  f._hint = `Вхід у новий акаунт${handle ? ` <b>@${esc(handle)}</b>` : ""} з паролем, який ти задав(-ла) під час реєстрації. Пізніше можна перейти на пароль застосунку.
    <br>⚠️ Якщо ти щойно не реєструвався(-лася) — не вводь тут пароль: таке посилання могли надіслати, щоб його вкрасти.`; // stays while the main password is chosen
  f.dispatchEvent(new Event("change"));
  setTimeout(() => (handle ? f.pass : f.handle).focus(), 50);
}
// Before a password goes to a server that is not Bluesky's own (Eurosky, a self-hosted PDS…): once per server
const TRUSTED = "skybee.trustedPds";
async function confirmServer(host) {
  let list = []; try { list = JSON.parse(localStorage.getItem(TRUSTED)) || []; } catch {}
  if (list.includes(host)) return true;
  const ok = await confirmBox(`Цей акаунт живе не на серверах Bluesky, а на сервері ${host}. Пароль буде надіслано туди. Продовжуй, лише якщо знаєш цей сервер (наприклад, Eurosky чи свій). Якщо тебе привели сюди за чужим посиланням — це може бути крадіжка пароля.`, "Так, це мій сервер", true);
  if (ok) try { localStorage.setItem(TRUSTED, JSON.stringify([...list, host].slice(-20))); } catch {}
  return ok;
}

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
  app: "<b>Пароль застосунку</b> безпечніший: його можна будь-коли відкликати. Створити його можна прямо в Skybee (Налаштування → Конфіденційність і безпека → Паролі застосунків) після одного входу з основним паролем. Для чатів постав галочку доступу до повідомлень.",
  main: "<b>Основний пароль</b> дає повний доступ до акаунта. Він надсилається лише на сервер Bluesky і в Skybee не зберігається. Якщо ввімкнено підтвердження поштою, знадобиться код із листа.",
};

function bindLogin(f) {
  const btn = $("button", f), err = $(".err", f);
  const sync = () => {
    const main = f.kind.value === "main";
    $("[data-hint]", f).innerHTML = main && f._hint || LOGIN_HINT[f.kind.value];
    f.pass.placeholder = main ? "Основний пароль" : "xxxx-xxxx-xxxx-xxxx";
    f.pass.type = f.show.checked ? "text" : "password";
    if (!main) { f.code.hidden = true; f.code.value = ""; }
  };
  f.addEventListener("change", sync); sync();
  f.onsubmit = async (e) => {
    e.preventDefault();
    btn.disabled = true; err.textContent = ""; btn.textContent = "Вхід…";
    try {
      await api.login(f.handle.value, f.pass.value, { main: f.kind.value === "main", code: f.code.value, confirmServer });
      // a page reload needs the session in storage; where storage is blocked, carry on in memory
      let stored = false; try { stored = !!localStorage.getItem("skybee.session"); } catch {}
      if (stored) restart(); else { document.querySelectorAll(".modal-bg").forEach(m => m.remove()); location.hash = "#/"; boot(); }
    } catch (ex) {
      err.textContent = ex.code === "Cancelled" ? "" : errText(ex);
      if (ex.code === "AuthFactorTokenRequired") { f.kind.value = "main"; sync(); f.code.hidden = false; f.code.focus(); }
    }
    btn.disabled = false; btn.textContent = "Увійти";
  };
}

function loginScreen() {
  document.body.classList.remove("guest");
  app.innerHTML = `
  <div class="login">
    <div class="loginbee">${bee(120)}</div><h1>Skybee</h1>
    <p class="muted">Клієнт для Bluesky</p>
    <form class="card loginform">
      <p class="hint">Достатньо ввести нік, наприклад <b>@lejk309</b>, або email акаунта. Якщо акаунт не на bsky.social (Eurosky, свій домен) — повний handle.</p>
      ${LOGIN_FIELDS}
      <hr>
      <p class="hint">Ще немає акаунта в Bluesky?</p>
      <a class="ghost wide" href="#/signup">Створити акаунт</a>
    </form>
    <form class="card loginform" id="peek">
      <p class="hint"><b>Переглянути без входу.</b> Встав посилання на пост чи профіль з bsky.app або Skybee — гілку можна прочитати й поділитися нею без акаунта.</p>
      <input name="url" placeholder="https://bsky.app/profile/…/post/…" autocapitalize="none" spellcheck="false">
      <p class="err"></p>
      <button class="ghost wide">Відкрити</button>
    </form>
  </div>`;
  bindLogin($("form", app));
  const q = hashQuery();
  if (q.has("new")) prefillLogin($("form", app), fullHandle(q.get("handle")));
  const peek = $("#peek", app);
  peek.onsubmit = (e) => {
    e.preventDefault();
    const m = peek.url.value.trim().match(/profile\/([^/?#\s]+)(?:\/post\/([^/?#\s]+))?/);
    if (!m) { $(".err", peek).textContent = "Це не схоже на посилання на пост чи профіль"; return; }
    location.hash = `#/profile/${m[1]}${m[2] ? "/post/" + m[2] : ""}`;
  };
}

/* ---------- sign-up ----------
   In the apps (desktop, Android, iOS) sign-up opens in the browser: the Skybee site with ?app=1. When it is done, the
   site opens skybee://login?handle=… and the app shows the login form with the new handle filled in.
   bsky.social asks for a captcha that only Bluesky itself can run, so there the site sends the user to bsky.app and
   offers «back to Skybee» afterwards; other servers (Eurosky, your own PDS) are signed up right here. */
const needsCaptcha = (pds) => /(^|\.)bsky\.social$/.test(new URL(pds).hostname);
function signupScreen() {
  document.body.classList.remove("guest");
  if (inApp()) {
    app.innerHTML = `
    <div class="login">
      <div class="loginbee">${bee(90)}</div><h1>Новий акаунт</h1>
      <div class="card loginform">
        <p>Реєстрація відкриється в браузері. Коли закінчиш, браузер поверне тебе в Skybee — залишиться лише ввести пароль.</p>
        <button class="btn wide" data-open>Зареєструватися в браузері ↗</button>
        <p class="hint">Браузер спитає, чи відкрити Skybee, — дозволь.</p>
        <a class="ghost wide" href="#/login">← У мене вже є акаунт</a>
      </div>
    </div>`;
    $("[data-open]", app).onclick = () => window.open(SITE + "#/signup?app=1", "_blank");
    return;
  }
  const fromApp = hashQuery().get("app") === "1";
  const back = (h) => fromApp ? `skybee://login?handle=${encodeURIComponent(h)}` : `#/login?new=1&handle=${encodeURIComponent(h)}`;
  app.innerHTML = `
  <div class="login">
    <div class="loginbee">${bee(90)}</div><h1>Новий акаунт</h1>
    ${fromApp ? `<p class="muted">Реєстрація для застосунку Skybee — після неї повернешся в нього.</p>` : ""}
    <form class="card loginform" id="su" novalidate>
      <label class="field">Сервер<select name="srv"><option value="https://bsky.social">bsky.social — Bluesky</option><option value="other">Інший сервер…</option></select></label>
      <input name="custom" placeholder="https://мій-сервер.example" autocapitalize="none" hidden>
      <div data-steps hidden>
        <p class="small"><b>1.</b> На bsky.social потрібна перевірка «я не робот», яку проводить лише сам Bluesky, тож акаунт там створюється на bsky.app.</p>
        <a class="btn wide" href="https://bsky.app/" target="_blank" rel="noopener">Зареєструватися на bsky.app ↗</a>
        <p class="small"><b>2.</b> Коли акаунт буде готовий, повернися на цю вкладку${fromApp ? " — і назад у Skybee" : " й увійди"}:</p>
        <input name="newhandle" placeholder="твій новий нік (можна пропустити)" autocapitalize="none" autocorrect="off" spellcheck="false">
        <button type="button" class="btn wide" data-back>${fromApp ? "Повернутися в Skybee" : "Я зареєструвався(-лася) — увійти"}</button>
      </div>
      <div data-fields>
        <input name="email" type="email" placeholder="Email" autocomplete="email" required>
        <div class="row"><input name="handle" placeholder="нік" autocapitalize="none" autocorrect="off" spellcheck="false" required><select name="domain" style="width:auto"></select></div>
        <input name="pass" type="password" placeholder="Пароль (від 8 символів)" autocomplete="new-password" required>
        <label class="field">Дата народження<input name="birth" type="date" max="${new Date().toISOString().slice(0, 10)}" required></label>
        <input name="invite" placeholder="Код запрошення" hidden>
        <label class="check"><input type="checkbox" name="agree"> <span>Погоджуюся з <a data-terms target="_blank" rel="noopener">умовами</a> і <a data-privacy target="_blank" rel="noopener">політикою конфіденційності</a> сервера</span></label>
        <button class="btn wide">Створити акаунт</button>
      </div>
      <p class="err"></p>
      <a class="ghost wide" href="${fromApp ? "skybee://login" : "#/login"}">← У мене вже є акаунт</a>
    </form>
  </div>`;
  const f = $("#su", app), err = $(".err", f), btn = $("[data-fields] button.btn", f), steps = $("[data-steps]", f), fields = $("[data-fields]", f);
  let info = null, pds = "";
  $("[data-back]", f).onclick = () => { location.href = back(fullHandle(f.newhandle.value)); };
  const load = async () => {
    f.custom.hidden = f.srv.value !== "other";
    pds = f.srv.value === "other" ? f.custom.value.trim().replace(/\/$/, "") : f.srv.value;
    info = null; err.textContent = "";
    const captcha = /^https:\/\/[^/]+$/.test(pds) && needsCaptcha(pds);
    steps.hidden = !captcha; fields.hidden = captcha;
    if (captcha || !/^https:\/\/[^/]+$/.test(pds)) { f.domain.innerHTML = ""; return; }
    try {
      info = await api.describeServer(pds);
      f.domain.innerHTML = (info.availableUserDomains || []).map(d => `<option>${esc(d)}</option>`).join("");
      f.invite.hidden = !info.inviteCodeRequired;
      const web = (u) => (/^https?:\/\//i.test(u || "") ? u : pds); // the server chooses these links: only web pages
      $("[data-terms]", f).href = web(info.links?.termsOfService); $("[data-privacy]", f).href = web(info.links?.privacyPolicy);
    } catch (ex) { err.textContent = errText(ex); }
  };
  f.srv.onchange = load; f.custom.onchange = load; load();
  f.onsubmit = async (e) => {
    e.preventDefault(); err.textContent = "";
    if (!steps.hidden) return;
    const handle = f.handle.value.trim().toLowerCase().replace(/^@/, "");
    const birth = f.birth.value, age = birth ? (Date.now() - Date.parse(birth)) / 31557600000 : 0;
    if (!info) return err.textContent = "Обери сервер, що працює";
    if (!/^\S+@\S+\.\S+$/.test(f.email.value.trim())) return err.textContent = "Введи email";
    if (!/^[a-z0-9]([a-z0-9-]{1,16}[a-z0-9])$/.test(handle)) return err.textContent = "Нік: 3–18 латинських літер, цифр чи дефісів";
    if (f.pass.value.length < 8) return err.textContent = "Пароль — щонайменше 8 символів";
    if (!birth || age < 13) return err.textContent = birth ? "Bluesky можна користуватися з 13 років" : "Вкажи дату народження";
    if (info.inviteCodeRequired && !f.invite.value.trim()) return err.textContent = "Потрібен код запрошення";
    if (!f.agree.checked) return err.textContent = "Потрібна згода з умовами сервера";
    btn.disabled = true; btn.textContent = "Створення…";
    try {
      const full = handle + f.domain.value;
      await api.signup(pds, { email: f.email.value.trim(), handle: full, password: f.pass.value, inviteCode: f.invite.value.trim() });
      await api.updatePref("personalDetailsPref", { birthDate: new Date(birth).toISOString() }).catch(() => {});
      if (!fromApp) { toast("Акаунт створено 🐝 Підтвердь email з листа, коли зможеш"); restart(); return; }
      // back to the app: it asks for the password once more (a session is not passed through a link)
      f.innerHTML = `<h3>Акаунт створено 🐝</h3><p class="small">Повертаємо тебе в Skybee… Якщо нічого не сталося, натисни кнопку. Не забудь підтвердити email з листа.</p>
        <a class="btn wide" href="${back(full)}">Відкрити Skybee</a>`;
      location.href = back(full);
    } catch (ex) { err.textContent = errText(ex); btn.disabled = false; btn.textContent = "Створити акаунт"; }
  };
}

/* ---------- guest: reading shared threads and profiles without an account ---------- */
// Everything here comes from the public AppView; anything that writes asks to sign in
const guestRoute = () => {
  const seg = location.hash.slice(1).split("?")[0].split("/").filter(Boolean);
  return seg[0] === "profile" && seg[1] && seg[1] !== "me" && !["known", "likes"].includes(seg[2]) || seg[0] === "tag" && !!seg[1];
};
const GUEST_ACTS = new Set(["back", "unblur", "showMuted", "lightbox", "lightboxOne", "translate", "player", "retryVideo"]);
function guestShell() {
  document.body.classList.add("guest");
  app.innerHTML = `<header class="guestbar"><a class="logo" href="#/login">${bee(26)} <b>Skybee</b></a><span class="muted small grow">перегляд без входу</span><a class="btn sm" href="#/login">Увійти</a></header><main id="main"></main>`;
}

// One more account: after signing in it becomes the active one
function addAccountDialog(newHandle) {
  const m = modal(`<h3>Додати акаунт</h3><form class="loginform">${LOGIN_FIELDS}</form>`);
  bindLogin($("form", m));
  if (newHandle !== undefined) prefillLogin($("form", m), newHandle); else $("input", m).focus();
}

/* ---------- skybee://login?handle=… — back from sign-up in the browser ---------- */
function handleLink(url) {
  let u; try { u = new URL(url); } catch { return; }
  if (u.protocol !== "skybee:") return;
  const what = (u.host || u.pathname.replace(/^\/+/, "")).toLowerCase();
  if (what !== "login") return;
  const handle = fullHandle(u.searchParams.get("handle")).slice(0, 253);
  if (api.session) { addAccountDialog(handle); return; } // already signed in: the new account joins the others
  location.hash = `#/login?new=1${handle ? "&handle=" + encodeURIComponent(handle) : ""}`;
  loginScreen();
}
onLink(handleLink);

/* ---------- shell ---------- */
const NAV = [
  ["#/", "home", "Головна"], ["#/search", "search", "Пошук"], ["#/notifications", "bell", "Сповіщення", "nbadge"],
  ["#/messages", "chat", "Чати", "cbadge"], ["#/feeds", "hash", "Фіди"], ["#/deck", "deck", "Колонки"], ["#/lists", "list", "Списки"], ["#/bookmarks", "bookmark", "Закладки"],
  ["#/profile/me", "user", "Профіль"], ["#/settings", "settings", "Налаштування"],
];
const meChip = () => {
  const me = actors.get(api.session.did) || api.session;
  return `${avatar(me, 36)}<span class="nl"><b>${name(me)}</b><small>${at(api.session.handle)}</small></span>`;
};
// own profile card in the right column
function sideProfile(p) {
  if (!p) return `<div class="spinner"></div>`;
  const href = `#/profile/${encodeURIComponent(p.handle)}`;
  return `
    <a class="sp-banner" href="${href}" ${p.banner ? `style="background-image:url('${esc(p.banner)}')"` : ""}></a>
    <div class="sp-body">
      <a class="sp-ava" href="${href}">${avatar(p, 64)}</a>
      <a href="${href}" class="sp-name"><b>${name(p)}</b></a>
      <div class="muted small">${at(p.handle)}</div>
      <div class="sp-counts">
        <a href="${href}/followers"><b>${num(p.followersCount)}</b> читачів</a>
        <a href="${href}/follows"><b>${num(p.followsCount)}</b> підписок</a>
        <span><b>${num(p.postsCount)}</b> постів</span>
      </div>
      ${p.description ? `<div class="sp-bio small">${esc(p.description)}</div>` : ""}
      <div class="row sp-btns">
        <a class="ghost sm" href="${href}">Мій профіль</a>
        <button class="ghost sm" data-act="editProfile">Редагувати</button>
      </div>
    </div>`;
}

function shell() {
  app.innerHTML = `
  <nav class="side">
    <a class="logo" href="#/">${bee(34)} <span>Skybee</span></a>
    ${NAV.map(([h, i, l, b]) => `<a href="${h}" data-nav="${h}"><span class="ni">${ico(i)}${b ? `<i class="dot" id="${b}"></i>` : ""}</span><span class="nl">${l}</span></a>`).join("")}
    <button class="btn compose-side" data-act="compose">${ico("pen", 20)} <span>Новий пост</span></button>
    <button class="me" data-act="accountMenu" title="Акаунти">${meChip()}</button>
  </nav>
  <main id="main"></main>
  <aside class="right">
    <div class="card sideprof" id="sideProf">${sideProfile(actors.get(api.session.did))}</div>
    <div id="sidebox"></div>
    <div class="card small muted">${bee(16)} Skybee · <a href="https://github.com/vysocavnu/skybee" target="_blank" rel="noopener">GitHub</a></div>
  </aside>
  <nav class="bottom">${NAV.filter((_, i) => [0, 1, 3, 2, 8].includes(i)).map(([h, i, l, b]) => `<a href="${h}" data-nav="${h}" aria-label="${l}"><span class="ni">${ico(i, 26)}${b ? `<i class="dot" id="m${b}"></i>` : ""}</span><span class="bl">${l}</span></a>`).join("")}</nav>
  <button class="fab" data-act="compose" title="Новий пост">${ico("pen", 24)}<span class="fl">Новий пост</span></button>`;
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
  if (location.hash.startsWith("#/signup") && (!api.session || hashQuery().get("app") === "1")) return signupScreen();
  if (!api.session && !guestRoute()) return loginScreen();
  if (!api.session && !$("#main")) guestShell();
  cleanup?.(); cleanup = null;
  document.body.classList.remove("drawer");
  document.querySelector(".popmenu")?.remove();
  document.querySelectorAll(".modal-bg").forEach(m => m.close ? m.close() : m.remove());
  const main = $("#main");
  if (!main) return; // signed in a moment ago, the page is about to reload
  let [path, qs] = location.hash.slice(1).split("?");
  path = path || "/";
  const q = Object.fromEntries(new URLSearchParams(qs || ""));
  const seg = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (path === "/login" && api.session) { location.replace("#/"); return; }
  if (seg[0] === "profile" && seg[1] === "me") { location.replace(`#/profile/${api.session.handle}${seg.length > 2 ? "/" + seg.slice(2).join("/") : ""}`); return; }
  document.querySelectorAll("[data-nav]").forEach(a => {
    const h = a.dataset.nav.slice(1);
    // «/profile/me» is the own profile; only that link (a plain replace of "/me" also hit «/messages» → no active «Чати» tab)
    const want = h === "/profile/me" ? "/profile/" + api.session?.handle : h;
    a.classList.toggle("on", h === "/" ? path === "/" : path === want || path.startsWith(want + "/"));
  });
  document.documentElement.classList.remove("tab-min", "fab-min", "scrolled"); // a new screen starts with the full bars
  placeLens($("nav.bottom a.on"));
  main.innerHTML = "";
  document.body.classList.remove("deckmode");
  main._tint = null; // the page colour stays only if the new screen claims it (profile, post)
  let keepScroll = null; try { keepScroll = JSON.parse(sessionStorage.getItem("skybee.scroll:" + location.hash)); } catch {}
  scrollTo(0, 0);
  try {
    let r;
    if (path === "/") r = V.home(main);
    else if (seg[0] === "search") r = V.search(main, q);
    else if (seg[0] === "notifications") r = V.notifications(main, { filter: seg[1] });
    else if (seg[0] === "messages") r = seg[1] === "requests" ? V.messages(main, { requests: true }) : seg[1] ? V.convo(main, { id: seg[1] }) : V.messages(main);
    else if (seg[0] === "lists") r = M.lists(main);
    else if (seg[0] === "starter-packs" && seg[1] === "new") r = M.newStarterPack(main);
    else if (seg[0] === "starter-pack" && seg[2]) r = M.starterPack(main, { actor: seg[1], rkey: seg[2] });
    else if (seg[0] === "feeds") r = V.feeds(main);
    else if (seg[0] === "tag" && seg[1]) r = V.hashtag(main, { tag: seg[1], tab: seg[2] === "latest" ? "latest" : "top" });
    else if (seg[0] === "deck") r = D.deck(main);
    else if (seg[0] === "myfeeds" && seg[1]) r = D.myFeedEdit(main, { id: seg[1] });
    else if (seg[0] === "myfeeds") r = D.myFeeds(main);
    else if (seg[0] === "myfeed" && seg[1]) r = D.myFeedView(main, { id: seg[1] });
    else if (seg[0] === "feed") r = V.feed(main, { uri: seg[1] });
    else if (seg[0] === "list") r = V.list(main, { uri: seg[1] });
    else if (seg[0] === "bookmarks") r = V.bookmarks(main);
    else if (seg[0] === "newcomers") r = N.newcomers(main);
    else if (seg[0] === "settings") r = ({
      words: V.mutedWords, content: M.contentFilters, passwords: M.appPasswords, account: S.account, accounts: S.accounts, privacy: S.privacy,
      moderation: S.moderation, notifs: S.notifications, media: S.media, appearance: S.appearance, a11y: S.a11y, langs: S.langs, help: S.help, about: S.about,
    }[seg[1]] || (seg[1] === "mutes" || seg[1] === "blocks" ? (m) => V.modList(m, { kind: seg[1] }) : seg[1] === "blocked-by" ? V.blockedBy : S.index))(main);
    else if (seg[0] === "profile" && seg[2] === "post" && seg[4]) r = V.postUsers(main, { actor: seg[1], rkey: seg[3], kind: seg[4] });
    else if (seg[0] === "profile" && seg[2] === "post") r = V.thread(main, { actor: seg[1], rkey: seg[3], read: "read" in q });
    else if (seg[0] === "profile" && ["followers", "follows", "known"].includes(seg[2])) r = V.follows(main, { actor: seg[1], kind: seg[2] });
    else if (seg[0] === "profile") r = V.profile(main, { actor: seg[1], tab: seg[2] });
    else main.innerHTML = `<p class="pad">Сторінку не знайдено. <a href="#/">На головну</a></p>`;
    cleanup = await r;
    if (!main._tint) flair.untint(main);
    if (keepScroll) restoreScroll(keepScroll);
  } catch (e) {
    if (!main._tint) flair.untint(main);
    main.insertAdjacentHTML("beforeend", `<div class="card"><p class="err">${esc(errText(e))}</p><button class="ghost" data-act="back">← Назад</button></div>`);
  }
}
window.addEventListener("hashchange", route);
// other modules ask for the share and report dialogs that live here
window.addEventListener("skybee:share", (e) => shareDialog(...e.detail));
window.addEventListener("skybee:report", (e) => reportDialog(e.detail));
// pinned feeds changed: the right column's list and the home tabs are built again
window.addEventListener("skybee:tabsChanged", () => { V.forgetHomeTabs(); const b = $("#sidebox"); if (b) M.sidebar(b).catch(() => {}); });

/* ---------- bottom bar: the bubble under the current tab, and dragging a finger along the bar to switch tabs ---------- */
// The bubble (.navlens, shown in Liquid Glass) slides to the tab; holding the bar and moving along it carries the bubble
// with the finger, and letting go opens the tab under it — as the tab bar does on iPhone. Works in every style.
function placeLens(a) {
  const bar = $("nav.bottom"); if (!bar) return;
  let lens = bar.querySelector(".navlens");
  if (!lens) { lens = document.createElement("span"); lens.className = "navlens"; lens.setAttribute("aria-hidden", "true"); bar.prepend(lens); }
  if (!a || !a.offsetWidth) { lens.style.opacity = "0"; return; }
  lens.style.opacity = "1";
  const inset = 3; // a little air from the capsule edge, so the bubble never touches it or the search circle
  lens.style.width = a.offsetWidth - inset * 2 + "px";
  // from the boxes on screen, not offsetLeft: the same in every browser, whatever the tab's own scale or position
  const r = a.getBoundingClientRect(); // its centre: a pressed tab (scale .94) keeps its centre, not its edges
  const x = r.left + r.width / 2 - a.offsetWidth / 2 - bar.getBoundingClientRect().left - bar.clientLeft;
  lens.style.setProperty("--lx", Math.round(x + inset) + "px");
}
addEventListener("resize", () => placeLens($("nav.bottom a.on")));
// The tabs change size after the bubble was placed — fonts arrive, a badge appears, the bar collapses or expands —
// so it is placed again whenever the bar or a tab changes size, after the fonts load and after every bar animation
{
  const again = () => placeLens($("nav.bottom a.on"));
  let ro = null, watched = null;
  const watch = () => {
    const bar = $("nav.bottom");
    if (!bar || bar === watched || !window.ResizeObserver) return;
    watched = bar; ro?.disconnect();
    ro = new ResizeObserver(() => requestAnimationFrame(again));
    ro.observe(bar); bar.querySelectorAll("a").forEach(a => ro.observe(a));
    bar.addEventListener("transitionend", (e) => { if (e.target === bar || e.propertyName === "padding-right") again(); });
  };
  addEventListener("hashchange", () => setTimeout(watch));
  setTimeout(watch, 0); setTimeout(watch, 1500);
  document.fonts?.ready.then(again).catch(() => {});
}
// While reading, the chrome steps back:
// - Liquid Glass on a phone: scrolling down shrinks the tab capsule to the current tab, scrolling up (or reaching the top) brings it back
// - Material: the top app bar takes its «scrolled» colour, and the extended ✏️ «Новий пост» button shrinks to its icon (as in Gmail)
{
  let lastY = scrollY, acc = 0;
  addEventListener("scroll", () => {
    const r = document.documentElement, y = scrollY, d = y - lastY; lastY = y;
    acc = Math.sign(d) === Math.sign(acc) ? acc + d : d;
    r.classList.toggle("scrolled", y > 4);
    if (r.dataset.ui === "material") {
      if (acc > 30 && y > 120) r.classList.add("fab-min");
      else if (acc < -20 || y < 60) r.classList.remove("fab-min");
    } else r.classList.remove("fab-min");
    const on = $("nav.bottom a.on");
    // only on a tab screen (a settings page or a post has no tab to keep), and not on search, which has its own circle
    if (r.dataset.ui !== "glass" || !r.classList.contains("glass-float") || innerWidth > 640 || !on || on.dataset.nav === "#/search") return r.classList.remove("tab-min");
    const min = r.classList.contains("tab-min");
    if (!min && acc > 40 && y > 160) r.classList.add("tab-min");
    else if (min && (acc < -24 || y < 60)) r.classList.remove("tab-min");
    else return;
    setTimeout(() => placeLens($("nav.bottom a.on")), 380); // also on transitionend / resize of the tabs
  }, { passive: true });
}
{
  let drag = null;
  const tabAt = (bar, x) => [...bar.querySelectorAll("a")].find(a => { const r = a.getBoundingClientRect(); return x >= r.left && x <= r.right; });
  const stop = () => {
    if (!drag) return;
    drag.bar.classList.remove("dragging");
    drag.bar.querySelectorAll(".peek").forEach(a => a.classList.remove("peek"));
    drag = null;
  };
  addEventListener("pointerdown", (e) => {
    const bar = e.target.closest?.("nav.bottom");
    if (!bar || e.pointerType === "mouse") return;
    drag = { bar, x0: e.clientX, from: e.target.closest("a"), cur: e.target.closest("a"), moved: false };
  }, { passive: true });
  addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x0) < 10) return;
    drag.moved = true;
    drag.bar.classList.add("dragging");
    const a = tabAt(drag.bar, e.clientX);
    if (a && a !== drag.cur) {
      drag.cur?.classList.remove("peek");
      drag.cur = a; a.classList.add("peek");
      placeLens(a);
      navigator.vibrate?.(6);
    }
  }, { passive: true });
  const finish = () => {
    if (!drag) return;
    const { moved, cur, from } = drag;
    stop();
    if (moved && cur && cur !== from) location.hash = cur.getAttribute("href");
    else placeLens($("nav.bottom a.on"));
  };
  addEventListener("pointerup", finish, { passive: true });
  addEventListener("pointercancel", () => { stop(); placeLens($("nav.bottom a.on")); }, { passive: true });
  // iPhone does not always send pointerup/pointercancel to the bar (a system gesture, the screen changing under the finger):
  // the end of the touch, a screen change or leaving the app also end the drag, so the bubble never stays swollen
  addEventListener("touchend", () => setTimeout(finish, 40), { passive: true }); // pointerup normally comes first and has done it
  for (const ev of ["touchcancel", "hashchange", "blur"]) addEventListener(ev, () => { if (drag) { stop(); placeLens($("nav.bottom a.on")); } }, { passive: true });
  document.addEventListener("visibilitychange", () => { if (document.hidden && drag) stop(); });
}

/* ---------- Material ripple: a circle spreads from the finger on buttons and menu items (Settings → Appearance) ---------- */
addEventListener("pointerdown", (e) => {
  const r = document.documentElement;
  if (r.dataset.ui !== "material" || !r.classList.contains("m-ripple") || document.body.classList.contains("calm")) return;
  const t = e.target.closest?.(".btn, .ghost, .actions button, .srow, nav.side a, nav.bottom a, .tabs > *, .chip, .popmenu button, .seg button, .fab");
  if (!t || t.disabled) return;
  const b = t.getBoundingClientRect(), d = Math.max(b.width, b.height) * 2.2;
  const s = document.createElement("span");
  s.className = "ripple";
  s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - b.left - d / 2}px;top:${e.clientY - b.top - d / 2}px`;
  t.appendChild(s);
  setTimeout(() => s.remove(), 600);
}, { passive: true });

/* ---------- pull to refresh (touch screens) ---------- */
// At the very top of a screen, pulling down and letting go reloads it
{
  let y0 = null, dy = 0, ind = null;
  addEventListener("touchstart", (e) => {
    y0 = scrollY <= 0 && e.touches[0].clientX > 32 && !document.querySelector(".modal-bg, .msheet-bg") && !document.body.classList.contains("deckmode") && e.target.closest?.("main") ? e.touches[0].clientY : null;
    dy = 0;
  }, { passive: true });
  addEventListener("touchmove", (e) => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0 || scrollY > 0) { ind?.remove(); ind = null; return; }
    if (!ind) { ind = document.createElement("div"); ind.className = "ptr"; ind.textContent = "↻"; document.body.appendChild(ind); }
    const p = Math.min(dy / 80, 1);
    ind.style.transform = `translate(-50%, ${Math.min(dy, 110) * .6}px) rotate(${p * 270}deg)`;
    ind.classList.toggle("ready", p >= 1);
  }, { passive: true });
  addEventListener("touchend", () => {
    if (ind) {
      const go = ind.classList.contains("ready");
      ind.classList.add("spin"); setTimeout(() => { ind?.remove(); ind = null; }, go ? 700 : 0);
      if (go) route();
    }
    y0 = null;
  }, { passive: true });
}

/* ---------- coming back to a screen: the same place in the list ---------- */
// Remembered: the post at the top of the screen and how far it was scrolled past, plus plain scrollY as a fallback.
// Feeds are loaded again on return, so the place is found by that post: the list is read on until it shows up.
let restoring = 0;
function anchorNow() {
  const x = ($("#main")?.getBoundingClientRect().left || 0) + 80;
  for (const y of [70, 120, 200]) {
    const a = document.elementFromPoint(x, y)?.closest("[data-uri]");
    if (a) return { uri: a.dataset.uri, off: Math.round(a.getBoundingClientRect().top) };
  }
  return null;
}
let saveTimer = 0;
addEventListener("scroll", () => {
  if (restoring) return;
  clearTimeout(saveTimer);
  const h = location.hash;
  saveTimer = setTimeout(() => {
    if (h !== location.hash) return;
    try { sessionStorage.setItem("skybee.scroll:" + h, JSON.stringify({ y: scrollY, ...anchorNow() })); } catch {}
  }, 120);
}, { passive: true });
function restoreScroll(k) {
  if (typeof k === "number") k = { y: k };
  if (!k?.y) return;
  const h = location.hash, id = ++restoring, until = Date.now() + 8000;
  const stop = () => { if (restoring === id) restoring = 0; removeEventListener("wheel", stop); removeEventListener("touchstart", stop); removeEventListener("keydown", stop); };
  addEventListener("wheel", stop, { passive: true }); addEventListener("touchstart", stop, { passive: true }); addEventListener("keydown", stop);
  const step = () => {
    if (restoring !== id || location.hash !== h) return stop();
    const el = k.uri && document.querySelector(`#main [data-uri="${CSS.escape(k.uri)}"]`);
    if (el) { scrollTo(0, scrollY + el.getBoundingClientRect().top - (k.off ?? 70)); return stop(); }
    const max = document.documentElement.scrollHeight - innerHeight;
    if (!k.uri && max >= k.y) { scrollTo(0, k.y); return stop(); }
    scrollTo(0, Math.min(k.y, max)); // further down the list loads the next page
    if (Date.now() > until) return stop();
    setTimeout(step, 150);
  };
  setTimeout(step, 50);
}

/* ---------- helpers for actions ---------- */
// A link to the post in Skybee itself; the desktop app has no web address, so it gives the site's one
const skybeeUrl = (p) => (location.protocol.startsWith("http") ? location.origin + location.pathname : "https://vysocavnu.github.io/skybee/") +
  `#/profile/${encodeURIComponent(p.author?.handle || p.uri.split("/")[2])}/post/${p.uri.split("/").pop()}`;
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
  // phones: the side menu is a drawer; a tap outside it (or on one of its links) closes it
  if (document.body.classList.contains("drawer") && !t.closest("[data-act=drawer], .me") && (!t.closest("nav.side") || t.closest("a, .compose-side"))) {
    document.body.classList.remove("drawer");
    if (!t.closest("nav.side")) return;
  }
  const actEl = t.closest("[data-act]");
  const act = actEl?.dataset.act;

  if (!act) {
    const v = t.closest("video[data-src]"); if (v) { attachVideo(v); return; }
    // card navigation (ignore clicks on links, buttons, inputs, videos)
    if (t.closest("a, button, input, textarea, select, video, label, summary, details")) return;
    const card = t.closest("[data-href]");
    if (card && !getSelection().toString()) { location.hash = card.dataset.href; }
    return;
  }
  e.preventDefault(); e.stopPropagation();
  const p = postOf(actEl);
  if (!api.session && !GUEST_ACTS.has(act)) {
    if (act === "postMenu" && p) {
      const c = await menu(actEl, [{ act: "copyText", label: "📋 Копіювати текст" }, { act: "copySkybee", label: `${bee(18)} Копіювати посилання` }, { act: "copyLink", label: "🔗 Посилання на bsky.app" }, "-", { act: "login", label: "Увійти, щоб відповісти чи вподобати" }]);
      if (c === "copyText") { await navigator.clipboard.writeText(p.record?.text || ""); toast("Скопійовано"); }
      if (c === "copySkybee") { await navigator.clipboard.writeText(skybeeUrl(p)); toast("Посилання скопійовано"); }
      if (c === "copyLink") { await navigator.clipboard.writeText(webUrl(p)); toast("Посилання скопійовано"); }
      if (c === "login") location.hash = "#/login";
      return;
    }
    toast("Щоб це зробити, увійди в акаунт");
    return;
  }
  try {
    switch (act) {
      case "back": history.length > 1 ? history.back() : (location.hash = "#/"); break;
      case "compose": openComposer({}, reloadView); break;
      case "drawer": document.body.classList.toggle("drawer"); break;
      case "unblur": actEl.parentElement.classList.add("shown"); actEl.remove(); break;
      case "showMuted": actEl.closest(".post").classList.remove("mw-hidden"); actEl.remove(); break;
      case "lightbox": {
        const imgs = [...actEl.parentElement.querySelectorAll("img")];
        lightbox(imgs.map(i => i.dataset.full || i.src), +actEl.dataset.i, imgs.map(i => i.alt));
        break;
      }
      case "lightboxOne": lightbox([actEl.dataset.full]); break;
      case "retryVideo": { const box = actEl.closest(".video"); box.querySelector(".verr")?.remove(); attachVideo(box.querySelector("video")); break; }
      case "player": { // a video or music player from the link, in place of its card
        const w = actEl.closest(".playwrap");
        const f = document.createElement("iframe");
        f.src = actEl.dataset.src; f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write"; f.allowFullscreen = true;
        f.setAttribute("loading", "lazy"); f.referrerPolicy = "strict-origin-when-cross-origin";
        if (w.dataset.h) f.style.height = w.dataset.h + "px";
        w.innerHTML = ""; w.appendChild(f); w.classList.add("on");
        break;
      }

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
          ...(p.viewer?.embeddingDisabled ? [] : [{ act: "quote", label: "❝ Цитувати" }]),
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
      case "translate": window.open(`https://translate.google.com/?sl=auto&tl=${S.translateLang()}&text=${encodeURIComponent(p.record?.text || "")}`, "_blank"); break;
      case "editGate": editGate(p); break;
      case "postMenu": {
        const mine = p.author.did === api.session.did, my = `at://${api.session.did}/`;
        const rootUri = p.record?.reply?.root?.uri;
        const e = p.embed, quoted = e?.$type === "app.bsky.embed.record#view" ? e.record : e?.$type === "app.bsky.embed.recordWithMedia#view" ? e.record?.record : null;
        const art = actEl.closest("[data-feed]"), gen = art ? await api.feedGen(art.dataset.feed).catch(() => null) : null;
        const tune = gen?.acceptsInteractions;
        const c = await menu(actEl, [
          ...(tune ? [{ act: "more", label: "👍 Показувати більше такого" }, { act: "less", label: "👎 Показувати менше такого" }, "-"] : []),
          { act: "translate", label: "🌐 Перекласти" },
          { act: "copyText", label: "📋 Копіювати текст" },
          { act: "copyLink", label: "🔗 Копіювати посилання" },
          { act: "copySkybee", label: `${bee(18)} Посилання Skybee (відкривається й без входу)` },
          { act: "sendDm", label: "✉️ Надіслати в чат" },
          { act: "muteThread", label: p.viewer?.threadMuted ? "🔔 Не приховувати гілку" : "🔕 Приховати гілку" },
          "-",
          // the thread's author may hide a reply for everyone, the author of a quoted post may detach the quote
          ...(!mine && rootUri?.startsWith(my) ? [{ act: "hideReply", label: hiddenReplies.has(p.uri) ? "👁️ Показати відповідь усім" : "🙈 Приховати відповідь для всіх" }] : []),
          ...(!mine && quoted?.uri?.startsWith(my) && quoted.$type === "app.bsky.embed.record#viewRecord" ? [{ act: "detach", label: "✂️ Від'єднати мій пост від цитати" }] : []),
          ...(mine ? [
            { act: "pin", label: p.viewer?.pinned ? "📌 Відкріпити з профілю" : "📌 Закріпити в профілі" },
            { act: "gate", label: "💬 Хто може відповідати й цитувати" },
            { act: "delete", label: "🗑️ Видалити пост", danger: true },
          ] : [
            { act: "muteUser", label: `🙈 Приховати ${at(p.author.handle)}` },
            { act: "blockUser", label: `⛔ Заблокувати ${at(p.author.handle)}`, danger: true },
            { act: "report", label: "🚩 Поскаржитись", danger: true },
          ]),
        ]);
        if (c === "sendDm") peopleDialog("Надіслати пост у чат", async (did) => {
          const { convo } = await api.chat("chat.bsky.convo.getConvoForMembers", { members: [did] });
          await api.chatPost("chat.bsky.convo.sendMessage", { convoId: convo.id, message: { text: "", embed: { $type: "app.bsky.embed.record", record: api.strongRef(p) } } });
          toast("Надіслано ✉️");
        });
        if (c === "pin") { const on = !p.viewer?.pinned; await api.pinPost(p, on); p.viewer = { ...(p.viewer || {}), pinned: on }; toast(on ? "Закріплено в профілі" : "Відкріплено"); }
        if (c === "hideReply") {
          const hide = !hiddenReplies.has(p.uri);
          await api.hideReply(rootUri, p.uri, hide);
          hide ? hiddenReplies.add(p.uri) : hiddenReplies.delete(p.uri);
          toast(hide ? "Відповідь приховано для всіх" : "Відповідь знову видно"); reloadView();
        }
        if (c === "detach" && await confirmBox("Від'єднати ваш пост від цієї цитати? Замість нього там буде позначка «від'єднано».", "Від'єднати", true)) {
          await api.detachQuote(quoted.uri, p.uri); toast("Цитату від'єднано"); setTimeout(reloadView, 800);
        }
        if (c === "more" || c === "less") {
          await api.feedInteraction(gen, p.uri, c === "more", art.dataset.fctx || undefined);
          if (c === "less") { art.classList.add("fadeout"); setTimeout(() => art.remove(), 300); }
          toast(c === "more" ? `Фід «${gen.displayName}» показуватиме більше такого` : `Фід «${gen.displayName}» показуватиме менше такого`);
        }
        if (c === "translate") window.open(`https://translate.google.com/?sl=auto&tl=${S.translateLang()}&text=${encodeURIComponent(p.record?.text || "")}`, "_blank");
        if (c === "copyText") { await navigator.clipboard.writeText(p.record?.text || ""); toast("Скопійовано"); }
        if (c === "copyLink") { await navigator.clipboard.writeText(webUrl(p)); toast("Посилання скопійовано"); }
        if (c === "copySkybee") { await navigator.clipboard.writeText(skybeeUrl(p)); toast("Посилання скопійовано"); }
        if (c === "muteThread") {
          const on = !p.viewer?.threadMuted;
          await api.post(on ? "app.bsky.graph.muteThread" : "app.bsky.graph.unmuteThread", { root: rootUri || p.uri });
          p.viewer = { ...(p.viewer || {}), threadMuted: on }; toast(on ? "Гілку приховано: сповіщень із неї не буде" : "Гілку знову видно");
        }
        if (c === "gate") editGate(p);
        if (c === "delete" && await confirmBox("Видалити цей пост назавжди?", "Видалити", true)) {
          await api.deletePost(p.uri); document.querySelectorAll(`[data-uri="${CSS.escape(p.uri)}"]`).forEach(x => x.remove()); toast("Пост видалено");
        }
        if (c === "muteUser") { await api.mute(p.author.did); toast("Акаунт приховано"); }
        if (c === "blockUser" && await confirmBox(`Заблокувати ${at(p.author.handle)}?`, "Заблокувати", true)) { await api.block(p.author.did); toast("Заблоковано"); }
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
      case "editFlair": flair.edit(reloadView); break;
      case "editProfile": V.editProfile(actors.get(api.session.did) || {}, reloadView); break;
      case "shareMe": { const h = api.session.handle; shareDialog(`Профіль ${at(h)}`, `#/profile/${encodeURIComponent(h)}`, `https://bsky.app/profile/${h}`); break; }
      case "profileMenu": {
        const a = actors.get(actEl.dataset.did); const mine = a.did === api.session.did;
        const c = await menu(actEl, [
          { act: "share", label: "📤 Поділитися профілем" },
          { act: "search", label: "🔍 Шукати в постах" },
          ...(mine ? [isLive(a) ? { act: "endlive", label: "⏹️ Завершити ефір" } : { act: "live", label: "🔴 Я в ефірі" }] : []),
          { act: "lists", label: "📋 Додати до списків" },
          ...(mine ? [] : [
            ...(a.viewer?.following ? [{ act: "bell", label: a.viewer?.activitySubscription?.post ? "🔕 Не сповіщати про пости" : "🔔 Сповіщати про нові пости" }] : []),
            a.viewer?.muted ? { act: "unmute", label: "👁️ Показувати" } : { act: "mute", label: "🙈 Приховати" },
            a.viewer?.blocking ? { act: "unblock", label: "Розблокувати" } : { act: "block", label: "⛔ Заблокувати", danger: true },
            { act: "report", label: "🚩 Поскаржитись", danger: true },
          ]),
        ]);
        if (c === "share") shareDialog(`Профіль ${at(a.handle)}`, `#/profile/${encodeURIComponent(a.handle)}`, `https://bsky.app/profile/${a.handle}`);
        if (c === "live") liveDialog();
        if (c === "endlive") { await api.endLive(); toast("Ефір завершено"); setTimeout(reloadView, 800); }
        if (c === "search") location.hash = `#/search?q=${encodeURIComponent("from:" + a.handle + " ")}`;
        if (c === "lists") M.addToListsDialog(a);
        if (c === "bell") {
          const on = !a.viewer?.activitySubscription?.post;
          await api.subscribeActivity(a.did, on);
          a.viewer.activitySubscription = { post: on, reply: false }; toast(on ? "Сповіщатимемо про нові пости 🔔" : "Сповіщення вимкнено");
        }
        if (c === "mute") { await api.mute(a.did); toast("Приховано"); reloadView(); }
        if (c === "unmute") { await api.unmute(a.did); toast("Знову видно"); reloadView(); }
        if (c === "block" && await confirmBox(`Заблокувати ${at(a.handle)}?`, "Заблокувати", true)) { await api.block(a.did); reloadView(); }
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
        window.dispatchEvent(new Event("skybee:tabsChanged"));
        break;
      }
      case "unsaveFeed": await api.unsaveFeed(actEl.dataset.uri); $("#main").dispatchEvent(new Event("skybee:feedsChanged")); window.dispatchEvent(new Event("skybee:tabsChanged")); break;
      case "moveFeed": await api.moveFeed(actEl.dataset.uri, +actEl.dataset.dir); $("#main").dispatchEvent(new Event("skybee:feedsChanged")); window.dispatchEvent(new Event("skybee:tabsChanged")); break;
      case "pinFeed": await api.togglePin(actEl.dataset.uri); $("#main").dispatchEvent(new Event("skybee:feedsChanged")); window.dispatchEvent(new Event("skybee:tabsChanged")); break;
      case "likeFeed": {
        if (actEl.dataset.like) { await api.deleteRecord("app.bsky.feed.like", actEl.dataset.like); actEl.dataset.like = ""; actEl.textContent = "♡"; }
        else { const r = await api.createRecord("app.bsky.feed.like", { subject: { uri: actEl.dataset.uri, cid: actEl.dataset.cid } }); actEl.dataset.like = r.uri; actEl.textContent = "♥"; }
        break;
      }

      case "newList": M.listDialog(); break;
      case "listMenu": { const subject = await M.listMenu(actEl, actEl.dataset.uri); if (subject) reportDialog(subject); break; }
      case "listAddPeople": M.addPeopleDialog(actEl.dataset.uri); break;
      case "listRemove": await api.removeFromList(actEl.dataset.item); actEl.closest(".actor")?.remove(); toast("Прибрано зі списку"); break;
      case "convoLeave":
        if (await confirmBox("Відхилити запит і вийти з цього чату?", "Відхилити", true)) { await api.chatPost("chat.bsky.convo.leaveConvo", { convoId: actEl.dataset.id }); location.hash = "#/messages"; }
        break;

      case "markRead": await api.post("app.bsky.notification.updateSeen", { seenAt: new Date().toISOString() }); document.querySelectorAll(".unread").forEach(x => x.classList.remove("unread")); badges(); break;
      case "newDm": peopleDialog("Нове повідомлення", (did) => V.startDm(did)); break;
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
          ...others.map(a => ({ act: a.did, label: `↔️ ${at(a.handle)}` })),
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
        if (a && await confirmBox(`Вийти з акаунта ${at(a.handle)}?`, "Вийти", true)) { api.removeAccount(a.did); reloadView(); }
        break;
      }
      case "logout": if (await confirmBox(`Вийти з акаунта ${at(api.session.handle)}?`, "Вийти", true)) { api.logout(); restart(); } break;
      case "install": {
        const prompt = pwa.install; pwa.install = null; actEl.hidden = true;
        if (prompt) { prompt.prompt(); await prompt.userChoice; }
        break;
      }
    }
  } catch (ex) { toast(errText(ex)); }
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
      catch (ex) { toast(errText(ex)); return; }
    }
    m.close();
  });
}

// Share: the Skybee link (opens even without an account), the bsky.app link and a QR code to scan with a phone
export function shareDialog(title, hash, bskyUrl) {
  const sky = (location.protocol.startsWith("http") ? location.origin + location.pathname : "https://vysocavnu.github.io/skybee/") + hash;
  const m = modal(`<h3>📤 ${title}</h3>
    <div class="qr"><img alt="QR-код" src="https://api.qrserver.com/v1/create-qr-code/?size=440x440&margin=12&data=${encodeURIComponent(sky)}"></div>
    <p class="hint center">Наведи камеру телефона — відкриється в Skybee, навіть без входу</p>
    <div class="col" style="align-items:stretch">
      <button class="btn" data-copy="${esc(sky)}">${bee(18)} Копіювати посилання Skybee</button>
      ${bskyUrl ? `<button class="ghost wide" data-copy="${esc(bskyUrl)}">🔗 Копіювати посилання bsky.app</button>` : ""}
      ${navigator.share ? `<button class="ghost wide" data-native>Інші застосунки…</button>` : ""}
    </div>`);
  m.addEventListener("click", async (e) => {
    const c = e.target.closest("[data-copy]");
    if (c) { await navigator.clipboard.writeText(c.dataset.copy); toast("Скопійовано"); }
    if (e.target.closest("[data-native]")) navigator.share({ url: sky }).catch(() => {});
  });
}

// «I'm live»: a link to the stream and how long to show the badge
function liveDialog() {
  const m = modal(`<h3>🔴 Я в ефірі</h3>
    <p class="hint">Біля твоєї аватарки з'явиться мітка LIVE, а в профілі — посилання на трансляцію. Bluesky поки показує її лише для деяких сервісів (наприклад, Twitch) і не всім акаунтам.</p>
    <label class="field">Посилання на трансляцію<input name="uri" type="url" placeholder="https://twitch.tv/…" required></label>
    <label class="field">Назва (необов'язково)<input name="title" maxlength="120"></label>
    <label class="field">Скільки показувати<select name="min"><option value="30">30 хвилин</option><option value="60" selected>1 годину</option><option value="120">2 години</option><option value="240">4 години</option></select></label>
    <p class="err"></p><div class="row end"><button class="ghost" data-x="0">Скасувати</button><button class="btn" data-x="1">Почати</button></div>`);
  m.addEventListener("click", async (e) => {
    const x = e.target.closest("[data-x]"); if (!x) return;
    if (x.dataset.x === "0") return m.close();
    const uri = m.querySelector("[name=uri]").value.trim();
    if (!/^https:\/\//.test(uri)) { m.querySelector(".err").textContent = "Встав посилання, що починається з https://"; return; }
    x.disabled = true;
    try { await api.goLive(uri, m.querySelector("[name=title]").value.trim(), +m.querySelector("[name=min]").value); m.close(); toast("Ти в ефірі 🔴"); setTimeout(reloadView, 800); }
    catch (ex) { m.querySelector(".err").textContent = errText(ex); x.disabled = false; }
  });
}

// Pick a person to write to; onPick(did) may throw, the dialog then stays open
function peopleDialog(title, onPick) {
  const m = modal(`<h3>${title}</h3><input type="search" placeholder="Пошук людей" autofocus><div class="results"></div>`);
  const inp = $("input", m), res = $(".results", m);
  const row = (a) => `<button class="actor plain" data-did="${a.did}" ${a.associated?.chat?.allowIncoming === "none" ? "disabled title='Не приймає повідомлення'" : ""}>${avatar(a, 36)}<div class="who"><b>${esc(a.displayName || a.handle)}</b><span class="muted">${at(a.handle)}</span></div></button>`;
  // until something is typed: the people from recent chats
  api.chat("chat.bsky.convo.listConvos", { limit: 15 }).then(d => {
    if (inp.value.trim()) return;
    res.innerHTML = d.convos.map(c => c.members.find(x => x.did !== api.session.did)).filter(Boolean).map(row).join("");
  }).catch(() => {});
  let tm;
  inp.addEventListener("input", () => {
    clearTimeout(tm);
    tm = setTimeout(async () => {
      const q = inp.value.trim(); if (!q) { res.innerHTML = ""; return; }
      const d = await api.get("app.bsky.actor.searchActorsTypeahead", { q, limit: 8 });
      res.innerHTML = d.actors.map(row).join("");
    }, 250);
  });
  res.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-did]"); if (!b) return;
    b.disabled = true;
    try { await onPick(b.dataset.did); m.close(); } catch (ex) { toast(errText(ex)); b.disabled = false; }
  });
}

/* ---------- GIFs play by themselves when that is turned on ---------- */
const gifSeen = new IntersectionObserver((list) => {
  for (const e of list) {
    const v = e.target;
    if (e.isIntersecting) { if (!v.dataset.ready) attachVideo(v); else v.play().catch(() => {}); }
    else if (v.dataset.ready) v.pause();
  }
}, { threshold: 0.5 });
new MutationObserver(() => {
  let on = false; try { on = localStorage.getItem("skybee.autogif") === "1"; } catch {}
  if (!on) return;
  document.querySelectorAll("video[data-gif]:not([data-watched])").forEach(v => { v.dataset.watched = "1"; gifSeen.observe(v); });
}).observe(document.getElementById("app"), { childList: true, subtree: true });

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
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) { // the desktop app ships its own files, no service worker there
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
  if (location.hash.startsWith("#/signup") && hashQuery().get("app") === "1" && !inApp()) return signupScreen(); // sign-up for an app, in the browser
  if (!api.session) return location.hash.startsWith("#/signup") ? signupScreen() : guestRoute() ? (guestShell(), route()) : loginScreen();
  document.body.classList.remove("guest");
  api.primePrefs();
  shell();
  route();
  badges();
  M.sidebar($("#sidebox")).catch(() => {});
  clearInterval(window.__skybeeBadge);
  window.__skybeeBadge = setInterval(badges, 60000);
  // own profile: the avatar for the account button and the reply box
  api.get("app.bsky.actor.getProfile", { actor: api.session.did })
    .then(p => {
      actors.set(p.did, p); const me = $(".me"); if (me) me.innerHTML = meChip(); const sp = $("#sideProf"); if (sp) sp.innerHTML = sideProfile(p);
      // «Для новеньких»: in the menu for the first 6 months after sign-up (always reachable from Settings → Help)
      const prof = $('nav.side [data-nav="#/profile/me"]');
      if (N.isNewbie(p) && prof && !$('nav.side [data-nav="#/newcomers"]')) {
        prof.insertAdjacentHTML("beforebegin", `<a href="#/newcomers" data-nav="#/newcomers"><span class="ni">${ico("sprout")}</span><span class="nl">Для новеньких</span></a>`);
        if (location.hash.startsWith("#/newcomers")) $('nav.side [data-nav="#/newcomers"]').classList.add("on");
      }
    }).catch(() => {});
  const sp = $("#sideProf"); if (sp) flair.paint(sp, api.session.did); // own Skybee colour on the profile card
  setTimeout(() => U.autoCheck().catch(() => {}), 5000); // phones: a new version (or beta build) to download?
}
boot();
