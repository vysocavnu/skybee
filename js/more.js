// Skybee — more screens: lists, starter packs, content filters, account, app passwords
import { locale as LOC, t as T } from "./i18n.js";
import { errText } from "./errors.js";
import * as api from "./api.js";
import { session } from "./api.js";
import { $, esc, enc, num, name, vname, avatar, richText, renderActor, renderFeedCard, empty, spinner, toast, modal, menu, confirmBox, profileHref, actors, at, ico } from "./ui.js";
import { header, paged, renderListCard, homeTabs } from "./views.js";

const reload = () => window.dispatchEvent(new Event("hashchange"));

/* ================= LISTS ================= */
export async function lists(el) {
  el.innerHTML = header("Списки", false, `<a class="ghost sm" href="#/starter-packs/new" title="Новий стартовий набір">🎒 Набір</a><button class="btn sm" data-act="newList">＋ Новий</button>`) +
    `<p class="pad small muted">Звичайний список — це власна стрічка з обраних людей, її можна закріпити на головній. Модераційний — щоб разом приховати чи заблокувати групу акаунтів.</p>`;
  return paged(el, async (cursor) => {
    const d = await api.get("app.bsky.graph.getLists", { actor: session.did, limit: 50, cursor });
    return { html: d.lists.map(renderListCard), cursor: d.cursor };
  });
}

// Create a list, or edit `list` (a list view) when given
export function listDialog(list) {
  const m = modal(`<h3>${list ? "Редагувати список" : "Новий список"}</h3>
    ${list ? "" : `<div class="seg"><label><input type="radio" name="purpose" value="${api.CURATE}" checked> Звичайний</label><label><input type="radio" name="purpose" value="${api.MODLIST}"> Модераційний</label></div>`}
    <label class="field">Назва<input data-f="name" maxlength="64" value="${esc(list?.name || "")}"></label>
    <label class="field">Опис<textarea data-f="desc" maxlength="300" rows="3">${esc(list?.description || "")}</textarea></label>
    <label class="field">Зображення<input type="file" accept="image/*" data-f="avatar"></label>
    <p class="err"></p>
    <div class="row end"><button class="ghost" data-x="0">Скасувати</button><button class="btn" data-x="1">Зберегти</button></div>`);
  m.addEventListener("click", async (e) => {
    const x = e.target.closest("[data-x]"); if (!x) return;
    if (x.dataset.x === "0") return m.close();
    const nm = $("[data-f=name]", m).value.trim(), description = $("[data-f=desc]", m).value.trim(), file = $("[data-f=avatar]", m).files[0];
    if (!nm) { $(".err", m).textContent = "Вкажи назву"; return; }
    x.disabled = true;
    try {
      const patch = { name: nm, description: description || undefined };
      if (file) patch.avatar = await api.uploadBlob((await api.prepareImage(file, 1000)).blob);
      if (list) { await api.updateList(list.uri, patch); m.close(); toast("Список оновлено"); setTimeout(reload, 600); }
      else {
        const r = await api.createRecord("app.bsky.graph.list", { ...patch, purpose: m.querySelector("[name=purpose]:checked").value });
        m.close(); toast("Список створено"); location.hash = `#/list/${enc(r.uri)}`;
      }
    } catch (ex) { $(".err", m).textContent = errText(ex); x.disabled = false; }
  });
}

