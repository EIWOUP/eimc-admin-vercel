// The EIMC mark's chart: the journey, written on the unfolded sheet.
//
// Once the sheet has unfolded (CSS, logo.js) the market's story is written across it, left to right
// in time, over an order-flow heatmap like the terminal's own: a light liquidity pool below and a heavy
// wall above. Price drifts down and probes the pool but stops short, then sweeps into it — the
// liquidity is taken (flash, sparks, the pool ends where price traded through it) — and reverses hard.
// The rally runs into the wall and is absorbed while the wall heats up, then burns through it (every
// level of the wall ends where price traded through it), pulls back to retest the broken level, which
// now holds, and breaks out to a new high: the live tip. Idle, the tip breathes and beats with real
// ticks, a light retraces the journey now and then, the heat glimmers and a sheen crosses the paper.
//
// Everything is drawn on one canvas on the mark's 64-unit grid (the sheet is 4..60, r = 15; the canvas
// spills 16 units round it for glow) and the whole timeline is a pure function of time, so the same
// player runs in the splash's worker (OffscreenCanvas, never blocked by the app booting) or on the main
// thread (the top-bar mark).

import { THEME } from "./theme.js";

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = (t) => 1 - (1 - clamp01(t)) ** 3;
const easeInOut = (t) => { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; };
const backOut = (t) => { t = clamp01(t) - 1; return 1 + 3.2 * t * t * t + 2.2 * t * t; };
const bump = (v, a, b, c) => (v <= a || v >= c ? 0 : v < b ? smooth(a, b, v) : 1 - smooth(b, c, v));
const raf = (fn) => (self.requestAnimationFrame ? self.requestAnimationFrame(fn) : setTimeout(() => fn(performance.now()), 1000 / 144));
const caf = (id) => (self.cancelAnimationFrame ? self.cancelAnimationFrame(id) : clearTimeout(id));
const wall = () => performance.timeOrigin + performance.now();       // one clock for page and worker
const surface = (n) => {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(n, n);
  const cv = document.createElement("canvas");
  cv.width = cv.height = n;
  return cv;
};
const hash = (a, b) => {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1)) + 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const vnoise = (seed, t) => { const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f); return hash(seed, i) * (1 - u) + hash(seed, i + 1) * u; };
const rng = (seed) => () => {                                        // mulberry32
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Smooth monotone cubic through knots [[x, y], ...] (Fritsch–Butland): no overshoot, so every turn of
// the price is exactly at its knot and the story clock never runs backwards.
function monotone(K) {
  const n = K.length, h = [], d = [], m = [];
  for (let i = 0; i < n - 1; i++) { h[i] = K[i + 1][0] - K[i][0]; d[i] = (K[i + 1][1] - K[i][1]) / h[i]; }
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (3 * (h[i - 1] + h[i])) / ((2 * h[i] + h[i - 1]) / d[i - 1] + (h[i] + 2 * h[i - 1]) / d[i]);
  }
  return (x) => {
    if (x <= K[0][0]) return K[0][1];
    if (x >= K[n - 1][0]) return K[n - 1][1];
    let i = 0;
    while (x > K[i + 1][0]) i++;
    const t = (x - K[i][0]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * K[i][1] + (t3 - 2 * t2 + t) * h[i] * m[i] + (3 * t2 - 2 * t3) * K[i + 1][1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

// ---- the journey -----------------------------------------------------------------------------------
// price y(x) through its turns: start, near miss, lower high, the tap, the peak past the wall, the
// retest, the new high (the live tip)
const KEYS = [[13, 41], [19.5, 45.8], [24.5, 40.8], [30.5, 50.6], [41.5, 17.8], [47.5, 29.3], [55, 12]];
const price = monotone(KEYS);
const X0 = KEYS[0][0], X1 = KEYS[KEYS.length - 1][0];
export const TIP = KEYS[KEYS.length - 1];
const MISS = KEYS[1], TAP = KEYS[3], TEST = KEYS[5];
const crossing = (y, a, b) => {                                       // first x in [a, b] where price passes y
  for (let x = a; x < b; x += 0.02) if ((price(x) - y) * (price(x + 0.02) - y) <= 0) return x + 0.01;
  return null;
};
// the liquidity: a heavy wall above, a light pool below (centre, half height, peak intensity)
const UP = { x0: 7, yc: 25.8, h: 3.7, max: 0.97, build: 0.3, buildLen: 7, seed: 11 };
const LO = { x0: 8.5, yc: 50.4, h: 1.8, max: 0.58, build: 0.4, buildLen: 3.5, seed: 23 };
const WALL_IN = crossing(UP.yc + UP.h, TAP[0], KEYS[4][0]);           // the rally enters the wall…
const WALL_OUT = crossing(UP.yc - UP.h, TAP[0], KEYS[4][0]);          // …and breaks out of its top
UP.end = WALL_OUT;
LO.end = TAP[0] + 0.5;

// story clock: x of "now" against story time (s at tempo 1) — slow at the near miss, a breath at the
// tap, absorbed at the wall, fast through the breakout and up the final leg
const CLOCK = monotone([[0, 6], [0.18, 13], [0.46, 19.5], [0.62, 24.5], [0.84, 30.5], [0.95, 31.3], [1.16, 36.4],
  [1.38, 38.3], [1.46, 39.6], [1.58, 41.5], [1.86, 47.5], [1.96, 47.9], [2.2, 55]]);
const END = 2.2;
const STORY = 0.95;                                                   // s into the boot (× tempo) the story starts
const tauAt = (x) => { let a = 0, b = END; for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (CLOCK(m) < x) a = m; else b = m; } return (a + b) / 2; };
const T_MISS = tauAt(MISS[0]), T_TAP = tauAt(TAP[0]), T_IN = tauAt(WALL_IN), T_BREAK = tauAt(WALL_OUT), T_TEST = tauAt(TEST[0]);
export const STORY_END = STORY + END;                                 // s into the boot (at tempo 1) the tip lands

// heat ramp for the purple sheet: transparent → crimson → red → orange → yellow → white-hot
const RAMP = THEME.heat;
function heat(v, k = 1) {
  v = clamp01(v);
  let i = 0;
  while (i < RAMP.length - 2 && v > RAMP[i + 1][0]) i++;
  const a = RAMP[i], b = RAMP[i + 1], f = clamp01((v - a[0]) / (b[0] - a[0])), c = (j) => a[j] + (b[j] - a[j]) * f;
  return `rgba(${c(1) | 0},${c(2) | 0},${c(3) | 0},${(c(4) * k).toFixed(3)})`;
}

// The heatmap of one band, as the terminal draws it: each price level a glowing streak (thicker and
// hotter where more size rests) with dark gaps between levels; along time the size at a level drifts,
// and now and then is pulled. Each level ends where price traded through it — the liquidity was taken.
const CW = 0.36, TH = 0.92;
function cells(B, hot) {
  const out = [], R = Math.ceil((B.h + 0.6) / TH), down = B === LO;
  for (let r = -R; r <= R; r++) {
    const y = B.yc + r * TH, prof = clamp01(1 - (Math.abs(r * TH) / (B.h + 0.6)) ** 2.2);
    if (prof <= 0) continue;
    const lvl = 0.62 + 0.55 * hash(B.seed, r + 99);                  // some price levels are heavier
    const hit = down ? crossing(y, KEYS[2][0], TAP[0]) : crossing(y, TAP[0], KEYS[4][0]);
    const xe = (hit ?? B.end) + 0.2 + hash(B.seed + 7, r + 99) * (hit ? 0.3 : 0.9);
    for (let x = 6; x < xe; x += CW) {
      const n = vnoise(B.seed * 131 + r, x / 1.9), keep = smooth(0.1, 0.3, vnoise(B.seed * 17 + r, x / 3.1));
      let v = B.max * prof * lvl * (0.55 + 0.6 * n) * (0.3 + 0.7 * keep) * smooth(B.x0, B.x0 + 3.5, x)
        * (1 + B.build * smooth(B.end - B.buildLen, B.end, x));
      if (hot) v = v * 1.25 + 0.16 * prof;
      v = Math.min(1, v);
      const hh = TH * (0.4 + 0.42 * v);
      if (v > 0.03) out.push([x, y - hh / 2, Math.min(CW, xe - x), hh, v]);
    }
  }
  return out;
}

// Broad-nib ink (the old mark's pen): an oval nib at a fixed angle stamped along the curve, so the
// rallies come out bold and the pullbacks fine; the pen lands light, then presses.
const NIB = (39.7 * Math.PI) / 180, NA = 1.5, NB = 0.56;
function inkPath(w) {
  const p = new Path2D(), ca = Math.cos(NIB), sa = Math.sin(NIB);
  let s = 0, next = 0, px = X0, py = price(X0);
  for (let x = X0; x <= X1 + 1e-9; x += 0.01) {
    const y = price(x);
    s += Math.hypot(x - px, y - py);
    px = x;
    py = y;
    if (s < next && x + 0.01 <= X1) continue;
    next = s + 0.2;
    const k = (0.42 + 0.58 * smooth(0, 5, s)) * w, a = NA * k, b = NB * k;
    p.moveTo(x + a * ca, y + a * sa);
    p.ellipse(x, y, a, b, NIB, 0, TAU);
  }
  return p;
}

// sparks: fixed per event (seeded), placed analytically from the time since the event
const sparkSet = (seed, n, aim) => { const r = rng(seed); return Array.from({ length: n }, () => ({ ...aim(r), life: 0.34 + r() * 0.42, w: 0.32 + r() * 0.4, d: r() * 0.06 })); };
const TAP_SPARKS = sparkSet(7, 16, (r) => ({ ang: (r() < 0.5 ? Math.PI : 0) + (r() - 0.5) * 0.9 - 0.3, sp: 9 + r() * 15 }));
const BREAK_SPARKS = sparkSet(19, 28, (r) => (r() < 0.7 ? { ang: -1.05 + (r() - 0.5) * 1.7, sp: 12 + r() * 20 }
  : { ang: (r() < 0.5 ? Math.PI : 0) + (r() - 0.5) * 0.5, sp: 8 + r() * 12 }));
const BURST = [-90, -50, -10, 30, 70, 110, 150, 190, 230].map((a) => (a * Math.PI) / 180);

const INK = new Map();                                                 // by weight, built on first use

export class MarkPlayer {
  // canvas: the mark's canvas (1.5 × the mark, centred); size: the mark in CSS px; epoch: wall-clock ms
  // the boot started (so a worker stays in step with the page's CSS unfold); boot = false starts idle.
  // onLand(ms): told once, on the first frame, the wall-clock time the tip will land.
  constructor(canvas, { size = 30, dpr = 1, tempo = 1, boot = true, reduce = false, epoch = null, throttle = false, onLand = null } = {}) {
    this.cv = canvas;
    this.c = canvas.getContext("2d");
    this.tempo = tempo;
    this.throttle = throttle;
    this.tk = [94, 255, 196];                                          // tip colour: brand mint, red on a down tick
    this.live = false;
    this.pingAt = -1e9;
    this.pingCol = this.tk;
    this.drawnAt = 0;
    this.setSize(size, dpr);
    this.epoch = boot && !reduce ? epoch ?? wall() : wall() - (STORY + END + 30) * 1000 * tempo;
    this.boot = boot && !reduce;
    this.onLand = onLand;
    if (reduce) { this.draw(1e6, true); return; }
    this.loop = (ts) => { this.raf = raf(this.loop); this.frame(ts); };
    this.raf = raf(this.loop);
  }

  setSize(size, dpr) {
    const ppu = (this.ppu = (size * dpr) / 64), n = Math.round(96 * ppu);
    this.cv.width = this.cv.height = n;
    const weight = size <= 40 ? 1.38 : size <= 80 ? 1.15 : 1;        // optical sizing: bolder when small
    if (!INK.has(weight)) INK.set(weight, inkPath(weight));
    const ink = INK.get(weight);
    const layer = () => {
      const cv = surface(n), g = cv.getContext("2d");
      g.setTransform(ppu, 0, 0, ppu, 16 * ppu, 16 * ppu);
      return [cv, g];
    };
    const band = (B, hot) => {
      const [crisp, cg] = layer(), [cv, g] = layer();
      for (const [x, y, w, h, v] of cells(B, hot)) { cg.fillStyle = heat(v); cg.fillRect(x, y, w, h); }
      g.setTransform(1, 0, 0, 1, 0, 0);
      for (const [blur, a] of [[3.2, B === UP ? 0.85 : 0.7], [1.6, 0.65], [0.75, 1], [0, 1]]) {   // aura, glow, bloom, cells
        g.filter = blur ? `blur(${(blur * ppu).toFixed(2)}px)` : "none";
        g.globalAlpha = a;
        g.drawImage(crisp, 0, 0);
      }
      g.filter = "none";
      g.globalAlpha = 1;
      return cv;
    };
    this.lo = band(LO, false);
    this.up = band(UP, false);
    this.loHot = band(LO, true);
    this.upHot = band(UP, true);
    const [inkCv, g] = layer();
    g.save();
    g.filter = `blur(${(1.1 * ppu).toFixed(2)}px)`;
    g.translate(0, 1);
    g.fillStyle = THEME.gold.shadow;                                  // the ink's shadow on the paper
    g.fill(ink);
    g.restore();
    g.save();
    g.filter = `blur(${(1.5 * ppu).toFixed(2)}px)`;
    g.fillStyle = THEME.gold.glow;                                    // the metal's warm bloom
    g.fill(ink);
    g.restore();
    // The journey is struck in gold. The gradient runs along the climb and turns light,
    // shadow, light the way metal does -- a single flat yellow reads as a coloured line, not
    // as gold. Same stops as the still mark in logo.js, so the two cannot disagree.
    const au = g.createLinearGradient(13, 52, 55, 10);
    const G = THEME.gold;
    for (const [at, col] of [[0, G.deep], [0.14, G.mid], [0.3, G.rich], [0.42, G.mid], [0.56, G.rich],
                             [0.68, G.deep], [0.8, G.rich], [0.92, G.bright], [1, G.spec]]) {
      au.addColorStop(at, col);
    }
    g.fillStyle = G.smudge;                                           // the dull base under the metal
    g.fill(ink);
    g.fillStyle = au;
    g.fill(ink);
    // the sheen: the same stroke a hair higher, catching the light along its upper edge
    g.save();
    g.translate(-0.18, -0.62);
    const sh = g.createLinearGradient(13, 52, 55, 10);
    for (const [at, a] of [[0, 0], [0.26, 0.5], [0.34, 0.05], [0.5, 0], [0.63, 0.42], [0.71, 0.08],
                           [0.88, 0.34], [1, 0]]) {
      sh.addColorStop(at, `rgba(255,255,255,${a})`);
    }
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = sh;
    g.fill(ink);
    g.restore();
    g.globalCompositeOperation = "source-over";
    this.ink = inkCv;
    // canvas drawing is deferred: rasterise the layers now, not on the story's first frame
    for (const l of [this.lo, this.up, this.loHot, this.upHot, this.ink]) l.getContext("2d").getImageData(0, 0, 1, 1);
    // and run each of the story's effects once, unseen, so none of them costs a frame the first time
    for (const tau of [T_MISS, T_TAP + 0.08, T_IN + 0.05, T_BREAK + 0.06, T_TEST + 0.1, END - 0.1, END + 0.2, END + 1.5]) this.draw((STORY + tau) * this.tempo);
    this.c.setTransform(1, 0, 0, 1, 0, 0);
    this.c.clearRect(0, 0, n, n);
    this.c.getImageData(0, 0, 1, 1);
  }

  replay() { this.epoch = wall(); this.boot = true; this.started = false; }

  // A tick on the chart: ring out from the tip in its direction's colour.
  ping(dir) {
    this.pingAt = wall();
    this.pingCol = dir === "up" ? [94, 255, 196] : dir === "dn" ? [255, 93, 115] : [255, 255, 255];
  }

  destroy() {
    caf(this.raf);
    this.loop = () => {};
  }

  frame(ts) {
    const abs = Number.isFinite(ts) ? performance.timeOrigin + ts : wall();
    if (!this.started) {
      // a player that starts late (a cold worker while the app boots) begins the story now rather than
      // skipping it — the sheet has unfolded in CSS meanwhile — and says when the tip will land
      this.started = true;
      const late = abs - this.epoch - STORY * this.tempo * 1000;
      if (this.boot && late > 0) this.epoch += late;
      if (this.boot) this.onLand?.(this.epoch + STORY_END * this.tempo * 1000);
    }
    const t = (abs - this.epoch) / 1000;
    if (this.throttle && !this.busy && performance.now() - this.drawnAt < 15) return;   // idle: ~60 fps is plenty
    this.drawnAt = performance.now();
    this.draw(t);
  }

  draw(t, still = false) {
    const { c, ppu } = this, n = this.cv.width, s = t / this.tempo, tau = s - STORY, e = tau - END;
    const idle = t - (STORY + END) * this.tempo;                       // real seconds since the tip landed
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, n, n);
    c.setTransform(ppu, 0, 0, ppu, 16 * ppu, 16 * ppu);
    const pingAge = (wall() - this.pingAt) / 1000;
    this.busy = e < 1.2 || pingAge < 1.2;

    c.save();
    c.beginPath();
    c.roundRect(4, 4, 56, 56, 15);
    c.clip();
    // the sheet's creases: they settle after the unfold and fade to a whisper once it is written on
    const crease = smooth(1.02, 1.4, s) * (1 - 0.75 * smooth(0, 0.7, tau));
    if (crease > 0) {
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 30);
      g.addColorStop(0, `rgba(255,255,255,${0.42 * crease})`);
      g.addColorStop(0.7, `rgba(255,255,255,${0.16 * crease})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      c.strokeStyle = g;
      c.lineWidth = 0.7;
      c.beginPath();
      c.moveTo(32, 4); c.lineTo(32, 60); c.moveTo(4, 32); c.lineTo(60, 32);
      c.stroke();
    }
    if (tau < 0) { c.restore(); return; }
    const X = e >= 0 ? X1 + 2 : CLOCK(tau);
    if (e < 0.9 || still) this.heatStory(tau, X);
    else this.heatIdle(idle);
    if (e >= 0.9 && !still) this.sheen(idle);
    c.restore();

    // the ink, written up to now
    c.save();
    c.beginPath();
    c.rect(-16, -16, X + 16, 96);
    c.clip();
    c.drawImage(this.ink, -16, -16, 96, 96);
    c.restore();

    c.globalCompositeOperation = "lighter";
    if (e < 1.4 && !still) this.events(tau, X);
    if (e >= 0.9 && !still) this.glint(idle);
    c.globalCompositeOperation = "source-over";
    if (e < 0) this.head(tau, X);
    else this.tip(still ? 9 : e, pingAge, still, idle);
  }

  // The heat during the story: revealed up to now, the present column hottest; the pool flares under
  // the near miss, the wall heats up while it absorbs the rally and cools once it is broken.
  heatStory(tau, X) {
    const { c } = this;
    const L = (img, a, x0 = -16, x1 = X) => {
      if (a <= 0 || x1 <= x0) return;
      c.save();
      c.beginPath();
      c.rect(x0, -16, x1 - x0, 96);
      c.clip();
      c.globalAlpha = Math.min(1, a);
      c.drawImage(img, -16, -16, 96, 96);
      c.restore();
    };
    L(this.lo, 1 - 0.16 * smooth(T_TAP, T_TAP + 0.9, tau));
    L(this.up, 1 - 0.18 * smooth(T_BREAK, T_BREAK + 1, tau));
    L(this.loHot, 0.9, X - 0.8);                                      // the order book at "now"
    L(this.upHot, 0.9, X - 0.8);
    L(this.loHot, 0.75 * bump(tau, T_MISS - 0.16, T_MISS + 0.02, T_MISS + 0.42), MISS[0] - 5, Math.min(X, MISS[0] + 4));
    const hot = smooth(T_IN - 0.3, T_BREAK, tau) * (1 - smooth(T_BREAK + 0.04, T_BREAK + 0.75, tau));
    for (const [w, a] of [[12, 0.3], [6.5, 0.35], [3, 0.35]]) L(this.upHot, hot * a, X - w);
  }

  // Idle: the history stays, glimmering — a few cells of the wall and the pool catch the light.
  heatIdle(e) {
    const { c } = this;
    c.globalAlpha = 0.84;
    c.drawImage(this.lo, -16, -16, 96, 96);
    c.globalAlpha = 0.82;
    c.drawImage(this.up, -16, -16, 96, 96);
    c.globalAlpha = 1;
    c.globalCompositeOperation = "lighter";
    const slot = Math.floor(e / 0.38);
    for (let k = 0; k < 3; k++) {
      const id = slot - k, age = e - id * 0.38, a = bump(age, 0, 0.3, 1.1);
      if (a <= 0) continue;
      const lo = hash(id, 3) < 0.25, B = lo ? LO : UP, x = B.x0 + 3 + hash(id, 5) * (B.end - B.x0 - 5);
      const y = B.yc + (hash(id, 7) - 0.5) * B.h * 1.3;
      glow(c, x, y, lo ? 1.5 : 2.1, [[0, `rgba(255,236,170,${0.55 * a})`], [0.4, `rgba(255,140,60,${0.3 * a})`], [1, "rgba(255,80,60,0)"]]);
    }
    c.globalCompositeOperation = "source-over";
  }

  // A soft sheen crossing the paper every 11 s.
  sheen(e) {
    const p = (e - 0.9 + 9) % 11;
    if (p > 1.7) return;
    const { c } = this, x = -20 + 104 * easeInOut(p / 1.7);
    const g = c.createLinearGradient(x - 9, -4, x + 9, 4);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, "rgba(255,255,255,.2)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(-16, -16, 96, 96);
  }

  // The story's moments: the near miss, the tap, the absorption, the breakout, the retest.
  events(tau, X) {
    const { c } = this;
    // near miss: the pool lights up under the probe, then lets it go
    const m = bump(tau, T_MISS - 0.14, T_MISS + 0.02, T_MISS + 0.4);
    if (m > 0) glow(c, MISS[0], LO.yc, 4.4, [[0, `rgba(255,190,110,${0.5 * m})`], [0.4, `rgba(255,70,60,${0.3 * m})`], [1, "rgba(255,40,60,0)"]]);

    // the tap: liquidity taken — a white-hot flash, a shock ring, sparks along the pool, embers cooling
    const dt = tau - T_TAP;
    if (dt > -0.03 && dt < 1.3) {
      const a = smooth(-0.03, 0.03, dt) * (1 - smooth(0.04, 0.5, dt));
      if (a > 0) flash(c, TAP[0], TAP[1], 2.4 + 6 * easeOut(dt / 0.25), a);
      ring(c, TAP[0], TAP[1], 1.4 + 10 * easeOut(dt / 0.55), 1.1 * (1 - clamp01(dt / 0.55)), [255, 214, 170], 0.85 * (1 - clamp01(dt / 0.55)));
      this.sparks(TAP_SPARKS, TAP[0], TAP[1], dt);
      const em = 1 - smooth(0.1, 1.2, dt);
      if (em > 0) glow(c, LO.end - 0.6, LO.yc, 2.6, [[0, `rgba(255,170,80,${0.6 * em})`], [1, "rgba(255,60,40,0)"]]);
    }

    // absorption: the rally pushes into the wall, which flickers hot where it is being hit
    if (tau > T_IN - 0.05 && tau < T_BREAK) {
      const f = 0.55 + 0.25 * Math.sin(tau * 95) + 0.2 * Math.sin(tau * 57);
      glow(c, X, price(X), 3.6, [[0, `rgba(255,220,150,${0.75 * f})`], [0.5, `rgba(255,110,50,${0.4 * f})`], [1, "rgba(255,60,40,0)"]]);
    }

    // the breakout: the wall burns through — a flare, a tear across the wall, two rings, a spray of sparks
    const db = tau - T_BREAK, bx = WALL_OUT, by = UP.yc - UP.h;
    if (db > -0.03 && db < 1.4) {
      const a = smooth(-0.03, 0.03, db) * (1 - smooth(0.05, 0.6, db));
      if (a > 0) {
        flash(c, bx, by + 1.2, 3 + 10 * easeOut(db / 0.3), a);
        const g = c.createLinearGradient(0, UP.yc - UP.h - 1.5, 0, UP.yc + UP.h + 1.5);
        g.addColorStop(0, "rgba(255,200,120,0)");
        g.addColorStop(0.5, `rgba(255,248,226,${0.9 * a})`);
        g.addColorStop(1, "rgba(255,200,120,0)");
        c.fillStyle = g;
        const w = 0.5 + 1.4 * (1 - easeOut(db / 0.5));
        c.fillRect(bx - w, UP.yc - UP.h - 1.5, w * 2, UP.h * 2 + 3);
      }
      ring(c, bx, by + 1.2, 2 + 15 * easeOut(db / 0.65), 1.3 * (1 - clamp01(db / 0.65)), [255, 226, 180], 0.9 * (1 - clamp01(db / 0.65)));
      const d2 = db - 0.07;
      if (d2 > 0) ring(c, bx, by + 1.2, 1.5 + 8.5 * easeOut(d2 / 0.45), 0.8 * (1 - clamp01(d2 / 0.45)), [255, 170, 110], 0.7 * (1 - clamp01(d2 / 0.45)));
      this.sparks(BREAK_SPARKS, bx, by + 1, db);
    }

    // the retest: the broken wall's level now holds — it lights up in mint as price bounces off it
    const dr = tau - T_TEST;
    if (dr > -0.06 && dr < 1.2) {
      const grow = easeOut((dr + 0.06) / 0.22), a = 1 - smooth(0.35, 1.15, dr), y = UP.yc + UP.h;
      c.save();
      c.setLineDash([0.9, 0.75]);
      c.lineCap = "round";
      c.strokeStyle = `rgba(94,255,196,${0.85 * a})`;
      c.lineWidth = 0.5;
      c.beginPath();
      c.moveTo(WALL_OUT - 1, y);
      c.lineTo(WALL_OUT - 1 + (TEST[0] - WALL_OUT + 1.5) * grow, y);
      c.stroke();
      c.restore();
      if (dr > 0) {
        glow(c, TEST[0], TEST[1], 4, [[0, `rgba(220,255,244,${0.7 * a})`], [0.4, `rgba(94,255,196,${0.35 * a})`], [1, "rgba(94,255,196,0)"]]);
        ring(c, TEST[0], TEST[1], 1.2 + 6 * easeOut(dr / 0.5), 0.8 * (1 - clamp01(dr / 0.5)), [94, 255, 196], 0.9 * (1 - clamp01(dr / 0.5)));
      }
    }
  }

  sparks(list, x0, y0, t) {
    const { c } = this;
    c.lineCap = "round";
    for (const s of list) {
      const u = t - s.d;
      if (u <= 0 || u >= s.life) continue;
      const k = u / s.life, dr = (1 - Math.exp(-3 * u)) / 3, sv = Math.exp(-3 * u);
      const vx = Math.cos(s.ang) * s.sp, vy = Math.sin(s.ang) * s.sp;
      const x = x0 + vx * dr, y = y0 + vy * dr + 5 * u * u;
      c.strokeStyle = heat(1 - k * 0.7, (1 - k) ** 0.8);
      c.lineWidth = s.w * 1.3 * (1 - k * 0.5);
      c.beginPath();
      c.moveTo(x - vx * sv * 0.05, y - (vy * sv + 10 * u) * 0.05);
      c.lineTo(x, y);
      c.stroke();
    }
  }

  // The pen while writing: a hot head with a comet tail that stretches with the speed of the move.
  head(tau, X) {
    if (X < X0) return;
    const { c } = this, y = price(X);
    const sp = Math.abs(CLOCK(Math.min(END, tau + 0.016)) - CLOCK(tau)) / 0.016;
    const len = Math.min(7, Math.max(1.4, sp * 0.055)), land = smooth(0, 0.08, tau - 0.18);
    c.globalCompositeOperation = "lighter";
    for (let k = 9; k >= 1; k--) {
      const x = Math.max(X0, X - (len * k) / 9), a = 0.26 * (1 - k / 10) * land;
      glow(c, x, price(x), 2.1 - k * 0.12, [[0, `rgba(235,255,250,${a})`], [1, "rgba(120,240,255,0)"]]);
    }
    const absorbing = tau > T_IN && tau < T_BREAK;
    const col = absorbing ? "255,190,120" : "94,255,196";
    glow(c, X, y, 4.4, [[0, `rgba(${col},${0.85 * land})`], [0.45, `rgba(${col},${0.3 * land})`], [1, `rgba(${col},0)`]]);
    c.globalCompositeOperation = "source-over";
    c.fillStyle = `rgba(255,255,255,${land})`;
    c.beginPath();
    c.arc(X, y, 1.3, 0, TAU);
    c.fill();
  }

  // The live tip: lands with a pop and a burst, then breathes; pings on ticks (or slowly when quiet).
  tip(e, pingAge, still, idle = e) {
    const { c } = this, [x, y] = TIP, tk = this.tk.join(",");
    const ph = still ? 0.5 : (Math.max(0, idle) % 2.8) / 2.8, br = 0.5 - 0.5 * Math.cos(ph * TAU);
    const hs = (0.78 + 0.34 * br) * easeOut(e / 0.45), ha = 0.45 + 0.5 * br;
    c.globalCompositeOperation = "lighter";
    if (hs > 0) glow(c, x, y, 8 * hs, [[0, `rgba(${tk},${0.8 * ha})`], [0.45, `rgba(${tk},${0.32 * ha})`], [1, `rgba(${tk},0)`]]);
    if (!still && !this.live && idle > 0.35) {
      const p = ((idle - 0.35) % 3.6) / 3.6;
      if (p < 0.36) { const q = p / 0.36; ring(c, x, y, 3.3 * (1 + 2.4 * easeOut(q)), 1.1 * (1 - q * 0.5), this.tk, 0.95 * (1 - q)); }
    }
    if (pingAge < 1.1) { const q = pingAge / 1.1; ring(c, x, y, 3.3 * (1 + 2.8 * easeOut(q)), 1.2 * (1 - q * 0.5), this.pingCol, 1 - q); }
    if (!still && e < 0.85) {                                         // the burst as it lands
      const q = easeOut((e - 0.06) / 0.75);
      if (e > 0.06) {
        BURST.forEach((a, i) => {
          const r = 2 + 9 * q;
          c.fillStyle = i % 2 ? `rgba(255,255,255,${1 - q})` : `rgba(${tk},${1 - q})`;
          c.beginPath();
          c.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, 0.75 * (1.2 - q), 0, TAU);
          c.fill();
        });
      }
    }
    c.globalCompositeOperation = "source-over";
    const pop = still ? 1 : backOut(e / 0.55);
    c.fillStyle = "#fff";
    c.beginPath();
    c.arc(x, y, 3.1 * pop, 0, TAU);
    c.fill();
  }

  // Every 9.5 s a light retraces the journey, waking each moment as it passes.
  glint(e) {
    const p = (e - 0.9) % 9.5;
    if (p > 1.3) return;
    const { c } = this, u = easeInOut(p / 1.15), gx = X0 + (X1 - X0) * u, fade = 1 - smooth(1.1, 1.3, p);
    for (let k = 6; k >= 0; k--) {
      const x = Math.max(X0, gx - k * 0.9), a = 0.55 * (1 - k / 7) * fade;
      glow(c, x, price(x), 2.4 - k * 0.15, [[0, `rgba(240,255,252,${a})`], [1, "rgba(120,240,255,0)"]]);
    }
    for (const [x, y, col] of [[MISS[0], LO.yc, "255,150,80"], [TAP[0], TAP[1], "255,190,110"], [WALL_OUT, UP.yc, "255,200,120"], [TEST[0], TEST[1], "94,255,196"]]) {
      const a = 0.5 * bump(gx - x, -1.5, 0, 2.5) * fade;
      if (a > 0) glow(c, x, y, 3.4, [[0, `rgba(${col},${a})`], [1, `rgba(${col},0)`]]);
    }
  }
}

function glow(c, x, y, r, stops) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, col] of stops) g.addColorStop(o, col);
  c.fillStyle = g;
  c.fillRect(x - r, y - r, 2 * r, 2 * r);
}

function flash(c, x, y, r, a) {
  glow(c, x, y, r, [[0, `rgba(255,252,240,${a})`], [0.18, `rgba(255,228,150,${0.85 * a})`], [0.45, `rgba(255,120,60,${0.45 * a})`], [1, "rgba(255,60,80,0)"]]);
}

function ring(c, x, y, r, w, rgb, a) {
  if (a <= 0 || w <= 0) return;
  c.strokeStyle = `rgba(${rgb.join(",")},${a})`;
  c.lineWidth = w;
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.stroke();
}

// The static mark for the browser tab: the sheet, the two liquidity bands, the journey and the tip.
export function markSVG() {
  const pts = [];
  for (let x = X0; x <= X1 + 1e-9; x += 0.5) pts.push(`${x.toFixed(1)} ${price(x).toFixed(2)}`);
  const band = (B, id) => `<rect x="${B.x0 + 0.5}" y="${B.yc - B.h}" width="${B.end - B.x0 - 0.5}" height="${B.h * 2}" rx="${B.h}" fill="url(#${id})"/>`;
  const grad = (id, k) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e81c3a" stop-opacity="${0.5 * k}"/>
<stop offset=".5" stop-color="${k > 0.8 ? "#ffc040" : "#ff6a2a"}" stop-opacity="${k}"/><stop offset="1" stop-color="#e81c3a" stop-opacity="${0.5 * k}"/></linearGradient>`;
  return { band: band(UP, "hu") + band(LO, "hl"), defs: grad("hu", 1) + grad("hl", 0.8), line: `M${pts.join(" L")}`, tip: TIP };
}
