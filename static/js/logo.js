import { Launch } from "./launch.js";
import { MarkPlayer, STORY_END, markSVG } from "./mark.js";
import { THEME, gridSVG } from "./theme.js";

// The EIMC mark: "everything is written on unfolded paper".
//
// A sheet unfolded from quarters (two creases, four facets lit like folded paper; a CSS 3D unfold on
// boot: right flap over, bottom flap down) on which the market's story is then written by mark.js: an
// order-flow heatmap with a light liquidity pool below and a heavy wall above, and a price line in
// broad-nib ink that probes the pool, sweeps it, reverses, breaks through the wall, retests it and runs
// to a new high — the live tip, which beats with the chart's real ticks. One component at any size:
// the sheet is laid out in em with 1em = size / 64, the chart is a canvas on the same 64-unit grid.

export function logoHTML({ size = 30, boot = true, tempo = 0.55, cls = "" } = {}) {
  return `<span class="mk ${boot ? "unfold" : ""} ${cls}" style="--mk:${size}px;--mkT:${tempo}" data-size="${size}" data-tempo="${tempo}" aria-hidden="true">
  <span class="mk-3d"><span class="mk-persp"><span class="mk-sheet">
    <span class="mk-f mk-tl"></span>
    <span class="mk-f mk-bt"><i class="mk-sh"></i></span>
    <span class="mk-tr"><span class="mk-f mk-fr"></span><span class="mk-bk"></span></span>
  </span></span></span>
  <canvas class="mk-cv"></canvas>
</span>`;
}

// Options for a MarkPlayer drawing this mark (in a worker, or here).
export function markOptions(mk, extra = {}) {
  return {
    size: +mk.dataset.size || 30,
    tempo: +mk.dataset.tempo || 1,
    dpr: Math.min(3, devicePixelRatio || 1),
    boot: mk.classList.contains("unfold"),
    reduce: matchMedia("(prefers-reduced-motion: reduce)").matches,
    ...extra,
  };
}