export async function listMenu(anchor, uri) {
  const l = (await api.get("app.bsky.graph.getList", { list: uri, limit: 1 })).list;
  const mine = l.creator.did === session.did, mod = l.purpose === api.MODLIST;
  const web = `https://bsky.app/profile/${l.creator.handle}/lists/${uri.split("/").pop()}`;
  const c = await menu(anchor, [
    { act: "copy", label: "🔗 Копіювати посилання" },
    ...(mine ? [{ act: "edit", label: "✏️ Редагувати" }, { act: "delete", label: "🗑️ Видалити список", danger: true }] : []),
    ...(mod ? [
      { act: "mute", label: l.viewer?.muted ? "👁️ Більше не приховувати учасників" : "🙈 Приховати всіх учасників" },
      { act: "block", label: l.viewer?.blocked ? "Розблокувати учасників" : "⛔ Заблокувати всіх учасників", danger: !l.viewer?.blocked },
    ] : []),
    ...(mine ? [] : [{ act: "report", label: "🚩 Поскаржитись", danger: true }]),
  ]);
  if (c === "copy") { await navigator.clipboard.writeText(web); toast("Скопійовано"); }
  if (c === "edit") listDialog(l);
  if (c === "delete" && await confirmBox(`Видалити список «${l.name}»?`, "Видалити", true)) { await api.deleteList(uri); toast("Список видалено"); location.hash = "#/lists"; }
  if (c === "mute") { await api.muteList(uri, !l.viewer?.muted); toast("Готово"); reload(); }
  if (c === "block") {
    if (l.viewer?.blocked) await api.unblockList(l.viewer.blocked);
    else if (await confirmBox(`Заблокувати всіх учасників списку «${l.name}»?`, "Заблокувати", true)) await api.blockList(uri); else return null;
    toast("Готово"); setTimeout(reload, 600);
  }
  return c === "report" ? { $type: "com.atproto.repo.strongRef", uri: l.uri, cid: l.cid } : null; // the caller opens the report dialog
}

// Search for people and add them to my list
export function addPeopleDialog(listUri) {
  const m = modal(`<h3>Додати до списку</h3><input type="search" placeholder="Пошук людей"><div class="results"></div>
    <div class="row end"><button class="btn" data-x>Готово</button></div>`, { onClose: reload });
  const inp = $("input", m), res = $(".results", m);
  inp.focus();
  let tm;
  inp.addEventListener("input", () => {
    clearTimeout(tm);
    tm = setTimeout(async () => {
      const q = inp.value.trim(); if (!q) { res.innerHTML = ""; return; }
      try {
        const d = await api.get("app.bsky.actor.searchActorsTypeahead", { q, limit: 8 });
        res.innerHTML = d.actors.map(a => `<div class="actor static">${avatar(a, 36)}<div class="who"><b>${name(a)}</b><span class="muted small">${at(a.handle)}</span></div>
          <button class="ghost sm" data-add="${esc(a.did)}">Додати</button></div>`).join("");
      } catch (ex) { toast(errText(ex)); }
    }, 250);
  });
  m.addEventListener("click", async (e) => {
    if (e.target.closest("[data-x]")) return m.close();
    const b = e.target.closest("[data-add]"); if (!b) return;
    b.disabled = true;
    try { await api.addToList(listUri, b.dataset.add); b.textContent = "✓ Додано"; } catch (ex) { toast(errText(ex)); b.disabled = false; }
  });
}

// Tick the lists of mine that an account belongs to
export async function addToListsDialog(actor) {
  const m = modal(`<h3>Списки для ${at(actor.handle)}</h3><div class="results">${spinner()}</div>
    <div class="row between" style="margin-top:12px"><button class="ghost sm" data-act="newList">＋ Новий список</button><button class="btn" data-x>Готово</button></div>`);
  const res = $(".results", m);
  m.addEventListener("click", e => { if (e.target.closest("[data-x]")) m.close(); });
  let rows;
  try { rows = await api.listsWithMember(actor.did); } catch (ex) { res.innerHTML = `<p class="err">${esc(errText(ex))}</p>`; return; }
  res.innerHTML = rows.map((r, i) => `<label class="radio"><input type="checkbox" data-i="${i}" ${r.item ? "checked" : ""}> ${esc(r.list.name)}
    <span class="muted small">${r.list.purpose === api.MODLIST ? "модераційний" : ""}</span></label>`).join("") || empty("У вас ще немає списків");
  res.addEventListener("change", async (e) => {
    const r = rows[e.target.dataset.i], box = e.target;
    box.disabled = true;
    try {
      if (box.checked) r.item = (await api.addToList(r.list.uri, actor.did)).uri;
      else { await api.removeFromList(r.item); r.item = null; }
    } catch (ex) { toast(errText(ex)); box.checked = !box.checked; }
    box.disabled = false;
  });
}

