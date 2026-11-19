// The boot splash's finale: lights out and away we go.
//
// While the chart loads, an F1 car waits on the grid painted on the splash (grid box, chequered line,
// "F1"), revving harder with every start light that comes on. At lights out it launches along the
// splash's horizontal crease: the sheet is cut open behind it with white-hot edges, sparks fly off the
// plank, the tyres smoke off the line, and once the car is through, the two halves of the sheet are
// blown apart to show the terminal underneath. Everything is drawn on one canvas.

import { MarkPlayer } from "./mark.js";

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut3 = (t) => 1 - (1 - t) ** 3;
const easeIn3 = (t) => t * t * t;
const smoothstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// Hot metal: white → yellow → orange → red as it cools (h = 1 … 0).
const HEAT = ["rgb(225,52,38)", "rgb(255,128,44)", "rgb(255,206,106)", "rgb(255,246,222)"];
const heatLevel = (h) => Math.min(3, Math.max(0, Math.floor(h * 4)));

// The race is drawn in a worker on an OffscreenCanvas, so its 144 Hz loop never waits for the app
// booting on the main thread (chart engine, fetches, JSON); without workers it runs inline as before.
const raf = (fn) => (self.requestAnimationFrame ? self.requestAnimationFrame(fn) : setTimeout(() => fn(performance.now()), 1000 / 144));
const caf = (id) => (self.cancelAnimationFrame ? self.cancelAnimationFrame(id) : clearTimeout(id));
const surface = (w, h) => {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  return cv;
};

// Main-thread handle used by the splash: anchor() → {x, y}, the point the crease runs through (the
// mark's centre); pace < 1 runs it faster. `ready` resolves once the first frame is on screen. mark =
// {canvas, ...MarkPlayer options}: the splash mark's journey, drawn by the same worker.
export class Launch {
  constructor(canvas, anchor, pace = 1, mark = null) {
    const view = () => { const a = anchor(); return { W: innerWidth, H: innerHeight, dpr: Math.min(2, devicePixelRatio || 1), ax: a.x, ay: a.y }; };
    this.ready = new Promise((ok) => { this.onReady = ok; });
    this.finished = new Promise((ok) => { this.onDone = ok; });
    let off = null, markOff = null;
    if (canvas.transferControlToOffscreen && typeof Worker !== "undefined") {
      try {
        this.worker = new Worker(new URL("./launch.worker.js", import.meta.url), { type: "module" });
        off = canvas.transferControlToOffscreen();
        if (mark?.canvas) markOff = mark.canvas.transferControlToOffscreen();
      } catch {
        this.worker?.terminate();
        this.worker = null;
      }
    }
    if (this.worker) {
      this.worker.onmessage = ({ data }) => (data === "ready" ? this.onReady() : data === "done" ? this.onDone() : data?.landed && this.onLand?.(data.landed));
      this.worker.onerror = () => { this.onReady(); this.onDone(); };      // never hold the app back
      const m = markOff ? { ...mark, canvas: markOff } : null;
      this.worker.postMessage({ type: "init", canvas: off, pace, view: view(), mark: m }, markOff ? [off, markOff] : [off]);
      this.onResize = () => this.worker.postMessage({ type: "view", view: view() });
    } else {
      this.race = new Race(canvas, pace, view(), () => this.onReady(), () => this.onDone());
      if (mark?.canvas) this.mark = new MarkPlayer(mark.canvas, { ...mark, onLand: (at) => this.onLand?.(at) });
      this.onResize = () => this.race.resize(view());
    }
    addEventListener("resize", this.onResize);
  }

  set rev(v) { this.worker ? this.worker.postMessage({ type: "rev", rev: v }) : (this.race.rev = v); }

  // Lights out: resolves once the sheet is gone.
  launch() {
    this.worker ? this.worker.postMessage({ type: "go" }) : this.race.launch();
    return this.finished;
  }

  destroy() {
    removeEventListener("resize", this.onResize);
    this.worker ? this.worker.terminate() : (this.race.destroy(), this.mark?.destroy());
    this.onDone();
  }
}

// The renderer itself: the same on the main thread or in the worker. view = {W, H, dpr, ax, ay}.
export class Race {
  constructor(canvas, pace, view, onReady, onDone) {
    this.cv = canvas;
    this.c = canvas.getContext("2d");
    this.pace = pace;
    this.onReady = onReady;
    this.onDone = onDone;
    this.rev = 0;                    // 0..1: how hard the car revs on the grid (lights on / 5)
    this.go = null;                  // launch time (set on the first frame after launch())
    this.sparks = [];
    this.smoke = [];
    this.streaks = [];
    this.passAt = null;
    this.resize(view);
    this.last = null;
    this.raf = raf((t) => this.frame(t));
  }

  resize({ W, H, dpr, ax, ay }) {
    this.dpr = dpr;
    this.W = W;
    this.H = H;
    this.cv.width = Math.round(W * dpr);
    this.cv.height = Math.round(H * dpr);
    this.cx = ax;
    this.cy = ay;
    this.L = Math.round(Math.max(130, Math.min(300, W * 0.17)));      // car length, px
    this.x0 = Math.max(16, W * 0.055);                                 // the car's rear on the grid
    this.bg = paper(this);
    this.car = carSprite(this.L, dpr);
    // The band grid() can touch: the car sprite (pad 28 either side of L * 1.06, L * 0.42 tall),
    // the exhaust glow (centred L * .02 behind the nose, radius up to L * .26), the rear-wing
    // light, and a few pixels for the shake. Measured here, not per frame.
    const reach = Math.max(28, this.L * 0.28) + 4, hh = this.L * 0.21 + 32;
    const bx = Math.max(0, this.x0 - reach), by = Math.max(0, this.cy - hh);
    this.box = { x: bx, y: by,
      w: Math.min(W - bx, this.x0 + this.L * 1.06 + 32 - bx), h: Math.min(H - by, this.cy + hh - by) };
    this.full = true;                                  // the first frame after a resize paints it all
    this.puff = this.puff || puffSprite();
    // Canvas drawing is deferred: rasterise the sheet and the car now, not on the first animated frame.
    const t = surface(1, 1).getContext("2d");
    for (const s of [this.bg, this.car.cv, this.puff]) t.drawImage(s, 0, 0, 1, 1);
    t.getImageData(0, 0, 1, 1);
  }

  launch() { this.goNext = true; }

  destroy() {
    caf(this.raf);
    this.stopped = true;
  }