// Static version for the browser tab: the same sheet, the two bands, the journey and the tip.
export function faviconURL() {
  const f = (d, fill) => `<path d="${d}" fill="${fill}"/>`;
  const TL = "M4 19A15 15 0 0 1 19 4H32V32H4Z", TR = "M32 4H45A15 15 0 0 1 60 19V32H32Z";
  const BL = "M4 32H32V60H19A15 15 0 0 1 4 45Z", BR = "M32 32H60V45A15 15 0 0 1 45 60H32Z";
  const m = markSVG(), [tx, ty] = m.tip;
  const g = THEME.gold, s = THEME.sheet;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>
<linearGradient id="g" x1="4" y1="4" x2="60" y2="60" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="${s.a}"/><stop offset=".5" stop-color="${s.b}"/><stop offset="1" stop-color="${s.c}"/></linearGradient>
<linearGradient id="au" x1="13" y1="52" x2="55" y2="10" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="${g.deep}"/><stop offset=".14" stop-color="${g.mid}"/>
<stop offset=".3" stop-color="${g.rich}"/><stop offset=".42" stop-color="${g.mid}"/>
<stop offset=".56" stop-color="${g.rich}"/><stop offset=".68" stop-color="${g.deep}"/>
<stop offset=".8" stop-color="${g.rich}"/><stop offset=".92" stop-color="${g.bright}"/>
<stop offset="1" stop-color="${g.spec}"/></linearGradient>
<linearGradient id="sheen" x1="13" y1="52" x2="55" y2="10" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="${g.sheen}" stop-opacity="0"/><stop offset=".14" stop-color="${g.sheen}" stop-opacity=".25"/>
<stop offset=".26" stop-color="#fff" stop-opacity=".7"/><stop offset=".34" stop-color="${g.sheen}" stop-opacity=".1"/>
<stop offset=".5" stop-color="${g.sheen}" stop-opacity="0"/><stop offset=".63" stop-color="#fff" stop-opacity=".6"/>
<stop offset=".71" stop-color="${g.sheen}" stop-opacity=".15"/><stop offset=".88" stop-color="#fff" stop-opacity=".5"/>
<stop offset="1" stop-color="${g.sheen}" stop-opacity="0"/></linearGradient>
<filter id="grain" x="-20%" y="-20%" width="140%" height="140%">
<feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="3" seed="9" result="n"/>
<feColorMatrix in="n" type="saturate" values="0" result="m"/>
<feComponentTransfer in="m" result="t"><feFuncA type="linear" slope=".55" intercept="-.12"/></feComponentTransfer>
<feComposite in="t" in2="SourceGraphic" operator="in"/></filter>
<filter id="bloom" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.25"/></filter>
<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation=".55"/></filter>
${m.defs}</defs>
${[TL, TR, BL, BR].map((d) => f(d, "url(#g)")).join("")}${f(TL, s.lift)}${f(TR, s.dip)}${f(BL, s.dip)}${f(BR, s.lift)}
<g clip-path="inset(0 round 0)">${gridSVG()}</g>
${m.band}
<path d="${m.line}" fill="none" stroke="${g.glow}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" filter="url(#bloom)"/>
<path d="${m.line}" fill="none" stroke="${g.shadow}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 .75)" filter="url(#soft)"/>
<path d="${m.line}" fill="none" stroke="${g.smudge}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
<path d="${m.line}" fill="none" stroke="${g.deep}" stroke-width="3.2" stroke-linecap="butt" stroke-dasharray="1.6 5.1 3.2 7.4 2.1 9.3" opacity=".5"/>
<path d="${m.line}" fill="none" stroke="url(#au)" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round"/>
<path d="${m.line}" fill="none" stroke="url(#sheen)" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round" transform="translate(-.18 -.62)"/>
<path d="${m.line}" fill="none" stroke="${g.bright}" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round" opacity=".22" filter="url(#grain)"/>
<circle cx="${tx}" cy="${ty}" r="6" fill="${THEME.tip.halo}"/><circle cx="${tx}" cy="${ty}" r="3.8" fill="${THEME.tip.core}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Controls one mounted mark: hover replays the unfold and the journey, beat() pulses the tip with a
// real tick.
export class Logo {
  // defer: build the canvas player later (see wake()). The boot splash passes it, because the
  // top-bar mark is invisible behind the splash and its layers cost real main-thread time.
  constructor(host, { defer = false } = {}) {
    this.host = host;
    this.el = host.querySelector(".mk");
    this.bootAt = performance.now();
    this.last = null;
    this.beatAt = 0;
    this.quietT = 0;
    this.player = null;
    if (!defer) this.wake();
  }

  // Build the canvas player, or let a held one run again.
  //
  // Standing it up is not free: four blurred heat bands and the gold ink are rasterised, and
  // every effect in the story is then run once, unseen, so none of them costs a frame the first
  // time it is really wanted. Behind the boot splash the mark is hidden and its 144 Hz loop was
  // drawing frames nobody could see, in competition with the splash's own animation -- so with
  // a splash up the whole thing waits until the splash is on its way out.
  wake() {
    if (this.player) return;
    const cv = this.el?.querySelector(".mk-cv");
    if (!cv) return;
    this.player = new MarkPlayer(cv, markOptions(this.el, { throttle: true }));
    this.player.frame();    // one frame right now: the mark is never blank for the frame it appears on
  }

  replay() {
    if (!this.el || performance.now() - this.bootAt < (STORY_END + 0.5) * (+this.el.dataset.tempo || 1) * 1000) return;
    this.bootAt = performance.now();
    this.el.classList.remove("unfold");
    void this.el.offsetWidth;                 // restart every boot animation from its first frame
    this.el.classList.add("unfold");
    this.player?.replay();
  }

  // A tick on the open chart. Throttled to one beat a second; after 8 s without ticks the mark goes
  // back to its slow idle pulse.
  beat(px) {
    if (!this.el || !Number.isFinite(px)) return;
    const dir = this.last == null || px === this.last ? "fl" : px > this.last ? "up" : "dn";
    this.last = px;
    const p = this.player;
    if (p) p.live = true;
    clearTimeout(this.quietT);
    this.quietT = setTimeout(() => { if (p) { p.live = false; p.tk = [94, 255, 196]; } }, 8000);   // quiet: back to brand mint
    const now = performance.now();
    if (now - this.beatAt < 950) return;
    this.beatAt = now;
    if (p && dir !== "fl") p.tk = dir === "up" ? [94, 255, 196] : [255, 93, 115];
    p?.ping(dir);
  }
}

// The boot splash: the mark unfolds large in the middle of the screen, EIMC and the motto are written
// under it, and an F1 car waits on the grid while the five start lights come on — they are the loading
// bar. Once the chart is ready and all five are lit, a random hold like a real start, then lights out:
// the car launches through the sheet (launch.js) and the mark flies into its place in the top bar.
export function bootSplash(target) {
  const el = document.getElementById("boot");
  if (!el) return { status() {}, done() {}, onClose(fn) { fn(); } };
  const seen = (() => { try { return sessionStorage.getItem("eimc.boot") === "1"; } catch { return false; } })();
  try { sessionStorage.setItem("eimc.boot", "1"); } catch { /* storage blocked */ }
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.classList.toggle("quick", seen);
  el.querySelector("#boot-mark").innerHTML = logoHTML({ size: 112, tempo: seen ? 0.45 : 0.55 });   // the whole boot ends within ~3 s
  const mk = el.querySelector("#boot-mark .mk");
  const markOpts = markOptions(mk, { epoch: performance.timeOrigin + performance.now() });
  let landed = performance.now() + (reduce ? 0 : STORY_END * markOpts.tempo * 1000);     // the journey's new high
  const motto = el.querySelector("#boot-motto");
  const chars = [...motto.textContent.trim()], mid = (chars.length - 1) / 2;     // letters glide in from wide tracking
  // data-c is the letter again, for the ::after that carries the wave of light across the words
  // (app.css): a second, already-glowing copy whose opacity is animated, so the shine costs the
  // compositor one fade instead of costing the main thread a filtered repaint per letter.
  const glyph = (c) => (c === " " ? " " : c);
  const attr = (c) => c.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  motto.innerHTML = `<span class="boot-mt">${chars.map((c, i) =>
    `<i style="--i:${i};--d:${(i - mid).toFixed(1)}" data-c="${attr(glyph(c))}">${attr(glyph(c))}</i>`).join("")}</span>`;
  motto.classList.add("split");
  document.body.classList.add("booting");

  const anchor = () => {                           // the crease (and the car's track) runs through the mark
    const r = el.querySelector("#boot-mark").getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const cv = el.querySelector("#boot-fx");
  const slow = Math.max(1, +new URLSearchParams(location.search).get("race") || 1);   // dev: ?race=4 films it slower
  // the race and the mark's journey are drawn off the main thread together (launch.js)
  const fx = !reduce && cv ? new Launch(cv, anchor, (seen ? 0.75 : 0.85) * slow, { canvas: mk.querySelector(".mk-cv"), ...markOpts }) : null;
  if (!fx) new MarkPlayer(mk.querySelector(".mk-cv"), markOpts);
  if (fx) fx.onLand = (at) => {                    // the journey's real landing (a cold worker starts it late)
    landed = at - performance.timeOrigin;
    if (hold && !out) { clearTimeout(hold); hold = 0; maybeGo(); }
  };
  if (fx) fx.ready.then(() => cv.classList.add("on"));   // fade in from its first drawn frame

  const pods = [...el.querySelectorAll(".boot-lights i")];
  let lit = 0, ready = false, out = false, hold = 0, flight = Promise.resolve();

  let closed = false, after = [];
  const close = () => {
    if (closed) return;
    closed = true;
    fx?.destroy();
    el.remove();
    document.body.classList.remove("booting");
    for (const fn of after.splice(0)) { try { fn(); } catch { /* the terminal is up; never block on this */ } }
  };
  // The mark squats, then travels to its place in the top bar at a steady speed.
  //
  // Three things were wrong with this motion and all three were visible.
  //
  //   * The keyframes mixed transform shapes -- `none`, then `scale()`, then `translate() scale()`
  //     -- and the browser cannot interpolate lists that do not match, so it decomposed matrices
  //     instead. Every keyframe now carries the same `translate() scale()` pair, which it
  //     interpolates part by part.
  //   * A waypoint put the mark 55% of the way there at 62% of the time, so it slowed down and
  //     then had to hurry: two kinks in what should be one move. It is gone, and the transit is
  //     linear from the squat to the landing.
  //   * It animated filter: blur(). That meant re-rasterising and re-blurring the whole sheet
  //     every frame on the main thread -- while the terminal underneath was doing its first
  //     paint. Nothing here touches filter now, so the compositor owns the flight outright.
  const flyMark = () => {
    const mark = el.querySelector("#boot-mark .mk"), dest = target?.querySelector(".mk");
    const a = mark?.getBoundingClientRect(), b = dest?.getBoundingClientRect();
    if (reduce || !a || !b || !b.width) return;
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2), sc = b.width / a.width;
    const at = (x, y, k) => `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${k.toFixed(5)})`;
    flight = mark.animate([
      { transform: at(0, 0, 1), offset: 0, easing: "cubic-bezier(.35,0,.7,1)" },
      { transform: at(0, 0, 0.93), offset: 0.1, easing: "linear" },
      { transform: at(dx, dy, sc), offset: 1 },
    ], { duration: 840 * slow, fill: "forwards" }).finished.catch(() => {});
  };
  const lightsOut = () => {
    if (out) return;
    out = true;
    clearTimeout(hold);
    pods.forEach((p) => p.classList.remove("on"));
    const st = el.querySelector("#boot-status");
    if (st) { st.textContent = "Lights out"; st.classList.add("out"); }
    el.classList.add("go");
    flyMark();
    const raced = fx ? fx.launch() : new Promise((ok) => setTimeout(ok, 320));
    Promise.all([raced, flight]).then(close);
    setTimeout(close, 3500 * slow);                // whatever happens, the terminal is shown
  };
  // all five lit, the chart ready and the mark's journey at its new high: a random hold, then go
  const maybeGo = () => {
    if (out || !ready || lit < pods.length || hold) return;
    const wait = Math.max(0, landed - performance.now());
    hold = setTimeout(lightsOut, wait + (reduce ? 0 : 80 + Math.random() * 140));
  };
  const light = () => {
    if (out || lit >= pods.length) return;
    pods[lit++].classList.add("on");
    if (fx) fx.rev = lit / pods.length;
    if (lit < pods.length) setTimeout(light, reduce ? 0 : seen ? 110 : 230);
    else maybeGo();
  };
  setTimeout(light, reduce ? 0 : seen ? 400 : 550);
  const skip = () => {                             // click or any key: straight to lights out
    if (out) return;
    pods.forEach((p) => p.classList.add("on"));
    lit = pods.length;
    lightsOut();
  };
  el.addEventListener("click", skip);
  addEventListener("keydown", skip, { once: true });
  setTimeout(skip, 15000);                         // never trap the app behind the splash

  return {
    status(html) { const st = el.querySelector("#boot-status"); if (st && !out) st.innerHTML = html; },
    // The chart is up, so the terminal behind the splash can start being rasterised: .warm drops
    // the cover a hair below opaque, and a cover that is not quite opaque is one the compositor
    // will not skip painting behind. Without it the app's whole first paint landed on the single
    // frame the mark starts its flight -- and this is every path to lights out, the impatient
    // click included, not just the one that waits for the lights.
    done() { ready = true; el.classList.add("warm"); maybeGo(); },
    // Work that should not compete with the splash for frames: run it once the splash is gone.
    onClose(fn) { closed ? fn() : after.push(fn); },
  };
}
