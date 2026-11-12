// Skybee — AT Protocol / Bluesky API layer
const PUBLIC_API = "https://public.api.bsky.app";
const CHAT_PROXY = "did:web:api.bsky.chat#bsky_chat";
const MOD_PROXY = "did:plc:ar7c4by46qjdydhdevvrndac#atproto_labeler";
const VIDEO = "https://video.bsky.app";
const KEY = "skybee.session", ACCOUNTS = "skybee.accounts";

/* ---------- sessions: several accounts, one of them active ---------- */
export let session = null;  // the active account: { did, handle, accessJwt, refreshJwt, pds }
export let accounts = [];   // every signed-in account; `session` is one of these objects

const read = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const write = (key, v) => { try { v ? localStorage.setItem(key, JSON.stringify(v)) : localStorage.removeItem(key); } catch {} };

// Puts the active session object into the list (in place, so the order of accounts stays stable)
function adopt() {
  if (!session || accounts.includes(session)) return;
  const i = accounts.findIndex(a => a.did === session.did);
  if (i < 0) accounts.push(session); else accounts[i] = session;
}
export function loadSession() {
  session = read(KEY) || (read(ACCOUNTS) ? null : session); // storage blocked (private mode): keep what is in memory
  const saved = read(ACCOUNTS);
  accounts = (Array.isArray(saved) ? saved : []).filter(a => a?.did);
  adopt();
  return session;
}
function saveSession() {
  adopt();
  write(KEY, session); write(ACCOUNTS, accounts.length ? accounts : null);
}
export function switchAccount(did) {
  const a = accounts.find(a => a.did === did);
  if (!a) return false;
  session = a; forgetPrefs(); saveSession();
  return true;
}
// Forgets an account on this device; if it was the active one, another account (if any) becomes active
export function removeAccount(did) {
  accounts = accounts.filter(a => a.did !== did);
  if (session?.did === did) { session = accounts[0] || null; forgetPrefs(); }
  saveSession();
}
export const logout = () => removeAccount(session?.did);

/* ---------- identity ---------- */
export function normalizeHandle(h) {
  h = h.trim().replace(/^@/, "").toLowerCase();
  if (!h.startsWith("did:") && !h.includes(".")) h += ".bsky.social";
  return h;
}

export async function resolvePds(input) {
  const handle = normalizeHandle(input);
  let did = handle.startsWith("did:") ? handle : null;
  if (!did) {
    const r = await fetch(`${PUBLIC_API}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`);
    if (!r.ok) throw new Error("Не вдалося знайти такий нік");
    did = (await r.json()).did;
  }
  const docUrl = did.startsWith("did:plc:")
    ? `https://plc.directory/${did}`
    : `https://${did.slice("did:web:".length)}/.well-known/did.json`;
  const doc = await (await fetch(docUrl)).json();
  const svc = (doc.service || []).find(s => s.id === "#atproto_pds" || s.type === "AtprotoPersonalDataServer");
  if (!svc) throw new Error("Не знайдено сервер (PDS) акаунта");
  return { did, pds: svc.serviceEndpoint.replace(/\/$/, "") };
}

const ENTRYWAY = "https://bsky.social";
const pdsOfDoc = (doc) => (doc?.service || []).find(x => x.id === "#atproto_pds" || x.type === "AtprotoPersonalDataServer")?.serviceEndpoint?.replace(/\/$/, "");