/* ================= STARTER PACK ================= */
// New starter pack: name, a few words, people (you are always in it) and up to 3 feeds
export async function newStarterPack(el) {
  const people = new Map(), feeds = new Set();
  el.innerHTML = header("Новий стартовий набір", true) + `
    <form class="card builder">
      <p class="hint">Набір допомагає новачкам знайти цікавих людей і фіди: за посиланням на нього можна підписатися на всіх одразу.</p>
      <label class="field">Назва<input name="name" maxlength="50" required placeholder="Наприклад: Українські ілюстратори"></label>
      <label class="field">Опис<textarea name="desc" maxlength="300" rows="3" placeholder="Про кого цей набір"></textarea></label>
      <div class="field">Люди (до 150; ти вже є в наборі)<input type="search" data-q placeholder="Пошук людей"><div class="results" data-res></div><div data-people></div></div>
      <div class="field">Фіди (до 3)<div data-feeds>${spinner()}</div></div>
      <p class="err"></p><div class="row end"><button class="btn">Створити набір</button></div>
    </form>`;
  const form = $("form", el), res = $("[data-res]", el), q = $("[data-q]", el), err = $(".err", el);
  const drawPeople = () => { $("[data-people]", el).innerHTML = [...people.values()].map(a => `<div class="srcrow">${avatar(a, 24)} <span class="grow clip">${name(a)} <small class="muted">${at(a.handle)}</small></span><button type="button" class="ghost sm" data-unp="${a.did}">✕</button></div>`).join(""); };
  let tm;
  q.addEventListener("input", () => {
    clearTimeout(tm);
    const v = q.value.trim(); if (!v) { res.innerHTML = ""; return; }
    tm = setTimeout(async () => {
      const d = await api.get("app.bsky.actor.searchActorsTypeahead", { q: v, limit: 6 }).catch(() => ({ actors: [] }));
      res.innerHTML = d.actors.filter(a => a.did !== session.did).map(a => { actors.set(a.did, a); return `<button type="button" class="actor plain" data-addp="${a.did}">${avatar(a, 32)}<div class="who"><b>${name(a)}</b><span class="muted">${at(a.handle)}</span></div></button>`; }).join("");
    }, 250);
  });
  form.addEventListener("click", (e) => {
    const add = e.target.closest("[data-addp]"), un = e.target.closest("[data-unp]");
    if (add) { if (people.size >= 149) return toast("Максимум 150 людей"); people.set(add.dataset.addp, actors.get(add.dataset.addp)); res.innerHTML = ""; q.value = ""; q.focus(); drawPeople(); }
    if (un) { people.delete(un.dataset.unp); drawPeople(); }
  });
  try {
    const saved = (await api.getSavedFeeds()).filter(i => i.type === "feed").map(i => i.value);
    const gens = saved.length ? (await api.get("app.bsky.feed.getFeedGenerators", { feeds: saved })).feeds : [];
    $("[data-feeds]", el).innerHTML = gens.length ? gens.map(g => `<label class="check"><input type="checkbox" value="${esc(g.uri)}"> ${esc(g.displayName)}</label>`).join("") : `<p class="hint">Збережених фідів немає</p>`;
  } catch { $("[data-feeds]", el).innerHTML = ""; }
  $("[data-feeds]", el).addEventListener("change", (e) => {
    const c = e.target; if (c.type !== "checkbox") return;
    if (c.checked && feeds.size >= 3) { c.checked = false; return toast("Не більше 3 фідів"); }
    c.checked ? feeds.add(c.value) : feeds.delete(c.value);
  });
  form.onsubmit = async (e) => {
    e.preventDefault(); err.textContent = "";
    const nm = form.elements.name.value.trim();
    if (!nm) { err.textContent = "Дай набору назву"; return; }
    if (people.size < 1) { err.textContent = "Додай хоча б одну людину"; return; }
    const b = $("button.btn", form); b.disabled = true; b.textContent = "Створення…";
    try {
      const r = await api.createStarterPack({ name: nm, description: form.elements.desc.value.trim(), dids: [...people.keys()], feeds: [...feeds] });
      toast("Набір створено 🎒"); location.hash = `#/starter-pack/${encodeURIComponent(session.handle)}/${r.uri.split("/").pop()}`;
    } catch (ex) { err.textContent = errText(ex); b.disabled = false; b.textContent = "Створити набір"; }
  };
}

