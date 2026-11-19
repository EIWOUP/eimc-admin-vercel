'use strict';
/* Activity: sign-ins, live sessions, the audit trail, and suspicious IPs. */
import { $, $$, api, html, put, icon, num, ago, dtime, avatar, cap, toast, fail } from './core.js';
import { dataTable } from './table.js';

let D, tab = 'logins';
const TABS = [['logins', 'Sign-ins'], ['sessions', 'Live sessions'], ['audit', 'Audit trail'], ['ips', 'IP addresses']];
const ua = s => { s = s || ''; const b = /Edg\//.test(s) ? 'Edge' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : /EIMC/.test(s) ? 'EIMC Terminal' : s ? 'Browser' : '—'; const os = /Windows/.test(s) ? 'Windows' : /Android/.test(s) ? 'Android' : /iPhone|iPad/.test(s) ? 'iPhone' : /Mac OS/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : ''; return os ? `${b} on ${os}` : b; };

export async function render(root) {
  D = await api.get('activity');
  const fails = D.logins.filter(l => !l.success);
  put(root, html`
  <div class="ph"><div><h1>Activity <em>&amp; audit trail</em></h1><p>${num(D.logins.length)} recent sign-in attempts · ${num(fails.length)} failed · ${num(D.sessions.length)} live sessions · ${num(D.audit.length)} audit entries</p></div></div>
  <div class="tabs" id="a-tabs"><span class="ink"></span>${TABS.map(([k, l]) => html`<button type="button" data-t="${k}" class="${k === tab ? 'on' : ''}">${l} <em>${{ logins: D.logins.length, sessions: D.sessions.length, audit: D.audit.length, ips: D.ips.length }[k]}</em></button>`)}</div>
  <div id="a-pane"></div>`);
}

export function mounted(view, ctx) {
  const ink = () => { const on = $('#a-tabs .on', view), ik = $('#a-tabs .ink', view); ik.style.left = on.offsetLeft + 'px'; ik.style.width = on.offsetWidth + 'px'; };
  requestAnimationFrame(ink);
  $$('#a-tabs [data-t]', view).forEach(b => b.addEventListener('click', () => { tab = b.dataset.t; $$('#a-tabs [data-t]', view).forEach(x => x.classList.toggle('on', x === b)); ink(); show(view, ctx); }));
  show(view, ctx);
}

function show(view, ctx) {
  const host = $('#a-pane', view);
  host.className = 'pane';
  const who = r => (r.user_id ? html`<div class="who">${avatar(r.full_name || '?', 'sm')}<div><b>${r.full_name}</b><small>${r.client_id}</small></div></div>` : html`<span class="muted">Unknown account</span>`);
  if (tab === 'logins') dataTable(host, {
    rows: D.logins, placeholder: 'Search name, typed ID, IP…',
    search: l => [l.full_name, l.login_id, l.ip, l.client_id, l.user_agent].join(' '),
    chips: [{ key: 'all', label: 'All' }, { key: 'ok', label: 'Successful', test: l => l.success }, { key: 'bad', label: 'Failed', test: l => !l.success }, { key: 'unknown', label: 'Unknown ID', test: l => !l.user_id }],
    sort: { col: 0, dir: 'desc' }, pageSize: 30,
    columns: [
      { label: 'When', sort: l => +new Date(l.at), cls: 'nw', render: l => html`${dtime(l.at)}<small>${ago(l.at)}</small>` },
      { label: 'Result', sort: l => l.success, render: l => (l.success ? html`<span class="st-pill ok">OK</span>` : html`<span class="st-pill bad">Failed</span>`) },
      { label: 'Account', sort: l => l.full_name || '', render: who },
      { label: 'Typed', cls: 'mono', render: l => l.login_id || '—' },
      { label: 'IP', cls: 'mono', sort: l => l.ip || '', render: l => l.ip || l.location || '—' },
      { label: 'Device', render: l => ua(l.user_agent) },
    ],
    onRow: l => l.user_id && ctx.nav(`#/users/${l.user_id}?tab=security`),
    csv: 'eimc-signins', csvCols: ['at', 'success', 'client_id', 'full_name', 'login_id', 'ip', 'user_agent'],
  });
  if (tab === 'sessions') dataTable(host, {
    rows: D.sessions, placeholder: 'Search name, device, IP…',
    search: s => [s.full_name, s.device_label, s.ip, s.client_id].join(' '),
    chips: [{ key: 'all', label: 'All' }, { key: 'web', label: 'Website', test: s => s.kind === 'web' }, { key: 'terminal', label: 'Terminal', test: s => s.kind === 'terminal' },
      { key: 'now', label: 'Active 15 min', test: s => s.last_used_at && Date.now() - new Date(s.last_used_at) < 9e5 }],
    sort: { col: 3, dir: 'desc' },
    columns: [
      { label: 'Account', sort: s => s.full_name, render: who },
      { label: 'Device', render: s => html`${s.device_label || '—'}<small>${s.kind}</small>` },
      { label: 'IP', cls: 'mono', render: s => s.ip || '—' },
      { label: 'Last used', sort: s => +new Date(s.last_used_at || 0), cls: 'nw', render: s => html`${ago(s.last_used_at)}<small>started ${dtime(s.created_at)}</small>` },
      { label: 'Expires', sort: s => +new Date(s.expires_at), cls: 'nw', render: s => dtime(s.expires_at) },
      { label: '', render: s => html`<button type="button" class="btn btn-sm" data-rev="${s.id}">Revoke</button>` },
    ],
    onRow: s => ctx.nav(`#/users/${s.user_id}?tab=security`),
    afterRender(tb) {
      tb.querySelectorAll('[data-rev]').forEach(b => b.addEventListener('click', async e => {
        e.stopPropagation(); b.classList.add('busy');
        try { await api.do('revokeSession', b.dataset.rev); toast('Session revoked: they are signed out'); b.closest('tr').style.opacity = '.4'; b.remove(); } catch (er) { fail(er); b.classList.remove('busy'); }
      }));
    },
  });
  if (tab === 'audit') dataTable(host, {
    rows: D.audit, placeholder: 'Search action, person, details…',
    search: a => [a.action, a.actor, a.full_name, a.client_id, JSON.stringify(a.details || '')].join(' '),
    chips: [{ key: 'all', label: 'All' }, { key: 'admin', label: 'By admin', test: a => a.actor === 'admin' }, { key: 'customer', label: 'By customers', test: a => a.actor === 'customer' },
      { key: 'system', label: 'System', test: a => !['admin', 'customer'].includes(a.actor) }, { key: 'sec', label: 'Admin sign-ins', test: a => /^admin\.login/.test(a.action) }],
    sort: { col: 0, dir: 'desc' }, pageSize: 30,
    columns: [
      { label: 'When', sort: a => +new Date(a.at), cls: 'nw', render: a => html`${dtime(a.at)}<small>${ago(a.at)}</small>` },
      { label: 'By', sort: a => a.actor, render: a => html`<span class="st-pill ${a.actor === 'admin' ? 'vio' : a.actor === 'customer' ? 'info' : 'mute'}">${a.actor}</span>` },
      { label: 'Action', cls: 'mono', sort: a => a.action, render: a => (a.action === 'admin.login_failed' ? html`<span style="color:var(--red-t)">${a.action}</span>` : a.action) },
      { label: 'Account', render: a => (a.user_id ? who(a) : html`<span class="muted">—</span>`) },
      { label: 'Details', render: a => html`<span class="cell" title="${a.details ? JSON.stringify(a.details) : ''}">${a.details ? Object.entries(a.details).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') : '—'}</span>` },
    ],
    onRow: a => a.user_id && ctx.nav(`#/users/${a.user_id}?tab=activity`),
    csv: 'eimc-audit', csvCols: ['at', 'actor', 'action', 'client_id', 'full_name', 'details'],
  });
  if (tab === 'ips') dataTable(host, {
    rows: D.ips, key: 'ip', search: r => r.ip, placeholder: 'Search IP…',
    chips: [{ key: 'all', label: 'All' }, { key: 'bad', label: 'With failures', test: r => r.bad > 0 }, { key: 'multi', label: 'Several accounts', test: r => r.users > 1 }],
    sort: { col: 2, dir: 'desc' },
    columns: [
      { label: 'IP address', cls: 'mono', render: r => html`<b style="color:var(--bone)">${r.ip}</b>` },
      { label: 'Attempts', r: true, cls: 'mono', sort: r => r.n, render: r => num(r.n) },
      { label: 'Failed', r: true, cls: 'mono', sort: r => r.bad, render: r => (r.bad ? html`<span style="color:var(--red-t)">${num(r.bad)}</span>` : '0') },
      { label: 'Accounts', r: true, cls: 'mono', sort: r => r.users, render: r => (r.users > 1 ? html`<span style="color:var(--heat-t)">${r.users}</span>` : r.users) },
      { label: 'Last seen', sort: r => +new Date(r.last), render: r => ago(r.last) },
      { label: 'Risk', sort: r => r.bad * 2 + r.users, render: r => { const s = r.bad >= 5 || r.users > 3 ? ['bad', 'High'] : r.bad >= 2 || r.users > 1 ? ['warn', 'Watch'] : ['ok', 'Normal']; return html`<span class="st-pill ${s[0]}">${s[1]}</span>`; } },
    ],
    empty: 'No sign-ins with an IP in the last 30 days',
  });
}
