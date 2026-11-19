'use strict';
/* ════════════════════════════════════════════════════════════════════
   EIMC-Admin shell: hash router, sidebar, top bar, live pulse,
   command palette (Ctrl K), keyboard shortcuts, sign-out.
   Pages live in js/admin/p-*.js and are loaded on first visit.
   ════════════════════════════════════════════════════════════════════ */
import { $, $$, api, html, put, icon, esc, raw, toast, fail, lights, debounce, ago, avatar, subPill, inr, skeleton } from './core.js';
import { mountThemeToggle } from '/js/theme-toggle.js';

const PAGES = {
  overview: { title: 'Overview', icon: 'grid', load: () => import('./p-overview.js') },
  activity: { title: 'Activity', icon: 'pulse', load: () => import('./p-activity.js') },
  users:    { title: 'Users', icon: 'users', load: () => import('./p-users.js'), badge: 'users' },
  user:     { title: 'User', icon: 'user', load: () => import('./p-user.js'), hidden: true, parent: 'users' },
  subs:     { title: 'Subscriptions', icon: 'layers', load: () => import('./p-subs.js'), badge: 'at_risk', hot: true },
  orders:   { title: 'Orders & revenue', icon: 'receipt', load: () => import('./p-orders.js') },
  plans:    { title: 'Plans & pricing', icon: 'tag', load: () => import('./p-plans.js') },
  messages: { title: 'Email & push', icon: 'send', load: () => import('./p-messages.js') },
  support:  { title: 'Support', icon: 'help', load: () => import('./p-support.js'), badge: 'tickets', hot: true },
  ideas:    { title: 'Ideas board', icon: 'bulb', load: () => import('./p-ideas.js') },
  db:       { title: 'Database', icon: 'db', load: () => import('./p-db.js') },
  sql:      { title: 'SQL console', icon: 'code', load: () => import('./p-sql.js') },
};
const GROUPS = [['Analyse', ['overview', 'activity']], ['People', ['users', 'subs']], ['Money', ['orders', 'plans']],
  ['Reach', ['messages']], ['Help', ['support', 'ideas']], ['Data', ['db', 'sql']]];

const view = $('#view');
let current = null, cleanup = null, navSeq = 0;

/* ── sidebar ─────────────────────────────────────────────────────── */
put($('#sb-nav'), html`${GROUPS.map(([g, keys]) => html`<div class="sb-g">${g}</div>${keys.map(k => html`<a class="sb-l" href="#/${k}" data-k="${k}">${icon(PAGES[k].icon)}<span>${PAGES[k].title}</span><em class="${PAGES[k].hot ? 'hot' : ''}" data-badge="${PAGES[k].badge || ''}"></em></a>`)}`)}`);

/* ── router ──────────────────────────────────────────────────────── */
function parse() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  let key = parts[0] || 'overview';
  if (key === 'users' && parts[1]) key = 'user';
  if (!PAGES[key]) key = 'overview';
  return { key, params: parts.slice(1) };
}
export const nav = h => { location.hash = h; };

export function crumb(...items) {
  put($('#crumb'), html`${items.map((it, i) => html`${i ? raw('<i></i>') : ''}${it.href ? html`<a href="${it.href}">${it.label}</a>` : html`<b>${it.label}</b>`}`)}`);
  document.title = `${items[items.length - 1]?.label || 'EIMC'} · EIMC Admin`;
}