// opts.main: the account's main password (may need an e-mail `code`), otherwise an app password.
// Phone keyboards add spaces, invisible characters and «smart» dashes — all of that is cleaned up here.
export async function login(handle, password, { main = false, code = "" } = {}) {
  const id = handle.replace(/[\s​-‍⁠﻿]/g, "").replace(/^@/, "");
  let pass = password.trim();
  if (!main) pass = pass.replace(/\s/g, "").replace(/[‐-―−]/g, "-");
  if (!id || !pass) throw new Error("Введи нік і пароль");
  let identifier = id.includes("@") ? id : normalizeHandle(id), pds = ENTRYWAY, resolved = false;
  if (!id.includes("@")) { // an e-mail cannot be resolved, it goes straight to bsky.social
    try { const r = await resolvePds(id); identifier = r.did; pds = r.pds; resolved = true; }
    catch { /* lookup blocked or failed (ad blockers, weak network): bsky.social can still sign most accounts in */ }
  }
  const body = { identifier, password: pass };
  if (code.trim()) body.authFactorToken = code.trim();
  let r, d;
  try {
    r = await fetch(`${pds}/xrpc/com.atproto.server.createSession`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    d = await r.json().catch(() => ({}));
  } catch { throw new Error("Немає зв'язку із сервером. Перевір інтернет або вимкни блокувальник реклами для цього сайту."); }
  if (!r.ok) {
    const e = new Error(
      d.error === "AuthFactorTokenRequired" ? "На пошту акаунта надіслано код підтвердження — введи його нижче"
      : d.error === "AuthenticationRequired" ? (main ? "Неправильний нік або пароль" : "Неправильний нік або пароль застосунку. Якщо вводиш основний пароль — обери «Основний пароль».")
      : d.error === "RateLimitExceeded" || r.status === 429 ? "Забагато спроб входу, спробуй за кілька хвилин"
      : d.error === "AccountTakedown" ? "Акаунт заблоковано модерацією"
      : d.message || d.error || `Помилка ${r.status}`);
    e.code = d.error; throw e;
  }
  if (!resolved) { // signed in through bsky.social: find the account's own server for later requests
    pds = pdsOfDoc(d.didDoc) || await resolvePds(d.did).then(x => x.pds, () => ENTRYWAY);
  }
  session = { did: d.did, handle: d.handle, accessJwt: d.accessJwt, refreshJwt: d.refreshJwt, pds };
  forgetPrefs();
  saveSession();
  return session;
}

// `s` is the account the request belongs to: the active one may change while the request is in flight
async function refresh(s) {
  const r = await fetch(`${s.pds}/xrpc/com.atproto.server.refreshSession`, {
    method: "POST", headers: { Authorization: `Bearer ${s.refreshJwt}` } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    // only a rejected token ends the session; a server hiccup (5xx, rate limit) must not sign the account out
    if (r.status !== 400 && r.status !== 401) throw new Error(d.message || `Помилка ${r.status}`);
    removeAccount(s.did); location.hash = "#/"; location.reload();
    throw new Error("Сесія закінчилась, увійди знову");
  }
  Object.assign(s, { accessJwt: d.accessJwt, refreshJwt: d.refreshJwt, handle: d.handle });
  saveSession();
}

/* ---------- XRPC ---------- */
// opts: { params, body, raw (Blob), contentType, proxy, retry }
export async function xrpc(method, opts = {}) {
  const { params, body, raw, contentType, proxy, retry = true, as: s = session, headers: extra } = opts;
  // without an account (a shared thread opened by a guest): public reading through the open AppView, no writing
  if (!s && (body || raw || proxy)) { const e = new Error("Щоб це зробити, увійди в акаунт"); e.code = "NoSession"; throw e; }
  const url = new URL(`${s ? s.pds : PUBLIC_API}/xrpc/${method}`);
  if (params) for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach(x => url.searchParams.append(k, x));
    else url.searchParams.set(k, v);
  }
  const headers = { ...extra };
  if (s) headers.Authorization = `Bearer ${s.accessJwt}`;
  if (proxy) headers["atproto-proxy"] = proxy;
  let payload;
  if (raw) { payload = raw; headers["Content-Type"] = contentType || raw.type || "application/octet-stream"; }
  else if (body) { payload = JSON.stringify(body); headers["Content-Type"] = "application/json"; }
  const r = await fetch(url, { method: payload ? "POST" : "GET", headers, body: payload });
  const data = r.headers.get("content-type")?.includes("json") ? await r.json() : null;
  if (!r.ok) {
    if (s && retry && (data?.error === "ExpiredToken" || data?.error === "InvalidToken")) {
      await refresh(s); return xrpc(method, { ...opts, retry: false, as: s });
    }
    const e = new Error(data?.message || data?.error || `Помилка ${r.status}`);
    e.code = data?.error; e.status = r.status;
    throw e;
  }
  return data;
}
export const get = (m, params, extra) => xrpc(m, { params, ...extra });
export const post = (m, body, extra) => xrpc(m, { body, ...extra });
export const chat = (m, params) => xrpc(m, { params, proxy: CHAT_PROXY });
export const chatPost = (m, body) => xrpc(m, { body, proxy: CHAT_PROXY });

/* ---------- records ---------- */
const now = () => new Date().toISOString();
export const rkeyOf = (uri) => uri.split("/").pop();
export const strongRef = (p) => ({ uri: p.uri, cid: p.cid });

// TID — a sortable record key: 11 base32 chars of microseconds + 2 chars of random clock id
const S32 = "234567abcdefghijklmnopqrstuvwxyz";
let lastTid = 0;
export function tid() {
  lastTid = Math.max(Date.now() * 1000, lastTid + 1);
  let s = "";
  for (let n = lastTid; s.length < 11; n = Math.floor(n / 32)) s = S32[n % 32] + s;
  const clock = Math.floor(Math.random() * 1024);
  return s + S32[clock >> 5] + S32[clock & 31];
}

export const createRecord = (collection, record) =>
  post("com.atproto.repo.createRecord", { repo: session.did, collection, record: { $type: collection, createdAt: now(), ...record } });
export const deleteRecord = (collection, uri) =>
  post("com.atproto.repo.deleteRecord", { repo: session.did, collection, rkey: rkeyOf(uri) });

export const like = (p) => createRecord("app.bsky.feed.like", { subject: strongRef(p) });
export const unlike = (likeUri) => deleteRecord("app.bsky.feed.like", likeUri);
export const repost = (p) => createRecord("app.bsky.feed.repost", { subject: strongRef(p) });
export const unrepost = (uri) => deleteRecord("app.bsky.feed.repost", uri);
export const follow = (did) => createRecord("app.bsky.graph.follow", { subject: did });
export const unfollow = (uri) => deleteRecord("app.bsky.graph.follow", uri);
export const block = (did) => createRecord("app.bsky.graph.block", { subject: did });
export const unblock = (uri) => deleteRecord("app.bsky.graph.block", uri);
export const deletePost = (uri) => deleteRecord("app.bsky.feed.post", uri);
export const mute = (did) => post("app.bsky.graph.muteActor", { actor: did });
export const unmute = (did) => post("app.bsky.graph.unmuteActor", { actor: did });
export const muteThread = (root) => post("app.bsky.graph.muteThread", { root });
export const bookmark = (p) => post("app.bsky.bookmark.createBookmark", strongRef(p));
export const unbookmark = (uri) => post("app.bsky.bookmark.deleteBookmark", { uri });

export const report = (subject, reasonType, reason) =>
  xrpc("com.atproto.moderation.createReport", { body: { reasonType, reason, subject }, proxy: MOD_PROXY });

/* ---------- threadgate: who can reply ---------- */
// `allow` everywhere: undefined → anyone, [] → nobody, otherwise up to 5 rules ({$type: "app.bsky.feed.threadgate#…Rule"})
const GATE = "app.bsky.feed.threadgate";

// The gate record lives in the author's repo under the same rkey as the thread's root post
export async function getThreadgate(postUri) {
  try { return (await get("com.atproto.repo.getRecord", { repo: session.did, collection: GATE, rkey: rkeyOf(postUri) })).value; }
  catch (e) { if (e.code === "RecordNotFound") return null; throw e; }
}

export async function setThreadgate(postUri, allow) {
  const cur = await getThreadgate(postUri);
  const hiddenReplies = cur?.hiddenReplies?.length ? cur.hiddenReplies : undefined; // the same record also keeps hidden replies
  if (!allow && !hiddenReplies) { if (cur) await deleteRecord(GATE, postUri); return; }
  await post("com.atproto.repo.putRecord", { repo: session.did, collection: GATE, rkey: rkeyOf(postUri),
    record: { $type: GATE, post: postUri, allow: allow || undefined, hiddenReplies, createdAt: cur?.createdAt || now() } });
}

// A post and its gates are written in one commit, so the post is never public without them.
// allow: who can reply (see above); noQuote: nobody may quote the post. → { uri, cid }
export async function createPost(record, allow, noQuote = false) {
  const POST = "app.bsky.feed.post";
  if (!allow && !noQuote) { const r = await createRecord(POST, record); return { uri: r.uri, cid: r.cid }; }
  const rkey = tid(), createdAt = now(), uri = `at://${session.did}/${POST}/${rkey}`;
  const create = (collection, value) => ({ $type: "com.atproto.repo.applyWrites#create", collection, rkey, value: { $type: collection, ...value } });
  const writes = [create(POST, { createdAt, ...record })];
  if (allow) writes.push(create(GATE, { post: uri, allow, createdAt }));
  if (noQuote) writes.push(create(PGATE, { post: uri, embeddingRules: [NOQUOTE], createdAt }));
  const r = await post("com.atproto.repo.applyWrites", { repo: session.did, writes });
  const cid = r?.results?.[0]?.cid || (await get("com.atproto.repo.getRecord", { repo: session.did, collection: POST, rkey })).cid;
  return { uri, cid };
}

// The thread's author hides (or shows again) one reply for everyone; the list lives in the gate record
export async function hideReply(rootUri, replyUri, hide) {
  const cur = await getThreadgate(rootUri);
  const set = new Set(cur?.hiddenReplies || []);
  hide ? set.add(replyUri) : set.delete(replyUri);
  const hiddenReplies = set.size ? [...set] : undefined;
  if (!cur?.allow && !hiddenReplies) { if (cur) await deleteRecord(GATE, rootUri); return; }
  await post("com.atproto.repo.putRecord", { repo: session.did, collection: GATE, rkey: rkeyOf(rootUri),
    record: { $type: GATE, post: rootUri, allow: cur?.allow, hiddenReplies, createdAt: cur?.createdAt || now() } });
}

/* ---------- postgate: who can quote ---------- */
const PGATE = "app.bsky.feed.postgate", NOQUOTE = { $type: PGATE + "#disableRule" };
export async function getPostgate(postUri) {
  try { return (await get("com.atproto.repo.getRecord", { repo: session.did, collection: PGATE, rkey: rkeyOf(postUri) })).value; }
  catch (e) { if (e.code === "RecordNotFound") return null; throw e; }
}
async function editPostgate(postUri, change) {
  const cur = await getPostgate(postUri);
  const g = change({ rules: cur?.embeddingRules || [], detached: cur?.detachedEmbeddingUris || [] });
  if (!g.rules.length && !g.detached.length) { if (cur) await deleteRecord(PGATE, postUri); return; }
  await post("com.atproto.repo.putRecord", { repo: session.did, collection: PGATE, rkey: rkeyOf(postUri),
    record: { $type: PGATE, post: postUri, createdAt: cur?.createdAt || now(),
      embeddingRules: g.rules.length ? g.rules : undefined, detachedEmbeddingUris: g.detached.length ? g.detached : undefined } });
}
export const setQuotesDisabled = (postUri, off) => editPostgate(postUri, g => ({ ...g, rules: off ? [NOQUOTE] : [] }));
// Removes my post from someone's quote of it
export const detachQuote = (postUri, quoteUri) => editPostgate(postUri, g => ({ ...g, detached: [...new Set([...g.detached, quoteUri])] }));

/* ---------- lists ---------- */
const LIST = "app.bsky.graph.list", LISTITEM = "app.bsky.graph.listitem";
export const CURATE = "app.bsky.graph.defs#curatelist", MODLIST = "app.bsky.graph.defs#modlist";
export const createList = (name, description, purpose = CURATE) => createRecord(LIST, { name, description: description || undefined, purpose });
export async function updateList(uri, patch) {
  const cur = (await get("com.atproto.repo.getRecord", { repo: session.did, collection: LIST, rkey: rkeyOf(uri) })).value;
  await post("com.atproto.repo.putRecord", { repo: session.did, collection: LIST, rkey: rkeyOf(uri), record: { ...cur, ...patch } });
}
// Every record of a collection in my repo (newest first), up to `max`
async function myRecords(collection, max = 2000) {
  const out = [];
  for (let cursor; out.length < max;) {
    const d = await get("com.atproto.repo.listRecords", { repo: session.did, collection, limit: 100, cursor });
    out.push(...d.records); cursor = d.cursor;
    if (!cursor || !d.records.length) break;
  }
  return out;
}
// The list goes together with its member records
export async function deleteList(uri) {
  const items = (await myRecords(LISTITEM)).filter(r => r.value?.list === uri);
  const del = (collection, u) => ({ $type: "com.atproto.repo.applyWrites#delete", collection, rkey: rkeyOf(u) });
  const writes = [...items.map(r => del(LISTITEM, r.uri)), del(LIST, uri)];
  for (let i = 0; i < writes.length; i += 200) await post("com.atproto.repo.applyWrites", { repo: session.did, writes: writes.slice(i, i + 200) });
}
export const addToList = (listUri, did) => createRecord(LISTITEM, { subject: did, list: listUri });
export const removeFromList = (itemUri) => deleteRecord(LISTITEM, itemUri);
// My lists with the member record of `did` in each (item: uri or null)
export async function listsWithMember(did) {
  try {
    const d = await get("app.bsky.graph.getListsWithMembership", { actor: did, limit: 100 });
    return d.listsWithMembership.map(x => ({ list: x.list, item: x.listItem?.uri || null }));
  } catch { // older servers: look through my own member records
    const [lists, items] = await Promise.all([get("app.bsky.graph.getLists", { actor: session.did, limit: 100 }), myRecords(LISTITEM)]);
    return lists.lists.map(list => ({ list, item: items.find(r => r.value?.list === list.uri && r.value?.subject === did)?.uri || null }));
  }
}
export const muteList = (list, on) => post(on ? "app.bsky.graph.muteActorList" : "app.bsky.graph.unmuteActorList", { list });
export const blockList = (list) => createRecord("app.bsky.graph.listblock", { subject: list });
export const unblockList = (uri) => deleteRecord("app.bsky.graph.listblock", uri);
// Follows many accounts at once
export async function followAll(dids) {
  const createdAt = now();
  const writes = dids.map(subject => ({ $type: "com.atproto.repo.applyWrites#create", collection: "app.bsky.graph.follow", rkey: tid(),
    value: { $type: "app.bsky.graph.follow", subject, createdAt } }));
  for (let i = 0; i < writes.length; i += 100) await post("com.atproto.repo.applyWrites", { repo: session.did, writes: writes.slice(i, i + 100) });
}

/* ---------- languages of feed content ---------- */
// Custom feeds pick posts in these languages (sent as Accept-Language); empty → any language
export function contentLangs() { try { return JSON.parse(localStorage.getItem("skybee.contentLangs")) || []; } catch { return []; } }
export const feedHeaders = () => { const l = contentLangs(); return l.length ? { headers: { "Accept-Language": l.join(",") } } : undefined; };

/* ---------- account ---------- */
// E-mail: a change needs a code from the current address once the address is confirmed
export const requestEmailUpdate = () => post("com.atproto.server.requestEmailUpdate");
export const updateEmail = (email, token, emailAuthFactor) => post("com.atproto.server.updateEmail", { email, token: token?.trim() || undefined, emailAuthFactor });
export const requestEmailConfirmation = () => post("com.atproto.server.requestEmailConfirmation");
export const confirmEmail = (email, token) => post("com.atproto.server.confirmEmail", { email, token: token.trim() });
export const deactivateAccount = () => post("com.atproto.server.deactivateAccount", {});
export const requestAccountDelete = () => post("com.atproto.server.requestAccountDelete");
export const deleteAccount = (password, token) => post("com.atproto.server.deleteAccount", { did: session.did, password, token: token.trim() });
// Server-side notification settings: which kinds appear in the list and from whom
export const getNotifPrefs = () => get("app.bsky.notification.getPreferences").then(d => d.preferences || {});
export const putNotifPrefs = (patch) => post("app.bsky.notification.putPreferencesV2", patch);
// Who may get notified about my new posts: "followers" | "mutuals" | "none"
const NDECL = "app.bsky.notification.declaration";
export async function getActivityAccess() {
  try { return (await get("com.atproto.repo.getRecord", { repo: session.did, collection: NDECL, rkey: "self" })).value.allowSubscriptions || "followers"; }
  catch { return "followers"; }
}
export const setActivityAccess = (allowSubscriptions) =>
  post("com.atproto.repo.putRecord", { repo: session.did, collection: NDECL, rkey: "self", record: { $type: NDECL, allowSubscriptions } });
// «Ask apps not to show my account to people who are not signed in» is a self-label on the profile
const NOAUTH = "!no-unauthenticated";
export const loggedOutHidden = async () => !!(await getOwnProfileRecord()).labels?.values?.some(l => l.val === NOAUTH);
export async function setLoggedOutHidden(on) {
  const rec = await getOwnProfileRecord();
  const vals = (rec.labels?.values || []).filter(l => l.val !== NOAUTH);
  if (on) vals.push({ val: NOAUTH });
  if (vals.length) rec.labels = { $type: "com.atproto.label.defs#selfLabels", values: vals }; else delete rec.labels;
  await putOwnProfileRecord(rec);
}

export const getAccount = () => get("com.atproto.server.getSession");
export async function changeHandle(handle) {
  handle = normalizeHandle(handle);
  await post("com.atproto.identity.updateHandle", { handle });
  session.handle = handle; saveSession();
}
export const listAppPasswords = () => get("com.atproto.server.listAppPasswords").then(d => d.passwords);
export const createAppPassword = (name, privileged) => post("com.atproto.server.createAppPassword", { name, privileged });
export const revokeAppPassword = (name) => post("com.atproto.server.revokeAppPassword", { name });
export const requestPasswordReset = (email) => post("com.atproto.server.requestPasswordReset", { email });
export const resetPassword = (token, password) => post("com.atproto.server.resetPassword", { token: token.trim(), password });
// The whole repository (posts, likes, follows…) as a CAR file
export async function exportRepo() {
  const r = await fetch(`${session.pds}/xrpc/com.atproto.sync.getRepo?did=${encodeURIComponent(session.did)}`);
  if (!r.ok) throw new Error(`Помилка ${r.status}`);
  return r.blob();
}
// Notify me about new posts (and replies) of an account
export const subscribeActivity = (did, on) =>
  post("app.bsky.notification.putActivitySubscription", { subject: did, activitySubscription: { post: on, reply: false } });

// My own (non-moderation) lists — they can be used in a gate
export async function getMyLists() {
  const d = await get("app.bsky.graph.getLists", { actor: session.did, limit: 100, purposes: ["curatelist"] });
  return d.lists.filter(l => l.purpose === "app.bsky.graph.defs#curatelist");
}

/* ---------- blobs / images ---------- */
export async function uploadBlob(blob) {
  const d = await xrpc("com.atproto.repo.uploadBlob", { raw: blob });
  return d.blob;
}

// Downscale + recompress so the image fits Bluesky's ~1 MB limit
export async function prepareImage(file, maxSide = 2000, maxBytes = 950_000) {
  const bmp = await createImageBitmap(file);
  let { width, height } = bmp;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  width = Math.round(width * scale); height = Math.round(height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  canvas.getContext("2d").drawImage(bmp, 0, 0, width, height);
  if (file.size <= maxBytes && scale === 1 && /image\/(jpeg|png|webp|gif)/.test(file.type)) return { blob: file, width, height };
  for (let q = 0.9; q >= 0.4; q -= 0.1) {
    const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", q));
    if (blob.size <= maxBytes) return { blob, width, height };
  }
  throw new Error("Зображення завелике");
}

/* ---------- video ---------- */
// The video service acts on the user's behalf with short-lived tokens signed by the PDS
const serviceAuth = async (aud, lxm, minutes) =>
  (await get("com.atproto.server.getServiceAuth", { aud, lxm, exp: Math.floor(Date.now() / 1000) + minutes * 60 })).token;
const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); rej(signal.reason); }, { once: true });
});

