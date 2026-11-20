'use strict';
/* ════════════════════════════════════════════════════════════════════
   EIMC-Admin core: API calls, safe HTML templates, formatting, toasts,
   modals, the chart tooltip, count-ups and the cursor light on cards.
   Every page module imports from here.
   ════════════════════════════════════════════════════════════════════ */

export const $ = (s, c = document) => c.querySelector(s);
export const $$ = (s, c = document) => [...c.querySelectorAll(s)];
export const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── HTML: everything interpolated is escaped unless it is raw() ─────── */
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = s => new Raw(String(s ?? ''));
const val = v => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(val).join('') : v == null || v === false ? '' : esc(v));
export function html(str, ...vals) { return raw(str.reduce((a, s, i) => a + s + (i < vals.length ? val(vals[i]) : ''), '')); }
export const put = (el, h) => { el.innerHTML = String(h); return el; };

/* ── API ──────────────────────────────────────────────────────────── */
async function call(url, opts) {
  let r;
  try { r = await fetch(url, { credentials: 'same-origin', ...opts }); }
  catch { throw new Error('Cannot reach the server. Is it running?'); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { location.replace('index.html?next=' + encodeURIComponent(location.hash)); throw new Error('Signed out'); }
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}
export const api = {
  get: (v, params = {}) => call(`/api/q?${new URLSearchParams({ v, ...params })}`),
  do: (action, ...args) => call('/api/do', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, args }) }),
  sql: (sql, write) => call('/api/sql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, write }) }),
  auth: (body) => call('/api/auth', { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }),
};

