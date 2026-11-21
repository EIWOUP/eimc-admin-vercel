'use strict';
/* Abuse flags: accounts that look shared, copied or farmed (eimc.abuse_flags, DB/sql/10_abuse.sql).
   Nothing is blocked automatically. Look at the evidence, act on the user page (sign out all
   terminals, block a PC, suspend the account), or mark the flag reviewed: it then stays hidden
   until new evidence arrives. Reads /api/q?v=abuse. */
import { $$, api, html, put, icon, num, dtime, ago, act, modal, countUp } from './core.js';

let D, CTX;

/* what each signal means, how strong it is, and what usually fixes it */
export const SIGNALS = {
  licence_copied: { label: 'Licence copied', lvl: 'bad', strength: 'Strong',
    what: 'The same account and PC connected to live data from another network while it was already connected, 3+ times in 7 days.',
    fix: 'Sign out all terminals (forces the password), and block the PC if it continues.' },
  token_reuse: { label: 'Sign-in token reused', lvl: 'bad', strength: 'Strong',
    what: 'An already-used sign-in token came back: the terminal’s saved sign-in was copied to another PC. That PC was signed out automatically.',
    fix: 'Sign out all terminals; the owner signs in again with the password.' },
  device_mismatch: { label: 'Licence from another PC', lvl: 'warn', strength: 'Medium',
    what: 'A licence issued to one PC was presented from a different PC, 3+ times in 30 days.',
    fix: 'Often a copied app-data folder: sign out all terminals.' },
  many_places: { label: 'Many networks', lvl: 'warn', strength: 'Weak',
    what: 'Active from 5+ different networks in one day (addresses grouped per /24 or /64, so a phone changing address is not counted).',
    fix: 'Travel and mobile data can do this. Act only if “Licence copied” shows too.' },
  pc_churn: { label: 'Seat passed around', lvl: 'warn', strength: 'Medium',
    what: 'Signed in on more than 3× its PC allowance within 30 days: one seat rotated between people.',
    fix: 'Ask the customer; block PCs that are not theirs, or lower the PC limit.' },
  shared_pc: { label: 'PC on several accounts', lvl: 'info', strength: 'Weak',
    what: 'The same PC is signed in to two or more accounts. Common with trial farming (a new account for each free trial).',
    fix: 'Family PCs are legitimate. If the accounts are throwaway trials, suspend them.' },
  signup_burst: { label: 'Sign-up burst', lvl: 'info', strength: 'Weak',
    what: '4+ accounts signed up from one address within 30 days.',
    fix: 'Offices and hostels share addresses. Check whether the accounts look like the same person.' },
};
const ORDER = Object.keys(SIGNALS);

function evidence(f) {
  const d = f.detail || {};
  switch (f.signal) {
    case 'licence_copied': return `${d.times}× replaced${d.networks?.length ? ` · from ${d.networks.join(', ')}` : ''}`;
    case 'token_reuse': return `${d.times}× in 30 days`;
    case 'device_mismatch': return `${d.times}× in 30 days`;
    case 'many_places': return `${d.networks} networks in 24 h${d.sample?.length ? ` · ${d.sample.join(', ')}` : ''}`;
    case 'pc_churn': return `${d.pcs} PCs on a ${d.seats}-PC plan`;
    case 'shared_pc': return `“${d.pc || 'PC'}” is on ${d.accounts} accounts`;
    case 'signup_burst': return `${d.accounts} accounts from ${d.ip}`;
    default: return JSON.stringify(d);
  }
}

export const flagPill = f => html`<span class="st-pill ${SIGNALS[f.signal]?.lvl || 'mute'}" title="${SIGNALS[f.signal]?.what || ''}">${SIGNALS[f.signal]?.label || f.signal}</span>`;