// Uploads a video (or a GIF, which the service converts to video) and waits until it is processed.
// Returns the blob for app.bsky.embed.video. onProgress(stage: "upload" | "process", percent)
export async function uploadVideo(file, { signal, onProgress = () => {} } = {}) {
  const s = session;
  let limits = null;
  try {
    const token = await serviceAuth("did:web:video.bsky.app", "app.bsky.video.getUploadLimits", 1);
    limits = await (await fetch(`${VIDEO}/xrpc/app.bsky.video.getUploadLimits`, { headers: { Authorization: `Bearer ${token}` }, signal })).json();
  } catch { /* the check is optional: if it fails, the upload itself will tell */ }
  signal?.throwIfAborted();
  if (limits?.canUpload === false) throw new Error(limits.message || "Зараз не можна завантажити відео: вичерпано денний ліміт");

  // the upload token is addressed to the user's PDS: that is where the service stores the result
  const token = await serviceAuth(`did:web:${new URL(s.pds).hostname}`, "com.atproto.repo.uploadBlob", 30);
  const ext = { "video/webm": "webm", "video/quicktime": "mov", "video/mpeg": "mpeg", "image/gif": "gif" }[file.type] || "mp4";
  const sent = await new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress("upload", Math.round(e.loaded / e.total * 100)); };
    x.onload = () => { try { resolve(JSON.parse(x.responseText)); } catch { reject(new Error(`Не вдалося завантажити відео (помилка ${x.status})`)); } };
    x.onerror = () => reject(new Error("Не вдалося завантажити відео: немає зв'язку із сервером"));
    x.onabort = () => reject(signal?.reason || new Error("Скасовано"));
    signal?.addEventListener("abort", () => x.abort(), { once: true });
    x.open("POST", `${VIDEO}/xrpc/app.bsky.video.uploadVideo?did=${encodeURIComponent(s.did)}&name=${tid()}.${ext}`);
    x.setRequestHeader("Content-Type", file.type || "video/mp4");
    x.setRequestHeader("Authorization", `Bearer ${token}`);
    x.send(file);
  });
  const job = sent.jobStatus || sent; // also returned (with an "already exists" note) when this very file was uploaded before
  if (!job.jobId) throw new Error(job.message || job.error || "Не вдалося завантажити відео");

  onProgress("process", 0);
  for (let fails = 0, until = Date.now() + 15 * 60000; Date.now() < until;) {
    await sleep(1500, signal);
    let st;
    try {
      st = (await (await fetch(`${VIDEO}/xrpc/app.bsky.video.getJobStatus?jobId=${encodeURIComponent(job.jobId)}`, { signal })).json()).jobStatus;
    } catch (e) { if (signal?.aborted || ++fails > 20) throw e; continue; }
    if (st?.state === "JOB_STATE_FAILED") throw new Error(st.message || st.error || "Не вдалося обробити відео");
    if (st?.state === "JOB_STATE_COMPLETED") {
      if (!st.blob) throw new Error("Відео оброблено, але сервер не повернув файл");
      return st.blob;
    }
    onProgress("process", st?.progress || 0);
  }
  throw new Error("Обробка відео триває надто довго, спробуй пізніше");
}