export async function starterPack(el, { actor, rkey }) {
  el.innerHTML = header("Стартовий набір", true) + spinner();
  const did = actor.startsWith("did:") ? actor : (await api.get("com.atproto.identity.resolveHandle", { handle: actor })).did;
  const sp = (await api.get("app.bsky.graph.getStarterPack", { starterPack: `at://${did}/app.bsky.graph.starterpack/${rkey}` })).starterPack;
  const rec = sp.record || {};
  const mine = sp.creator.did === session.did;
  el.innerHTML = header(esc(rec.name || "Стартовий набір"), true, `<button class="ghost icon" data-spshare title="Поділитися">📤</button>${mine ? `<button class="ghost icon" data-spdel title="Видалити набір">🗑️</button>` : ""}`) + `
    <div class="card-row pad"><span class="bigemoji">🎒</span>
      <div class="grow"><b>${esc(rec.name || "")}</b>
        <div class="muted small">Стартовий набір від <a href="${profileHref(sp.creator)}">${at(sp.creator.handle)}</a>${sp.joinedAllTimeCount ? ` · приєдналися: ${num(sp.joinedAllTimeCount)}` : ""}</div>
        ${rec.description ? `<div class="small">${richText(rec.description, rec.descriptionFacets)}</div>` : ""}</div>
      ${sp.list ? `<button class="btn sm" data-followall>Стежити за всіма</button>` : ""}
    </div>
    ${sp.feeds?.length ? `<h3 class="pad">Фіди</h3>${sp.feeds.map(renderFeedCard).join("")}` : ""}
    <h3 class="pad">Люди</h3>`;
  $("[data-spshare]", el).onclick = () => window.dispatchEvent(new CustomEvent("skybee:share", { detail: [
    `Стартовий набір «${esc(rec.name || "")}»`, `#/starter-pack/${encodeURIComponent(sp.creator.handle)}/${rkey}`, `https://bsky.app/starter-pack/${sp.creator.handle}/${rkey}`] }));
  const del = $("[data-spdel]", el);
  if (del) del.onclick = async () => {
    if (!await confirmBox("Видалити цей стартовий набір? Люди, які вже приєдналися, залишаться підписаними.", "Видалити", true)) return;
    try { await api.deleteStarterPack(sp); toast("Набір видалено"); location.hash = "#/profile/me/packs"; } catch (ex) { toast(errText(ex)); }
  };
  if (!sp.list) { el.insertAdjacentHTML("beforeend", empty("Список людей недоступний")); return; }
  const btn = $("[data-followall]", el);
  btn.onclick = async () => {
    if (!await confirmBox("Підписатися на всіх людей із цього набору?", "Стежити")) return;
    btn.disabled = true; btn.textContent = "Зачекайте…";
    try {
      const dids = [];
      for (let cursor, n = 0; n < 5; n++) { // a pack holds up to 150 people
        const d = await api.get("app.bsky.graph.getList", { list: sp.list.uri, limit: 100, cursor });
        for (const i of d.items) if (!i.subject.viewer?.following && !i.subject.viewer?.blocking && !i.subject.viewer?.blockedBy && i.subject.did !== session.did) dids.push(i.subject.did);
        if (!(cursor = d.cursor)) break;
      }
      await api.followAll(dids);
      toast(`Нових підписок: ${dids.length}`); btn.textContent = "✓ Ви стежите";
    } catch (ex) { toast(errText(ex)); btn.disabled = false; btn.textContent = "Стежити за всіма"; }
  };
  return paged(el, async (cursor) => {
    const d = await api.get("app.bsky.graph.getList", { list: sp.list.uri, limit: 50, cursor });
    return { html: d.items.map(i => renderActor(i.subject)), cursor: d.cursor };
  });
}