  frame(now) {
    if (this.stopped) return;
    const dt = this.last == null ? 1000 / 144 : Math.min(48, now - this.last);
    this.last = now;
    if (this.goNext && this.go == null) this.go = now;             // the launch clock is the frame clock
    const { c, W, H, dpr } = this;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    let finished;
    try {
      if (this.go == null) {
        // Waiting on the grid, nothing on this canvas changes but the car, its exhaust shimmer and
        // the light on its rear wing -- so only that band is cleared and repainted from the sheet.
        //
        // It used to clear the whole screen and blit the whole sheet back, 144 times a second, to
        // redraw a picture identical to the one already there: at 2560x1440 on a 2x display that
        // is some fifteen million pixel operations a frame for nothing. And this worker is also
        // where the mark's journey is written (mark.js) -- which is the animation the eye is
        // actually on while the lights come on, and which was being starved of the thread.
        const b = this.box;
        if (this.full) { this.full = false; c.clearRect(0, 0, W, H); c.drawImage(this.bg, 0, 0, W, H); }
        else {
          c.clearRect(b.x, b.y, b.w, b.h);
          c.drawImage(this.bg, b.x * dpr, b.y * dpr, b.w * dpr, b.h * dpr, b.x, b.y, b.w, b.h);
        }
        finished = this.grid(now);
      } else {
        c.clearRect(0, 0, W, H);                       // the race repaints the sheet itself, in halves
        finished = this.race(Math.max(0, now - this.go) / this.pace, dt / this.pace);
      }
    } catch (e) {
      finished = true;                                 // a broken effect must never hold the app back
      console.warn("launch fx", e);
    }
    if (!this.shown) { this.shown = true; this.onReady?.(); }
    if (finished) { this.destroy(); this.onDone?.(); return; }
    this.raf = raf((t) => this.frame(t));
  }

  // On the grid: the car idling, shaking harder as the revs rise. The sheet behind it is put back
  // by frame(), over this.box only -- so everything drawn here must stay inside that band.
  grid(now) {
    const { c, L, cy, rev } = this;
    const amp = 0.15 + rev * 1.25;
    const x = this.x0 + rnd(-amp, amp) * 0.35, y = cy + rnd(-amp, amp) * 0.5;
    // heat shimmer off the exhaust, pulsing with the revs
    const fl = 0.75 + 0.25 * Math.sin(now * (0.03 + rev * 0.05));
    glow(c, x - L * 0.02, y, L * (0.14 + rev * 0.12), `rgba(255,120,60,${(0.06 + rev * 0.22) * fl})`);
    this.drawCar(x, y, 1);
    // the rain light on the rear wing flashes faster as it revs
    const on = Math.sin(now * (0.012 + rev * 0.03)) > -0.2;
    glow(c, x + L * 0.004, y, L * 0.05, `rgba(255,40,60,${on ? 0.85 : 0.18})`);
    return false;
  }

  race(lt, dt) {
    const { c, W, H, L, x0, cy } = this;
    const T = 560, POW = 2.3, OPEN = 340, BLOW = 470;
    const D = W + L * 1.5 - x0, plank = L * 0.42;
    const k = Math.min(lt, T) / T;
    const xr = x0 + D * k ** POW;                                      // rear of the car
    const v = lt < T ? ((D * POW) / T) * k ** (POW - 1) : 0;           // px / ms
    const tAt = (x) => { const u = (x - x0 - plank) / D; return u < 0 ? Infinity : T * u ** (1 / POW); };
    const gMax = Math.min(H * 0.2, 170);
    const gapAt = (x) => { const tp = tAt(x); return tp === Infinity ? 0 : gMax * easeOut3(clamp01((lt - tp) / OPEN)); };
    const P2 = T * 0.88, blow = clamp01((lt - P2) / BLOW), d = H * 0.9 * easeIn3(blow);
    const fade = 1 - clamp01((lt - P2 - BLOW * 0.4) / (BLOW * 0.6));
    if (this.passAt == null && xr + plank >= this.cx) this.passAt = lt;

    // camera: the kick off the line, and the car going past the lens
    let sh = lt < 260 ? 7 * (1 - lt / 260) : 0;
    if (this.passAt != null && lt - this.passAt < 200) sh = Math.max(sh, 4 * (1 - (lt - this.passAt) / 200));
    c.save();
    c.translate(rnd(-sh, sh), rnd(-sh, sh) * 0.6);

    // the two halves of the sheet, cut along the crease and then blown apart
    const xs = [];
    for (let x = -12; x <= W + 12; x += 6) xs.push(x);
    const g = xs.map(gapAt);
    this.half(xs, g, -1, d, fade);
    this.half(xs, g, 1, d, fade);
    this.edges(xs, g, lt, tAt, d, fade);

    // speed: streaks rushing past in the opening, everywhere once the sheet goes
    if (lt > 40 && lt < P2 + BLOW * 0.7) {
      for (let i = 0; i < (blow > 0 ? 7 : 3); i++) {
        const x = rnd(0, W), gp = gapAt(x);
        const y = blow > 0 ? rnd(0, H) : cy + rnd(-0.45, 0.45) * gp;
        if (blow > 0 || gp > 12) this.streaks.push({ x, y, len: rnd(70, 320), vx: -rnd(1.4, 3.6), life: rnd(150, 300), age: 0, cyan: Math.random() < 0.35 });
      }
    }
    // the ending: streaks and sparks thin out and fade to nothing by the last frame, so nothing pops
    const tail = 1 - smoothstep(P2 + BLOW * 0.3, P2 + BLOW + 90, lt);
    this.drawStreaks(dt, tail);

    // the launch shockwave
    if (lt < 420) {
      const q = lt / 420;
      c.save();
      c.globalCompositeOperation = "lighter";
      c.strokeStyle = `rgba(190,205,255,${0.38 * (1 - q) ** 2})`;
      c.lineWidth = 2 + 10 * (1 - q);
      c.beginPath();
      c.ellipse(x0 + L * 0.2, cy, 20 + q * L * 2.6, 12 + q * L * 1.5, 0, 0, Math.PI * 2);
      c.stroke();
      c.restore();
    }

    // tyre smoke off the line
    if (lt < 300) {
      for (const s of [-1, 1]) {
        this.smoke.push({ x: xr + L * 0.16 + rnd(-4, 4), y: cy + s * L * 0.15, r: rnd(5, 9), vr: rnd(0.035, 0.075),
          vx: -rnd(0.01, 0.06), vy: s * rnd(0.005, 0.04), life: rnd(520, 820), age: 0 });
      }
    }
    this.drawSmoke(dt, fade);

    // sparks off the plank, more the faster it goes
    if (lt < T) {
      const n = Math.min(70, Math.round(v * 9 * (dt / 16)) + 3);
      for (let i = 0; i < n; i++) {
        const big = Math.random() < 0.12;
        this.sparks.push({ x: xr + L * rnd(0.3, 0.62), y: cy + rnd(-1, 1) * L * 0.05, vx: v * rnd(0.05, 0.6),
          vy: rnd(-1, 1) ** 3 * (0.6 + v * 0.16) * (big ? 1.4 : 1), life: rnd(220, 700) * (big ? 1.3 : 1), age: 0, w: big ? 2.2 : 1 });
      }
    }
    this.drawSparks(dt, tail);

    // the car, motion-blurred, with its rain light smeared into a streak
    if (lt < T + 60) {
      for (let i = 7; i >= 1; i--) this.drawCar(xr - v * 7 * i, cy, 0.3 * (1 - i / 8));
      this.drawCar(xr, cy, 1);
      c.save();
      c.globalCompositeOperation = "lighter";
      const tl = c.createLinearGradient(xr, 0, xr - Math.max(10, v * 80), 0);
      tl.addColorStop(0, "rgba(255,50,70,.95)");
      tl.addColorStop(1, "rgba(255,50,70,0)");
      c.strokeStyle = tl;
      c.lineWidth = 3.2;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(xr + 1, cy);
      c.lineTo(xr - Math.max(10, v * 80), cy);
      c.stroke();
      c.restore();
    }

    // a burst of light as it passes the mark
    if (this.passAt != null) {
      const a = 1 - clamp01((lt - this.passAt) / 280);
      if (a > 0) {
        c.save();
        c.globalCompositeOperation = "lighter";
        glow(c, this.cx, cy, W * 0.42, `rgba(170,190,255,${0.2 * a})`);
        c.restore();
      }
    }
    c.restore();
    return lt > P2 + BLOW + 90;
  }

