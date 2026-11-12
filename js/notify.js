// Skybee — system notifications while the app is open (a tab, even a background one, or the installed app).
// Real push for a closed app needs a server that watches the network; a static site has none.
import * as api from "./api.js";
import { matchMuted } from "./ui.js";

// «<name> <reason>» — shared with the notifications screen
export const NREASON = {
  like: "вподобав(-ла) ваш пост", repost: "поширив(-ла) ваш пост", follow: "стежить за вами",
  reply: "відповів(-ла) вам", mention: "згадав(-ла) вас", quote: "процитував(-ла) ваш пост",
  "like-via-repost": "вподобав(-ла) ваше поширення", "repost-via-repost": "поширив(-ла) ваше поширення",
  "starterpack-joined": "приєднався(-лась) через ваш стартовий набір", verified: "вас верифіковано", unverified: "верифікацію знято",
  "subscribed-post": "опублікував(-ла) новий пост",
};
const WITH_TEXT = ["reply", "mention", "quote", "subscribed-post"];

const KEY = "skybee.notify";
const getItem = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const setItem = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
// per account: the newest notification (n) and chat message (c) already handled, as ISO timestamps
const markKey = () => `skybee.notified.${api.session.did}`;

export const supported = () => "Notification" in window;
export const enabled = () => supported() && Notification.permission === "granted" && getItem(KEY) === "1";

export async function enable() {
  if (!supported()) return false;
  if (Notification.permission !== "granted" && await Notification.requestPermission() !== "granted") return false;
  const now = new Date().toISOString();
  setItem(KEY, "1"); setItem(markKey(), JSON.stringify({ n: now, c: now })); // only what arrives from now on
  show("Skybee", "Сповіщення увімкнено", "#/notifications", "skybee-on");
  return true;
}
export const disable = () => setItem(KEY, null);

export async function show(title, body, hash, tag) {
  const opts = { body, tag, icon: "icons/icon-192.png", data: { hash } };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg?.active) return await reg.showNotification(title, opts); // the only way on Android; clicks are handled in sw.js
  } catch { /* fall back to a page notification */ }
  try {
    const n = new Notification(title, opts);
    n.onclick = () => { window.focus(); location.hash = hash; n.close(); };
  } catch { /* not allowed here */ }
}

let lastCount = -1;
// Called after every badge poll: `count` of unread notifications and the chat list (null when chats are unavailable)
export async function check(count, convos) {
  if (!enabled()) return;
  const me = api.session.did, now = new Date().toISOString(), who = (a) => a?.displayName || a?.handle || "Хтось";
  let mark = {};
  try { mark = JSON.parse(getItem(markKey())) || {}; } catch {}
  const since = { n: mark.n || now, c: mark.c || now }, fresh = [];

  if (count && count !== lastCount) {
    const d = await api.get("app.bsky.notification.listNotifications", { limit: 30 });
    for (const n of d.notifications) {
      if (n.isRead || n.indexedAt <= since.n) continue;
      if (n.indexedAt > (mark.n || "")) mark.n = n.indexedAt;
      const rec = n.record || {}, body = WITH_TEXT.includes(n.reason) ? rec.text || "" : "";
      if (body && matchMuted(api.mutedWords, { text: body, facets: rec.facets, tags: rec.tags, langs: rec.langs, actor: n.author })) continue;
      fresh.push({ title: `${who(n.author)} ${NREASON[n.reason] || "— нове сповіщення"}`, body, hash: "#/notifications", tag: n.uri });
    }
  }
  lastCount = count;

  for (const c of convos || []) {
    const m = c.lastMessage;
    if (!c.unreadCount || c.muted || !m?.sentAt || m.sender?.did === me || m.sentAt <= since.c) continue;
    if (m.sentAt > (mark.c || "")) mark.c = m.sentAt;
    fresh.push({ title: `${who(c.members.find(x => x.did === m.sender?.did))}: нове повідомлення`, body: m.text || "", hash: `#/messages/${c.id}`, tag: `chat-${c.id}` });
  }

  setItem(markKey(), JSON.stringify({ n: mark.n || now, c: mark.c || now }));
  // while the user is looking at Skybee, the badges in the menu are enough
  if (!fresh.length || (document.visibilityState === "visible" && document.hasFocus())) return;
  for (const f of fresh.slice(0, 3)) show(f.title, f.body, f.hash, f.tag);
  if (fresh.length > 3) show("Skybee", `І ще нових сповіщень: ${fresh.length - 3}`, "#/notifications", "skybee-more");
}