/* ---------- rich text ---------- */
const enc = new TextEncoder();
const blen = (s) => enc.encode(s).length;
const TRAIL = /[.,;:!?)"'»]+$/;

export async function detectFacets(text) {
  const facets = [];
  const add = (start, str, feature) => {
    const byteStart = blen(text.slice(0, start));
    facets.push({ index: { byteStart, byteEnd: byteStart + blen(str) }, features: [feature] });
  };
  // links
  for (const m of text.matchAll(/(^|[\s(])(https?:\/\/[^\s]+)/g)) {
    const url = m[2].replace(TRAIL, "");
    add(m.index + m[1].length, url, { $type: "app.bsky.richtext.facet#link", uri: url });
  }
  // hashtags
  for (const m of text.matchAll(/(^|\s)#([^\s#]*[^\d\s\p{P}][^\s#]*)/gu)) {
    const tag = m[2].replace(TRAIL, "");
    if (!tag || tag.length > 64) continue;
    add(m.index + m[1].length, "#" + tag, { $type: "app.bsky.richtext.facet#tag", tag });
  }
  // mentions
  for (const m of text.matchAll(/(^|[\s(])@([a-zA-Z0-9.-]+[a-zA-Z0-9])/g)) {
    const raw = m[2];
    try {
      const d = await get("com.atproto.identity.resolveHandle", { handle: normalizeHandle(raw) });
      add(m.index + m[1].length, "@" + raw, { $type: "app.bsky.richtext.facet#mention", did: d.did });
    } catch { /* unknown handle: leave as text */ }
  }
  return facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
}

export function graphemes(s) {
  try { return [...new Intl.Segmenter().segment(s)].length; } catch { return [...s].length; }
}

/* ---------- link cards ---------- */
export async function fetchLinkCard(url) {
  try {
    const r = await fetch(`https://cardyb.bsky.app/v1/extract?url=${encodeURIComponent(url)}`);
    if (!r.ok) return null;
    const d = await r.json();
    if (d.error || !d.title) return null;
    return { uri: url, title: d.title, description: d.description || "", image: d.image || null };
  } catch { return null; }
}

/* ---------- preferences / feeds ---------- */
export const DISCOVER = "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot";
// Feeds shown on the home screen until the user pins feeds of their own; also suggested on the «Фіди» screen
const feedUri = (did, name) => `at://${did}/app.bsky.feed.generator/${name}`;
export const DEFAULT_FEEDS = [
  ...["all", "newcomers", "top100-month", "videos"].map(n => feedUri("did:plc:dvgliotey33vix3wlltybgkd", n)),
  ...["whats-hot", "thevids"].map(n => feedUri("did:plc:z72i7hdynmk6r22z27h6tvur", n)),
];

const PREF = "app.bsky.actor.defs#";
const lastPref = (prefs, type) => prefs.filter(p => p.$type === PREF + type).pop();
const clone = (x) => JSON.parse(JSON.stringify(x));

let prefsCache = null, prefsAt = 0, prefsBusy = null;
export let mutedWords = []; // always mirrors the last loaded or saved preferences

function usePrefs(prefs) {
  prefsCache = prefs; prefsAt = Date.now();
  mutedWords = lastPref(prefs, "mutedWordsPref")?.items || [];
  return prefs;
}
function forgetPrefs() { prefsCache = null; prefsBusy = null; mutedWords = []; }

// Cached for a few seconds so that startup and the home screen share one request.
// Pass fresh = true right before changing preferences: putPreferences replaces the whole list.
export function getPrefs(fresh = false) {
  if (!fresh && prefsCache && Date.now() - prefsAt < 15000) return Promise.resolve(clone(prefsCache));
  const req = prefsBusy ||= get("app.bsky.actor.getPreferences")
    .then(d => { if (prefsBusy === req) usePrefs(d.preferences || []); return d.preferences || []; })
    .finally(() => { if (prefsBusy === req) prefsBusy = null; });
  return req.then(clone);
}
async function putPrefs(prefs) {
  await post("app.bsky.actor.putPreferences", { preferences: prefs });
  usePrefs(prefs);
}

// Resolves when preferences (and so muted words) are known, or after a short wait; never rejects
export let prefsReady = Promise.resolve();
export function primePrefs() {
  prefsReady = Promise.race([getPrefs().catch(() => {}), new Promise(res => setTimeout(res, 3000))]);
}

// Account-wide default for «who can reply», set in the official app
export function defaultGate() {
  const rules = prefsCache && lastPref(prefsCache, "postInteractionSettingsPref")?.threadgateAllowRules;
  return rules ? clone(rules) : undefined;
}

export async function getSavedFeeds() {
  const prefs = await getPrefs();
  const v2 = prefs.find(p => p.$type === "app.bsky.actor.defs#savedFeedsPrefV2");
  if (v2) return v2.items;
  const v1 = prefs.find(p => p.$type === "app.bsky.actor.defs#savedFeedsPref");
  if (v1) return v1.saved.map(uri => ({
    id: uri, type: uri.includes("/app.bsky.graph.list/") ? "list" : "feed", value: uri, pinned: v1.pinned.includes(uri) }));
  return [{ id: "timeline", type: "timeline", value: "following", pinned: true }];
}

export async function setSavedFeeds(items) {
  const prefs = (await getPrefs(true)).filter(p => p.$type !== "app.bsky.actor.defs#savedFeedsPrefV2");
  prefs.push({ $type: "app.bsky.actor.defs#savedFeedsPrefV2", items });
  await putPrefs(prefs);
}

export async function saveFeed(uri, pinned = false) {
  const items = await getSavedFeeds();
  if (items.some(i => i.value === uri)) return;
  items.push({ id: Math.random().toString(36).slice(2, 12), type: uri.includes("/app.bsky.graph.list/") ? "list" : "feed", value: uri, pinned });
  await setSavedFeeds(items);
}
export async function unsaveFeed(uri) { await setSavedFeeds((await getSavedFeeds()).filter(i => i.value !== uri)); }
// dir: -1 up, +1 down. The order of saved feeds is the order of tabs on the home screen
export async function moveFeed(uri, dir) {
  const items = await getSavedFeeds(), i = items.findIndex(x => x.value === uri);
  let j = i + dir;
  while (items[j]?.type === "timeline") j += dir; // «Підписки» is not in the list on screen: step over it
  if (i < 0 || !items[j]) return;
  [items[i], items[j]] = [items[j], items[i]];
  await setSavedFeeds(items);
}

/* ---------- single settings stored in the account ---------- */
// type: "threadViewPref", or "feedViewPref" with feed = "home"
const samePref = (type, feed) => (p) => p.$type === PREF + type && (!feed || p.feed === feed);
export const pref = (type, feed) => (prefsCache || []).filter(samePref(type, feed)).pop() || {};
export async function updatePref(type, patch, feed) {
  const prefs = await getPrefs(true), cur = prefs.filter(samePref(type, feed)).pop() || {};
  await putPrefs(prefs.filter(p => !samePref(type, feed)(p)).concat({ ...cur, $type: PREF + type, ...(feed ? { feed } : {}), ...patch }));
}

/* ---------- content filters ---------- */
export const adultEnabled = () => !!lastPref(prefsCache || [], "adultContentPref")?.enabled;
export const setAdult = (enabled) => updatePref("adultContentPref", { enabled });
const LABEL_DEFAULT = { porn: "hide", sexual: "warn", "graphic-media": "warn", nudity: "ignore" };
// → "ignore" | "warn" | "hide" for one of the global labels
export function labelPref(label) {
  const v = (prefsCache || []).filter(p => p.$type === PREF + "contentLabelPref" && !p.labelerDid && p.label === label).pop()?.visibility;
  return v === "show" ? "ignore" : v || LABEL_DEFAULT[label] || "warn";
}
export async function setLabelPref(label, visibility) {
  const prefs = (await getPrefs(true)).filter(p => !(p.$type === PREF + "contentLabelPref" && !p.labelerDid && p.label === label));
  await putPrefs(prefs.concat({ $type: PREF + "contentLabelPref", label, visibility }));
}

// Who may start a chat with me: "all" | "following" | "none"
const CHAT_DECL = "chat.bsky.actor.declaration";
export async function getChatAccess() {
  try { return (await get("com.atproto.repo.getRecord", { repo: session.did, collection: CHAT_DECL, rkey: "self" })).value.allowIncoming || "following"; }
  catch { return "following"; }
}
export const setChatAccess = (allowIncoming) =>
  post("com.atproto.repo.putRecord", { repo: session.did, collection: CHAT_DECL, rkey: "self", record: { $type: CHAT_DECL, allowIncoming } });

export async function togglePin(uri) {
  const items = await getSavedFeeds();
  const it = items.find(i => i.value === uri);
  if (it) { it.pinned = !it.pinned; await setSavedFeeds(items); }
}

/* ---------- muted words ---------- */
export const sanitizeMutedWord = (v) => v.trim().replace(/^#(?!️)/, "").replace(/[\r\n­⁠‍‌​]+/g, "");

async function editMutedWords(change) {
  const prefs = await getPrefs(true);
  const items = change(lastPref(prefs, "mutedWordsPref")?.items || []);
  await putPrefs(prefs.filter(p => p.$type !== PREF + "mutedWordsPref").concat({ $type: PREF + "mutedWordsPref", items }));
}
// word: { value, targets: ["content", "tag"] | ["tag"], actorTarget: "all" | "exclude-following", expiresAt? }
export function addMutedWord(word) {
  const value = sanitizeMutedWord(word.value);
  return editMutedWords(items => items.filter(w => (w.value || "").toLowerCase() !== value.toLowerCase()).concat({ id: tid(), ...word, value }));
}
// words saved by old clients have no id and are matched by value
export const removeMutedWord = (word) =>
  editMutedWords(items => items.filter(w => !(w.id ? w.id === word.id : w.value === word.value)));

/* ---------- profile edit ---------- */
export async function getOwnProfileRecord() {
  try {
    return (await get("com.atproto.repo.getRecord", { repo: session.did, collection: "app.bsky.actor.profile", rkey: "self" })).value;
  } catch (e) { if (e.code === "RecordNotFound") return { $type: "app.bsky.actor.profile" }; throw e; } // never overwrite a profile that just failed to load
}
export async function pinPost(p, pin) {
  const rec = await getOwnProfileRecord();
  if (pin) rec.pinnedPost = strongRef(p); else delete rec.pinnedPost;
  await putOwnProfileRecord(rec);
}
export async function putOwnProfileRecord(record) {
  await post("com.atproto.repo.putRecord", { repo: session.did, collection: "app.bsky.actor.profile", rkey: "self", record });
}