/* ── formatting (India: ₹, lakh grouping, IST) ───────────────────────── */
const nf = new Intl.NumberFormat('en-IN');
const nf2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const num = n => nf.format(Math.round(+n || 0));
export const inr = (n, dp) => '₹' + (dp ? nf2.format(+n || 0) : nf.format(Math.round(+n || 0)));
export const inrShort = n => {
  n = +n || 0; const a = Math.abs(n);
  if (a >= 1e7) return '₹' + (n / 1e7).toFixed(a >= 1e8 ? 0 : 1).replace(/\.0$/, '') + 'Cr';
  if (a >= 1e5) return '₹' + (n / 1e5).toFixed(a >= 1e6 ? 0 : 1).replace(/\.0$/, '') + 'L';
  if (a >= 1e3) return '₹' + (n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return '₹' + Math.round(n);
};
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const TZ = { timeZone: 'Asia/Kolkata' };
export const date = d => (d ? new Date(d).toLocaleDateString('en-IN', { ...TZ, day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const dshort = d => (d ? new Date(d).toLocaleDateString('en-IN', { ...TZ, day: 'numeric', month: 'short' }) : '—');
export const dtime = d => (d ? new Date(d).toLocaleString('en-IN', { ...TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : '—');
export const isoLocal = d => { if (!d) return ''; const x = new Date(d); const p = n => String(n).padStart(2, '0'); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`; };
export function ago(d) {
  if (!d) return 'never';
  const s = (Date.now() - new Date(d)) / 1000, f = s < 0, a = Math.abs(s);
  const t = a < 45 ? 'just now' : a < 3600 ? `${Math.round(a / 60)}m` : a < 86400 ? `${Math.round(a / 3600)}h` : a < 86400 * 45 ? `${Math.round(a / 86400)}d` : a < 86400 * 400 ? `${Math.round(a / 86400 / 30)}mo` : `${(a / 86400 / 365).toFixed(1)}y`;
  return t === 'just now' ? t : f ? `in ${t}` : `${t} ago`;
}
export const daysLeft = d => (d ? Math.ceil((new Date(d) - Date.now()) / 864e5) : null);
export const initials = n => String(n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
export const hue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
export const avatar = (name, cls = '') => html`<span class="av ${cls}" style="--h:${hue(name)}">${initials(name)}</span>`;
export const cap = s => String(s || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

/* status → pill */
const SUBP = { active: 'ok', trialing: 'info', past_due: 'warn', halted: 'bad', cancelled: 'mute', expired: 'mute', free: 'mute' };
export const subPill = s => html`<span class="st-pill ${SUBP[s] || 'mute'}">${s ? cap(s) : 'No plan'}</span>`;
const USERP = { active: 'ok', suspended: 'warn', deleted: 'bad' };
export const userPill = s => html`<span class="st-pill ${USERP[s] || 'mute'}">${cap(s)}</span>`;
const ORDP = { paid: 'ok', failed: 'bad', refunded: 'warn', cancelled: 'mute', created: 'info' };
export const orderPill = s => html`<span class="st-pill ${ORDP[s] || 'mute'}">${cap(s)}</span>`;
const TKP = { open: 'info', in_progress: 'gold', waiting_customer: 'warn', resolved: 'ok', closed: 'mute' };
export const ticketPill = s => html`<span class="st-pill ${TKP[s] || 'mute'}">${cap(s)}</span>`;
export const planPill = p => (p ? html`<span class="st-pill ${p === 'pro' ? 'gold' : 'mute'}">${cap(p)}</span>` : html`<span class="st-pill mute">Free</span>`);

/* a customer's health, 0..100: access, paying, use, payment trouble, support load */
export function health(u) {
  if (u.status === 'suspended' || u.status === 'deleted') return 0;
  let s = 40;
  if (u.access_until) s += 22;
  if (['active'].includes(u.sub_status) && u.billing_cycle !== 'trial') s += 12;
  if (u.sub_status === 'trialing') s += 6;
  s += Math.min(18, (u.logins_30 || 0) * 3);
  if (u.last_login_at && Date.now() - new Date(u.last_login_at) > 14 * 864e5) s -= 12;
  if (u.sub_status === 'past_due') s -= 22;
  if (u.sub_status === 'halted') s -= 30;
  if (['cancelled', 'expired'].includes(u.sub_status)) s -= 14;
  if (u.card_expired) s -= 8;
  if (u.fails_30 > 3) s -= 6;
  s -= Math.min(12, (u.open_tickets || 0) * 4);
  if (u.licence_revoked) s -= 10;
  return Math.max(0, Math.min(100, Math.round(s)));
}
export const healthColor = v => (v >= 70 ? 'var(--teal)' : v >= 45 ? 'var(--heat)' : 'var(--red)');
export const healthBar = v => html`<span class="hp" style="--v:${v}%;--hc:${healthColor(v)}"><i></i>${v}</span>`;

/* ── icons (stroke, 24 grid, currentColor) ───────────────────────────── */
const P = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.6-5.5 6.5-5.5s5.5 2 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.7 3 2.4 3.5 5.2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  layers: '<path d="M12 2 3 7l9 5 9-5-9-5Z"/><path d="m3 17 9 5 9-5"/><path d="m3 12 9 5 9-5"/>',
  receipt: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h6"/>',
  tag: '<path d="M3 12V3h9l9 9-9 9-9-9Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  send: '<path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><path d="M12 17.5v.01"/>',
  bulb: '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2Z"/>',
  db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  code: '<path d="m8 6-6 6 6 6M16 6l6 6-6 6M14 4l-4 16"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  out: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 17l5-5-5-5M15 12H3"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a2 2 0 0 0 3.4 0"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/>',
  shield: '<path d="M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5l-8-3Z"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17v.01"/>',
  monitor: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3Z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  play: '<path d="M7 4v16l13-8L7 4Z"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12Z"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 21h16"/>',
};
export const icon = (n, cls = '') => raw(`<svg class="${cls}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || P.info}</svg>`);

/* ── toast ────────────────────────────────────────────────────────── */
let toastT;
export function toast(msg, bad = false) {
  const t = $('#toast');
  put(t, html`${icon(bad ? 'alert' : 'check')}<span>${msg}</span>`);
  t.classList.toggle('bad', bad);
  t.style.borderColor = bad ? '' : '';
  $('svg', t).style.color = bad ? 'var(--danger)' : '';
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), bad ? 5200 : 3200);
}
export const fail = e => { if (e?.message !== 'Signed out') toast(e?.message || String(e), true); };

/* ── modal: returns a promise of the button value (or form data) ─────── */
let modalSeq = 0;
export function modal({ title, text, body, wide, xl, danger, actions = [{ label: 'Close', value: null }], onOpen, submit }) {
  const m = $('#modal');
  const seq = ++modalSeq;
  return new Promise(resolve => {
    put(m, html`<div class="modal-veil" data-close></div>
      <form class="modal-box ${wide ? 'wide' : ''} ${xl ? 'xl' : ''} ${danger ? 'danger' : ''}" role="dialog" aria-modal="true" novalidate>
        <button type="button" class="modal-x" data-close aria-label="Close">${icon('x')}</button>
        <h3>${title}</h3>
        ${text ? html`<p>${text}</p>` : ''}
        ${body ? html`<div class="modal-b">${body}</div>` : ''}
        <div class="modal-err lg-err" role="alert"></div>
        <div class="modal-f">${actions.map((a, i) => html`<button type="${a.submit ? 'submit' : 'button'}" class="btn ${a.cls || ''}" data-i="${i}">${a.label}</button>`)}</div>
      </form>`);
    m.hidden = false;
    requestAnimationFrame(() => m.classList.add('on'));
    const form = $('form', m);
    let done = false;
    const close = v => {
      if (done) return; done = true;
      m.classList.remove('on');
      document.removeEventListener('keydown', esc);
      // a dialog opened right after this one (a second confirm) must not be wiped by this close
      setTimeout(() => { if (seq === modalSeq) { m.hidden = true; m.innerHTML = ''; } }, 220);
      resolve(v);
    };
    const esc = e => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', esc);
    $$('[data-close]', m).forEach(b => b.addEventListener('click', () => close(null)));
    const err = $('.modal-err', m);
    const run = async a => {
      if (a.submit && submit) {
        const btn = $(`[data-i="${actions.indexOf(a)}"]`, m);
        btn.classList.add('busy'); err.classList.remove('on');
        try { const r = await submit(Object.fromEntries(new FormData(form)), form); close(r === undefined ? true : r); }
        catch (e) { err.textContent = e.message; err.classList.add('on'); btn.classList.remove('busy'); form.closest('.modal-box')?.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 260 }); }
        return;
      }
      close(a.value);
    };
    $$('.modal-f button', m).forEach(b => b.addEventListener('click', e => { const a = actions[+b.dataset.i]; if (!a.submit) { e.preventDefault(); run(a); } }));
    form.addEventListener('submit', e => { e.preventDefault(); const a = actions.find(x => x.submit); if (a) run(a); });
    onOpen?.(form, close);
    setTimeout(() => ($('input:not([type=hidden]),textarea,select', form) || $('.modal-f .btn-gold', m))?.focus(), 60);
  });
}
export const confirmBox = (title, text, { label = 'Confirm', danger = false } = {}) =>
  modal({ title, text, danger, actions: [{ label: 'Cancel', value: false, cls: 'btn-quiet' }, { label, value: true, cls: danger ? 'btn-danger' : 'btn-gold' }] });

/* run an action with a busy button + toast */
export async function act(btn, fn, okMsg) {
  btn?.classList.add('busy');
  try { const r = await fn(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); return r; }
  catch (e) { fail(e); throw e; }
  finally { btn?.classList.remove('busy'); }
}

/* ── tooltip shared by every chart ─────────────────────────────────── */
export const tip = {
  show(h, x, y) {
    const t = $('#tip');
    put(t, h);
    t.classList.add('on');
    const r = t.getBoundingClientRect();
    let left = x + 16, top = y - r.height - 12;
    if (left + r.width > innerWidth - 8) left = x - r.width - 16;
    if (top < 8) top = y + 18;
    t.style.left = left + 'px'; t.style.top = top + 'px';
  },
  hide() { $('#tip')?.classList.remove('on'); },
};

/* ── count-up for every [data-count] inside el ─────────────────────── */
export function countUp(el) {
  $$('[data-count]', el).forEach(n => {
    const to = +n.dataset.count, fmt = n.dataset.fmt;
    const show = v => (n.textContent = fmt === 'inr' ? inr(v) : fmt === 'inrs' ? inrShort(v) : num(v));
    if (REDUCED || !isFinite(to)) return show(to);
    const t0 = performance.now(), dur = 1100 + Math.min(600, Math.log10(Math.abs(to) + 1) * 120);
    const step = t => { const p = Math.min(1, (t - t0) / dur); show(to * (1 - Math.pow(1 - p, 4))); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}

/* ── cursor light on .lit cards ─────────────────────────────────────── */
export function lights(root = document) {
  if (REDUCED || !matchMedia('(hover: hover)').matches) return;
  $$('.lit', root).forEach(el => {
    if (el.dataset.lit) return; el.dataset.lit = 1;
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', ((e.clientX - r.left) / r.width) * 100 + '%');
      el.style.setProperty('--my', ((e.clientY - r.top) / r.height) * 100 + '%');
      el.style.setProperty('--trk', 1);
    });
    el.addEventListener('pointerleave', () => el.style.setProperty('--trk', 0));
  });
}

export const copy = async (text, what = 'Copied') => { try { await navigator.clipboard.writeText(text); toast(`${what} to clipboard`); } catch { toast('Could not copy', true); } };
export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const skeleton = (rows = [[4, 142], [2, 320], [3, 280]]) =>
  html`${rows.map(([n, h]) => html`<div class="g g${n}">${Array.from({ length: n }, () => html`<div class="sk" style="height:${h}px"></div>`)}</div>`)}`;
export function csv(name, cols, rows) {
  const q = v => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = [cols.join(','), ...rows.map(r => cols.map(c => q(r[c])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
