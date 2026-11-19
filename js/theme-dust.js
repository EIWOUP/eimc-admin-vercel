'use strict';
/* ════════════════════════════════════════════════════════════════════
   The theme switch, in the gallery's particle style (js/media.js gallery,
   "out" mode). The page is already in the new theme underneath; a sheet
   of the OLD page colour covers it and dissolves in a circle from the
   button you pressed. As the edge passes each point, that bit of the old
   colour lifts off as tiny dust (most one pixel) that flies outward,
   swirls and fades.

   Same engine as the gallery: WebGL 2, every particle's path worked out
   in the vertex shader, one draw call per frame. The page restyle happens
   while the sheet still covers everything and nothing moves, so the
   motion itself never waits on it.

   run() resolves false when WebGL 2 is not available; the caller then
   uses its plain fade.
   ════════════════════════════════════════════════════════════════════ */

const LIFE = 0.55;
const MS = 1050;
const DENSITY = 520000;

const PVS = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uView, uCell, uO;
uniform vec4 uRing;
uniform int uCols;
uniform float uDpr;
uniform vec3 uCol, uAcc, uAcc2;
uniform uint uSeed;
out vec4 vC;
out float vSoft;
uint hsh(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float rn(inout uint s) { s = hsh(s); return float(s >> 8) * (1.0 / 16777216.0); }
void main() {
  gl_Position = vec4(-9.0, -9.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  vC = vec4(0.0); vSoft = 0.0;
  int id = gl_VertexID;
  uint s = (uint(id) * 0x9e3779b9u) ^ uSeed;
  float hx = rn(s); float hy = rn(s); float hk = rn(s); float hu = rn(s); float hs = rn(s);
  float hw = rn(s); float hp = rn(s); float hz = rn(s); float hz2 = rn(s);
  vec2 P = (vec2(float(id % uCols), float(id / uCols)) + 0.5 + (vec2(hx, hy) - 0.5) * 0.96) * uCell;
  vec2 d = P - uO;
  float dist = max(length(d), 1.0);
  vec2 dir = d / dist;
  float u = clamp((dist - uRing.x) / uRing.y, 0.0, 1.0) * 0.88 + hu * 0.12;
  float age = (uRing.z - u) / uRing.w;
  if (age <= 0.0 || age >= 1.0) return;
  float e = 1.0 - (1.0 - age) * (1.0 - age);
  float sp = 70.0 + hs * 260.0;
  float sw = (hw < 0.5 ? -1.0 : 1.0) * (14.0 + fract(hw * 7.31) * 30.0) * sin(age * 3.14159);
  float ph = hp * 6.28318;
  vec2 q = P + dir * (sp * e) + vec2(-dir.y, dir.x) * sw + vec2(sin(ph + age * 5.0), cos(ph + age * 4.0)) * (6.0 * age);
  q.y -= 40.0 * e * e;
  gl_Position = vec4(q.x / uView.x * 2.0 - 1.0, 1.0 - q.y / uView.y * 2.0, 0.0, 1.0);
  float sz = hz < 0.62 ? 1.0 : (hz < 0.92 ? 1.35 + hz2 * 0.5 : 2.0 + hz2 * 0.9);
  sz *= 1.0 - age * 0.35;
  gl_PointSize = max(1.0, sz * uDpr);
  vSoft = step(1.7, gl_PointSize);
  // mostly flakes of the old page colour, with a few sparks of the accent
  vec3 c = hk < 0.80 ? uCol : (hk < 0.93 ? uAcc : uAcc2);
  vC = vec4(c, (hk < 0.80 ? 0.8 : 0.85) * pow(1.0 - age, 1.3));
}`;
const PFS = `#version 300 es
precision mediump float;
in vec4 vC;
in float vSoft;
out vec4 o;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float a = vC.a * mix(1.0, clamp(1.25 - dot(q, q), 0.0, 1.0), vSoft);
  o = vec4(vC.rgb * a, a);
}`;
// the sheet of old colour, with the hole opening from the button
const SVS = `#version 300 es
precision highp float;
out vec2 vP;
uniform vec2 uView;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vP = c * uView;
  gl_Position = vec4(c.x * 2.0 - 1.0, 1.0 - c.y * 2.0, 0.0, 1.0);
}`;
const SFS = `#version 300 es
precision highp float;
uniform vec2 uO;
uniform vec4 uRing;
uniform vec3 uCol, uAcc;
uniform float uMode;
in vec2 vP;
out vec4 o;
void main() {
  float r = distance(vP, uO), f = uRing.z;
  if (uMode > 0.5) {
    // a thin line of light riding the edge of the circle (the real page is clipped there)
    float R = uRing.x + (f + 0.06) * uRing.y;
    float k = exp(-pow((r - R) / 7.0, 2.0)) * 0.5 + exp(-pow((r - R) / 34.0, 2.0)) * 0.16;
    float a = k * uRing.w;
    if (a <= 0.002) discard;
    o = vec4(uAcc * a, a);
    return;
  }
  float a = smoothstep(uRing.x + (f - 0.04) * uRing.y, uRing.x + (f + 0.16) * uRing.y, r);
  if (a <= 0.002) discard;
  o = vec4(uCol * a, a);
}`;

let eng;                 // undefined = not tried, null = no WebGL 2
function engine() {
  if (eng !== undefined) return eng;
  const cv = document.createElement('canvas');
  cv.setAttribute('aria-hidden', 'true');
  cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483646;pointer-events:none;display:none';
  let gl = null;
  try { gl = cv.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false }); } catch { /* none */ }
  if (!gl) return (eng = null);
  const prog = (vs, fs, names) => {
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
    const u = {}; for (const n of names) u[n] = gl.getUniformLocation(p, n);
    return { p, u };
  };
  const pp = prog(PVS, PFS, ['uView', 'uCell', 'uO', 'uRing', 'uCols', 'uDpr', 'uCol', 'uAcc', 'uAcc2', 'uSeed']);
  const sp = prog(SVS, SFS, ['uView', 'uO', 'uRing', 'uCol', 'uAcc', 'uMode']);
  if (!pp || !sp) return (eng = null);
  const vao = gl.createVertexArray();
  document.body.appendChild(cv);
  eng = { cv, gl, pp, sp, vao, lost: false };
  cv.addEventListener('webglcontextlost', e => { e.preventDefault(); eng.lost = true; });
  return eng;
}

const rgb = hex => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const frame = () => new Promise(r => requestAnimationFrame(r));
const ease = t => Math.pow(t, 1.12);

/* warm the shaders while the page is idle, so the first click does not build them */
export function prepare() {
  const idle = window.requestIdleCallback || (f => setTimeout(f, 800));
  idle(() => { const e = engine(); if (e) draw(e, { W: 2, H: 2, D: 1, ox: 0, oy: 0, dmin: 0, span: 1, front: -9, col: [0, 0, 0], acc: [0, 0, 0], acc2: [0, 0, 0], cols: 1, cell: [1, 1], count: 1, seed: 1 }); });
}

function draw(e, s) {
  const { gl, cv, pp, sp } = e;
  gl.viewport(0, 0, cv.width, cv.height);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindVertexArray(e.vao);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  if (!s.real) {                                  // the sheet of old colour (fallback only; no edge line)
    gl.useProgram(sp.p);
    gl.uniform2f(sp.u.uView, s.W, s.H); gl.uniform2f(sp.u.uO, s.ox, s.oy);
    gl.uniform4f(sp.u.uRing, s.dmin, s.span, s.front, 0); gl.uniform3f(sp.u.uCol, ...s.col);
    gl.uniform3f(sp.u.uAcc, ...s.acc); gl.uniform1f(sp.u.uMode, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  gl.useProgram(pp.p);
  gl.uniform2f(pp.u.uView, s.W, s.H); gl.uniform2f(pp.u.uCell, s.cell[0], s.cell[1]); gl.uniform2f(pp.u.uO, s.ox, s.oy);
  gl.uniform4f(pp.u.uRing, s.dmin, s.span, s.front, LIFE); gl.uniform1i(pp.u.uCols, s.cols); gl.uniform1f(pp.u.uDpr, s.D);
  gl.uniform3f(pp.u.uCol, ...s.col); gl.uniform3f(pp.u.uAcc, ...s.acc); gl.uniform3f(pp.u.uAcc2, ...s.acc2);
  gl.uniform1ui(pp.u.uSeed, s.seed);
  gl.drawArrays(gl.POINTS, 0, s.count);
}

/**
 * Dissolve the old theme from point (x, y). `apply` switches the theme.
 * `from` is the old page colour, `accent`/`accent2` the sparks.
 */
export async function run({ x, y, from, accent, accent2, apply }) {
  const e = engine();
  if (!e || e.lost) return false;
  const W = innerWidth, H = innerHeight, D = Math.min(2, devicePixelRatio || 1);
  e.cv.width = Math.round(W * D); e.cv.height = Math.round(H * D);
  e.cv.style.display = 'block';
  const pitch = Math.max(1.1, Math.sqrt(W * H / DENSITY));
  const cols = Math.round(W / pitch), rows = Math.round(H / pitch);
  const span = Math.max(...[[0, 0], [W, 0], [0, H], [W, H]].map(([a, b]) => Math.hypot(x - a, y - b)));
  const s = { W, H, D, ox: x, oy: y, dmin: 0, span, front: -0.06, col: rgb(from), acc: rgb(accent), acc2: rgb(accent2),
    cols, cell: [W / cols, H / rows], count: cols * rows, seed: (Math.random() * 4294967295) >>> 0 };

  draw(e, s);                                   // the old colour now covers the page
  await frame();
  apply();                                      // restyle underneath, while nothing moves
  getComputedStyle(document.body).color;
  await frame();
  await new Promise(done => {
    const t0 = performance.now();
    const tick = now => {
      const t = Math.min(1, (now - t0) / MS);
      s.front = -0.06 + (1.06 + LIFE) * ease(t);
      draw(e, s);
      if (t < 1) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  });
  e.gl.clear(e.gl.COLOR_BUFFER_BIT);
  e.cv.style.display = 'none';
  e.cv.width = e.cv.height = 1;                 // give the memory back
  return true;
}

/* ════════════════════════════════════════════════════════════════════
   The full version: the REAL page changes theme inside the circle.

   A View Transition keeps a picture of the old page (text, images, video
   frames, everything) and shows the live new page on top of it, clipped
   to a circle that grows from the button. So every element changes
   theme exactly as the edge reaches it. The particle canvas has its own
   view-transition-name, which lifts it above both pages, unclipped, so
   the dust flies out over the old page too.

   The circle and the dust share one curve and one start time. The page
   restyle happens while the old picture is still showing and nothing
   moves; the clip is a plain WAAPI animation the browser can run on its
   compositor.
   ════════════════════════════════════════════════════════════════════ */
export async function runReal({ x, y, from, accent, accent2, apply }) {
  if (!document.startViewTransition) return run({ x, y, from, accent, accent2, apply });
  const e = engine();
  const ok = e && !e.lost;
  const W = innerWidth, H = innerHeight, D = Math.min(2, devicePixelRatio || 1);
  const span = Math.max(...[[0, 0], [W, 0], [0, H], [W, H]].map(([a, b]) => Math.hypot(x - a, y - b)));
  let s = null;
  if (ok) {
    e.cv.width = Math.round(W * D); e.cv.height = Math.round(H * D);
    const pitch = Math.max(1.1, Math.sqrt(W * H / DENSITY));
    const cols = Math.round(W / pitch), rows = Math.round(H / pitch);
    s = { W, H, D, ox: x, oy: y, dmin: 0, span, front: -0.06, ring: 0, real: true, col: rgb(from), acc: rgb(accent), acc2: rgb(accent2),
      cols, cell: [W / cols, H / rows], count: cols * rows, seed: (Math.random() * 4294967295) >>> 0 };
    e.gl.clearColor(0, 0, 0, 0); e.gl.clear(e.gl.COLOR_BUFFER_BIT);
    e.cv.style.display = 'block';
    e.cv.style.viewTransitionName = 'theme-dust';
  }
  const root = document.documentElement;
  root.classList.add('vt-theme');
  const vt = document.startViewTransition(() => { apply(); });
  try { await vt.ready; } catch { root.classList.remove('vt-theme'); if (ok) { e.cv.style.display = 'none'; e.cv.style.viewTransitionName = ''; } return true; }

  // the circle: radius = span * (front + 0.06), the same curve the dust uses
  const reach = 1.06 + LIFE;
  const tEnd = Math.min(1, Math.pow(1.04 / reach, 1 / 1.12));       // when the circle covers the screen
  const steps = 28, frames = [];
  for (let i = 0; i <= steps; i++) {
    const k = i / steps, t = k * tEnd;
    const r = Math.max(0, span * (reach * ease(t)));
    frames.push({ clipPath: `circle(${r.toFixed(1)}px at ${x}px ${y}px)`, offset: k });
  }
  root.animate(frames, { duration: MS * tEnd, easing: 'linear', fill: 'forwards', pseudoElement: '::view-transition-new(root)' });

  if (ok) {
    await new Promise(done => {
      const t0 = performance.now();
      const tick = now => {
        const t = Math.min(1, (now - t0) / MS);
        s.front = -0.06 + reach * ease(t);
        s.ring = t < tEnd ? 1 : Math.max(0, 1 - (t - tEnd) / 0.15);
        draw(e, s);
        if (t < 1) requestAnimationFrame(tick); else done();
      };
      requestAnimationFrame(tick);
    });
  }
  try { await vt.finished; } catch { /* skipped */ }
  root.classList.remove('vt-theme');
  if (ok) {
    e.gl.clear(e.gl.COLOR_BUFFER_BIT);
    e.cv.style.display = 'none';
    e.cv.style.viewTransitionName = '';
    e.cv.width = e.cv.height = 1;
  }
  return true;
}
