// Skybee — more screens: lists, starter packs, content filters, account, app passwords
import * as api from "./api.js";
import { session } from "./api.js";
import { $, esc, enc, num, name, vname, avatar, richText, renderActor, renderFeedCard, empty, spinner, toast, modal, menu, confirmBox, profileHref, actors, at } from "./ui.js";
import { header, paged, renderListCard, homeTabs } from "./views.js";

const reload = () => window.dispatchEvent(new Event("hashchange"));

/* ================= LISTS ================= */
export async function lists(el) {
  el.innerHTML = header("Списки", false, `<button class="btn sm" data-act="newList">＋ Новий</button>`) +
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
    } catch (ex) { $(".err", m).textContent = ex.message; x.disabled = false; }
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
      } catch (ex) { toast(ex.message); }
    }, 250);
  });
  m.addEventListener("click", async (e) => {
    if (e.target.closest("[data-x]")) return m.close();
    const b = e.target.closest("[data-add]"); if (!b) return;
    b.disabled = true;
    try { await api.addToList(listUri, b.dataset.add); b.textContent = "✓ Додано"; } catch (ex) { toast(ex.message); b.disabled = false; }
  });
}

// Tick the lists of mine that an account belongs to
export async function addToListsDialog(actor) {
  const m = modal(`<h3>Списки для ${at(actor.handle)}</h3><div class="results">${spinner()}</div>
    <div class="row between" style="margin-top:12px"><button class="ghost sm" data-act="newList">＋ Новий список</button><button class="btn" data-x>Готово</button></div>`);
  const res = $(".results", m);
  m.addEventListener("click", e => { if (e.target.closest("[data-x]")) m.close(); });
  let rows;
  try { rows = await api.listsWithMember(actor.did); } catch (ex) { res.innerHTML = `<p class="err">${esc(ex.message)}</p>`; return; }
  res.innerHTML = rows.map((r, i) => `<label class="radio"><input type="checkbox" data-i="${i}" ${r.item ? "checked" : ""}> ${esc(r.list.name)}
    <span class="muted small">${r.list.purpose === api.MODLIST ? "модераційний" : ""}</span></label>`).join("") || empty("У вас ще немає списків");
  res.addEventListener("change", async (e) => {
    const r = rows[e.target.dataset.i], box = e.target;
    box.disabled = true;
    try {
      if (box.checked) r.item = (await api.addToList(r.list.uri, actor.did)).uri;
      else { await api.removeFromList(r.item); r.item = null; }
    } catch (ex) { toast(ex.message); box.checked = !box.checked; }
    box.disabled = false;
  });
}

/* ================= STARTER PACK ================= */
export async function starterPack(el, { actor, rkey }) {
  el.innerHTML = header("Стартовий набір", true) + spinner();
  const did = actor.startsWith("did:") ? actor : (await api.get("com.atproto.identity.resolveHandle", { handle: actor })).did;
  const sp = (await api.get("app.bsky.graph.getStarterPack", { starterPack: `at://${did}/app.bsky.graph.starterpack/${rkey}` })).starterPack;
  const rec = sp.record || {};
  el.innerHTML = header(esc(rec.name || "Стартовий набір"), true) + `
    <div class="card-row pad"><span class="bigemoji">🎒</span>
      <div class="grow"><b>${esc(rec.name || "")}</b>
        <div class="muted small">Стартовий набір від <a href="${profileHref(sp.creator)}">${at(sp.creator.handle)}</a>${sp.joinedAllTimeCount ? ` · приєдналися: ${num(sp.joinedAllTimeCount)}` : ""}</div>
        ${rec.description ? `<div class="small">${richText(rec.description, rec.descriptionFacets)}</div>` : ""}</div>
      ${sp.list ? `<button class="btn sm" data-followall>Стежити за всіма</button>` : ""}
    </div>
    ${sp.feeds?.length ? `<h3 class="pad">Фіди</h3>${sp.feeds.map(renderFeedCard).join("")}` : ""}
    <h3 class="pad">Люди</h3>`;
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
    } catch (ex) { toast(ex.message); btn.disabled = false; btn.textContent = "Стежити за всіма"; }
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
      try { await api.setAdult(e.target.checked); toast("Збережено"); } catch (ex) { toast(ex.message); }
      draw();
    };
    el.querySelectorAll("[data-label]").forEach(b => b.onclick = async () => {
      b.disabled = true;
      try { await api.setLabelPref(b.dataset.label, b.dataset.vis); toast("Збережено"); } catch (ex) { toast(ex.message); }
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
        <span class="muted small">створено ${new Date(p.createdAt).toLocaleDateString("uk-UA")}${p.privileged ? " · з доступом до чатів" : ""}</span></div>
        <button class="ghost sm danger" data-revoke="${esc(p.name)}">Відкликати</button></div>`).join("") || empty("Паролів застосунків ще немає");
    } catch (ex) {
      box.innerHTML = `<div class="card"><p class="err">${esc(ex.message)}</p><p class="small muted">Керувати паролями можна лише після входу з <b>основним паролем</b>. З паролем застосунку ця сторінка недоступна.</p></div>`;
    }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("button", form); btn.disabled = true; $(".err", form).textContent = "";
    try {
      const p = await api.createAppPassword(form.name.value.trim(), form.dm.checked);
      form.reset();
      const m = modal(`<h3>Пароль створено</h3><p class="small muted">Збережи його зараз — більше він не показуватиметься.</p>
        <input readonly value="${esc(p.password)}" onfocus="this.select()"><div class="row end"><button class="ghost" data-copy>Копіювати</button><button class="btn" data-x>Готово</button></div>`);
      m.addEventListener("click", async (ev) => {
        if (ev.target.closest("[data-copy]")) { await navigator.clipboard.writeText(p.password); toast("Скопійовано"); }
        if (ev.target.closest("[data-x]")) m.close();
      });
      load();
    } catch (ex) { $(".err", form).textContent = ex.message; }
    btn.disabled = false;
  };
  box.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-revoke]"); if (!b) return;
    if (!await confirmBox(`Відкликати пароль «${b.dataset.revoke}»? Застосунки з ним втратять доступ.`, "Відкликати", true)) return;
    try { await api.revokeAppPassword(b.dataset.revoke); toast("Пароль відкликано"); load(); } catch (ex) { toast(ex.message); }
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
    `<button class="sfeed${i === cur ? " on" : ""}" data-sfeed="${i}">${{ timeline: "🏠", feed: "#️⃣", list: "📋", my: "🧩" }[t.kind] || "#️⃣"} <span class="clip">${esc(t.label)}</span></button>`).join("")}
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