/* ================= CONTENT FILTERS ================= */
const FILTERS = [
  ["porn", "Контент для дорослих", "Відверта сексуальна активність, еротика", true],
  ["sexual", "Відвертий контент", "Без оголеності, але сексуального характеру", true],
  ["graphic-media", "Жорсткий контент", "Насильство, кров, травми", true],
  ["nudity", "Оголеність", "Несексуальна або мистецька оголеність", false],
];
export async function contentFilters(el) {
  el.innerHTML = header("Фільтри контенту", true) + spinner();
  await api.getPrefs(true);
  const draw = () => {
    const adult = api.adultEnabled();
    el.innerHTML = header("Фільтри контенту", true) + `
      <div class="card">
        <label class="radio"><input type="checkbox" id="adult" ${adult ? "checked" : ""}> Показувати контент для дорослих (мені вже є 18)</label>
        <p class="small muted">Поки вимкнено, пости з позначками для дорослих зникають зі стрічок, а в гілках і профілях їхні медіа закриті.</p>
      </div>
      <div class="card">${FILTERS.map(([k, title, desc, adultOnly]) => {
        const locked = adultOnly && !adult, cur = locked ? "hide" : api.labelPref(k);
        return `<div class="filter"><b>${title}</b><div class="small muted">${desc}</div>
          <div class="seg">${[["ignore", "Показувати"], ["warn", "Попереджати"], ["hide", "Приховувати"]].map(([v, l]) =>
            `<button data-label="${k}" data-vis="${v}" class="${v === cur ? "on" : ""}" ${locked ? "disabled" : ""}>${l}</button>`).join("")}</div></div>`;
      }).join("")}
        <p class="small muted">«Попереджати» — медіа розмите, доки не натиснеш «Показати». «Приховувати» — пост не потрапляє у стрічки. Налаштування спільні з офіційним застосунком.</p>
      </div>`;
    $("#adult", el).onchange = async (e) => {
      try { await api.setAdult(e.target.checked); toast("Збережено"); } catch (ex) { toast(errText(ex)); }
      draw();
    };
    el.querySelectorAll("[data-label]").forEach(b => b.onclick = async () => {
      b.disabled = true;
      try { await api.setLabelPref(b.dataset.label, b.dataset.vis); toast("Збережено"); } catch (ex) { toast(errText(ex)); }
      draw();
    });
  };
  draw();
}