  // One half of the cut sheet (s = -1 top, 1 bottom), moved d px away from the cut.
  half(xs, g, s, d, fade) {
    const { c, W, H, cy } = this;
    if (fade <= 0) return;
    c.save();
    c.globalAlpha = fade;
    c.translate(0, s * d);
    c.beginPath();
    c.moveTo(-20, s < 0 ? -H : 2 * H);
    c.lineTo(W + 20, s < 0 ? -H : 2 * H);
    for (let i = xs.length - 1; i >= 0; i--) c.lineTo(xs[i], cy + (s * g[i]) / 2);
    c.closePath();
    c.clip();
    c.drawImage(this.bg, 0, 0, W, H);
    c.restore();
  }

  // The cut edges: white-hot right behind the car, cooling through orange to red, then a violet rim.
  edges(xs, g, lt, tAt, d, fade) {
    const { c, cy } = this;
    if (fade <= 0) return;
    const paths = [0, 1, 2, 3, 4].map(() => new Path2D());           // 4 heat levels + cooled rim
    for (const s of [-1, 1]) {
      for (let i = 1; i < xs.length; i++) {
        if (g[i] < 0.6) continue;
        const h = 1 - clamp01((lt - tAt(xs[i])) / 420);
        const p = paths[h > 0 ? heatLevel(h) : 4];
        p.moveTo(xs[i - 1], cy + (s * g[i - 1]) / 2 + s * d);
        p.lineTo(xs[i], cy + (s * g[i]) / 2 + s * d);
      }
    }
    c.save();
    c.globalAlpha = fade;
    c.globalCompositeOperation = "lighter";
    c.lineCap = "round";
    c.strokeStyle = "rgba(140,120,255,.55)";
    c.lineWidth = 1.2;
    c.stroke(paths[4]);
    for (let l = 0; l < 4; l++) {
      c.strokeStyle = HEAT[l];
      c.globalAlpha = fade * (0.18 + l * 0.06);
      c.lineWidth = 7 + l * 2;
      c.stroke(paths[l]);
      c.globalAlpha = fade * (0.55 + l * 0.15);
      c.lineWidth = 1.2 + l * 0.6;
      c.stroke(paths[l]);
    }
    c.restore();
  }

  drawSparks(dt, tail = 1) {
    const { c } = this;
    const paths = [0, 1, 2, 3, 4, 5, 6, 7].map(() => new Path2D());   // 4 heat levels × small / big
    const keep = [];
    for (const s of this.sparks) {
      s.age += dt;
      if (s.age >= s.life) continue;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.986 ** dt;
      s.vy *= 0.976 ** dt;
      const p = paths[heatLevel(1 - s.age / s.life) + (s.w > 1 ? 4 : 0)];
      p.moveTo(s.x, s.y);
      p.lineTo(s.x - s.vx * 32 - 0.5, s.y - s.vy * 32);
      keep.push(s);
    }
    this.sparks = keep;
    c.save();
    c.globalCompositeOperation = "lighter";
    c.lineCap = "round";
    for (let l = 0; l < 8; l++) {
      const big = l > 3, h = l % 4;
      c.strokeStyle = HEAT[h];
      c.globalAlpha = (0.3 + h * 0.22) * tail;
      c.lineWidth = (1 + h * 0.35) * (big ? 1.35 : 1);
      c.stroke(paths[l]);
    }
    c.restore();
  }

