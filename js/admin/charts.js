'use strict';
/* ════════════════════════════════════════════════════════════════════
   Charts, hand-built in SVG so they share the site's fonts and tokens:
   line/area with a crosshair, bars (stacked), donut, heatmap, bar list,
   funnel, sparkline. Every chart has a hover tooltip; marks draw in once.
   Colours are the four validated chart hues (--c1..--c4) or status tokens.
   ════════════════════════════════════════════════════════════════════ */
import { html, raw, esc, put, tip, num, REDUCED } from './core.js';

let uid = 0;
const nice = v => { if (v <= 0) return 1; const e = Math.pow(10, Math.floor(Math.log10(v))); const f = v / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e; };

/* monotone cubic: smooth, never overshoots below zero */
function smooth(pts) {
  const n = pts.length;
  if (n < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : '';
  const dx = [], dy = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; dy[i] = pts[i + 1][1] - pts[i][1]; m[i] = dy[i] / dx[i]; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${(pts[i][0] + h).toFixed(1)},${(pts[i][1] + h * t[i]).toFixed(1)} ${(pts[i + 1][0] - h).toFixed(1)},${(pts[i + 1][1] - h * t[i + 1]).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
  }
  return d;
}

/* keep a chart sized to its box; re-draw (without the intro) on resize */
function responsive(el, draw) {
  let first = true, w = 0;
  const go = () => { const nw = el.clientWidth; if (!nw || nw === w) return; w = nw; draw(nw, first && !REDUCED); first = false; };
  go();
  if (el._ro) el._ro.disconnect();
  el._ro = new ResizeObserver(() => go());
  el._ro.observe(el);
}

/* ── line / area ────────────────────────────────────────────────────
   series: [{ name, values:[], color:'var(--c1)', area:true }]  labels: [] */
export function lineChart(el, { labels, series, height = 220, fmt = num, xfmt = s => s, yfmt, ticks = 4, minMax = 0 }) {
  el.classList.add('ch');
  const yf = yfmt || fmt;
  responsive(el, (W, anim) => {
    const pad = { l: 46, r: 14, t: 14, b: 26 };
    const n = labels.length;
    const max = nice(Math.max(minMax, ...series.flatMap(s => s.values)) * 1.08 || 1);
    const iw = W - pad.l - pad.r, ih = height - pad.t - pad.b;
    const X = i => pad.l + (n < 2 ? iw / 2 : (i * iw) / (n - 1));
    const Y = v => pad.t + ih - (v / max) * ih;
    const id = `g${++uid}`;
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 70))));
    const svg = `<svg viewBox="0 0 ${W} ${height}" height="${height}" role="img">
      <defs>${series.map((s, k) => `<linearGradient id="${id}${k}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".32"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`).join('')}</defs>
      <g class="grid">${Array.from({ length: ticks + 1 }, (_, i) => { const v = (max / ticks) * i; return `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${pad.l - 8}" y="${Y(v) + 3.5}" text-anchor="end">${esc(yf(v))}</text>`; }).join('')}</g>
      <g>${labels.map((l, i) => (i % every === 0 || i === n - 1) && !(i !== n - 1 && n - 1 - i < every * .6) ? `<text x="${X(i)}" y="${height - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${esc(xfmt(l))}</text>` : '').join('')}</g>
      ${series.map((s, k) => { const pts = s.values.map((v, i) => [X(i), Y(v)]); const d = smooth(pts);
        return (s.area !== false ? `<path class="${anim ? 'ar' : ''}" d="${d}L${X(n - 1)},${Y(0)}L${X(0)},${Y(0)}Z" fill="url(#${id}${k})"/>` : '') +
          `<path class="ln ${anim ? 'draw' : ''}" pathLength="1" d="${d}" stroke="${s.color}" ${s.dash ? 'stroke-dasharray="4 4"' : ''}/>`; }).join('')}
      <line class="cross" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ih}"/>
      ${series.map(s => `<circle class="dot" r="4.5" fill="${s.color}" cx="-10" cy="-10"/>`).join('')}
      <rect class="hit" x="${pad.l}" y="${pad.t}" width="${iw}" height="${ih}"/>
    </svg>`;
    el.innerHTML = svg;
    const s = el.querySelector('svg'), hit = s.querySelector('.hit'), cross = s.querySelector('.cross'), dots = [...s.querySelectorAll('.dot')];
    const move = e => {
      const r = s.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.round(((x - pad.l) / iw) * (n - 1))));
      el.classList.add('hov');
      cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i));
      dots.forEach((d, k) => { d.setAttribute('cx', X(i)); d.setAttribute('cy', Y(series[k].values[i])); });
      tip.show(html`<div class="t">${xfmt(labels[i], true)}</div>${series.map(se => html`<div class="r" style="--c:${raw(se.color)}"><i></i>${se.name}<b>${fmt(se.values[i])}</b></div>`)}`, e.clientX, e.clientY);
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerleave', () => { el.classList.remove('hov'); tip.hide(); });
  });
}

/* ── vertical bars, optionally stacked ──────────────────────────────
   series: [{ name, values:[], color }]  (stacked bottom-up in order) */
export function barChart(el, { labels, series, height = 220, fmt = num, xfmt = s => s, yfmt, ticks = 4, onClick }) {
  el.classList.add('ch');
  const yf = yfmt || fmt;
  responsive(el, (W, anim) => {
    const pad = { l: 46, r: 8, t: 12, b: 26 };
    const n = labels.length;
    const tot = labels.map((_, i) => series.reduce((a, s) => a + (+s.values[i] || 0), 0));
    const max = nice(Math.max(...tot) * 1.1 || 1);
    const iw = W - pad.l - pad.r, ih = height - pad.t - pad.b;
    const slot = iw / n, bw = Math.max(2, Math.min(28, slot * 0.62));
    const Y = v => pad.t + ih - (v / max) * ih;
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 64))));
    let bars = '';
    labels.forEach((_, i) => {
      let acc = 0;
      const x = pad.l + slot * i + (slot - bw) / 2;
      series.forEach((s, k) => {
        const v = +s.values[i] || 0; if (!v) return;
        const y0 = Y(acc), y1 = Y(acc + v); acc += v;
        const top = k === series.length - 1 || series.slice(k + 1).every(t => !(+t.values[i]));
        const hgt = Math.max(1, y0 - y1 - (k > 0 ? 2 : 0));
        const r = top ? Math.min(4, bw / 2, hgt) : 0;
        const y = y1;
        bars += `<path class="${anim ? 'bar' : ''}" style="animation-delay:${anim ? (i * 14) : 0}ms" fill="${s.color}" d="M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${y + hgt}Z"/>`;
      });
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${height}" height="${height}" role="img">
      <g class="grid">${Array.from({ length: ticks + 1 }, (_, i) => { const v = (max / ticks) * i; return `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${pad.l - 8}" y="${Y(v) + 3.5}" text-anchor="end">${esc(yf(v))}</text>`; }).join('')}</g>
      <g>${labels.map((l, i) => (i % every === 0) ? `<text x="${pad.l + slot * i + slot / 2}" y="${height - 6}" text-anchor="middle">${esc(xfmt(l))}</text>` : '').join('')}</g>
      <g>${bars}</g>
      <g>${labels.map((_, i) => `<rect class="hit" data-i="${i}" x="${pad.l + slot * i}" y="${pad.t}" width="${slot}" height="${ih}" style="cursor:${onClick ? 'pointer' : 'default'}"/>`).join('')}</g>
    </svg>`;
    el.querySelectorAll('.hit').forEach(h => {
      const i = +h.dataset.i;
      h.addEventListener('pointermove', e => tip.show(html`<div class="t">${xfmt(labels[i], true)}</div>${series.map(se => html`<div class="r" style="--c:${raw(se.color)}"><i></i>${se.name}<b>${fmt(se.values[i])}</b></div>`)}`, e.clientX, e.clientY));
      h.addEventListener('pointerleave', () => tip.hide());
      if (onClick) h.addEventListener('click', () => onClick(i));
    });
  });
}

/* ── donut ─────────────────────────────────────────────────────────
   parts: [{ label, value, color }] */
export function donut(el, { parts, center, sub, fmt = num, onClick }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const live = parts.filter(p => p.value > 0);
  const gap = live.length > 1 ? 1.1 : 0;
  let at = 0;
  const segs = live.map((p, i) => {
    const len = Math.max(0.6, (p.value / total) * 100 - gap);
    const s = `<circle class="seg" data-i="${parts.indexOf(p)}" cx="85" cy="85" r="68" pathLength="100" stroke="${p.color}" style="--len:${len};stroke-dashoffset:${-at};animation-delay:${i * 90}ms"/>`;
    at += (p.value / total) * 100;
    return s;
  }).join('');
  put(el, html`<div class="donut">
    <div class="dn-w"><svg viewBox="0 0 170 170"><circle cx="85" cy="85" r="68" stroke="rgb(var(--tint) / .06)" style="stroke-width:18"/>${raw(segs)}</svg>
      <div class="dn-c"><b>${center ?? num(total)}</b><span>${sub || 'total'}</span></div></div>
    <div class="dn-l">${parts.map((p, i) => html`<div data-i="${i}" style="--c:${raw(p.color)};cursor:${onClick ? 'pointer' : 'default'}"><i></i><span>${p.label}</span><b>${fmt(p.value)}</b><small>${total ? Math.round((p.value / total) * 100) : 0}%</small></div>`)}</div>
  </div>`);
  el.querySelectorAll('circle.seg').forEach(c => {
    const p = parts[+c.dataset.i];
    c.addEventListener('pointermove', e => tip.show(html`<div class="r" style="--c:${raw(p.color)}"><i></i>${p.label}<b>${fmt(p.value)} · ${Math.round((p.value / total) * 100)}%</b></div>`, e.clientX, e.clientY));
    c.addEventListener('pointerleave', () => tip.hide());
    if (onClick) c.addEventListener('click', () => onClick(p));
  });
  if (onClick) el.querySelectorAll('.dn-l > div').forEach(d => d.addEventListener('click', () => onClick(parts[+d.dataset.i])));
}

/* ── weekday × hour heatmap (one hue, light → dark) ────────────────── */
export function heatmap(el, cells, { label = 'events' } = {}) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  cells.forEach(c => { grid[c.dow - 1][c.hr] += c.n; });
  const max = Math.max(1, ...grid.flat());
  const hh = h => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`);
  put(el, html`<div class="hm">
    <span></span>${Array.from({ length: 24 }, (_, h) => html`<span class="hh">${h % 3 === 0 ? hh(h) : ''}</span>`)}
    ${grid.map((row, d) => html`<span>${days[d]}</span>${row.map((n, h) => raw(`<i data-d="${d}" data-h="${h}" data-n="${n}" style="--a:${n ? (0.14 + 0.86 * (n / max)).toFixed(2) : 0.05};animation-delay:${(d * 24 + h) * 4}ms"></i>`))}`)}
  </div>
  <div class="hm-k">Less ${[0.05, 0.3, 0.55, 0.8, 1].map(a => raw(`<i style="--a:${a}"></i>`))} More <span style="margin-left:auto">IST · last 60 days</span></div>`);
  el.querySelectorAll('.hm i').forEach(i => {
    i.addEventListener('pointermove', e => tip.show(html`<div class="t">${days[+i.dataset.d]} · ${hh(+i.dataset.h)}–${hh((+i.dataset.h + 1) % 24)}</div><b>${num(+i.dataset.n)}</b> ${label}`, e.clientX, e.clientY));
    i.addEventListener('pointerleave', () => tip.hide());
  });
}

