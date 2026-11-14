// Skybee — the welcome scene, only in the apps (desktop, Android, iOS): a sky over the hills and a meadow with line-drawn
// flowers; the bee flies across, lands above the name, then flies on into the logo in the app's header.
// It follows the look: the light theme — a cream day sky and a golden sun; the dark themes — night: a moon and twinkling
// stars, a lighter gold bee. The app colour repaints the sky and the sun (moon) and gives the bee a colour that suits them;
// red is the Eclipse (a black sun in a blood-red sky). Settings → Оформлення → «Анімація запуску»: full / short / off.
// Once per launch, about 3.5 s (short ≈ 1.5 s), a tap skips it. Off with «reduce motion» (system or Skybee).
import { bee } from "./ui.js";

const KEY = "skybee.splash";
const seen = (() => { try { return sessionStorage.getItem(KEY) === "1"; } catch { return false; } })();
const ls = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const calm = ls("skybee.calm") === "1";
const mode = ["short", "off"].includes(ls("skybee.intro")) ? ls("skybee.intro") : "full";
const inApp = !!(window.skybeeDesktop || window.Capacitor?.isNativePlatform?.());

/* ---------- the look: theme and app colour → sky, sun or moon, bee ---------- */
const hex = (c) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const toHex = (rgb) => "#" + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t)); // t of the way from a to b
function hsl(c) {
  const [r, g, b] = hex(c).map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  let h = !d ? 0 : mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}
function look() {
  const t = ls("skybee.theme") || "dark";
  const night = (t === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : t) !== "light";
  const c = /^#[0-9a-f]{6}$/i.test(ls("skybee.color") || "") ? ls("skybee.color").toLowerCase() : null;
  const h = c && hsl(c);
  if (h && (h.h < 16 || h.h > 340) && h.s > .4 && h.l > .2 && h.l < .8) // red: the Eclipse
    return { cls: "eclipse", vars: { "--sp-bee-hi": "#4a0c0c", "--sp-bee-lo": "#0c0000" } };
  if (c && night) return { cls: "night tinted", vars: { "--sp-c": c, "--sp-sky1": mix(c, "#05070f", .82), "--sp-sky2": mix(c, "#0b1020", .62),
    "--sp-moon": mix(c, "#fbf6e4", .7), "--sp-bee-hi": mix(c, "#ffffff", .62), "--sp-bee-lo": mix(c, "#ffffff", .3) } };
  if (c) return { cls: "tinted", vars: { "--sp-c": c, "--sp-sky1": mix(c, "#fbf7ee", .86), "--sp-sky2": mix(c, "#efe5d2", .7),
    "--sp-sun1": mix(c, "#ffffff", .45), "--sp-sun2": c, "--sp-bee-hi": mix(c, "#000000", .12), "--sp-bee-lo": mix(c, "#000000", .42) } };
  if (night) return { cls: "night", vars: { "--sp-bee-hi": "#f8e3a6", "--sp-bee-lo": "#d9b264" } }; // a lighter gold at night
  return { cls: "", vars: { "--sp-bee-hi": "#e8c97f", "--sp-bee-lo": "#b98f45" } };
}
function stars() {
  const r = rnd(11); let out = "";
  for (let i = 0; i < 90; i++) {
    const x = r() * 100, y = r() * 62, s = .8 + r() * 1.8;
    out += `<i style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;width:${s.toFixed(1)}px;height:${s.toFixed(1)}px;animation-delay:${(r() * 3).toFixed(2)}s;animation-duration:${(1.8 + r() * 2.4).toFixed(2)}s"></i>`;
  }
  return `<div class="sp-stars">${out}</div>`;
}

// a small seeded random, so the meadow looks the same every time
function rnd(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }

function meadow() {
  const r = rnd(7), blades = [], flowers = [];
  for (let i = 0; i < 260; i++) { // grass
    const x = r() * 1600, h = 40 + r() * 120, lean = (r() - .5) * 50, y = 300;
    blades.push(`<path d="M${x.toFixed(0)} ${y} Q${(x + lean * .3).toFixed(0)} ${(y - h * .6).toFixed(0)} ${(x + lean).toFixed(0)} ${(y - h).toFixed(0)}" stroke="${r() < .12 ? "#c9a85a" : r() < .5 ? "#7f8a72" : "#98a389"}" stroke-width="${(1 + r() * 1.4).toFixed(1)}"/>`);
  }
  for (let i = 0; i < 26; i++) { // line flowers on thin stems
    const x = 30 + r() * 1540, top = 60 + r() * 140, kind = r();
    const stem = `<path d="M${x.toFixed(0)} 300 C${(x - 10).toFixed(0)} ${(top + 80).toFixed(0)} ${(x + 8).toFixed(0)} ${(top + 40).toFixed(0)} ${x.toFixed(0)} ${top.toFixed(0)}"/>`;
    const leaf = `<path d="M${x.toFixed(0)} ${(top + 70).toFixed(0)} q${-18 - r() * 10} -8 -22 -26 q14 6 22 26"/>`;
    let head = "";
    const n = 5 + Math.floor(r() * 3), rr = 7 + r() * 7;
    if (kind < .55) for (let k = 0; k < n; k++) { // daisy
      const a = k / n * Math.PI * 2;
      head += `<ellipse cx="${(x + Math.cos(a) * rr).toFixed(1)}" cy="${(top + Math.sin(a) * rr).toFixed(1)}" rx="${(rr * .55).toFixed(1)}" ry="${(rr * .28).toFixed(1)}" transform="rotate(${(a * 180 / Math.PI).toFixed(0)} ${(x + Math.cos(a) * rr).toFixed(1)} ${(top + Math.sin(a) * rr).toFixed(1)})"/>`;
    } else if (kind < .8) { // tulip: a cup with a zigzag rim
      const c = (dx, dy) => `${(x + dx * rr).toFixed(1)} ${(top + dy * rr).toFixed(1)}`;
      head = `<path d="M${c(-.9, -1.1)} Q${c(-1, .9)} ${c(0, .9)} Q${c(1, .9)} ${c(.9, -1.1)} L${c(.45, -.45)} L${c(0, -1.2)} L${c(-.45, -.45)} Z"/>`;
    }
    else for (let k = 0; k < 6; k++) head += `<circle cx="${(x + (r() - .5) * 8).toFixed(1)}" cy="${(top + k * 7).toFixed(1)}" r="${(3 - k * .3).toFixed(1)}"/>`; // lavender
    flowers.push(`<g class="sp-flower" style="animation-delay:${(r() * 1.5).toFixed(2)}s;transform-origin:${x.toFixed(0)}px 300px">${stem}${leaf}${head}</g>`);
  }
  return `<svg class="sp-meadow" viewBox="0 0 1600 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <path d="M0 40 C300 10 520 60 800 34 C1080 8 1300 50 1600 26 V300 H0Z" fill="#b9c3a6"/>
    <path d="M0 40 C300 10 520 60 800 34 C1080 8 1300 50 1600 26" fill="none" stroke="#d1b366" stroke-width="1.5" opacity=".7"/>
    <g fill="none" stroke-linecap="round">${blades.join("")}</g>
    <g fill="none" stroke="#5f6458" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${flowers.join("")}</g></svg>`;
}

const HILLS = `<svg class="sp-hills" viewBox="0 0 1600 400" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <g stroke="#c9a85a" stroke-width="1.6" stroke-linejoin="round">
    <path d="M0 250 L160 190 L240 215 L330 175 L470 260 L600 230 L760 120 L900 205 L1000 150 L1120 70 L1260 160 L1380 120 L1600 200 V400 H0Z" fill="#ebdfcb"/>
    <path d="M0 300 L120 255 L260 285 L420 230 L560 300 L700 250 L880 300 L1040 210 L1200 260 L1360 200 L1600 280 V400 H0Z" fill="#e3cfb8"/>
    <path d="M0 360 L200 320 L380 350 L560 300 L760 345 L980 290 L1180 340 L1400 300 L1600 340 V400 H0Z" fill="#dcc4b0"/>
  </g></svg>`;