export async function render(root, ctx) {
  CTX = ctx;
  D = await api.get('abuse');
  const byUser = new Map();
  for (const f of D.flags) {
    if (!byUser.has(f.user_id)) byUser.set(f.user_id, { ...f, list: [] });
    byUser.get(f.user_id).list.push(f);
  }
  const users = [...byUser.values()].sort((a, b) =>
    Math.min(...a.list.map(f => ORDER.indexOf(f.signal))) - Math.min(...b.list.map(f => ORDER.indexOf(f.signal))) ||
    new Date(b.last_at) - new Date(a.last_at));
  const count = s => new Set(D.flags.filter(f => f.signal === s).map(f => f.user_id)).size;

  put(root, html`
  <div class="ph"><div><h1>Abuse <em>flags</em></h1><p>Accounts that look shared, copied or farmed. Nothing is blocked automatically: you decide.</p></div></div>
  <div class="g g4">
    ${['licence_copied', 'token_reuse', 'pc_churn', 'shared_pc'].map(s => html`<div class="card kpi lit"><div class="kpi-l">${icon(SIGNALS[s].lvl === 'bad' ? 'alert' : 'shield')}${SIGNALS[s].label}</div>
      <div class="kpi-v"><span data-count="${count(s)}">0</span></div><div class="kpi-d"><span>${SIGNALS[s].strength} signal</span></div></div>`)}
  </div>

  <div class="card flush lit mt20"><div class="card-h" style="padding:20px 22px 0"><h2>Flagged accounts</h2><small>${num(users.length)} account${users.length === 1 ? '' : 's'} · newest evidence first within each strength</small></div>
    <div class="dt-w"><table class="tbl"><thead><tr><th>Account</th><th>Plan</th><th>Flags</th><th>Evidence</th><th>PCs</th><th>Last</th><th></th></tr></thead><tbody>
    ${users.length ? users.map(u => html`<tr>
      <td><a href="#/users/${u.user_id}"><b style="color:var(--bone)">${u.full_name}</b></a><small class="mono">${u.client_id}${u.user_status !== 'active' ? ` · ${u.user_status}` : ''}</small></td>
      <td>${u.plan_code ? html`${u.plan_code}<small>${u.sub_status || ''}</small>` : '—'}</td>
      <td>${u.list.map(f => html`${flagPill(f)} `)}</td>
      <td style="max-width:360px">${u.list.map(f => html`<small>${evidence(f)}</small>`)}</td>
      <td class="mono">${u.pcs} / ${u.max_devices ?? 1}</td>
      <td class="nw" title="${dtime(u.list[0].last_at)}">${ago(u.list.reduce((m, f) => (new Date(f.last_at) > new Date(m) ? f.last_at : m), u.list[0].last_at))}</td>
      <td class="r nw"><a class="btn btn-sm" href="#/users/${u.user_id}/licence">Open</a> <button type="button" class="btn btn-sm btn-quiet" data-review="${u.user_id}">${icon('check')}Reviewed</button></td>
    </tr>`) : html`<tr><td colspan="7"><div class="empty-s">${icon('shield')}No flags. Every account looks like one person on their own PCs.</div></td></tr>`}
    </tbody></table></div></div>

  <div class="g g2 mt20">
    <div class="card lit"><div class="card-h"><h2>${icon('info')} What the flags mean</h2></div>
      <div class="dl">${ORDER.map(s => html`<div style="margin-bottom:12px">${flagPill({ signal: s })} <small>${SIGNALS[s].strength}</small>
        <div class="mini" style="margin-top:4px">${SIGNALS[s].what}</div><div class="mini" style="margin-top:2px"><b>Usually:</b> ${SIGNALS[s].fix}</div></div>`)}</div>
    </div>
    <div class="card flush lit"><div class="card-h" style="padding:20px 22px 0"><h2>Recently reviewed</h2><small>hidden until new evidence</small></div>
      <div class="dt-w"><table class="tbl"><thead><tr><th>When</th><th>Account</th><th>Flag</th><th>Note</th></tr></thead><tbody>
      ${D.reviews.length ? D.reviews.map(r => html`<tr><td class="nw" title="${dtime(r.reviewed_at)}">${ago(r.reviewed_at)}</td>
        <td><a href="#/users/${r.user_id}">${r.full_name}</a><small class="mono">${r.client_id}</small></td><td>${flagPill(r)}</td><td><small>${r.note || '—'}</small></td></tr>`)
        : html`<tr><td colspan="4"><div class="empty-s">Nothing reviewed yet</div></td></tr>`}
      </tbody></table></div></div>
  </div>`);
}

async function again() {
  const v = document.querySelector('#view'), h = document.createElement('div');
  await render(h, CTX);
  v.replaceChildren(...h.childNodes);
  mounted(v, CTX);
}

export function mounted(view) {
  countUp(view);
  $$('[data-review]', view).forEach(b => b.addEventListener('click', async () => {
    const uid = b.dataset.review;
    const list = D.flags.filter(f => String(f.user_id) === uid);
    const r = await modal({ title: `Mark ${list[0]?.full_name || 'this account'} reviewed?`,
      text: 'The flags below disappear until new evidence arrives after now. Nothing changes for the customer.',
      body: html`<div style="margin-bottom:12px">${list.map(f => html`${flagPill(f)} `)}</div>
        <div class="fld wide"><label>Note (optional)</label><input name="note" maxlength="500" placeholder="e.g. travelling this week; family PC"></div>`,
      actions: [{ label: 'Cancel', value: null, cls: 'btn-quiet' }, { label: 'Mark reviewed', submit: true, cls: 'btn-gold' }],
      submit: f => api.do('abuseReview', uid, 'all', f.note) });
    if (r) again();
  }));
}