/* ── horizontal bar list ───────────────────────────────────────────── */
export function barList(el, rows, { color = 'var(--c1)', fmt = num, onClick } = {}) {
  const max = Math.max(1, ...rows.map(r => r.value));
  if (!rows.length) return put(el, html`<div class="ch-empty">No data yet</div>`);
  put(el, html`<div class="hb">${rows.map((r, i) => html`<div class="hb-r" data-i="${i}" style="${onClick ? 'cursor:pointer' : ''}"><span title="${r.label}">${r.label}</span>
    <div class="hb-t"><i style="width:${(r.value / max) * 100}%;--c:${raw(r.color || color)};animation-delay:${i * 60}ms"></i></div><b>${fmt(r.value)}</b></div>`)}</div>`);
  if (onClick) el.querySelectorAll('.hb-r').forEach(r => r.addEventListener('click', () => onClick(rows[+r.dataset.i])));
}

/* ── funnel ────────────────────────────────────────────────────────── */
export function funnel(el, steps) {
  const top = Math.max(1, steps[0]?.value || 1);
  put(el, html`<div class="fn">${steps.map((s, i) => html`<div class="fn-r" style="--w:${Math.max(6, (s.value / top) * 100)}%;animation-delay:${i * 80}ms"><span>${s.label}</span><b>${num(s.value)}</b><small title="of everyone registered">${Math.round((s.value / top) * 100)}%</small></div>`)}</div>`);
}

/* ── sparkline for KPI tiles ───────────────────────────────────────── */
export function spark(values, color = 'var(--c1)') {
  if (!values?.length) return raw('');
  const W = 240, H = 40, max = Math.max(1, ...values), n = values.length;
  const pts = values.map((v, i) => [n < 2 ? W / 2 : (i * W) / (n - 1), H - 3 - (v / max) * (H - 8)]);
  const d = smooth(pts), id = `s${++uid}`;
  return raw(`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${d}L${W},${H}L0,${H}Z" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" vector-effect="non-scaling-stroke" pathLength="1" class="${REDUCED ? '' : 'spk'}" style="stroke-dasharray:1;stroke-dashoffset:${REDUCED ? 0 : 1};animation:draw 1.6s var(--ease) .2s forwards"/></svg>`);
}
