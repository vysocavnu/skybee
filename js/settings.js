// Skybee — settings: the main list of sections and every section page. Nothing here sends the user to another site.
import { errText } from "./errors.js";
import * as api from "./api.js";
import { session } from "./api.js";
import { bee, $, esc, name, vname, at, avatar, empty, spinner, toast, modal, confirmBox, pwa, actors } from "./ui.js";
import { header } from "./views.js";
import { getLang } from "./compose.js";
import * as notify from "./notify.js";
import { PALETTE, inkFor } from "./flair.js";

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
const saved = (promise, undo) => promise.then(() => toast("Збережено"), (ex) => { toast(errText(ex), 5000); undo?.(); });
// the server refuses some account actions to an app password: say what to do instead of a bare error
const needMain = (ex) => ex.status === 401 || ex.status === 403 || /token|scope|privileged|Bad token/i.test(ex.message)
  ? "Ця дія потребує входу з основним паролем. Вийди й увійди знову, обравши «Основний пароль»." : errText(ex);

/* ---------- small icons (stroke, 24×24) ---------- */
const svg = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
const IC = {
  user: svg(`<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>`),
  users: svg(`<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5"/><circle cx="17" cy="7" r="2.5"/><path d="M17 12.5c2.8 0 4.5 1.7 4.5 4.5"/>`),
  lock: svg(`<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/>`),
  shield: svg(`<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>`),
  bell: svg(`<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>`),
  media: svg(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><circle cx="7" cy="6.5" r=".5"/>`),
  brush: svg(`<rect x="4" y="3" width="16" height="6" rx="1.5"/><path d="M12 9v3H7v3"/><rect x="5.5" y="15" width="3" height="6" rx="1"/>`),
  a11y: svg(`<circle cx="12" cy="12" r="9"/><circle cx="12" cy="7.5" r="1.2"/><path d="M8 10.5l4 1 4-1M12 11.5v3l-2 3.5M12 14.5l2 3.5"/>`),
  globe: svg(`<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>`),
  help: svg(`<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7"/><circle cx="12" cy="17" r=".6"/>`),
  info: svg(`<rect x="4" y="4" width="16" height="14" rx="2"/><path d="M9 18l3 3 3-3"/><path d="M12 8v.5M12 11v4"/>`),
  chev: svg(`<path d="M9 5l7 7-7 7"/>`),
};
const row = (href, icon, label, extra = "") =>
  `<a class="srow" href="${href}"><span class="sicon">${IC[icon]}</span><span class="grow">${label}</span>${extra}<span class="schev">${IC.chev}</span></a>`;
const toggle = (id, label, on, hint = "", disabled = false) =>
  `<label class="stoggle"><span class="grow">${label}${hint ? `<small class="muted">${hint}</small>` : ""}</span><input type="checkbox" id="${id}" ${on ? "checked" : ""} ${disabled ? "disabled" : ""}><i></i></label>`;
const seg = (attr, items, cur) => `<div class="seg">${items.map(([v, l]) => `<button data-${attr}="${v}" class="${v === cur ? "on" : ""}">${l}</button>`).join("")}</div>`;

/* ================= MAIN LIST ================= */
export async function index(el) {
  const me = actors.get(session.did) || session;
  const others = api.accounts.filter(a => a.did !== session.did);
  el.innerHTML = header("Налаштування") + `
    <a class="shead" href="#/profile/${encodeURIComponent(session.handle)}">${avatar(me, 88)}<b>${vname(me)}</b><span class="muted">${at(session.handle)}</span></a>
    <div class="sgroup">${row("#/settings/accounts", "users", others.length ? "Перемкнути акаунт" : "Акаунти на цьому пристрої",
      `<span class="savas">${others.slice(0, 3).map(a => avatar(actors.get(a.did) || a, 28)).join("")}</span>`)}</div>
    <div class="sgroup">
      ${row("#/settings/account", "user", "Акаунт")}
      ${row("#/settings/privacy", "lock", "Конфіденційність і безпека")}
      ${row("#/settings/moderation", "shield", "Модерація")}
      ${row("#/settings/notifs", "bell", "Сповіщення")}
      ${row("#/settings/media", "media", "Вміст і медіа")}
      ${row("#/settings/appearance", "brush", "Оформлення")}
      ${row("#/settings/a11y", "a11y", "Доступність")}
      ${row("#/settings/langs", "globe", "Мови")}
      ${row("#/settings/help", "help", "Довідка")}
      ${row("#/settings/about", "info", "Про Skybee")}
    </div>
    <div class="sgroup"><button class="srow danger" data-act="logout"><span class="grow">Вийти з ${at(session.handle)}</span></button></div>`;
  // my own profile may still be loading on the very first screen
  if (!actors.get(session.did)) api.get("app.bsky.actor.getProfile", { actor: session.did }).then(p => {
    actors.set(p.did, p);
    const h = $(".shead", el); if (h) h.innerHTML = `${avatar(p, 88)}<b>${vname(p)}</b><span class="muted">${at(session.handle)}</span>`;
  }).catch(() => {});
  // fresh avatars of the other accounts for the switch row
  if (others.length) api.get("app.bsky.actor.getProfiles", { actors: others.map(a => a.did).slice(0, 25) }).then(d => {
    d.profiles.forEach(p => actors.set(p.did, p));
    const box = $(".savas", el); if (box) box.innerHTML = others.slice(0, 3).map(a => avatar(actors.get(a.did) || a, 28)).join("");
  }).catch(() => {});
}

/* ================= ACCOUNTS ON THIS DEVICE ================= */
export async function accounts(el) {
  const draw = (profiles = []) => api.accounts.map(a => {
    const p = profiles.find(p => p.did === a.did) || actors.get(a.did) || a, active = a.did === session.did;
    return `<div class="accrow">${avatar(p, 44)}
      <div class="who"><b>${name(p)}</b><span class="muted small">${at(a.handle)}${active ? ` · сервер ${esc((a.pds || "").replace(/^https?:\/\//, ""))}` : ""}</span></div>
      ${active ? `<span class="pill">активний</span>`
        : `<button class="btn sm" data-act="switchAccount" data-did="${esc(a.did)}">Перемкнути</button><button class="ghost sm" data-act="removeAccount" data-did="${esc(a.did)}" title="Вийти з цього акаунта">✕</button>`}
    </div>`;
  }).join("");
  el.innerHTML = header("Акаунти", true) + `<div class="card"><div id="acclist">${draw()}</div>
    <button class="ghost sm" data-act="addAccount">➕ Додати акаунт</button>
    <p class="small muted">Тут усі акаунти, у які ви увійшли на цьому пристрої. Перемикатися можна без повторного входу.</p></div>`;
  api.get("app.bsky.actor.getProfiles", { actors: api.accounts.map(a => a.did).slice(0, 25) })
    .then(d => { const box = $("#acclist", el); if (box) box.innerHTML = draw(d.profiles); }).catch(() => {});
}

/* ================= ACCOUNT ================= */
// Asks for the code sent by e-mail (and more fields when given); resolves with their values or null
function codeDialog(title, text, fields = []) {
  return new Promise(res => {
    let done = false;
    const m = modal(`<h3>${title}</h3><p class="small muted">${text}</p>
      ${fields.map(f => `<label class="field">${f.label}<input data-f="${f.key}" type="${f.type || "text"}" ${f.type === "password" ? 'autocomplete="current-password"' : 'autocomplete="one-time-code" autocapitalize="characters"'} value="${esc(f.value || "")}"></label>`).join("")}
      <p class="err"></p><div class="row end"><button class="ghost" data-x="0">Скасувати</button><button class="btn" data-x="1">Далі</button></div>`,
      { onClose: () => { if (!done) res(null); } });
    $("input", m)?.focus();
    m.addEventListener("click", (e) => {
      const x = e.target.closest("[data-x]"); if (!x) return;
      if (x.dataset.x === "1") {
        const v = Object.fromEntries(fields.map(f => [f.key, $(`[data-f=${f.key}]`, m).value]));
        if (fields.some(f => !v[f.key].trim())) { $(".err", m).textContent = "Заповни всі поля"; return; }
        done = true; res(v);
      }
      m.close();
    });
  });
}

export async function account(el) {
  el.innerHTML = header("Акаунт", true) + spinner();
  const a = await api.getAccount();
  const birth = api.pref("personalDetailsPref").birthDate?.slice(0, 10) || "";
  el.innerHTML = header("Акаунт", true) + `
    <div class="card">
      <h3>Пошта</h3>
      ${a.email ? `<p>${esc(a.email)} ${a.emailConfirmed ? `<span class="pill">підтверджено</span>` : `<span class="pill">не підтверджено</span>`}</p>
        <div class="row wrap">${a.emailConfirmed ? "" : `<button class="btn sm" id="confirmEmail">Підтвердити</button>`}<button class="ghost sm" id="changeEmail">Змінити пошту</button></div>`
      : `<p class="small muted">З паролем застосунку пошту не видно. Щоб змінити пошту, увійди з основним паролем.</p>`}
    </div>
    <div class="card">
      <h3>Нік</h3>
      <p>${at(a.handle)} <span class="muted small">(${esc(a.handle)})</span></p>
      <form class="row" id="handleform"><input name="handle" placeholder="новий-нік або власний домен" autocapitalize="none" spellcheck="false" required><button class="btn sm">Змінити</button></form>
      <p class="small muted">Короткий нік отримає закінчення .bsky.social. Для власного домену спершу додай DNS-запис <code>_atproto</code> зі значенням <code>did=${esc(a.did)}</code>.</p>
    </div>
    <div class="card">
      <h3>Пароль</h3>
      <button class="ghost sm" id="pwreset" ${a.email ? "" : "disabled"}>Змінити основний пароль</button>
      <a class="rowlink" href="#/settings/passwords">Паролі застосунків →</a>
    </div>
    <div class="card">
      <h3>Дата народження</h3>
      <form class="row" id="birthform"><input type="date" name="birth" value="${esc(birth)}" max="${new Date().toISOString().slice(0, 10)}"><button class="btn sm">Зберегти</button></form>
      <p class="small muted">Видно лише вам. Від неї залежить доступ до контенту для дорослих.</p>
    </div>
    <div class="card">
      <h3>Мої дані</h3>
      <button class="ghost sm" id="export">⬇️ Завантажити архів (CAR)</button>
      <p class="small muted">Усі ваші пости, вподобання й підписки одним файлом. Медіафайли в архів не входять.</p>
      <p class="small muted">DID: <code>${esc(a.did)}</code><br>Сервер: <code>${esc(session.pds)}</code></p>
    </div>
    <div class="card">
      <h3>Деактивація та видалення</h3>
      <button class="ghost sm" id="deactivate">Деактивувати акаунт</button>
      <p class="small muted">Профіль і пости сховаються, доки ви не ввійдете знову.</p>
      <button class="ghost sm danger" id="delete">Видалити акаунт назавжди</button>
      <p class="small muted">Знадобляться основний пароль і код із пошти. Скасувати видалення неможливо.</p>
    </div>`;

  $("#confirmEmail", el)?.addEventListener("click", async (e) => {
    try {
      e.target.disabled = true;
      await api.requestEmailConfirmation();
      const v = await codeDialog("Підтвердження пошти", `Код надіслано на ${esc(a.email)}.`, [{ key: "code", label: "Код із листа" }]);
      if (v) { await api.confirmEmail(a.email, v.code); toast("Пошту підтверджено"); account(el); }
    } catch (ex) { toast(needMain(ex), 5000); }
    e.target.disabled = false;
  });
  $("#changeEmail", el)?.addEventListener("click", async (e) => {
    try {
      e.target.disabled = true;
      const { tokenRequired } = await api.requestEmailUpdate();
      const v = await codeDialog("Нова пошта", tokenRequired ? `Код надіслано на поточну адресу ${esc(a.email)}.` : "Введи нову адресу.",
        [{ key: "email", label: "Нова пошта", type: "email" }, ...(tokenRequired ? [{ key: "code", label: "Код із листа" }] : [])]);
      if (v) { await api.updateEmail(v.email.trim(), v.code); toast("Пошту змінено. Підтверди нову адресу."); account(el); }
    } catch (ex) { toast(needMain(ex), 5000); }
    e.target.disabled = false;
  });
  $("#handleform", el).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, btn = $("button", f);
    btn.disabled = true;
    try { await api.changeHandle(f.handle.value); toast("Нік змінено"); location.reload(); }
    catch (ex) { toast(needMain(ex), 5000); btn.disabled = false; }
  };
  $("#pwreset", el).onclick = async (e) => {
    try {
      e.target.disabled = true;
      await api.requestPasswordReset(a.email);
      const v = await codeDialog("Новий пароль", `Код надіслано на ${esc(a.email)}.`,
        [{ key: "code", label: "Код із листа" }, { key: "pass", label: "Новий пароль (щонайменше 8 символів)", type: "password" }]);
      if (v) {
        if (v.pass.length < 8) throw new Error("Пароль має містити щонайменше 8 символів");
        await api.resetPassword(v.code, v.pass); toast("Пароль змінено");
      }
    } catch (ex) { toast(errText(ex), 5000); }
    e.target.disabled = false;
  };
  $("#birthform", el).onsubmit = (e) => {
    e.preventDefault();
    const d = e.target.birth.value; if (!d) return;
    saved(api.updatePref("personalDetailsPref", { birthDate: new Date(d + "T00:00:00Z").toISOString() }));
  };
  $("#export", el).onclick = async (e) => {
    e.target.disabled = true;
    try {
      const url = URL.createObjectURL(await api.exportRepo()), link = document.createElement("a");
      link.href = url; link.download = `${a.handle}-${new Date().toISOString().slice(0, 10)}.car`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (ex) { toast(errText(ex)); }
    e.target.disabled = false;
  };
  $("#deactivate", el).onclick = async () => {
    if (!await confirmBox("Деактивувати акаунт? Профіль і пости зникнуть для всіх, доки ви не ввійдете знову.", "Деактивувати", true)) return;
    try { await api.deactivateAccount(); api.logout(); location.hash = "#/"; location.reload(); }
    catch (ex) { toast(needMain(ex), 5000); }
  };
  $("#delete", el).onclick = async () => {
    if (!await confirmBox(`Видалити акаунт @${a.handle} назавжди? Усі пости, підписки й повідомлення буде втрачено.`, "Далі", true)) return;
    try {
      await api.requestAccountDelete();
      const v = await codeDialog("Видалення акаунта", `Код надіслано на ${esc(a.email || "пошту акаунта")}. Це остання можливість передумати.`,
        [{ key: "code", label: "Код із листа" }, { key: "pass", label: "Основний пароль", type: "password" }]);
      if (!v) return;
      await api.deleteAccount(v.pass, v.code);
      api.logout(); location.hash = "#/"; location.reload();
    } catch (ex) { toast(needMain(ex), 5000); }
  };
}

/* ================= PRIVACY & SECURITY ================= */
export async function privacy(el) {
  el.innerHTML = header("Конфіденційність і безпека", true) + `
    <div class="card">
      <h3>Вхід</h3>
      <a class="rowlink" href="#/settings/passwords">Паролі застосунків →</a>
      ${toggle("twofa", "Підтвердження входу кодом із пошти", false, "При вході з основним паролем на пошту приходитиме код", true)}
    </div>
    <div class="card">
      <h3>Хто може</h3>
      <label class="field">Писати мені в чат<select id="chatacc" disabled><option value="all">Усі</option><option value="following">Ті, за ким я стежу</option><option value="none">Ніхто</option></select></label>
      <label class="field">Отримувати сповіщення про мої нові пости<select id="actacc" disabled><option value="followers">Мої читачі</option><option value="mutuals">Лише взаємні підписки</option><option value="none">Ніхто</option></select></label>
      <a class="rowlink" href="#/settings/media">Хто може відповідати на нові пости — у «Вміст і медіа» →</a>
    </div>
    <div class="card">
      ${toggle("noauth", "Просити не показувати мій акаунт без входу", false, "Застосунки й сайти, які це підтримують, не показуватимуть профіль і пости тим, хто не увійшов. Це прохання, а не захист: дані в Bluesky публічні.", true)}
    </div>`;
  api.getChatAccess().then(v => { const s = $("#chatacc", el); if (!s) return; s.value = v; s.disabled = false; s.onchange = () => saved(api.setChatAccess(s.value)); });
  api.getActivityAccess().then(v => { const s = $("#actacc", el); if (!s) return; s.value = v; s.disabled = false; s.onchange = () => saved(api.setActivityAccess(s.value)); });
  api.loggedOutHidden().then(on => {
    const c = $("#noauth", el); if (!c) return; c.checked = on; c.disabled = false;
    c.onchange = () => saved(api.setLoggedOutHidden(c.checked), () => { c.checked = !c.checked; });
  }).catch(() => {});
  // 2FA lives with the e-mail settings: turning it on or off needs a code from the inbox
  api.getAccount().then(a => {
    const c = $("#twofa", el); if (!c || !a.email) return;
    c.checked = !!a.emailAuthFactor; c.disabled = false;
    c.onchange = async () => {
      const want = c.checked;
      try {
        const { tokenRequired } = await api.requestEmailUpdate();
        const v = tokenRequired ? await codeDialog("Підтвердження", `Код надіслано на ${esc(a.email)}.`, [{ key: "code", label: "Код із листа" }]) : {};
        if (!v) { c.checked = !want; return; }
        await api.updateEmail(a.email, v.code, want); toast(want ? "Вхід із кодом увімкнено" : "Вхід із кодом вимкнено");
      } catch (ex) { c.checked = !want; toast(needMain(ex), 5000); }
    };
  }).catch(() => {});
}

/* ================= MODERATION ================= */
export async function moderation(el) {
  el.innerHTML = header("Модерація", true) + `
    <div class="sgroup">
      ${row("#/settings/content", "shield", "Фільтри контенту")}
      ${row("#/settings/words", "media", "Приховані слова й теги")}
      ${row("#/settings/mutes", "user", "Приховані акаунти")}
      ${row("#/settings/blocks", "lock", "Заблоковані акаунти")}
      ${row("#/settings/blocked-by", "lock", "Хто мене заблокував")}
      ${row("#/lists", "users", "Модераційні списки")}
    </div>
    <div class="card"><h3>🛡️ Сервіси модерації</h3><div data-labelers>${spinner()}</div>
      <p class="hint">Підписатися на інший сервіс можна на його профілі — там же налаштовуються його мітки. Знайти сервіси: пошук «labeler» або списки на кшталт bluesky-labelers.</p></div>
    <p class="pad small muted">Приховані акаунти не бачать, що ви їх приховали. Заблоковані не можуть бачити ваші пости й взаємодіяти з вами.</p>`;
  const box = $("[data-labelers]", el);
  try {
    await api.getPrefs(true); const views = await api.loadLabelers();
    const all = [{ creator: { did: api.BSKY_MOD, handle: "moderation.bsky.app", displayName: "Bluesky Moderation Service" }, always: true }, ...views];
    box.innerHTML = all.map(v => `<a class="actor" href="#/profile/${encodeURIComponent(v.creator.handle || v.creator.did)}">${avatar(v.creator, 36)}
      <div class="who"><b>${esc(v.creator.displayName || v.creator.handle)}</b><span class="muted small">${v.always ? "Увімкнено завжди" : `${(v.policies?.labelValues || []).length} міток`}</span></div></a>`).join("");
  } catch (ex) { box.innerHTML = `<p class="err">${esc(errText(ex))}</p>`; }
}

/* ================= NOTIFICATIONS ================= */
const NTYPES = [
  ["like", "Вподобання", true], ["repost", "Поширення", true], ["follow", "Нові читачі", true], ["reply", "Відповіді", true],
  ["mention", "Згадки", true], ["quote", "Цитати", true], ["likeViaRepost", "Вподобання ваших поширень", true],
  ["repostViaRepost", "Поширення ваших поширень", true], ["subscribedPost", "Нові пости тих, на кого підписані дзвіночком", false],
  ["starterpackJoined", "Приєднання через ваш стартовий набір", false], ["verified", "Верифікація", false],
];
export async function notifications(el) {
  el.innerHTML = header("Сповіщення", true) + `
    <div class="card">
      <h3>На цьому пристрої</h3>
      ${toggle("sysnotify", "Системні сповіщення", notify.enabled(), notify.supported()
        ? "Надходять, поки Skybee відкритий — у вкладці (навіть фоновій) або як встановлений застосунок."
        : "Цей браузер не підтримує системні сповіщення.", !notify.supported())}
    </div>
    <div class="card" id="nprefs"><h3>Що показувати в сповіщеннях</h3>${spinner()}</div>`;
  $("#sysnotify", el).onchange = async (e) => {
    if (!e.target.checked) { notify.disable(); return toast("Сповіщення вимкнено"); }
    if (await notify.enable()) return toast("Сповіщення увімкнено");
    e.target.checked = false;
    toast("Браузер не дозволив сповіщення. Дозволь їх для цього сайту в налаштуваннях браузера.", 5000);
  };
  const box = $("#nprefs", el);
  let prefs;
  try { prefs = await api.getNotifPrefs(); }
  catch (ex) { box.insertAdjacentHTML("beforeend", `<p class="err">${esc(errText(ex))}</p>`); box.querySelector(".sentinel")?.remove(); return; }
  box.innerHTML = `<h3>Що показувати в сповіщеннях</h3>` + NTYPES.map(([k, label, filter]) => {
    const p = prefs[k] || {}, on = p.list !== false;
    return `<div class="nprefrow">${toggle("n-" + k, label, on)}
      ${filter ? `<select data-include="${k}" ${on ? "" : "disabled"}><option value="all">від усіх</option><option value="follows" ${p.include === "follows" ? "selected" : ""}>лише від тих, за ким я стежу</option></select>` : ""}</div>`;
  }).join("") + `<div class="nprefrow"><label class="field">Нові повідомлення в чатах<select data-chat><option value="all">від усіх</option><option value="accepted" ${prefs.chat?.include === "accepted" ? "selected" : ""}>лише з прийнятих чатів</option></select></label></div>
    <p class="small muted">Налаштування зберігаються в акаунті й діють і в інших застосунках.</p>`;
  const put = (k, patch, undo) => saved(api.putNotifPrefs({ [k]: { ...(prefs[k] || {}), ...patch } }).then(() => { prefs[k] = { ...(prefs[k] || {}), ...patch }; }), undo);
  NTYPES.forEach(([k, , filter]) => {
    const c = $("#n-" + k, box);
    c.onchange = () => {
      const sel = $(`[data-include="${k}"]`, box); if (sel) sel.disabled = !c.checked;
      put(k, { list: c.checked, push: prefs[k]?.push ?? c.checked, ...(filter ? { include: prefs[k]?.include || "all" } : {}) }, () => { c.checked = !c.checked; });
    };
  });
  box.querySelectorAll("[data-include]").forEach(s => s.onchange = () => put(s.dataset.include, { include: s.value, list: true, push: prefs[s.dataset.include]?.push ?? true }));
  $("[data-chat]", box).onchange = (e) => put("chat", { include: e.target.value, push: prefs.chat?.push ?? true });
}

/* ================= CONTENT & MEDIA ================= */
export async function media(el) {
  await api.getPrefs().catch(() => {});
  const home = api.pref("feedViewPref", "home"), th = api.pref("threadViewPref");
  const tsort = ["oldest", "newest"].includes(th.sort) ? th.sort : "most-likes";
  const gate = api.defaultGate(), gateMode = !gate ? "all" : gate.length ? "some" : "none";
  el.innerHTML = header("Вміст і медіа", true) + `
    <div class="sgroup">${row("#/feeds", "media", "Мої фіди та їхній порядок")}</div>
    <div class="card">
      <h3>Стрічка «Підписки»</h3>
      ${[["hideReplies", "Приховувати відповіді"], ["hideReposts", "Приховувати поширення"], ["hideQuotePosts", "Приховувати цитати"]].map(([k, l]) => toggle("h-" + k, l, home[k])).join("")}
    </div>
    <div class="card">
      <h3>Гілки</h3>
      <label class="field">Порядок відповідей<select id="tsort">${[["most-likes", "Спершу популярні"], ["oldest", "Спершу старіші"], ["newest", "Спершу новіші"]].map(([v, l]) =>
        `<option value="${v}" ${v === tsort ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      ${toggle("tfollow", "Спершу відповіді від тих, за ким я стежу", !!th.prioritizeFollowedUsers)}
    </div>
    <div class="card">
      <h3>Нові пости</h3>
      <label class="field">Хто може відповідати за замовчуванням<select id="defgate">
        <option value="all" ${gateMode === "all" ? "selected" : ""}>Усі</option>
        <option value="follow" ${gateMode === "some" && gate.some(r => r.$type?.endsWith("followingRule")) ? "selected" : ""}>Ті, за ким я стежу</option>
        <option value="mention" ${gateMode === "some" && gate.every(r => r.$type?.endsWith("mentionRule")) ? "selected" : ""}>Лише згадані</option>
        <option value="none" ${gateMode === "none" ? "selected" : ""}>Ніхто</option></select></label>
      <p class="small muted">Для окремого поста це можна змінити в редакторі.</p>
    </div>
    <div class="card">
      <h3>Медіа</h3>
      ${toggle("autogif", "Автоматично відтворювати GIF", store.get("skybee.autogif") === "1")}
      <label class="field">Ключ Tenor API — для пошуку GIF<input id="tenorkey" autocomplete="off" spellcheck="false" placeholder="AIza…" value="${esc(store.get("skybee.tenorKey") || "")}"></label>
      <p class="small muted">Безплатний: Google Cloud Console → новий проєкт → увімкнути «Tenor API» → «Облікові дані» → «Створити ключ API». Зберігається лише на цьому пристрої.</p>
      ${toggle("players", "Вбудовані плеєри", store.get("skybee.players") !== "0", "YouTube, Spotify, SoundCloud, Vimeo, Twitch, Apple Music грають прямо в пості — після натискання ▶")}
      ${toggle("extmedia", "Показувати картки посилань із зображеннями", store.get("skybee.noLinkThumbs") !== "1")}
    </div>`;
  el.querySelectorAll("[id^=h-]").forEach(c => c.onchange = () => saved(api.updatePref("feedViewPref", { [c.id.slice(2)]: c.checked }, "home"), () => { c.checked = !c.checked; }));
  $("#tsort", el).onchange = (e) => saved(api.updatePref("threadViewPref", { sort: e.target.value }));
  $("#tfollow", el).onchange = (e) => saved(api.updatePref("threadViewPref", { prioritizeFollowedUsers: e.target.checked }), () => { e.target.checked = !e.target.checked; });
  $("#defgate", el).onchange = (e) => {
    const R = "app.bsky.feed.threadgate#";
    const rules = { all: undefined, none: [], follow: [{ $type: R + "followingRule" }, { $type: R + "mentionRule" }], mention: [{ $type: R + "mentionRule" }] }[e.target.value];
    saved(api.updatePref("postInteractionSettingsPref", { threadgateAllowRules: rules }));
  };
  $("#autogif", el).onchange = (e) => { store.set("skybee.autogif", e.target.checked ? "1" : null); toast("Збережено"); };
  $("#tenorkey", el).onchange = (e) => { store.set("skybee.tenorKey", e.target.value.trim() || null); toast(e.target.value.trim() ? "Ключ збережено — шукай GIF кнопкою «GIF» у редакторі" : "Ключ прибрано"); };
  $("#players", el).onchange = (e) => { store.set("skybee.players", e.target.checked ? null : "0"); toast("Збережено"); };
  $("#extmedia", el).onchange = (e) => { store.set("skybee.noLinkThumbs", e.target.checked ? null : "1"); document.body.classList.toggle("nolinkthumbs", !e.target.checked); toast("Збережено"); };
}

/* ================= APPEARANCE ================= */
export function applyLook() {
  const t = store.get("skybee.theme") || "dark";
  const sys = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  const root = document.documentElement, c = store.get("skybee.color");
  root.dataset.theme = t === "system" ? sys : t;
  // app colour: the same palette and look as the profile colour (js/flair.js), but for the whole app
  const ok = PALETTE.some(([p]) => p === c);
  root.classList.toggle("sb-theme", ok);
  if (ok) { root.style.setProperty("--sb", c); root.style.setProperty("--sb-ink", inkFor(c)); }
  else { root.style.removeProperty("--sb"); root.style.removeProperty("--sb-ink"); }
  // light theme on a deep colour has white text: let the browser draw inputs and scrollbars for a dark page
  root.style.colorScheme = ok && root.dataset.theme === "light" && inkFor(c) === "#ffffff" ? "dark" : "";
  document.body.style.fontSize = (store.get("skybee.font") || "15") + "px";
  document.body.classList.toggle("calm", store.get("skybee.calm") === "1");
  document.body.classList.toggle("nolinkthumbs", store.get("skybee.noLinkThumbs") === "1");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#0f1218");
}
export async function appearance(el) {
  const draw = () => {
    const theme = store.get("skybee.theme") || "dark", font = store.get("skybee.font") || "15", color = store.get("skybee.color") || "";
    el.innerHTML = header("Оформлення", true) + `
      <div class="card"><h3>Тема</h3>${seg("th", [["system", "Як у системі"], ["dark", "Темна"], ["dim", "Сутінки"], ["light", "Світла"]], theme)}</div>
      <div class="card"><h3>Колір</h3><p class="muted small">Ті самі кольори, що й в оформленні профілю.</p><div class="sb-swatches">${
        [["", "Звичайний (золотий)"], ...PALETTE].map(([c, n]) => `<button type="button" class="sb-sw${c ? "" : " none"}${c === color ? " on" : ""}" data-color="${c}" title="${n}" aria-label="${n}" style="background:${c || "#f5b301"}"></button>`).join("")}</div></div>
      <div class="card"><h3>Розмір тексту</h3>${seg("font", [["14", "Менший"], ["15", "Звичайний"], ["17", "Більший"], ["19", "Великий"]], font)}</div>`;
    el.querySelectorAll("[data-th]").forEach(b => b.onclick = () => { store.set("skybee.theme", b.dataset.th); applyLook(); draw(); });
    el.querySelectorAll("[data-color]").forEach(b => b.onclick = () => { store.set("skybee.color", b.dataset.color || null); applyLook(); draw(); });
    el.querySelectorAll("[data-font]").forEach(b => b.onclick = () => { store.set("skybee.font", b.dataset.font); applyLook(); draw(); });
  };
  draw();
}

/* ================= ACCESSIBILITY ================= */
export async function a11y(el) {
  el.innerHTML = header("Доступність", true) + `
    <div class="card">
      <h3>Опис зображень (ALT)</h3>
      ${toggle("reqalt", "Не публікувати фото й відео без опису", store.get("skybee.requireAlt") === "1", "Редактор нагадає додати опис для незрячих")}
    </div>
    <div class="card">
      <h3>Рух</h3>
      ${toggle("calm", "Зменшити анімацію", store.get("skybee.calm") === "1", "Без плавних переходів і анімацій")}
      ${toggle("noautogif", "Не відтворювати GIF самостійно", store.get("skybee.autogif") !== "1")}
    </div>
    <div class="sgroup">${row("#/settings/appearance", "brush", "Розмір тексту й тема")}</div>`;
  $("#reqalt", el).onchange = (e) => { store.set("skybee.requireAlt", e.target.checked ? "1" : null); toast("Збережено"); };
  $("#calm", el).onchange = (e) => { store.set("skybee.calm", e.target.checked ? "1" : null); applyLook(); toast("Збережено"); };
  $("#noautogif", el).onchange = (e) => { store.set("skybee.autogif", e.target.checked ? null : "1"); toast("Збережено"); };
}

/* ================= LANGUAGES ================= */
export const LANGS = [["uk", "Українська"], ["en", "English"], ["pl", "Polski"], ["be", "Беларуская"], ["ru", "Русский"], ["de", "Deutsch"],
  ["fr", "Français"], ["es", "Español"], ["it", "Italiano"], ["pt", "Português"], ["cs", "Čeština"], ["ja", "日本語"]];
export const translateLang = () => store.get("skybee.tlang") || "uk";
export async function langs(el) {
  const content = api.contentLangs();
  el.innerHTML = header("Мови", true) + `
    <div class="card"><h3>Мова інтерфейсу</h3><p class="small muted">Skybee поки розмовляє лише українською 🇺🇦</p></div>
    <div class="card"><h3>Мова моїх постів за замовчуванням</h3>
      <select id="deflang">${LANGS.map(([c, n]) => `<option value="${c}" ${c === getLang() ? "selected" : ""}>${n}</option>`).join("")}</select></div>
    <div class="card"><h3>Перекладати на</h3>
      <select id="tlang">${LANGS.map(([c, n]) => `<option value="${c}" ${c === translateLang() ? "selected" : ""}>${n}</option>`).join("")}</select></div>
    <div class="card"><h3>Мови вмісту</h3>
      <p class="small muted">Які мови показувати в тематичних фідах. Нічого не обрано — усі мови. На стрічку «Підписки» це не впливає.</p>
      ${LANGS.map(([c, n]) => `<label class="radio"><input type="checkbox" data-cl="${c}" ${content.includes(c) ? "checked" : ""}> ${n}</label>`).join("")}</div>`;
  $("#deflang", el).onchange = (e) => { store.set("skybee.lang", e.target.value); toast("Збережено"); };
  $("#tlang", el).onchange = (e) => { store.set("skybee.tlang", e.target.value); toast("Збережено"); };
  el.querySelectorAll("[data-cl]").forEach(c => c.onchange = () => {
    store.set("skybee.contentLangs", JSON.stringify([...el.querySelectorAll("[data-cl]:checked")].map(x => x.dataset.cl)));
    toast("Збережено");
  });
}

/* ================= HELP ================= */
export async function help(el) {
  el.innerHTML = header("Довідка", true) + `
    <div class="sgroup">${row("#/newcomers", "help", "🌱 Для новеньких: як усе працює, українські стрічки й списки")}</div>
    <div class="card"><h3>Клавіатура</h3>
      <p><kbd>N</kbd> — новий пост<br><kbd>/</kbd> — пошук<br><kbd>Ctrl</kbd> + <kbd>Enter</kbd> — опублікувати з редактора<br><kbd>Esc</kbd> — закрити вікно</p></div>
    <div class="card"><h3>Пароль застосунку чи основний?</h3>
      <p class="small">Пароль застосунку безпечніший: його можна будь-коли відкликати, і він не дає змінити пошту чи видалити акаунт. Створити його можна в <a href="#/settings/passwords">Паролях застосунків</a> (для цього треба один раз увійти з основним паролем). Щоб працювали чати, постав галочку доступу до повідомлень.</p></div>
    <div class="card"><h3>Гілка з кількох постів</h3>
      <p class="small">У редакторі натисни <b>＋</b> поруч із лічильником символів — з'явиться наступний пост гілки. Усі пости публікуються разом.</p></div>
    <div class="card"><h3>Чому немає сповіщень, коли Skybee закрито?</h3>
      <p class="small">Для справжніх push-сповіщень потрібен сервер, який стежить за мережею. Поки що Skybee показує сповіщення лише тоді, коли він відкритий (зокрема у фоновій вкладці або як встановлений застосунок).</p></div>
    <div class="card"><h3>Знайшли помилку?</h3>
      <p class="small">Напишіть про неї на <a href="https://github.com/vysocavnu/skybee/issues" target="_blank" rel="noopener">GitHub</a> — додайте скриншот і опис, що саме сталося.</p></div>`;
}

/* ================= ABOUT ================= */
export async function about(el) {
  el.innerHTML = header("Про Skybee", true) + `
    <div class="card center"><div class="aboutbee">${bee(110)}</div><h3>Skybee</h3>
      <p class="small muted">Відкритий клієнт для Bluesky. Без реклами, без трекерів, без збирання даних: усе зберігається у вашому акаунті Bluesky або в цьому браузері.</p>
      <a class="ghost sm" href="https://github.com/vysocavnu/skybee" target="_blank" rel="noopener">Код на GitHub</a>
      <button class="btn sm" data-act="install" ${pwa.install ? "" : "hidden"}>📲 Встановити як застосунок</button></div>
    ${window.skybeeDesktop?.update ? `<div class="card"><h3>Оновлення</h3>
      <p class="small muted" id="appver">Версія застосунку: …</p>
      <button class="btn sm" id="checkupd">Перевірити оновлення</button>
      <p class="small" id="updres" hidden></p></div>` : ""}
    <div class="card"><h3>Цей пристрій</h3>
      <button class="ghost sm" id="clearcache">Очистити кеш застосунку</button>
      <p class="small muted">Допомагає, якщо після оновлення щось виглядає дивно. Акаунти й налаштування залишаться.</p>
      <button class="ghost sm danger" id="resetlocal">Скинути налаштування цього пристрою</button>
      <p class="small muted">Тема, розмір тексту, мови й чернетка повернуться до початкових. Акаунти й налаштування в акаунті Bluesky не зміняться.</p></div>`;
  const upd = $("#checkupd", el);
  if (upd) {
    window.skybeeDesktop.version().then((v) => { $("#appver", el).textContent = `Версія застосунку: ${v}`; }).catch(() => {});
    upd.onclick = async () => {
      const res = $("#updres", el);
      upd.disabled = true; upd.textContent = "Перевіряю…"; res.hidden = true;
      let r;
      try { r = await window.skybeeDesktop.update(); } catch { r = { state: "error", code: "ipc" }; }
      upd.disabled = false; upd.textContent = "Перевірити оновлення";
      res.textContent = {
        latest: `✓ У тебе найновіша версія (${r.version}).`,
        downloading: `Знайдено версію ${r.version}. Вона завантажується у фоні (прогрес — на значку в панелі задач); коли буде готова, Skybee запропонує перезапуститися.`,
        ready: `Версія ${r.version} вже завантажена — перезапусти Skybee, щоб її встановити.`,
        flatpak: "Цю версію оновлює Flathub: відкрий «Програми» (GNOME Software чи Discover) або виконай flatpak update.",
        manual: "Ця збірка не оновлюється сама — завантаж нову версію зі сторінки релізів Skybee на GitHub.",
        dev: "Skybee запущено з вихідного коду — оновлення вимкнені.",
        error: `Не вдалося перевірити оновлення. Перевір підключення до інтернету й спробуй ще раз пізніше. (${r.code || "network"})`,
      }[r.state] || "";
      res.hidden = !res.textContent;
    };
  }
  $("#clearcache", el).onclick = async () => {
    try {
      for (const k of await caches.keys()) await caches.delete(k);
      for (const r of await navigator.serviceWorker?.getRegistrations?.() || []) await r.unregister();
    } catch {}
    location.reload();
  };
  $("#resetlocal", el).onclick = async () => {
    if (!await confirmBox("Скинути налаштування цього пристрою?", "Скинути", true)) return;
    for (const k of ["theme", "color", "font", "lang", "tlang", "contentLangs", "requireAlt", "calm", "autogif", "players", "tenorKey", "noLinkThumbs", "draft"]) store.set("skybee." + k, null);
    location.reload();
  };
}
