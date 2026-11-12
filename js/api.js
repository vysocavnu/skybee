// Skybee — AT Protocol / Bluesky API layer
const PUBLIC_API = "https://public.api.bsky.app";
const CHAT_PROXY = "did:web:api.bsky.chat#bsky_chat";
const MOD_PROXY = "did:plc:ar7c4by46qjdydhdevvrndac#atproto_labeler";
const KEY = "skybee.session";

export let session = null;

export function loadSession() {
  try { session = JSON.parse(localStorage.getItem(KEY)); } catch { session = null; }
  return session;
}
function saveSession() { try { localStorage.setItem(KEY, JSON.stringify(session)); } catch {} }
export function logout() { session = null; try { localStorage.removeItem(KEY); } catch {} }

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

export async function login(handle, password) {
  const { did, pds } = await resolvePds(handle);
  const r = await fetch(`${pds}/xrpc/com.atproto.server.createSession`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: did, password: password.trim() }) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error === "AuthenticationRequired" ? "Неправильний нік або пароль" : (d.message || d.error));
  session = { did: d.did, handle: d.handle, accessJwt: d.accessJwt, refreshJwt: d.refreshJwt, pds };
  saveSession();
  return session;
}

async function refresh() {
  const r = await fetch(`${session.pds}/xrpc/com.atproto.server.refreshSession`, {
    method: "POST", headers: { Authorization: `Bearer ${session.refreshJwt}` } });
  if (!r.ok) { logout(); location.hash = "#/"; location.reload(); throw new Error("Сесія закінчилась, увійди знову"); }
  const d = await r.json();
  Object.assign(session, { accessJwt: d.accessJwt, refreshJwt: d.refreshJwt, handle: d.handle });
  saveSession();
}

/* ---------- XRPC ---------- */
// opts: { params, body, raw (Blob), contentType, proxy, retry }
export async function xrpc(method, opts = {}) {
  const { params, body, raw, contentType, proxy, retry = true } = opts;
  const url = new URL(`${session.pds}/xrpc/${method}`);
  if (params) for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach(x => url.searchParams.append(k, x));
    else url.searchParams.set(k, v);
  }
  const headers = { Authorization: `Bearer ${session.accessJwt}` };
  if (proxy) headers["atproto-proxy"] = proxy;
  let payload;
  if (raw) { payload = raw; headers["Content-Type"] = contentType || raw.type || "application/octet-stream"; }
  else if (body) { payload = JSON.stringify(body); headers["Content-Type"] = "application/json"; }
  const r = await fetch(url, { method: payload ? "POST" : "GET", headers, body: payload });
  const data = r.headers.get("content-type")?.includes("json") ? await r.json() : null;
  if (!r.ok) {
    if (retry && (data?.error === "ExpiredToken" || data?.error === "InvalidToken")) {
      await refresh(); return xrpc(method, { ...opts, retry: false });
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

export async function getPrefs() { return (await get("app.bsky.actor.getPreferences")).preferences || []; }

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
  const prefs = (await getPrefs()).filter(p => p.$type !== "app.bsky.actor.defs#savedFeedsPrefV2");
  prefs.push({ $type: "app.bsky.actor.defs#savedFeedsPrefV2", items });
  await post("app.bsky.actor.putPreferences", { preferences: prefs });
}

export async function saveFeed(uri, pinned = false) {
  const items = await getSavedFeeds();
  if (items.some(i => i.value === uri)) return;
  items.push({ id: Math.random().toString(36).slice(2, 12), type: uri.includes("/app.bsky.graph.list/") ? "list" : "feed", value: uri, pinned });
  await setSavedFeeds(items);
}
export async function unsaveFeed(uri) { await setSavedFeeds((await getSavedFeeds()).filter(i => i.value !== uri)); }
export async function togglePin(uri) {
  const items = await getSavedFeeds();
  const it = items.find(i => i.value === uri);
  if (it) { it.pinned = !it.pinned; await setSavedFeeds(items); }
}

/* ---------- profile edit ---------- */
export async function getOwnProfileRecord() {
  try {
    return (await get("com.atproto.repo.getRecord", { repo: session.did, collection: "app.bsky.actor.profile", rkey: "self" })).value;
  } catch { return { $type: "app.bsky.actor.profile" }; }
}
export async function putOwnProfileRecord(record) {
  await post("com.atproto.repo.putRecord", { repo: session.did, collection: "app.bsky.actor.profile", rkey: "self", record });
}
