// «Лінза»: who blocks an account and which lists it is on — what skylens.redflag.ps and ClearSky show, inside Skybee.
// Blocks and list entries are public records; the open Constellation index answers «who points at this account»,
// everything else comes from Bluesky itself.
import * as api from "./api.js";
import { esc, renderActor, empty, spinner, name } from "./ui.js";
import { header, paged, renderListCard } from "./views.js";

const INDEX = "https://constellation.microcosm.blue";
const BLOCK = "app.bsky.graph.block", LISTITEM = "app.bsky.graph.listitem";

async function index(path, did, collection, extra = {}) {
  const qs = new URLSearchParams({ target: did, collection, path: ".subject", ...extra });
  const r = await fetch(`${INDEX}/${path}?${qs}`, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("Індекс блокувань зараз недоступний, спробуйте пізніше");
  return r.json();
}
const count = (did, collection) => index("links/count", did, collection).then(d => d.total, () => null);

// A record key (TID) starts with its creation time; hand-made keys give nonsense dates and are skipped
const TID = "234567abcdefghijklmnopqrstuvwxyz";
function tidDate(rkey) {
  if (!/^[2-7a-z]{13}$/.test(rkey)) return "";
  let us = 0n;
  for (const c of rkey.slice(0, 11)) us = us * 32n + BigInt(TID.indexOf(c));
  const d = new Date(Number(us / 1000n));
  return d > new Date("2022-01-01") && d < new Date(Date.now() + 864e5) ? d.toLocaleDateString("uk-UA", { day: "numeric", month: "long", year: "numeric" }) : "";
}

async function blockedByPage(did, cursor) {
  const d = await index("links", did, BLOCK, { limit: 25, ...(cursor ? { cursor } : {}) });
  const recs = d.linking_records || [];
  if (!recs.length) return { html: [], cursor: null };
  const { profiles } = await api.get("app.bsky.actor.getProfiles", { actors: [...new Set(recs.map(r => r.did))] });
  const byDid = new Map(profiles.map(p => [p.did, p]));
  return { cursor: d.cursor, html: recs.filter(r => byDid.has(r.did)).map(r => { // deleted accounts have no profile
    const when = tidDate(r.rkey);
    return renderActor(byDid.get(r.did), `<div class="muted small">⛔ Заблокував(ла)${when ? " " + when : ""}</div>`);
  }) };
}

// The index knows only «this list entry points here»; the entry itself (which list) is read from its owner's server
async function listOf(rec) {
  try {
    const { pds } = await api.resolvePds(rec.did);
    const r = await fetch(`${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(rec.did)}&collection=${LISTITEM}&rkey=${encodeURIComponent(rec.rkey)}`);
    const uri = r.ok && (await r.json()).value?.list;
    return typeof uri === "string" && uri.startsWith("at://") ? uri : null;
  } catch { return null; }
}
async function onListsPage(did, cursor, seen) {
  const d = await index("links", did, LISTITEM, { limit: 12, ...(cursor ? { cursor } : {}) });
  const uris = (await Promise.all((d.linking_records || []).map(listOf))).filter(u => u && !seen.has(u) && seen.add(u));
  const lists = await Promise.all(uris.map(u => api.get("app.bsky.graph.getList", { list: u, limit: 1 }).then(x => x.list, () => null)));
  return { cursor: d.cursor, html: lists.filter(Boolean).map(l =>
    renderListCard(l).replace(/<\/div><\/div>$/, `<div class="muted small">від ${name(l.creator)} · @${esc(l.creator.handle)}</div></div></div>`)) };
}

// A page of the index may consist only of deleted accounts or lists: read on a little so the scroll does not stop early
async function filled(fetchPage, cursor) {
  let html = [];
  for (let i = 0; i < 4; i++) {
    const p = await fetchPage(cursor);
    html = html.concat(p.html); cursor = p.cursor;
    if (html.length || !cursor) break;
  }
  return { html, cursor };
}

export async function lens(el, { actor, tab = "blockedby" }) {
  el.innerHTML = header("Блокування та списки", true) + spinner();
  const p = await api.get("app.bsky.actor.getProfile", { actor: actor || api.session.did });
  const base = `#/lens/${encodeURIComponent(p.did)}`, mine = p.did === api.session.did;
  el.innerHTML = header("Блокування та списки", true) + `
    <div class="card small" style="margin:12px 16px"><b>${name(p)}</b> <span class="muted">@${esc(p.handle)}</span>
      <p class="muted" style="margin:6px 0 0">Блокування й записи у списках — публічні дані Bluesky. Тут вони з відкритого індексу Constellation, який веде облік із січня 2025 року;
      старіші блокування видно на <a href="https://skylens.redflag.ps/#/${encodeURIComponent(p.handle)}" target="_blank" rel="noopener">Skylens</a>.</p></div>
    <div class="tabs"><a class="${tab === "blockedby" ? "on" : ""}" href="${base}">${mine ? "Хто заблокував мене" : "Хто заблокував"} <span class="muted" id="lcBlock"></span></a>
      <a class="${tab === "lists" ? "on" : ""}" href="${base}/lists">У списках <span class="muted" id="lcLists"></span></a></div>`;
  for (const [id, coll] of [["lcBlock", BLOCK], ["lcLists", LISTITEM]])
    count(p.did, coll).then(n => { const s = el.querySelector("#" + id); if (s && n != null) s.textContent = n.toLocaleString("uk-UA"); });
  const seen = new Set();
  return paged(el, (cursor) => filled(tab === "lists" ? (c) => onListsPage(p.did, c, seen) : (c) => blockedByPage(p.did, c), cursor));
}