async function route() {
  const seq = ++navSeq;
  const { key, params } = parse();
  const page = PAGES[key];
  document.body.classList.remove('nav-open');
  $$('.sb-l').forEach(a => a.classList.toggle('on', a.dataset.k === key || a.dataset.k === page.parent));
  try { cleanup?.(); } catch { /* a page that failed to clean up is not worth blocking navigation */ }
  cleanup = null;
  const same = current === key;
  current = key;
  if (!same) { view.classList.remove('in'); put(view, skeleton()); }
  crumb(...[page.parent ? { label: PAGES[page.parent].title, href: `#/${page.parent}` } : null, { label: page.title }].filter(Boolean));
  try {
    const mod = await page.load();
    if (seq !== navSeq) return;
    const ctx = { params, nav, crumb, refreshPulse: pulse, onLeave: fn => { cleanup = fn; }, isCurrent: () => seq === navSeq };
    const holder = document.createElement('div');
    await mod.render(holder, ctx);
    if (seq !== navSeq) return;
    view.classList.remove('in');
    view.replaceChildren(...holder.childNodes);
    void view.offsetWidth;
    view.classList.add('in');
    mod.mounted?.(view, ctx);
    lights(view);
    if (!same) window.scrollTo({ top: 0 });
  } catch (e) {
    if (seq !== navSeq) return;
    if (e?.message === 'Signed out') return;
    put(view, html`<div class="card"><div class="empty-s">${icon('alert')}<b style="color:var(--bone)">This page could not load</b><span>${e.message}</span><button class="btn btn-sm" onclick="location.reload()">Reload</button></div></div>`);
  }
}
window.addEventListener('hashchange', route);
export const refresh = () => { current = '__'; route(); };

/* ── live pulse + badges ─────────────────────────────────────────── */
let pulseT;
async function pulse() {
  clearTimeout(pulseT);
  const db = $('#sb-db');
  try {
    const t0 = performance.now();
    const p = await api.get('pulse');
    const ms = Math.round(performance.now() - t0);
    $('#pulse b').textContent = p.online;
    db.classList.remove('off');
    put(db, html`<i></i><span>Database <b>live</b> · ${ms} ms<br>last event ${ago(p.last_event)}</span>`);
    $$('[data-badge]').forEach(b => { const k = b.dataset.badge; if (k) b.textContent = p[k] ? p[k] : ''; });
  } catch (e) {
    if (e?.message === 'Signed out') return;
    db.classList.add('off');
    put(db, html`<i></i><span>Database <b>unreachable</b></span>`);
  }
  pulseT = setTimeout(pulse, document.hidden ? 60000 : 20000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) pulse(); });

