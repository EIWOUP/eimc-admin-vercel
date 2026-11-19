'use strict';
/* ════════════════════════════════════════════════════════════════════
   Light (default) / dark theme switch.

   The choice lives in localStorage 'eimc.theme'. An inline script in
   every page's <head> applies it before the first paint, so a page never
   flashes the wrong theme. The palettes themselves are in css/site.css
   ("LIGHT THEME").

   The switch dissolves the old theme into particles from the button, the
   gallery's own effect (js/theme-dust.js); without WebGL 2 it dips
   through the new page colour. Nothing moves for prefers-reduced-motion.
   ════════════════════════════════════════════════════════════════════ */

import { runReal as dust, prepare } from '/js/theme-dust.js';

const KEY = 'eimc.theme';
const root = document.documentElement;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const current = () => (root.dataset.theme === 'light' ? 'light' : 'dark');

function paint(theme) {
  if (theme === 'light') root.dataset.theme = 'light'; else delete root.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f3f5f9' : '#06080d');
  document.querySelectorAll('[data-theme-toggle]').forEach(b => {
    const next = theme === 'light' ? 'dark' : 'light';
    b.setAttribute('aria-label', `Switch to ${next} theme`);
    b.setAttribute('aria-pressed', String(theme === 'light'));
  });
  try { localStorage.setItem(KEY, theme); } catch { /* private mode: it just will not be remembered */ }
}

/* A dip through the new page colour: one fixed layer fades in, the theme
   changes underneath it while it covers the page, and it fades out. Only
   that layer's opacity animates (on the compositor), and the restyle of the
   whole page happens while nothing is moving, so it looks the same on every
   click, however busy the page is. (A full-page View Transition snapshot
   stuttered with the hero video playing.) */
const INK = { light: '#f3f5f9', dark: '#06080d' };
const frame = () => new Promise(r => requestAnimationFrame(() => r()));
let busy = false;
async function toggle(e) {
  if (busy) return;
  const next = current() === 'light' ? 'dark' : 'light';
  if (REDUCED) return paint(next);
  busy = true;
  try {
    // the gallery's particle dissolve, from the button (js/theme-dust.js)
    const r = e.currentTarget.getBoundingClientRect();
    const was = current();
    const ok = await dust({
      x: r.left + r.width / 2, y: r.top + r.height / 2,
      from: INK[was],
      accent: was === 'light' ? '#2f5ae6' : '#4c7dff',
      accent2: was === 'light' ? '#0a86a8' : '#38bdf8',
      apply: () => paint(next),
    });
    if (!ok) await dip(next);
  } finally { busy = false; }
}

// without WebGL 2: a dip through the new page colour
async function dip(next) {
  const v = document.createElement('div');
  v.setAttribute('aria-hidden', 'true');
  v.style.cssText = `position:fixed;inset:0;z-index:2147483646;pointer-events:none;background:${INK[next]};opacity:0;will-change:opacity;contain:strict`;
  document.body.appendChild(v);
  try {
    await v.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 170, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }).finished;
    paint(next);
    getComputedStyle(document.body).color;
    await frame(); await frame();
    await v.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: 'cubic-bezier(0,0,.2,1)', fill: 'forwards' }).finished;
  } finally { v.remove(); }
}

export function mountThemeToggle() {
  paint(current());
  document.querySelectorAll('[data-theme-toggle]').forEach(b => b.addEventListener('click', toggle));
  if (!REDUCED) prepare();
}