  drawSmoke(dt, fade) {
    const { c } = this;
    const keep = [];
    for (const s of this.smoke) {
      s.age += dt;
      if (s.age >= s.life) continue;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.r += s.vr * dt;
      c.globalAlpha = 0.075 * (1 - s.age / s.life) * fade;
      c.drawImage(this.puff, s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
      keep.push(s);
    }
    this.smoke = keep;
    c.globalAlpha = 1;
  }

  // Speed streaks: each fades in, then out over the last half of its life (4 alpha steps per colour,
  // so it stays two strokes a step), and the whole field fades with `tail` at the end.
  drawStreaks(dt, tail = 1) {
    const { c } = this;
    const paths = [0, 1, 2, 3, 4, 5, 6, 7].map(() => new Path2D());   // white / cyan × 4 alpha steps
    const keep = [];
    for (const s of this.streaks) {
      s.age += dt;
      if (s.age >= s.life) continue;
      s.x += s.vx * dt;
      const k = s.age / s.life, a = Math.min(1, k / 0.15) * (1 - smoothstep(0.5, 1, k));
      const step = Math.min(3, Math.floor(a * 4));
      if (a > 0.04) {
        const p = paths[step + (s.cyan ? 4 : 0)];
        p.moveTo(s.x, s.y);
        p.lineTo(s.x + s.len, s.y);
      }
      keep.push(s);
    }
    this.streaks = keep;
    if (tail <= 0) return;
    c.save();
    c.globalCompositeOperation = "lighter";
    c.lineWidth = 1;
    for (let l = 0; l < 8; l++) {
      c.globalAlpha = 0.32 * ((l % 4) + 1) / 4 * tail;
      c.strokeStyle = l < 4 ? "#eef3ff" : "#5fe9ff";
      c.stroke(paths[l]);
    }
    c.restore();
  }

  drawCar(x, y, alpha) {
    const s = this.car;
    if (alpha <= 0) return;
    this.c.globalAlpha = alpha;
    this.c.drawImage(s.cv, x - s.pad, y - s.h / 2, s.w, s.h);
    this.c.globalAlpha = 1;
  }
}

function glow(c, x, y, r, col) {
  const g = c.createRadialGradient(x, y, 0, x, y, Math.max(1, r));
  g.addColorStop(0, col);
  g.addColorStop(1, col.replace(/[\d.]+\)$/, "0)"));
  c.fillStyle = g;
  c.fillRect(x - r, y - r, r * 2, r * 2);
}

// One smoke puff, baked once: the same radial falloff glow() paints, drawn with globalAlpha per particle.
function puffSprite() {
  const n = 128, cv = surface(n, n), b = cv.getContext("2d");
  glow(b, n / 2, n / 2, n / 2, "rgba(196,204,228,1)");
  return cv;
}

// The splash's sheet: night glow, a chart grid fading out, and the starting grid painted on it.
function paper({ W, H, dpr, L, x0, cx, cy }) {
  const cv = surface(Math.round(W * dpr), Math.round(H * dpr));
  const b = cv.getContext("2d");
  b.setTransform(dpr, 0, 0, dpr, 0, 0);
  b.fillStyle = "#04060b";
  b.fillRect(0, 0, W, H);
  const M = Math.max(W, H);
  glow(b, W * 0.5, cy, M * 0.36, "rgba(104,88,255,.24)");
  glow(b, W * 0.46, cy + H * 0.03, M * 0.56, "rgba(40,140,255,.08)");
  glow(b, W * 0.56, cy - H * 0.01, M * 0.4, "rgba(170,80,255,.07)");
  b.strokeStyle = "rgba(150,160,255,.055)";
  b.lineWidth = 1;
  b.beginPath();
  const step = 46;
  for (let x = (cx % step) + 0.5; x < W; x += step) { b.moveTo(Math.round(x) + 0.5, 0); b.lineTo(Math.round(x) + 0.5, H); }
  for (let y = (cy % step) + 0.5; y < H; y += step) { b.moveTo(0, Math.round(y) + 0.5); b.lineTo(W, Math.round(y) + 0.5); }
  b.stroke();
  const vg = b.createRadialGradient(cx, cy, 0, cx, cy, M * 0.62);
  vg.addColorStop(0, "rgba(4,6,11,0)");
  vg.addColorStop(0.7, "rgba(4,6,11,.82)");
  vg.addColorStop(1, "#04060b");
  b.fillStyle = vg;
  b.fillRect(0, 0, W, H);

  // the grid slot: box lines, the slot line in front, a chequered start line and "F1" behind the car
  const front = x0 + L * 1.07, half = L * 0.27;
  b.strokeStyle = "rgba(255,255,255,.13)";
  b.lineWidth = 1.5;
  b.beginPath();
  b.moveTo(x0 - L * 0.08, cy - half); b.lineTo(front + 8, cy - half);
  b.moveTo(x0 - L * 0.08, cy + half); b.lineTo(front + 8, cy + half);
  b.stroke();
  b.fillStyle = "rgba(255,255,255,.3)";
  b.fillRect(front + 8, cy - half - 1, 3, half * 2 + 2);
  const sq = Math.max(5, L * 0.042), rows = Math.ceil((half * 2.3) / sq), top = cy - (rows * sq) / 2;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < 2; col++) {
      if ((r + col) % 2) continue;
      b.fillStyle = "rgba(255,255,255,.26)";
      b.fillRect(front + 22 + col * sq, top + r * sq, sq, sq);
    }
  }
  b.save();
  b.translate(x0 - L * 0.2, cy);
  b.rotate(-Math.PI / 2);
  b.font = `italic 800 ${Math.round(L * 0.2)}px Inter, system-ui, sans-serif`;
  b.textAlign = "center";
  b.textBaseline = "middle";
  b.fillStyle = "rgba(255,255,255,.1)";
  b.fillText("F1", 0, 0);
  b.restore();
  return cv;
}