/* ── command palette ─────────────────────────────────────────────── */
const K = $('#cmdk');
let kItems = [], kOn = 0, kSeq = 0;
const ACTIONS = [
  { label: 'Add a new user', icon: 'plus', run: () => { nav('#/users'); setTimeout(() => document.dispatchEvent(new CustomEvent('admin:new-user')), 400); } },
  { label: 'Send email or push notification', icon: 'send', run: () => nav('#/messages') },
  { label: 'Run SQL', icon: 'code', run: () => nav('#/sql') },
  { label: 'Switch light / dark theme', icon: 'eye', run: () => $('[data-theme-toggle]').click() },
  { label: 'Sign out', icon: 'out', run: () => logout() },
];
function openK() {
  put(K, html`<div class="cmdk-veil" data-x></div><div class="cmdk-box" role="dialog" aria-label="Search">
    <div class="cmdk-in">${icon('search')}<input id="k-in" placeholder="Search users by name, email, phone, client ID… or jump to a page" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div>
    <div class="cmdk-l" id="k-l"></div>
    <div class="cmdk-f"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div></div>`);
  K.hidden = false;
  $('[data-x]', K).addEventListener('click', closeK);
  const inp = $('#k-in');
  inp.addEventListener('input', debounce(() => fillK(inp.value), 120));
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); kOn = (kOn + (e.key === 'ArrowDown' ? 1 : -1) + kItems.length) % Math.max(1, kItems.length); paintK(); }
    if (e.key === 'Enter') { e.preventDefault(); kItems[kOn]?.run(); closeK(); }
    if (e.key === 'Escape') closeK();
  });
  fillK('');
  inp.focus();
}
function closeK() { K.hidden = true; K.innerHTML = ''; }
async function fillK(q) {
  const seq = ++kSeq;
  const t = q.trim().toLowerCase();
  const pages = Object.entries(PAGES).filter(([, p]) => !p.hidden && (!t || p.title.toLowerCase().includes(t)))
    .map(([k, p]) => ({ group: 'Pages', label: p.title, icon: p.icon, run: () => nav(`#/${k}`) }));
  const acts = ACTIONS.filter(a => !t || a.label.toLowerCase().includes(t)).map(a => ({ ...a, group: 'Actions' }));
  kItems = [...pages, ...acts];
  kOn = 0; paintK();
  if (t.length < 2) return;
  try {
    const r = await api.get('search', { q: t });
    if (seq !== kSeq) return;
    const found = [
      ...r.users.map(u => ({ group: 'Users', who: u, label: u.full_name, small: `${u.client_id} · ${u.email}`, run: () => nav(`#/users/${u.id}`) })),
      ...r.orders.map(o => ({ group: 'Orders', icon: 'receipt', label: `${o.order_no} · ${o.full_name}`, small: `${inr(o.total)} · ${o.status}`, run: () => nav(`#/users/${o.user_id}?tab=orders`) })),
      ...r.tickets.map(x => ({ group: 'Tickets', icon: 'help', label: `${x.ticket_no} · ${x.subject}`, small: x.status, run: () => nav(`#/support/${x.id}`) })),
    ];
    kItems = [...found, ...pages, ...acts];
    kOn = 0; paintK();
  } catch { /* the page list still works without search */ }
}
function paintK() {
  const l = $('#k-l'); if (!l) return;
  if (!kItems.length) return put(l, html`<div class="empty-s">${icon('search')}Nothing matches</div>`);
  let g = '';
  put(l, html`${kItems.map((it, i) => { const head = it.group !== g ? (g = it.group, html`<div class="cmdk-g">${g}</div>`) : '';
    return html`${head}<button type="button" class="cmdk-i ${i === kOn ? 'on' : ''}" data-i="${i}">${it.who ? avatar(it.who.full_name, 'sm') : icon(it.icon || 'arrow')}<span>${it.label}</span>${it.who ? subPill(it.who.sub_status) : ''}${it.small ? html`<small>${it.small}</small>` : ''}</button>`; })}`);
  $$('.cmdk-i', l).forEach(b => {
    b.addEventListener('click', () => { kItems[+b.dataset.i].run(); closeK(); });
    b.addEventListener('mousemove', () => { if (kOn !== +b.dataset.i) { kOn = +b.dataset.i; paintK(); } });
  });
  $('.cmdk-i.on', l)?.scrollIntoView({ block: 'nearest' });
}
$('#open-k').addEventListener('click', openK);

/* ── keys ────────────────────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); K.hidden ? openK() : closeK(); return; }
  if (typing || !$('#modal').hidden || !K.hidden) return;
  if (e.key === '/') { e.preventDefault(); openK(); }
  if (e.key === 'r' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); $('#refresh').click(); }
});

/* ── top bar bits ────────────────────────────────────────────────── */
$('#refresh').addEventListener('click', e => {
  const b = e.currentTarget; b.classList.add('spin');
  refresh(); pulse();
  setTimeout(() => b.classList.remove('spin'), 700);
});
$('#burger').addEventListener('click', e => { e.stopPropagation(); document.body.classList.toggle('nav-open'); });
document.addEventListener('click', e => { if (document.body.classList.contains('nav-open') && !e.target.closest('.sb')) document.body.classList.remove('nav-open'); });
const me = $('#me');
$('.acct-btn', me).addEventListener('click', e => { e.stopPropagation(); me.classList.toggle('open'); });
document.addEventListener('click', e => { if (!e.target.closest('#me')) me.classList.remove('open'); });
async function logout() {
  try { await api.auth({ action: 'logout' }); } catch { /* the cookie is cleared server-side either way */ }
  location.replace('index.html');
}
$('[data-logout]').addEventListener('click', logout);

/* ── start ───────────────────────────────────────────────────────── */
mountThemeToggle();
(async () => {
  try {
    const a = await api.auth();
    if (!a.admin) return location.replace('index.html?next=' + encodeURIComponent(location.hash));
    $('#me-id').textContent = `ID ${a.admin.id} · session ends ${new Date(a.admin.exp).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
    window.__mail = a.mail;
  } catch (e) { return; }
  route();
  pulse();
})();
export { toast, fail, esc };
