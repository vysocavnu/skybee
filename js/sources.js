// Skybee — post sources (shared by deck columns and own feeds), the own-feed engine and the media grid
import * as api from "./api.js";
import { esc, enc, renderPost, postHref, mutedBy, warnLabel } from "./ui.js";

/* ---------- sources ---------- */
// A source is { type, value?, sort?, label }. fetch → { items: [{ post, reason?, reply? }], cursor }
export const TYPES = {
  timeline: "Підписки",
  feed: "Фід",
  list: "Список",
  search: "Пошук",
  author: "Профіль",
  notifications: "Сповіщення", // deck only
  myfeed: "Моя стрічка",       // deck only
};
export const ICON = { timeline: "🏠", feed: "#️⃣", list: "📋", search: "🔍", author: "👤", notifications: "🔔", myfeed: "🧩" };

export async function fetchSource(src, cursor, as) {
  const o = as ? { as } : undefined;
  const g = (m, params) => api.get(m, { ...params, cursor }, { ...o, ...(m === "app.bsky.feed.getFeed" ? api.feedHeaders() : null) });
  if (src.type === "timeline") { const d = await g("app.bsky.feed.getTimeline", { limit: 30 }); return { items: d.feed, cursor: d.cursor }; }
  if (src.type === "feed") { const d = await g("app.bsky.feed.getFeed", { feed: src.value, limit: 30 }); return { items: d.feed, cursor: d.cursor }; }
  if (src.type === "list") { const d = await g("app.bsky.feed.getListFeed", { list: src.value, limit: 30 }); return { items: d.feed, cursor: d.cursor }; }
  if (src.type === "author") { const d = await g("app.bsky.feed.getAuthorFeed", { actor: src.value, filter: src.sort || "posts_and_author_threads", limit: 30 }); return { items: d.feed, cursor: d.cursor }; }
  if (src.type === "search") { const d = await g("app.bsky.feed.searchPosts", { q: src.value, sort: src.sort || "latest", limit: 30 }); return { items: d.posts.map(post => ({ post })), cursor: d.cursor }; }
  throw new Error("Невідоме джерело");
}