// A top view of a 2022–25 ground-effect F1 car, facing right, drawn to scale from the real numbers (mm):
// 5,630 long, 2,000 wide, 3,600 wheelbase, Pirelli 18s at 720 Ø (305 front / 405 rear), a 2,000 front
// wing and a 950 rear wing. Gloss midnight livery in the terminal's neon, rim-lit, with its floor, diffuser,
// suspension, brake ducts, halo, driver and cooling louvres — drawn once at the needed size.
const CAR_MM = 5630;
function carSprite(L, dpr) {
  const pad = 28, w = L * 1.06 + pad * 2, h = L * 0.42 + pad * 2;
  const cv = surface(Math.ceil(w * dpr), Math.ceil(h * dpr));
  const c = cv.getContext("2d");
  const k = L / CAR_MM, px = (n) => n / k;                            // px(n): n screen px in mm
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.translate(pad, h / 2);
  c.scale(k, k);
  c.lineJoin = "round";
  c.lineCap = "round";

  // smooth closed (or open) outline through the points; sym() mirrors a half outline drawn from the nose
  const path = (pts, closed = true) => {
    const p = new Path2D(), n = pts.length;
    const P = (i) => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
    p.moveTo(pts[0][0], pts[0][1]);
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const [x0, y0] = P(i - 1), [x1, y1] = P(i), [x2, y2] = P(i + 1), [x3, y3] = P(i + 2);
      p.bezierCurveTo(x1 + (x2 - x0) / 6, y1 + (y2 - y0) / 6, x2 - (x3 - x1) / 6, y2 - (y3 - y1) / 6, x2, y2);
    }
    if (closed) p.closePath();
    return p;
  };
  const sym = (half) => [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [x, -y])];
  const side = (pts, s) => pts.map(([x, y]) => [x, y * s]);
  const box = (x0, y0, x1, y1, r) => {
    const p = new Path2D();
    p.roundRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0), r);
    return p;
  };
  const oval = (x, y, rx, ry) => { const p = new Path2D(); p.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); return p; };
  const seg = (...v) => { const p = new Path2D(); p.moveTo(v[0], v[1]); for (let i = 2; i < v.length; i += 2) p.lineTo(v[i], v[i + 1]); return p; };
  const lin = (x0, y0, x1, y1, ...stops) => {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    for (const [o, col] of stops) g.addColorStop(o, col);
    return g;
  };
  const fill = (p, style, rule) => { c.fillStyle = style; c.fill(p, rule); };
  const stroke = (p, style, mm, minPx = 0.45) => { c.strokeStyle = style; c.lineWidth = Math.max(mm, px(minPx)); c.stroke(p); };
  const soft = (b, fn) => { c.save(); c.filter = `blur(${(b * dpr).toFixed(2)}px)`; fn(); c.restore(); };
  const clip = (p, fn) => { c.save(); c.clip(p); fn(); c.restore(); };
  const both = (fn) => { fn(-1); fn(1); };
  const glowOn = (col, b) => { c.shadowColor = col; c.shadowBlur = b * dpr; };
  const glowOff = () => { c.shadowBlur = 0; c.shadowColor = "rgba(0,0,0,0)"; };

  const neon = lin(0, 0, CAR_MM, 0, [0, "#a06bff"], [0.5, "#6d8cff"], [1, "#45e8ff"]);
  const PAINT = "#141b3a", CARBON = "#0a0c13", SHEEN = "rgba(190,205,255,.42)";
  const weave = (() => {                                              // 2×2 twill carbon, one texel per device px
    const t = surface(4, 4);
    const g = t.getContext("2d");
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) {
        g.fillStyle = (y - x + 4) % 4 < 2 ? "#161a26" : "#07080d";
        g.fillRect(x, y, 1, 1);
      }
    }
    const p = c.createPattern(t, "repeat");
    p.setTransform(new DOMMatrix().scale(1 / (k * dpr)));
    return p;
  })();
  const arm = (x0, y0, x1, y1, mm, col = "#0b0d15") => {             // faired carbon suspension member
    const p = seg(x0, y0, x1, y1);
    stroke(p, col, mm, 0.8);
    stroke(p, "rgba(165,180,225,.38)", mm * 0.28, 0.3);
  };

  // ---- outlines ----
  const BODY = path(sym([[5600, 0], [5590, 46], [5552, 76], [5440, 92], [5200, 112], [4900, 140], [4600, 172], [4350, 202],
    [4100, 238], [3900, 282], [3760, 330], [3600, 362], [3470, 384], [3420, 404], [3406, 520], [3398, 640], [3380, 694],
    [3332, 720], [3100, 728], [2850, 712], [2550, 660], [2250, 576], [1950, 470], [1650, 362], [1400, 272], [1180, 202],
    [980, 156], [800, 128], [600, 108], [380, 92], [180, 78], [50, 64], [8, 34], [0, 0]]));
  const FLOOR = path(sym([[4030, 0], [4022, 190], [3975, 330], [3870, 470], [3740, 610], [3620, 715], [3500, 772],
    [3320, 792], [2400, 798], [1640, 792], [1480, 772], [1370, 712], [1300, 628], [1250, 562], [1190, 532], [900, 524],
    [600, 518], [440, 502], [396, 400], [386, 0]]));
  const COVER = path(sym([[3000, 0], [2994, 112], [2960, 170], [2820, 202], [2560, 212], [2250, 198], [1900, 170],
    [1500, 136], [1160, 106], [900, 86], [720, 66], [640, 34], [620, 0]]));
  const COCKPIT = path(sym([[3830, 0], [3810, 150], [3730, 238], [3560, 282], [3300, 298], [3100, 294], [2985, 258],
    [2930, 150], [2920, 0]]));
  const AIRBOX = path(sym([[3015, 0], [3010, 92], [2984, 132], [2920, 148], [2800, 138], [2680, 104], [2580, 52], [2530, 0]]));
  const RW = path(sym([[428, 0], [424, 170], [412, 300], [396, 392], [370, 440], [326, 466], [262, 474], [70, 474],
    [24, 464], [4, 428], [0, 300], [0, 0]]));
  const TYRES = [[880, 595, 1000], [4450, 648, 953]];                // centre x, inner and outer y; Ø 720
  // front wing: leading and trailing edge x along the span (y), elements in between
  const LE = [[0, 5630], [150, 5626], [260, 5606], [450, 5572], [650, 5532], [850, 5492], [930, 5472]];
  const TE = [[0, 5340], [240, 5330], [300, 5272], [450, 5204], [640, 5122], [820, 5032], [930, 4985]];
  const at = (tab, y) => {
    for (let i = 1; i < tab.length; i++) {
      if (y <= tab[i][0]) { const [ya, xa] = tab[i - 1], [yb, xb] = tab[i]; return xa + ((xb - xa) * (y - ya)) / (yb - ya); }
    }
    return tab[tab.length - 1][1];
  };
  const span = (f, s, y0 = 262, y1 = 952) => {
    const pts = [];
    for (let y = y0; y <= y1 + 1; y += 46) pts.push([at(LE, y) * (1 - f) + at(TE, y) * f, s * y]);
    return pts;
  };
  const FW = path(sym([...LE.map(([y, x]) => [x, y]), [5462, 956], [4992, 956], ...TE.slice().reverse().map(([y, x]) => [x, y])]));

  // ---- the car's shadow on the tarmac, and the neon spilling under the floor ----
  const footprint = new Path2D();
  footprint.addPath(FLOOR);
  footprint.addPath(FW);
  both((s) => { for (const [x, a, b] of TYRES) footprint.addPath(box(x - 360, s * a, x + 360, s * b, 70)); });
  soft(9, () => { c.globalAlpha = 0.5; stroke(FLOOR, neon, px(5)); c.globalAlpha = 1; });
  c.save();
  c.translate(px(1.2), px(2.2));
  soft(4, () => fill(footprint, "rgba(0,0,0,.85)"));
  c.restore();

  // ---- floor and diffuser: bare carbon ----
  fill(FLOOR, CARBON);
  fill(FLOOR, weave);
  clip(FLOOR, () => {
    fill(FLOOR, lin(1250, 0, 390, 0, [0, "rgba(120,135,190,0)"], [1, "rgba(120,135,190,.14)"]));   // diffuser roof rising
    soft(1.5, () => stroke(FLOOR, "rgba(0,0,0,.8)", px(4)));
  });
  stroke(FLOOR, "rgba(90,200,255,.55)", px(0.6));                     // the floor edge catching the light
  both((s) => {
    fill(box(2300, s * 802, 3260, s * 834, 16), "#121624");           // floor-edge wing
    stroke(seg(2310, s * 806, 3250, s * 806), SHEEN, px(0.35));
    for (const [a, b] of [[[3990, 300], [3430, 432]], [[3930, 402], [3420, 560]], [[3842, 502], [3412, 690]]]) {   // floor fences
      const p = path([[a[0], s * a[1]], [(a[0] + b[0]) / 2, s * ((a[1] + b[1]) / 2 + 18)], [b[0], s * b[1]]], false);
      stroke(p, "rgba(0,0,0,.9)", px(1.3));
      stroke(p, "rgba(170,190,240,.5)", px(0.35));
    }
    for (let i = 0; i < 3; i++) {                                     // floor-edge cut-outs
      stroke(seg(1760 - i * 80, s * 742, 1730 - i * 80, s * 790), "rgba(0,0,0,.85)", 16, 0.5);
      stroke(seg(1748 - i * 80, s * 742, 1718 - i * 80, s * 790), "rgba(160,180,235,.22)", 6, 0.3);
    }
    stroke(seg(1200, s * 512, 430, s * 494), "rgba(150,170,230,.35)", px(0.35));                          // diffuser sidewall
  });
  for (const [x0, x1, hw] of [[470, 532, 400], [556, 626, 390]]) {    // beam wing
    const p = box(x0, -hw, x1, hw, 26);
    fill(p, CARBON);
    fill(p, weave);
    stroke(seg(x1 - 8, -hw + 20, x1 - 8, hw - 20), SHEEN, px(0.35));
  }

  // ---- suspension, driveshafts ----
  both((s) => {
    arm(880, s * 92, 880, s * 612, 66, "#171a23");                   // driveshaft
    arm(1270, s * 150, 870, s * 600, 34); arm(650, s * 110, 870, s * 600, 34);     // rear lower
    arm(1180, s * 140, 905, s * 590, 36); arm(760, s * 118, 905, s * 590, 36);     // rear upper
    arm(640, s * 108, 765, s * 596, 26);                               // toe link
    arm(1060, s * 136, 885, s * 586, 30);                              // pullrod
    arm(4800, s * 150, 4440, s * 666, 34); arm(4160, s * 200, 4440, s * 666, 34);  // front lower
    arm(4720, s * 185, 4472, s * 660, 38); arm(4230, s * 222, 4472, s * 660, 38);  // front upper
    arm(4300, s * 226, 4500, s * 622, 32);                             // pushrod
    arm(4622, s * 172, 4592, s * 656, 28);                             // track rod
  });

  // ---- tyres: slicks, lit from above, soft compound ----
  both((s) => {
    for (const [x, a, b] of TYRES) {
      const ya = Math.min(s * a, s * b), yb = Math.max(s * a, s * b), t = box(x - 360, ya, x + 360, yb, 66);
      fill(t, lin(x - 360, 0, x + 360, 0, [0, "#020203"], [0.16, "#0f1015"], [0.5, "#2b2d36"], [0.84, "#0f1015"], [1, "#020203"]));
      clip(t, () => {
        fill(t, lin(0, ya, 0, yb, [0, "rgba(0,0,0,.8)"], [0.16, "rgba(0,0,0,0)"], [0.84, "rgba(0,0,0,0)"], [1, "rgba(0,0,0,.8)"]));
        soft(2.4, () => fill(box(x - 110, ya + 50, x + 40, yb - 50, 40), "rgba(185,195,225,.09)"));   // scrubbed crown
        c.globalAlpha = 0.18;
        for (let i = 1; i < 6; i++) stroke(seg(x - 300, ya + ((yb - ya) * i) / 6, x + 300, ya + ((yb - ya) * i) / 6), "#000", px(0.3));
        c.globalAlpha = 1;
      });
      for (const y of [ya + 16, yb - 16]) stroke(seg(x - 250, y, x + 250, y), "rgba(255,48,64,.85)", 14, 0.5);    // red soft band
      stroke(t, "rgba(150,160,190,.28)", px(0.4));
    }
  });
  both((s) => {                                                       // brake ducts and their winglets
    const rd = box(700, s * 540, 1120, s * 592, 18);
    fill(rd, CARBON);
    stroke(rd, "rgba(150,170,230,.4)", px(0.35));
    for (const [y0, y1] of [[548, 566], [572, 588]]) fill(box(1110, s * y0, 1215, s * y1, 8), "#151a28");
    const fd = box(4290, s * 566, 4620, s * 648, 34);
    fill(fd, CARBON);
    stroke(fd, "rgba(150,170,230,.4)", px(0.35));
    fill(box(4600, s * 580, 4690, s * 640, 18), "#000");
    stroke(seg(4610, s * 584, 4610, s * 636), SHEEN, px(0.4));
  });

  // ---- front wing: four elements, the top flap in livery, endplates ----
  fill(FW, PAINT);
  fill(FW, lin(5630, 0, 4990, 0, [0, "rgba(150,170,240,.2)"], [0.5, "rgba(0,0,0,0)"], [1, "rgba(0,0,0,.3)"]));
  both((s) => {
    const el = (f0, f1) => path([...span(f0, s), ...span(f1, s).reverse()]);
    fill(el(0.42, 0.62), CARBON);
    fill(el(0.42, 0.62), weave);
    fill(el(0.8, 1), lin(0, 0, 0, s * 960, [0, "#a06bff"], [0.5, "#6d8cff"], [1, "#45e8ff"]));
    for (const f of [0.42, 0.62, 0.8]) {
      stroke(path(span(f, s), false), "rgba(0,0,0,.95)", 18, 0.7);                       // slot gaps
      stroke(path(span(f + 0.035, s), false), "rgba(200,215,255,.32)", 10, 0.35);        // element noses catching light
    }
    stroke(path(span(0.02, s, 120), false), "rgba(220,230,255,.45)", 10, 0.35);
    const ep = box(4985, s * 952, 5470, s * 984, 14);                  // endplate
    fill(ep, "#10142a");
    glowOn("rgba(69,232,255,.9)", 6);
    stroke(ep, "#45e8ff", px(0.55));
    glowOff();
  });
  glowOn("rgba(69,232,255,.8)", 7);
  stroke(path([...LE.slice().reverse().map(([y, x]) => [x, -y]), ...LE.slice(1).map(([y, x]) => [x, y])], false), "rgba(110,235,255,.8)", px(0.6));
  glowOff();

  // ---- body: survival cell, sidepods, engine cover, in gloss paint ----
  soft(3, () => fill(BODY, "rgba(0,0,0,.9)"));                        // contact shadow on the floor
  fill(BODY, PAINT);
  clip(BODY, () => {
    fill(BODY, lin(5600, 0, 4500, 0, [0, "rgba(69,232,255,.95)"], [0.35, "rgba(69,232,255,.35)"], [1, "rgba(69,232,255,0)"]));  // cyan nose
    both((s) => {                                                     // the sidepod flash
      fill(path(side([[3380, 702], [3100, 712], [2800, 690], [2500, 632], [2200, 545], [1900, 444], [1600, 340], [1350, 258],
        [1180, 205], [1400, 232], [1700, 296], [2000, 372], [2300, 446], [2600, 506], [2900, 546], [3200, 566], [3388, 572]], s)), neon);
      fill(path(side([[3380, 588], [3150, 584], [2850, 560], [2550, 518], [2250, 458], [1950, 388], [1650, 312], [1400, 250],
        [1300, 238], [1500, 262], [1800, 318], [2100, 382], [2400, 440], [2700, 488], [3000, 520], [3388, 540]], s)), "rgba(94,255,196,.9)");
    });
    fill(BODY, lin(3350, 0, 1000, 0, [0, "rgba(0,0,0,0)"], [1, "rgba(0,0,0,.42)"]));   // the downwash ramp falling away
    soft(3, () => stroke(BODY, "rgba(2,3,9,.92)", px(7)));            // flanks turning under
    soft(2.5, () => stroke(COVER, "rgba(0,0,0,.8)", px(5)));          // valleys either side of the engine cover
    both((s) => {                                                     // studio light running down each sidepod
      const p = path(side([[3330, 610], [3050, 628], [2750, 596], [2450, 526], [2150, 438], [1850, 344], [1550, 262]], s), false);
      soft(1.6, () => stroke(p, "rgba(200,212,255,.32)", px(2.6)));
      stroke(path(side([[3300, 612], [3000, 626], [2700, 590]], s), false), "rgba(240,244,255,.55)", px(0.5));
    });
    soft(1.4, () => stroke(path([[5560, -14], [5200, -20], [4800, -26], [4300, -34], [3900, -44]], false), "rgba(235,242,255,.5)", px(2)));
  });

  // engine cover: louvres, mint pinstripes, shark fin
  fill(COVER, PAINT);
  clip(COVER, () => {
    fill(COVER, lin(0, -215, 0, 215, [0, "rgba(0,0,0,.55)"], [0.38, "rgba(80,96,160,.18)"], [0.5, "rgba(150,165,230,.3)"], [0.62, "rgba(80,96,160,.12)"], [1, "rgba(0,0,0,.6)"]));
    fill(COVER, lin(3000, 0, 650, 0, [0, "rgba(0,0,0,0)"], [1, "rgba(0,0,0,.35)"]));
  });
  both((s) => {
    for (let i = 0; i < 7; i++) {                                     // cooling louvres on the sidepod tops
      const x = 2170 - i * 66;
      stroke(seg(x, s * 240, x - 14, s * 342), "rgba(0,0,0,.7)", 20, 0.5);
      stroke(seg(x - 18, s * 242, x - 32, s * 340), "rgba(170,188,240,.22)", 7, 0.3);
    }
    glowOn("rgba(94,255,196,.9)", 5);
    stroke(path(side([[2950, 150], [2560, 176], [2250, 164], [1900, 140], [1500, 112], [1160, 88], [900, 72]], s), false), "#5effc4", px(0.65));
    glowOff();
  });
  stroke(seg(2580, 0, 980, 0), "rgba(4,5,10,.75)", 14, 0.55);          // shark fin
  stroke(seg(2560, -10, 1000, -9), "rgba(185,200,255,.5)", 6, 0.3);

  // sidepod inlets and mirrors
  both((s) => {
    const m = box(3350, s * 412, 3412, s * 690, 26);
    fill(m, lin(3412, 0, 3350, 0, [0, "#000"], [1, "#05060c"]));
    stroke(seg(3410, s * 420, 3404, s * 682), "rgba(210,222,255,.55)", px(0.45));
    arm(3470, s * 470, 3470, s * 528, 26);
    const mh = box(3440, s * 524, 3506, s * 702, 28);
    fill(mh, lin(3440, 0, 3506, 0, [0, "#0b1028"], [1, "#1f2852"]));
    stroke(seg(3443, s * 540, 3443, s * 686), "rgba(220,236,255,.85)", 10, 0.45);          // the glass, facing back
  });

  // cockpit: driver, steering wheel, headrest
  fill(COCKPIT, "#020307");
  clip(COCKPIT, () => {
    both((s) => {
      const a = seg(3270, s * 205, 3480, s * 175, 3612, s * 122);      // arms in the race suit
      stroke(a, "#1d2350", 92);
      stroke(a, "rgba(150,165,230,.25)", 26);
    });
    fill(box(3612, -152, 3684, 152, 24), "#0b0c11");                  // steering wheel
    fill(box(3640, -46, 3674, 46, 6), "rgba(43,227,255,.55)");
    both((s) => {
      const g = oval(3628, s * 118, 50, 42);                          // gloves
      fill(g, "#e4e9f5");
      fill(g, lin(3600, s * 80, 3660, s * 160, [0, "rgba(255,255,255,0)"], [1, "rgba(40,50,90,.55)"]));
    });
    const pads = new Path2D();                                        // headrest around the helmet
    pads.addPath(oval(3050, 0, 340, 330));
    pads.addPath(oval(3215, 0, 212, 168));
    fill(pads, "#1a1f30", "evenodd");
    soft(1.4, () => stroke(oval(3215, 0, 212, 168), "rgba(0,0,0,.9)", px(3)));
    soft(2, () => stroke(COCKPIT, "rgba(0,0,0,.9)", px(5)));
  });
  stroke(COCKPIT, "rgba(160,175,230,.5)", px(0.45));
  const helmet = oval(3170, 0, 150, 122);
  soft(1.5, () => { c.save(); c.translate(px(0.8), px(1.3)); fill(helmet, "rgba(0,0,0,.8)"); c.restore(); });
  const hg = c.createRadialGradient(3205, -42, 10, 3170, 0, 160);
  hg.addColorStop(0, "#ffffff");
  hg.addColorStop(0.35, "#dfe5f6");
  hg.addColorStop(0.75, "#8a95bc");
  hg.addColorStop(1, "#353d62");
  fill(helmet, hg);
  clip(helmet, () => {
    stroke(seg(3020, 0, 3330, 0), "#45e8ff", 44);                      // helmet livery
    both((s) => stroke(seg(3020, s * 52, 3330, s * 52), "#a06bff", 18));
    const vis = oval(3338, 0, 112, 140);
    fill(vis, lin(0, -120, 0, 120, [0, "#140c2a"], [0.3, "#4a2a8c"], [0.5, "#d9a84e"], [0.7, "#4a2a8c"], [1, "#140c2a"]));
    soft(0.8, () => fill(oval(3282, -40, 16, 26), "rgba(255,255,255,.75)"));
    soft(1.2, () => fill(oval(3200, -48, 52, 30), "rgba(255,255,255,.5)"));
  });
  stroke(seg(3030, -66, 3030, 66), "rgba(10,12,22,.8)", 12, 0.4);      // helmet spoiler

  // airbox, T-cam
  fill(AIRBOX, PAINT);
  fill(AIRBOX, lin(0, -150, 0, 150, [0, "rgba(60,72,130,.25)"], [0.4, "rgba(170,185,245,.36)"], [0.5, "rgba(195,205,250,.42)"], [0.62, "rgba(120,135,210,.24)"], [1, "rgba(40,50,100,.25)"]));
  fill(AIRBOX, lin(3015, 0, 2530, 0, [0, "rgba(20,27,58,0)"], [0.6, "rgba(20,27,58,.2)"], [1, "rgba(20,27,58,.9)"]));
  fill(oval(2996, 0, 22, 84), "#010104");                             // roll-hoop intake
  stroke(path([[2982, -88], [3020, 0], [2982, 88]], false), "rgba(210,222,255,.6)", px(0.4));
  const tcam = box(2848, -46, 2918, 46, 18);                          // T-cam
  fill(tcam, "#05060a");
  stroke(seg(2856, -32, 2908, -32), "rgba(190,205,255,.5)", 7, 0.3);
  fill(oval(2914, 0, 6, 11), "#3c58ff");

  // halo: shadow on the cockpit, then the titanium hoop and strut, painted, with a light down its spine
  const halo = path([[2966, -366], [3150, -390], [3420, -344], [3640, -206], [3740, 0], [3640, 206], [3420, 344], [3150, 390], [2966, 366]], false);
  halo.addPath(seg(3998, 0, 3740, 0));
  soft(2.2, () => { c.save(); c.translate(px(1), px(2)); stroke(halo, "rgba(0,0,0,.7)", 110); c.restore(); });
  stroke(halo, "#0d1230", 94, 1.2);
  stroke(halo, "#1f2850", 64, 0.9);
  c.save();
  c.translate(0, -14);
  stroke(halo, "rgba(215,225,255,.6)", 18, 0.4);
  c.restore();
  both((s) => fill(box(2930, s * 330, 3010, s * 400, 20), "#0d1230"));

  // livery type: EIMC on the sidepods, the race number on the nose
  c.fillStyle = "rgba(238,242,255,.9)";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = `italic 800 112px Inter, system-ui, sans-serif`;
  both((s) => { c.save(); c.translate(2470, s * 388); c.fillText("EIMC", 0, 0); c.restore(); });
  c.save();
  c.translate(4930, 0);
  c.rotate(-Math.PI / 2);
  c.font = `italic 800 150px Inter, system-ui, sans-serif`;
  c.fillText("1", 0, 6);
  c.restore();

  // neon rim light on the body
  glowOn("rgba(110,140,255,.95)", 9);
  stroke(BODY, neon, px(0.75));
  glowOff();
  stroke(BODY, "rgba(225,232,255,.45)", px(0.35));

  // exhaust: heat-tinted titanium
  const ex = oval(470, 0, 62, 54);
  fill(ex, lin(410, 0, 530, 0, [0, "#2b4cff"], [0.45, "#a066ff"], [0.75, "#ffb347"], [1, "#e6d6b0"]));
  fill(oval(462, 0, 40, 34), "#030305");

  // rear wing: mainplane in paint with the name, DRS flap in livery, gurney, DRS pod, endplates
  fill(RW, PAINT);
  clip(RW, () => {
    fill(box(0, -480, 200, 480, 0), lin(0, -480, 0, 480, [0, "#5a3bd6"], [0.5, "#8c6bff"], [1, "#5a3bd6"]));
    fill(RW, lin(430, 0, 0, 0, [0, "rgba(160,180,255,.22)"], [0.3, "rgba(0,0,0,0)"], [0.52, "rgba(0,0,0,.45)"], [0.56, "rgba(255,255,255,.18)"], [1, "rgba(0,0,0,.25)"]));
    stroke(path([[198, -480], [205, 0], [198, 480]], false), "rgba(0,0,0,.95)", 16, 0.7);   // slot gap
    stroke(seg(6, -470, 6, 470), "rgba(255,255,255,.55)", 12, 0.4);                         // gurney
    c.save();
    c.translate(322, 0);
    c.rotate(Math.PI / 2);
    c.fillStyle = "rgba(238,242,255,.92)";
    c.font = `italic 800 112px Inter, system-ui, sans-serif`;
    c.fillText("EIMC", 0, 4);
    c.restore();
  });
  glowOn("rgba(160,107,255,.9)", 7);
  stroke(RW, "rgba(180,140,255,.85)", px(0.55));
  glowOff();
  const drs = box(128, -34, 250, 34, 18);                            // DRS actuator pod
  fill(drs, "#06070c");
  stroke(seg(140, -18, 238, -18), SHEEN, px(0.35));
  both((s) => {
    const ep = box(-16, s * 474, 528, s * 494, 10);
    fill(ep, "#10142a");
    glowOn("rgba(160,107,255,.9)", 6);
    stroke(ep, "#a06bff", px(0.5));
    glowOff();
  });

  // rain light
  glowOn("#ff2a3a", 10);
  fill(box(-44, -54, 8, 54, 14), "#ff3a4c");
  glowOff();
  fill(box(-36, -30, 0, 30, 8), "rgba(255,210,214,.85)");
  return { cv, pad, w, h };
}