/* ================= APP PASSWORDS ================= */
export async function appPasswords(el) {
  el.innerHTML = header("Паролі застосунків", true) + `
    <form class="card">
      <p class="small muted">Окремий пароль для кожного застосунку: основний пароль лишається в таємниці, а доступ можна будь-коли відкликати.</p>
      <input name="name" placeholder="Назва, наприклад «Skybee на телефоні»" maxlength="32" required>
      <label class="radio"><input type="checkbox" name="dm"> Дозволити доступ до особистих повідомлень</label>
      <p class="err"></p><button class="btn">Створити</button>
    </form><div id="pwlist">${spinner()}</div>`;
  const box = $("#pwlist", el), form = $("form", el);
  const load = async () => {
    try {
      const list = await api.listAppPasswords();
      box.innerHTML = list.map(p => `<div class="actor static"><div class="who"><b>${esc(p.name)}</b>
        <span class="muted small">${T("створено {0}", new Date(p.createdAt).toLocaleDateString(LOC))}${p.privileged ? " · з доступом до чатів" : ""}</span></div>
        <button class="ghost sm danger" data-revoke="${esc(p.name)}">Відкликати</button></div>`).join("") || empty("Паролів застосунків ще немає");
    } catch (ex) {
      box.innerHTML = `<div class="card"><p class="err">${esc(errText(ex))}</p><p class="small muted">Керувати паролями можна лише після входу з <b>основним паролем</b>. З паролем застосунку ця сторінка недоступна.</p></div>`;
    }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("button", form); btn.disabled = true; $(".err", form).textContent = "";
    try {
      const p = await api.createAppPassword(form.name.value.trim(), form.dm.checked);
      form.reset();
      const m = modal(`<h3>Пароль створено</h3><p class="small muted">Збережи його зараз — більше він не показуватиметься.</p>
        <input readonly value="${esc(p.password)}" data-selectall><div class="row end"><button class="ghost" data-copy>Копіювати</button><button class="btn" data-x>Готово</button></div>`);
      m.querySelector("[data-selectall]").addEventListener("focus", (ev) => ev.target.select()); // no inline handlers: they would break a Content-Security-Policy
      m.addEventListener("click", async (ev) => {
        if (ev.target.closest("[data-copy]")) { await navigator.clipboard.writeText(p.password); toast("Скопійовано"); }
        if (ev.target.closest("[data-x]")) m.close();
      });
      load();
    } catch (ex) { $(".err", form).textContent = errText(ex); }
    btn.disabled = false;
  };
  box.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-revoke]"); if (!b) return;
    if (!await confirmBox(`Відкликати пароль «${b.dataset.revoke}»? Застосунки з ним втратять доступ.`, "Відкликати", true)) return;
    try { await api.revokeAppPassword(b.dataset.revoke); toast("Пароль відкликано"); load(); } catch (ex) { toast(errText(ex)); }
  });
  load();
}

/* ================= RIGHT COLUMN ================= */
// Trends and people to follow next to the main column (wide screens only)
export async function sidebar(el) {
  const [tabs, sug] = await Promise.all([
    homeTabs().catch(() => []),
    api.get("app.bsky.actor.getSuggestions", { limit: 4 }).catch(() => null),
  ]);
  let html = "";
  // the home screen's feeds live here on wide screens (the tabs above the posts are hidden there)
  let cur = 0; try { cur = +sessionStorage.getItem("skybee.tab") || 0; } catch {}
  if (tabs.length) html += `<div class="card small sidefeeds"><h3>Фіди</h3>${tabs.map((t, i) =>
    `<button class="sfeed${i === cur ? " on" : ""}" data-sfeed="${i}">${ico({ timeline: "home", feed: "hash", list: "list", my: "deck" }[t.kind] || "hash", 18)} <span class="clip">${esc(t.label)}</span></button>`).join("")}
    <a class="rowlink" href="#/feeds">Усі фіди →</a></div>`;
  if (sug?.actors?.length) html += `<div class="card small"><h3>Кого почитати</h3>${sug.actors.map(a => {
    actors.set(a.did, a);
    return `<a class="sugg" href="${profileHref(a)}">${avatar(a, 32)}<span class="who"><b>${vname(a)}</b><span class="muted clip">${at(a.handle)}</span></span></a>`;
  }).join("")}<a class="rowlink" href="#/search">Більше →</a></div>`;
  el.innerHTML = html;
  el.onclick = (e) => {
    const b = e.target.closest("[data-sfeed]"); if (!b) return;
    const i = +b.dataset.sfeed;
    try { sessionStorage.setItem("skybee.tab", i); } catch {}
    const onHome = !location.hash || location.hash === "#/" || location.hash === "#";
    if (onHome) window.dispatchEvent(new CustomEvent("skybee:pickfeed", { detail: i })); else location.hash = "#/";
  };
  if (!el.dataset.bound) el.dataset.bound = "1", window.addEventListener("skybee:hometab", (e) => el.querySelectorAll("[data-sfeed]").forEach(b => b.classList.toggle("on", +b.dataset.sfeed === e.detail)));
}