function start() {
  try { sessionStorage.setItem(KEY, "1"); } catch {}
  const el = document.createElement("div");
  el.id = "splash";
  el.setAttribute("aria-hidden", "true");
  const lk = look();
  if (lk.cls) el.className = lk.cls;
  for (const [k, v] of Object.entries(lk.vars)) el.style.setProperty(k, v);
  // the bee is drawn with the splash's own gradient, so its colour can follow the scene
  const beeSvg = bee(160, true).replace("url(#beeGold)", "url(#spBeeG)");
  el.innerHTML = `<svg width="0" height="0" style="position:absolute"><defs><linearGradient id="spBeeG" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" style="stop-color:var(--sp-bee-hi)"/><stop offset="1" style="stop-color:var(--sp-bee-lo)"/></linearGradient></defs></svg>
    ${lk.cls.includes("night") ? stars() : ""}<div class="sp-sun"></div>${HILLS}${meadow()}
    <svg class="sp-trail"><path/></svg>
    <div class="sp-bee">${beeSvg}</div>
    <div class="sp-title"><b>Skybee</b><span>клієнт для Bluesky</span></div>`;
  document.body.appendChild(el);
  if (mode === "short") el.classList.add("short");
  const b = el.querySelector(".sp-bee"), trail = el.querySelector(".sp-trail path");
  const wings = b.querySelectorAll("svg > g > path");
  // the three wing petals flap around the point where they meet the body
  for (const w of [...wings].slice(0, 3)) w.classList.add("sp-wing");
  b.querySelector(".fl")?.classList.add("sp-wing");

  const W = () => innerWidth, H = () => innerHeight;
  // the flight: in from the lower left, up over the hills, a swing to the right and back to the middle
  const P = () => {
    const w = W(), h = H(), portrait = h > w;
    const end = [w * .5, h * (portrait ? .36 : .34)];
    return [
      [[-w * .15, h * .8], [w * .15, h * .25], [w * .42, h * .16], [w * (portrait ? .78 : .7), h * .3]],
      [[w * (portrait ? .78 : .7), h * .3], [w * (portrait ? 1 : .86), h * .42], [w * .7, h * .62], end],
    ];
  };
  const bez = (s, t) => { const u = 1 - t; return [0, 1].map(i => u * u * u * s[0][i] + 3 * u * u * t * s[1][i] + 3 * u * t * t * s[2][i] + t * t * t * s[3][i]); };
  const ease = (t) => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const FLY = mode === "short" ? 700 : 2400, t0 = performance.now(), pts = [];
  let raf, done = false;
  const size = () => Math.max(70, Math.min(W(), H()) * .2);
  const frame = (now) => {
    const k = Math.min(1, (now - t0) / FLY), e = ease(k), segs = P();
    const seg = e < .55 ? segs[0] : segs[1], t = e < .55 ? e / .55 : (e - .55) / .45;
    const [x, y] = bez(seg, t), [x2, y2] = bez(seg, Math.min(1, t + .02));
    const ang = Math.max(-28, Math.min(28, Math.atan2(y2 - y, x2 - x) * 180 / Math.PI)) * (1 - Math.max(0, (k - .85) / .15));
    const s = size();
    b.style.width = b.style.height = s + "px";
    b.style.transform = `translate(${x - s / 2}px, ${y - s / 2}px) rotate(${ang}deg)`;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    trail.setAttribute("d", "M" + pts.join(" L"));
    if (k < 1) raf = requestAnimationFrame(frame);
    else { el.classList.add("landed"); setTimeout(finish, mode === "short" ? 500 : 1100); }
  };
  raf = requestAnimationFrame(frame);
  // the end: the scene fades and the bee flies on into the logo in the app's header (if one is on screen)
  function finish() {
    if (done) return; done = true;
    cancelAnimationFrame(raf);
    const logo = [...document.querySelectorAll(".topbar .brand .bee, nav.side .logo .bee")]
      .find(x => { const r = x.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.bottom > 0 && r.top < innerHeight; }); // not the hidden side menu
    if (logo && !calm) {
      const from = b.getBoundingClientRect(), to = logo.getBoundingClientRect();
      b.style.transition = "none";
      b.style.position = "fixed"; b.style.zIndex = "1001";
      b.style.transform = `translate(${from.left}px, ${from.top}px)`; b.style.width = from.width + "px"; b.style.height = from.height + "px";
      document.body.appendChild(b); // out of the fading scene
      logo.style.visibility = "hidden";
      void b.offsetWidth;
      b.style.transition = "transform .65s cubic-bezier(.5,0,.2,1), width .65s cubic-bezier(.5,0,.2,1), height .65s cubic-bezier(.5,0,.2,1), filter .65s";
      b.style.transform = `translate(${to.left}px, ${to.top}px)`; b.style.width = to.width + "px"; b.style.height = to.height + "px";
      b.style.filter = "none";
      setTimeout(() => { logo.style.visibility = ""; b.remove(); }, 700);
    }
    el.classList.add("out");
    setTimeout(() => el.remove(), 750); // after the flying bee: its gradient lives in the scene
  }
  // a tap, click or key skips it
  el.addEventListener("pointerdown", finish);
  addEventListener("keydown", finish, { once: true });
  setTimeout(finish, 6000); // whatever happens, the app is never hidden for long
}

// last, when everything above is defined; a failure here must never stop the app from loading
try { if (inApp && mode !== "off" && !seen && !calm && !matchMedia("(prefers-reduced-motion: reduce)").matches) start(); }
catch { document.getElementById("splash")?.remove(); }