// Links pasted from bsky.app (or Skybee) → a source
export async function sourceFromUrl(url) {
  const m = String(url).match(/profile\/([^/?#]+)\/(feed|lists)\/([^/?#]+)/);
  if (!m) return null;
  let did = decodeURIComponent(m[1]);
  if (!did.startsWith("did:")) did = (await api.get("com.atproto.identity.resolveHandle", { handle: did })).did;
  return m[2] === "feed"
    ? { type: "feed", value: `at://${did}/app.bsky.feed.generator/${m[3]}` }
    : { type: "list", value: `at://${did}/app.bsky.graph.list/${m[3]}` };
}

/* ---------- media grid ---------- */
// Only posts with pictures or video, as square tiles; a click opens the post
function mediaOf(post) {
  let e = post.embed;
  if (e?.$type === "app.bsky.embed.recordWithMedia#view") e = e.media;
  if (e?.$type === "app.bsky.embed.images#view") return { thumb: e.images[0].thumb, n: e.images.length, alt: e.images[0].alt };
  if (e?.$type === "app.bsky.embed.video#view" && e.thumbnail) return { thumb: e.thumbnail, video: true, alt: e.alt };
  return null;
}
export function tiles(items) {
  return items.map(({ post }) => {
    if (!post || mutedBy(post)) return "";
    const m = mediaOf(post), label = warnLabel(post);
    if (!m || label?.hide) return "";
    return `<a class="tile${label ? " blur" : ""}" href="${postHref(post)}" title="${esc(m.alt || post.record?.text || "")}">
      <img src="${esc(m.thumb)}" alt="${esc(m.alt || "")}" loading="lazy">${m.video ? `<span class="tbadge">▶</span>` : m.n > 1 ? `<span class="tbadge">${m.n}</span>` : ""}</a>`;
  });
}
export const postsHtml = (items, grid) => grid ? tiles(items)
  : items.map(it => !it.post || mutedBy(it.post) || warnLabel(it.post)?.hide ? "" : renderPost(it.post, { reason: it.reason, parent: it.reply?.parent }));

/* ---------- own feeds («Мої стрічки») ---------- */
// Built in Skybee from sources + filters + sorting and run right here in the app (no feed server needed).
// Stored in the user's repository as one record, so they follow the account to every device.
const NSID = "io.github.vysocavnu.skybee.feeds";
const LOCAL = () => "skybee.myfeeds." + api.session?.did;
let mine = null;

export const blankFeed = () => ({
  id: api.tid(), name: "", sources: [], include: [], exclude: [], replies: "all", hideReposts: false, hideQuotes: false,
  media: "any", langs: [], minLikes: 0, maxAgeHours: 0, sort: "new", pinned: false,
});

export async function myFeeds(fresh = false) {
  if (mine && !fresh) return mine;
  try { mine = JSON.parse(localStorage.getItem(LOCAL())) || null; } catch {}
  const net = api.get("com.atproto.repo.getRecord", { repo: api.session.did, collection: NSID, rkey: "self" })
    .then(d => (Array.isArray(d.value?.feeds) ? d.value.feeds : []), (e) => (e.status === 400 || e.code === "RecordNotFound" ? [] : null))
    .then(list => { if (list) { mine = list; try { localStorage.setItem(LOCAL(), JSON.stringify(list)); } catch {} } return mine || []; });
  return mine && !fresh ? (net.catch(() => {}), mine) : net;
}
export async function saveMyFeeds(list) {
  mine = list;
  try { localStorage.setItem(LOCAL(), JSON.stringify(list)); } catch {}
  await api.post("com.atproto.repo.putRecord", { repo: api.session.did, collection: NSID, rkey: "self", validate: false,
    record: { $type: NSID, feeds: list, updatedAt: new Date().toISOString() } });
}
export async function myFeed(id) { return (await myFeeds()).find(f => f.id === id); }

const words = (s) => String(s || "").split(",").map(w => w.trim().toLowerCase()).filter(Boolean);
export const parseWords = words;

function haystack(p) {
  const r = p.record || {}, e = p.embed?.media || p.embed;
  const bits = [r.text, ...(r.tags || []), ...(r.facets || []).flatMap(f => f.features.map(x => x.tag || x.uri || ""))];
  if (e?.images) bits.push(...e.images.map(i => i.alt));
  if (e?.external) bits.push(e.external.title, e.external.description, e.external.uri);
  return bits.filter(Boolean).join(" \n").toLowerCase();
}
function kindOf(p) {
  let e = p.embed;
  const quote = /app\.bsky\.embed\.record(WithMedia)?#view/.test(e?.$type || "");
  if (e?.$type === "app.bsky.embed.recordWithMedia#view") e = e.media;
  return { quote, images: e?.$type === "app.bsky.embed.images#view", video: e?.$type === "app.bsky.embed.video#view", link: e?.$type === "app.bsky.embed.external#view" };
}
// matches a whole word or a phrase, not a piece of another word (Unicode-aware)
const hit = (text, w) => new RegExp(`(^|[^\\p{L}\\p{N}_])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}_])`, "u").test(text);

function passes(f, it) {
  const p = it.post, r = p.record || {};
  if (!p?.author || mutedBy(p) || warnLabel(p)?.hide) return false;
  const reply = !!r.reply, repost = it.reason?.$type === "app.bsky.feed.defs#reasonRepost";
  if (f.replies === "none" && reply) return false;
  if (f.replies === "only" && !reply) return false;
  if (f.hideReposts && repost) return false;
  const k = kindOf(p);
  if (f.hideQuotes && k.quote) return false;
  if (f.media === "media" && !(k.images || k.video)) return false;
  if (f.media === "images" && !k.images) return false;
  if (f.media === "video" && !k.video) return false;
  if (f.media === "links" && !k.link) return false;
  if (f.media === "text" && (k.images || k.video || k.link)) return false;
  if (f.minLikes && (p.likeCount || 0) < f.minLikes) return false;
  if (f.maxAgeHours && Date.now() - Date.parse(r.createdAt || p.indexedAt) > f.maxAgeHours * 3600e3) return false;
  if (f.langs?.length && !(r.langs || []).some(l => f.langs.includes(l.split("-")[0].toLowerCase()))) return false;
  if (f.include?.length || f.exclude?.length) {
    const t = haystack(p);
    if (f.include?.length && !f.include.some(w => hit(t, w))) return false;
    if (f.exclude?.some(w => hit(t, w))) return false;
  }
  return true;
}
const when = (it) => Date.parse(it.reason?.indexedAt || it.post.indexedAt) || 0;
const score = (p) => (p.likeCount || 0) + 2 * (p.repostCount || 0) + 1.5 * (p.replyCount || 0) + 2 * (p.quoteCount || 0);
const SORT = {
  new: (a, b) => when(b) - when(a),
  likes: (a, b) => score(b.post) - score(a.post),
  // «hot»: engagement that fades with age
  hot: (a, b) => score(b.post) / Math.pow((Date.now() - when(b)) / 3600e3 + 2, 1.5) - score(a.post) / Math.pow((Date.now() - when(a)) / 3600e3 + 2, 1.5),
};

// Returns page() → { items, more }. Every call takes the next page of every source, filters and sorts the batch.
// Strict filters can empty a batch, so it keeps reading (a few rounds at most) until there is something to show.
export function runFeed(f, as) {
  const st = (f.sources.length ? f.sources : [{ type: "timeline" }]).map(s => ({ s, cursor: undefined, done: false }));
  const seen = new Set();
  return async function page() {
    let out = [];
    for (let round = 0; round < 6 && out.length < 12; round++) {
      const live = st.filter(x => !x.done);
      if (!live.length) break;
      const got = await Promise.all(live.map(async x => {
        try {
          const r = await fetchSource(x.s, x.cursor, as);
          x.cursor = r.cursor; if (!r.cursor || !r.items.length) x.done = true;
          return r.items;
        } catch { x.done = true; return []; }
      }));
      for (const it of got.flat()) {
        if (!it.post || seen.has(it.post.uri)) continue;
        seen.add(it.post.uri);
        if (passes(f, it)) out.push(it);
      }
    }
    out.sort(SORT[f.sort] || SORT.new);
    return { items: out, more: st.some(x => !x.done) };
  };
}

// The same «paged» contract the screens use: fetchPage(cursor) → { html, cursor }
export function feedPager(src, { as, grid = false } = {}) {
  if (src.type === "myfeed") {
    let page = null;
    return async () => {
      if (!page) { const f = await myFeed(src.value); if (!f) throw new Error("Стрічку видалено"); page = runFeed(f, as); }
      const { items, more } = await page();
      return { html: postsHtml(items, grid), cursor: more ? "more" : undefined, keepGoing: more };
    };
  }
  return async (cursor) => {
    const d = await fetchSource(src, cursor, as);
    return { html: postsHtml(d.items, grid), cursor: d.cursor, keepGoing: !!d.cursor && d.items.length > 0 };
  };
}

export const myFeedHref = (f) => `#/myfeed/${enc(f.id)}`;
