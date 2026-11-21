'use strict';
/* One user: everything about them, and every lever to change it. */
import { $, $$, api, html, put, raw, icon, num, inr, ago, date, dtime, dshort, isoLocal, avatar, subPill, planPill, userPill, orderPill, ticketPill,
  health, healthColor, modal, toast, fail, act, confirmBox, copy, cap, daysLeft, countUp, lights } from './core.js';
import { barChart } from './charts.js';
import { SIGNALS, flagPill } from './p-abuse.js';

let D, uid, tab = 'overview', CTX;
const LEV = { activate: 'ok', refresh: 'mute', signout: 'mute', denied: 'warn', relay_connect: 'info', relay_drop: 'mute', token_reuse: 'bad' };
const LEV_LABEL = { activate: 'Signed in', refresh: 'Checked', signout: 'Signed out', denied: 'Refused', relay_connect: 'Live data on', relay_drop: 'Live data off', token_reuse: 'Token reused' };
const TABS = [['overview', 'Overview'], ['profile', 'Profile'], ['plan', 'Subscription'], ['licence', 'Licence & PCs'], ['security', 'Sign-in & security'],
  ['billing', 'Orders & payments'], ['support', 'Support'], ['messages', 'Messages'], ['activity', 'Timeline']];

export async function render(root, ctx) {
  CTX = ctx;
  const [idPart, qs] = String(ctx.params[0] || '').split('?');
  if (idPart !== uid) tab = 'overview';
  uid = idPart;
  tab = new URLSearchParams(qs || '').get('tab') || ctx.params[1] || tab || 'overview';
  if (!TABS.some(t => t[0] === tab)) tab = 'overview';
  D = await api.get('user', { id: uid });
  ctx.crumb({ label: 'Users', href: '#/users' }, { label: D.user.full_name });
  put(root, html`<div id="u-head"></div><div class="tabs" id="u-tabs"></div><div id="u-pane"></div>`);
}

export function mounted(view) {
  head(view); tabs(view); pane(view);
}

async function reload(keepTab = true) {
  try {
    D = await api.get('user', { id: uid });
    const v = $('#view'); head(v); tabs(v); pane(v);
    CTX.refreshPulse();
  } catch (e) { fail(e); }
}

/* ── header ───────────────────────────────────────────────────────── */
function head(v) {
  const u = D.user, s = D.sub;
  const flat = { ...u, sub_status: s?.status, billing_cycle: s?.billing_cycle, access_until: s?.access_until, logins_30: D.stats.logins_30, fails_30: 0,
    card_expired: D.methods.some(m => m.status === 'expired'), open_tickets: D.tickets.filter(t => !['resolved', 'closed'].includes(t.status)).length, licence_revoked: D.licence?.revoked };
  const hv = health(flat);
  put($('#u-head', v), html`<div class="card glow up-hero lit">
    ${avatar(u.full_name, 'big')}
    <div>
      <h1>${u.full_name} ${planPill(s?.plan_code)} ${subPill(s?.status)} ${u.status !== 'active' ? userPill(u.status) : ''} ${u.role !== 'customer' ? html`<span class="st-pill vio">${u.role}</span>` : ''}</h1>
      <div class="up-meta">
        <span>${icon('user')}Client <button type="button" class="mono" data-copy="${u.client_id}" title="Copy">${u.client_id}</button></span>
        <span>${icon('mail')}<button type="button" data-copy="${u.email}" title="Copy">${u.email}</button>${u.email_verified ? html`<span class="vf">verified</span>` : ''}</span>
        ${u.phone ? html`<span>${icon('phone')}<button type="button" data-copy="${u.phone}">${u.phone}</button></span>` : ''}
        <span>${icon('calendar')}Joined ${date(u.created_at)}${u.signup_source === 'website' ? html` · signed up on the website${u.signup_ip ? ` (${u.signup_ip})` : ''}` : u.signup_source === 'admin' ? ' · added by admin' : ''}</span>
        <span>${icon('clock')}Last sign-in ${ago(u.last_login_at)}</span>
        ${s?.access_until ? html`<span style="color:var(--teal)">${icon('zap')}Access until ${date(s.access_until)} · ${daysLeft(s.access_until)} d</span>` : html`<span style="color:var(--red-t)">${icon('ban')}No access now</span>`}
      </div>
    </div>
    <div class="up-side">
      <div class="ring" style="--hc:${raw(healthColor(hv))}"><svg viewBox="0 0 92 92"><circle class="bg" cx="46" cy="46" r="40"/><circle class="v" cx="46" cy="46" r="40" pathLength="100" style="--len:${hv}"/></svg><div><b>${hv}</b><span>health</span></div></div>
      <div class="up-act">
        <button type="button" class="btn btn-gold" data-a="msg">${icon('send')}Email / push</button>
        <button type="button" class="btn" data-a="extend">${icon('calendar')}+30 days</button>
        <button type="button" class="btn" data-a="pw">${icon('key')}Set password</button>
        ${u.status === 'active' ? html`<button type="button" class="btn btn-danger" data-a="suspend">${icon('ban')}Suspend</button>` : html`<button type="button" class="btn" data-a="activate">${icon('check')}Reactivate</button>`}
        <button type="button" class="btn btn-quiet" data-a="delete" title="Delete">${icon('trash')}</button>
      </div>
    </div>
  </div>`);
  $$('[data-copy]', v).forEach(b => b.addEventListener('click', () => copy(b.dataset.copy)));
  $$('#u-head [data-a]', v).forEach(b => b.addEventListener('click', () => HEAD[b.dataset.a](b)));
  lights(v);
}

const userBody = (u, over) => ({ first_name: u.first_name, last_name: u.last_name, email: u.email, phone: u.phone, role: u.role, status: u.status,
  blocked_reason: u.blocked_reason, email_verified: u.email_verified, phone_verified: u.phone_verified, ...over });
const HEAD = {
  msg: () => messageUser(),
  extend: b => act(b, () => api.do('extend', uid, 30), r => `Access now runs to ${date(r.current_period_end)}`).then(reload, () => {}),
  pw: () => { $(`#u-tabs [data-t="security"]`).click(); setTimeout(() => { const i = document.querySelector('#f-pw input[name=password]'); i?.scrollIntoView({ block: 'center', behavior: 'smooth' }); i?.focus(); }, 80); },
  suspend: async b => {
    const r = await modal({ title: `Suspend ${D.user.full_name}?`, danger: true, text: 'They are signed out of the site and the terminal at once, and cannot sign in until you reactivate them.',
      body: html`<div class="fld"><label>Reason (only admins see it)</label><input name="reason" placeholder="e.g. Chargeback, abuse, request"></div>`,
      actions: [{ label: 'Cancel', value: null, cls: 'btn-quiet' }, { label: 'Suspend', submit: true, cls: 'btn-danger' }],
      submit: f => api.do('updateUser', uid, userBody(D.user, { status: 'suspended', blocked_reason: f.reason || 'Suspended by admin' })) });
    if (r) { toast('Account suspended'); reload(); }
  },
  activate: b => act(b, () => api.do('updateUser', uid, userBody(D.user, { status: 'active', blocked_reason: null })), 'Account reactivated').then(reload, () => {}),
  delete: async () => {
    const r = await modal({ title: `Delete ${D.user.full_name}?`, danger: true,
      text: 'Soft delete hides the account and blocks sign-in, but keeps orders and history. Permanent delete removes the user and everything linked to them (orders, invoices, tickets, devices) and cannot be undone.',
      actions: [{ label: 'Cancel', value: null, cls: 'btn-quiet' }, { label: 'Soft delete', value: 'soft', cls: 'btn' }, { label: 'Delete permanently', value: 'hard', cls: 'btn-danger' }] });
    if (!r) return;
    if (r === 'hard' && !await confirmBox('This is permanent', `Every row for client ${D.user.client_id} is erased from the database. There is no undo.`, { label: 'Erase everything', danger: true })) return;
    try { await api.do('deleteUser', uid, r === 'hard'); toast(r === 'hard' ? 'User erased' : 'User soft-deleted'); CTX.refreshPulse(); r === 'hard' ? CTX.nav('#/users') : reload(); } catch (e) { fail(e); }
  },
};

/* ── tabs ─────────────────────────────────────────────────────────── */
function tabs(v) {
  const counts = { billing: D.orders.length, support: D.tickets.length, messages: D.notes.length, licence: D.devices.filter(d => !d.revoked && !d.blocked).length, security: D.sessions.filter(s => s.live).length };
  put($('#u-tabs', v), html`<span class="ink"></span>${TABS.map(([k, l]) => html`<button type="button" data-t="${k}" class="${tab === k ? 'on' : ''}">${l}${counts[k] ? html` <em>${counts[k]}</em>` : ''}</button>`)}`);
  const ink = () => { const on = $('#u-tabs .on', v), ik = $('#u-tabs .ink', v); if (on && ik) { ik.style.left = on.offsetLeft + 'px'; ik.style.width = on.offsetWidth + 'px'; } };
  requestAnimationFrame(ink);
  $$('#u-tabs [data-t]', v).forEach(b => b.addEventListener('click', () => {
    tab = b.dataset.t;
    history.replaceState(null, '', `#/users/${uid}?tab=${tab}`);
    $$('#u-tabs [data-t]', v).forEach(x => x.classList.toggle('on', x === b)); ink(); pane(v);
  }));
}

function pane(v) {
  const p = $('#u-pane', v);
  put(p, html`<div class="pane">${PANES[tab]()}</div>`);
  WIRE[tab]?.(p);
  countUp(p); lights(p);
}

const tblCard = (title, extra, head, rows, empty = 'Nothing yet') => html`<div class="card flush lit"><div class="card-h" style="padding:20px 22px 0">${title}${extra ? html`<div class="r">${extra}</div>` : ''}</div>
  <div class="dt-w"><table class="tbl"><thead><tr>${head.map(h => html`<th class="${h.startsWith('>') ? 'r' : ''}">${h.replace(/^>/, '')}</th>`)}</tr></thead>
  <tbody>${rows.length ? rows : html`<tr><td colspan="${head.length}"><div class="empty-s">${empty}</div></td></tr>`}</tbody></table></div></div>`;

/* ── panes ────────────────────────────────────────────────────────── */
const PANES = {
  overview() {
    const s = D.sub, p = D.profile || {};
    return html`<div class="g g4">
      <div class="card kpi"><div class="kpi-l">${icon('cash')}Paid in total</div><div class="kpi-v"><span data-count="${D.stats.ltv}" data-fmt="inr">0</span></div><div class="kpi-d"><span>${D.orders.filter(o => o.status === 'paid').length} paid orders · ${inr(D.stats.refunded)} refunded</span></div></div>
      <div class="card kpi"><div class="kpi-l">${icon('check')}Sign-ins, 30 d</div><div class="kpi-v"><span data-count="${D.stats.logins_30}">0</span></div><div class="kpi-d"><span>${num(D.stats.logins)} all-time · ${num(D.stats.fails)} failed</span></div></div>
      <div class="card kpi"><div class="kpi-l">${icon('monitor')}Terminals</div><div class="kpi-v"><span data-count="${D.devices.filter(d => !d.revoked && !d.blocked).length}">0</span><small>/ ${D.licence?.max_devices ?? s?.seats ?? 1}</small></div><div class="kpi-d"><span>${D.sessions.filter(x => x.live).length} live sessions</span></div></div>
      <div class="card kpi"><div class="kpi-l">${icon('layers')}Plan</div><div class="kpi-v" style="font-size:1.5rem">${s ? `${s.plan_name} · ${s.billing_cycle}` : 'Free'}</div><div class="kpi-d"><span>${s ? `${inr(s.price)} · since ${date(s.started_at)}` : 'No subscription'}</span></div></div>
    </div>
    <div class="g g21">
      <div class="card lit"><div class="card-h"><h2>Sign-ins per day</h2><small>last 30 days</small></div><div id="u-days"></div></div>
      <div class="card lit"><div class="card-h"><h2>At a glance</h2></div><div class="kvs">
        <div><span>Location</span><b>${[p.city, p.state].filter(Boolean).join(', ') || '—'}</b></div>
        <div><span>Experience</span><b>${p.experience || '—'}</b></div>
        <div><span>Trades</span><b>${p.trades || '—'}</b></div>
        <div><span>2-step sign-in</span><b>${D.security?.two_factor_enabled ? `On (${D.security.two_factor_method || 'email'})` : 'Off'}</b></div>
        <div><span>Licence</span><b class="mono">${D.licence ? (D.licence.revoked ? 'Revoked' : D.licence.licence_key) : 'None'}</b></div>
        <div><span>Abuse flags</span><b>${D.flags?.length ? D.flags.map(f => html`${flagPill(f)} `) : 'None'}</b></div>
        <div><span>Renewal</span><b>${s ? (s.cancel_at_period_end ? 'Will not renew' : s.auto_renew ? 'Auto-renews' : 'Manual') : '—'}</b></div>
        <div><span>Marketing emails</span><b>${D.prefs?.offers ? 'Yes' : 'No'}</b></div>
      </div></div>
    </div>
    <div class="card lit mt20"><div class="card-h"><h2>Recent activity</h2><div class="r"><button type="button" class="tlink sm" data-go="activity">Full timeline</button></div></div>
      <div class="feed">${D.feed.slice(0, 8).map(feed)}</div></div>`;
  },

  profile() {
    const u = D.user, p = D.profile || {}, n = D.prefs || {};
    const f = (name, label, value, extra = '') => html`<div class="fld"><label>${label}</label><input name="${name}" value="${value ?? ''}" ${raw(extra)}></div>`;
    const sel = (name, label, value, opts) => html`<div class="fld"><label>${label}</label><select name="${name}">${opts.map(o => html`<option value="${o}" ${o === value ? 'selected' : ''}>${cap(o)}</option>`)}</select></div>`;
    const sw = (name, label, sub, on) => html`<li><div><b>${label}</b><span>${sub}</span></div><label class="sw"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}><i></i></label></li>`;
    return html`<form class="card lit" id="f-user"><div class="card-h"><h2>Account</h2><small>what they sign in with</small></div>
      <div class="form-g">${f('first_name', 'First name', u.first_name)}${f('last_name', 'Last name', u.last_name)}${f('email', 'Email', u.email, 'type="email"')}${f('phone', 'Mobile', u.phone)}
        ${f('client_id', 'Client ID', u.client_id, 'inputmode="numeric" pattern="\\d{5,12}" class="mono"')}${f('created_at', 'Member since', isoLocal(u.created_at), 'type="datetime-local"')}
        ${sel('status', 'Account status', u.status, ['active', 'suspended', 'deleted'])}${sel('role', 'Role', u.role, ['customer', 'support', 'admin'])}${f('blocked_reason', 'Block reason', u.blocked_reason)}
        <div class="fld"><label>Verified</label><div style="display:flex;gap:18px;min-height:42px;align-items:center"><label class="chk"><input type="checkbox" name="email_verified" ${u.email_verified ? 'checked' : ''}><span></span>Email</label><label class="chk"><input type="checkbox" name="phone_verified" ${u.phone_verified ? 'checked' : ''}><span></span>Mobile</label></div></div>
      </div>
      <div class="form-f"><span class="mini">Client ID, email and mobile are what they sign in with: changing one changes their login.</span><div class="btns"><button class="btn btn-gold btn-sm" type="submit">Save account</button></div></div></form>

    <form class="card lit" id="f-prof"><div class="card-h"><h2>Personal &amp; billing details</h2><small>shown on their account page and GST invoices</small></div>
      <div class="form-g">${f('city', 'City', p.city)}${f('state', 'State', p.state)}${f('pincode', 'PIN code', p.pincode)}${f('country', 'Country', p.country)}
        ${f('address_line1', 'Address line 1', p.address_line1)}${f('address_line2', 'Address line 2', p.address_line2)}${f('company_name', 'Company', p.company_name)}${f('date_of_birth', 'Date of birth', p.date_of_birth ? String(p.date_of_birth).slice(0, 10) : '', 'type="date"')}
        ${f('experience', 'Trading experience', p.experience)}${f('trades', 'What they trade', p.trades)}${f('language', 'Language', p.language)}${f('gstin', 'GSTIN', p.gstin, 'maxlength="15" style="text-transform:uppercase"')}
        ${f('billing_name', 'Billing name', p.billing_name)}${f('billing_line1', 'Billing address 1', p.billing_line1)}${f('billing_line2', 'Billing address 2', p.billing_line2)}${f('billing_city', 'Billing city', p.billing_city)}
        ${f('billing_state', 'Billing state', p.billing_state)}${f('billing_pin', 'Billing PIN', p.billing_pin)}</div>
      <div class="form-f"><div class="btns"><button class="btn btn-gold btn-sm" type="submit">Save details</button></div></div></form>

    <form class="card lit" id="f-prefs"><div class="card-h"><h2>Notification switches</h2><small>the five on their account page, plus channels</small></div>
      <ul class="toggles">${sw('renewal', 'Renewal reminders', 'Before the plan renews or ends', n.renewal)}${sw('invoices', 'Invoice emails', 'A GST invoice after each payment', n.invoices)}
        ${sw('product', 'Product updates', 'New versions and features', n.product)}${sw('setups', 'Setup alerts', 'DQRS setup messages', n.setups)}${sw('offers', 'Offers', 'Marketing and discounts', n.offers)}
        ${sw('push_alerts', 'Push notifications', 'Terminal and browser push', n.push_alerts)}${sw('sms_alerts', 'SMS alerts', 'Text messages', n.sms_alerts)}${sw('whatsapp_alerts', 'WhatsApp alerts', 'WhatsApp messages', n.whatsapp_alerts)}</ul>
      <div class="form-f"><div class="btns"><button class="btn btn-gold btn-sm" type="submit">Save switches</button></div></div></form>`;
  },

  plan() {
    const s = D.sub || {};
    const opts = (list, v) => list.map(o => html`<option value="${o}" ${o === v ? 'selected' : ''}>${cap(o)}</option>`);
    return html`<div class="card glow lit"><div class="card-h"><h2>${icon('zap')} Quick changes</h2><small>${D.sub ? html`currently ${subPill(s.status)} · ${s.access_until ? `access until ${dtime(s.access_until)}` : 'no access'}` : 'no subscription yet'}</small></div>
      <div class="qa">
        ${[1, 7, 30, 90, 365].map(n => html`<button type="button" class="btn" data-ext="${n}">${icon('plus')}${n} day${n > 1 ? 's' : ''}</button>`)}
        <button type="button" class="btn" data-ext="custom">${icon('calendar')}Custom…</button>
      </div>
      <div class="qa mt12">
        <button type="button" class="btn" data-q="activate">${icon('check')}Activate</button>
        <button type="button" class="btn" data-q="resume">${icon('play')}Resume renewal</button>
        <button type="button" class="btn" data-q="cancel">${icon('x')}Cancel at period end</button>
        <button type="button" class="btn" data-q="past_due">${icon('alert')}Mark past due</button>
        <button type="button" class="btn" data-q="halt">${icon('ban')}Halt</button>
        <button type="button" class="btn btn-danger" data-q="expire">${icon('clock')}Expire now</button>
        ${D.sub ? html`<button type="button" class="btn btn-danger" data-q="remove">${icon('trash')}Remove plan</button>` : ''}
      </div></div>

    <form class="card lit" id="f-sub"><div class="card-h"><h2>${D.sub ? 'Edit subscription' : 'Give a plan'}</h2><small>changing plan or cycle keeps the old one as history</small></div>
      <div class="form-g">
        <div class="fld"><label>Plan</label><select name="plan_code">${D.plans.map(p => html`<option value="${p.code}" ${p.code === s.plan_code ? 'selected' : ''}>${p.name} — ${inr(p.price_monthly)}/mo</option>`)}</select></div>
        <div class="fld"><label>Billing cycle</label><select name="billing_cycle">${opts(['trial', 'monthly'], s.billing_cycle || 'monthly')}</select></div>
        <div class="fld"><label>Status</label><select name="status">${opts(['active', 'trialing', 'past_due', 'halted', 'cancelled', 'expired'], s.status || 'active')}</select></div>
        <div class="fld"><label>Price (₹, blank = list price)</label><input name="price" type="number" min="0" step="0.01" value="${s.price ?? ''}"></div>
        <div class="fld"><label>Period start</label><input name="current_period_start" type="datetime-local" value="${isoLocal(s.current_period_start || new Date())}"></div>
        <div class="fld"><label>Period end (access until)</label><input name="current_period_end" type="datetime-local" value="${isoLocal(s.current_period_end || new Date(Date.now() + 30 * 864e5))}" required></div>
        <div class="fld"><label>Trial end</label><input name="trial_end" type="datetime-local" value="${isoLocal(s.trial_end)}"></div>
        <div class="fld"><label>Seats / PCs</label><input name="seats" type="number" min="1" max="50" value="${s.seats ?? ''}"></div>
        <div class="fld"><label>Next cycle</label><select name="next_cycle"><option value="">Same</option>${opts(['monthly'], s.next_cycle)}</select></div>
        <div class="fld"><label>Cancel reason</label><input name="cancel_reason" value="${s.cancel_reason || ''}"></div>
        <div class="fld"><label>Renewal</label><div style="display:flex;gap:18px;min-height:42px;align-items:center"><label class="chk"><input type="checkbox" name="auto_renew" ${s.auto_renew !== false ? 'checked' : ''}><span></span>Auto-renew</label><label class="chk"><input type="checkbox" name="cancel_at_period_end" ${s.cancel_at_period_end ? 'checked' : ''}><span></span>Ends at period end</label></div></div>
      </div>
      <div class="form-f"><span class="mini">The customer's account page reads this on their next load.</span><div class="btns"><button class="btn btn-gold btn-sm" type="submit">${D.sub ? 'Save subscription' : 'Give plan'}</button></div></div></form>

    ${tblCard(html`<h2>History</h2>`, '', ['Plan', 'Cycle', 'Status', '>Price', 'Started', 'Period end', 'Current'],
      D.history.map(h => html`<tr><td>${h.plan_name}</td><td>${h.billing_cycle}</td><td>${subPill(h.status)}</td><td class="r mono">${inr(h.price)}</td><td class="nw">${date(h.started_at)}</td><td class="nw">${date(h.current_period_end)}</td><td>${h.is_current ? html`<span class="st-pill ok">Current</span>` : ''}</td></tr>`))}`;
  },

  licence() {
    const l = D.licence;
    return html`${D.flags?.length ? html`<div class="card lit" style="border-color:var(--heat-t)"><div class="card-h"><h2>${icon('alert')} Abuse flags</h2><div class="r"><a class="btn btn-sm" href="#/abuse">All flags</a></div></div>
      ${D.flags.map(f => html`<div style="margin-bottom:10px">${flagPill(f)} <small>${ago(f.last_at)}</small><div class="mini" style="margin-top:4px">${SIGNALS[f.signal]?.what || ''} <b>Usually:</b> ${SIGNALS[f.signal]?.fix || ''}</div></div>`)}
    </div>` : ''}
    <div class="card glow lit ${D.flags?.length ? 'mt20' : ''}"><div class="card-h"><h2>${icon('key')} Licence key</h2>${l ? html`<small>issued ${date(l.issued_at)}${l.last_issued_at ? ` · re-issued ${date(l.last_issued_at)}` : ''}</small>` : ''}</div>
      ${l ? html`<div class="lkey"><span style="${l.revoked ? 'text-decoration:line-through;color:var(--ash)' : ''}">${l.licence_key}</span>${l.revoked ? html`<span class="st-pill bad">Revoked</span>` : html`<span class="st-pill ok">Active</span>`}<button type="button" class="btn btn-sm btn-quiet" data-copy="${l.licence_key}">${icon('copy')}Copy</button></div>
        <div class="form-g mt20">
          <div class="fld"><label>Max PCs</label><input type="number" min="1" max="50" value="${l.max_devices}" data-l="devices"></div>
          <div class="fld"><label>App version</label><input value="${l.app_version}" data-l="version"></div>
          <div class="fld wide"><label>Licence key (edit to set your own)</label><input class="mono" value="${l.licence_key}" data-l="key" maxlength="19" style="text-transform:uppercase"></div>
        </div>
        <div class="qa mt20"><button type="button" class="btn" data-lic="regenerate">${icon('refresh')}New key</button>
          <button type="button" class="btn" data-lic="signout_all" ${D.devices.some(d => d.signed_in) ? '' : 'disabled'}>${icon('out')}Sign out all terminals</button>
          ${l.revoked ? html`<button type="button" class="btn" data-lic="restore">${icon('check')}Restore licence</button>` : html`<button type="button" class="btn btn-danger" data-lic="revoke">${icon('ban')}Revoke licence</button>`}</div>`
        : html`<div class="empty-s">${icon('key')}No licence yet<button type="button" class="btn btn-gold btn-sm" data-lic="issue">Issue a licence</button></div>`}
    </div>
    ${tblCard(html`<h2>Terminals (PCs)</h2>`, '', ['PC', 'OS', 'Version', 'Last IP', 'First seen', 'Last seen', 'Signed in', 'State', ''],
      D.devices.map(d => html`<tr><td><b style="color:var(--bone)">${d.label || 'PC'}</b>${d.other_accounts ? html`<small><span class="st-pill warn" title="The same PC is registered on other accounts">also on ${d.other_accounts} other account${d.other_accounts === 1 ? '' : 's'}</span></small>` : ''}</td>
        <td>${d.os || '—'}</td><td class="mono">${d.app_version || '—'}</td><td class="mono">${d.last_ip || '—'}</td>
        <td class="nw">${date(d.first_seen)}</td><td class="nw">${ago(d.last_seen)}</td><td>${d.signed_in ? html`<span class="st-pill ok">Yes</span>` : html`<span class="st-pill mute">No</span>`}</td>
        <td>${d.blocked ? html`<span class="st-pill bad" title="${d.blocked_reason || ''}">Blocked</span>` : d.revoked ? html`<span class="st-pill mute">Signed out</span>` : html`<span class="st-pill ok">Active</span>`}</td>
        <td class="r nw">${d.blocked ? html`<button type="button" class="btn btn-sm" data-dev="${d.id}" data-w="unblock">Unblock</button>`
          : html`${d.revoked ? html`<button type="button" class="btn btn-sm" data-dev="${d.id}" data-w="restore" title="Give the slot back without a sign-in">Restore</button>` : html`<button type="button" class="btn btn-sm" data-dev="${d.id}" data-w="revoke" title="Signs the PC out and frees its slot">Sign out PC</button>`}
            <button type="button" class="btn btn-sm btn-danger" data-dev="${d.id}" data-w="block" title="This PC can never use this account again">Block</button>`}
          <button type="button" class="btn btn-sm btn-quiet" data-devedit="${d.id}" title="Edit">${icon('edit')}</button> <button type="button" class="btn btn-sm btn-quiet" data-dev="${d.id}" data-w="delete" title="Delete">${icon('trash')}</button></td></tr>`), 'No PCs yet')}
    ${tblCard(html`<h2>Terminal sign-ins</h2><small>sign-ins, checks and refusals from EIMC Terminal</small>`, '', ['When', 'Event', 'Reason', 'PC', 'Version', 'IP'],
      (D.licenceEvents || []).map(e => html`<tr><td class="nw" title="${dtime(e.at)}">${ago(e.at)}</td><td><span class="st-pill ${LEV[e.event] || 'mute'}">${LEV_LABEL[e.event] || e.event}</span></td>
        <td class="mono"><small>${e.reason || ''}</small></td><td>${e.pc || '—'}</td><td class="mono">${e.app_version || '—'}</td><td class="mono">${e.ip || '—'}</td></tr>`),
      'This customer has not used EIMC Terminal yet')}`;
  },

  security() {
    const s = D.security || {};
    return html`<div class="g g2">
      <form class="card lit" id="f-pw"><div class="card-h"><h2>${icon('lock')} Password</h2><small>changed ${s.password_changed_at ? ago(s.password_changed_at) : '—'}</small></div>
        <div class="nt" style="margin-bottom:14px">${icon('info')}<span>Their current password <b>cannot be shown</b>: it is stored only as a one-way bcrypt hash, so nobody (not even the database) can read it back. Type or generate a new one below. You see it in full before you save it.</span></div>
        <div class="fld"><label>New password</label><div class="pw-row"><input name="password" type="text" minlength="8" maxlength="128" autocomplete="off" spellcheck="false" class="mono" placeholder="At least 8 characters" required>
          <button type="button" class="btn btn-sm" data-pw="gen" title="Generate a strong password">${icon('refresh')}Generate</button><button type="button" class="btn btn-sm btn-quiet" data-pw="copy" title="Copy">${icon('copy')}</button></div></div>
        <label class="chk mt12"><input type="checkbox" name="signout" checked><span></span>Sign them out of every browser and terminal</label>
        <div class="qa mt20"><button type="submit" class="btn btn-gold">${icon('key')}Set this password</button><button type="button" class="btn" data-sec="out">${icon('out')}Sign out everywhere</button></div></form>
      <div class="card lit"><div class="card-h"><h2>${icon('shield')} Protection</h2></div>
        <div class="kvs"><div><span>2-step sign-in</span><b>${s.two_factor_enabled ? `On · ${s.two_factor_method || 'email'}` : 'Off'}</b></div>
          <div><span>Failed attempts</span><b>${num(s.failed_login_count || 0)}</b></div><div><span>Locked until</span><b>${s.locked_until ? dtime(s.locked_until) : 'Not locked'}</b></div>
          <div><span>Failed sign-ins (all)</span><b>${num(D.stats.fails)}</b></div></div>
        <div class="qa mt20"><button type="button" class="btn" data-sec="unlock">${icon('unlock')}Unlock &amp; reset attempts</button>
          <button type="button" class="btn" data-sec="2fa">${icon('shield')}${s.two_factor_enabled ? 'Turn off 2-step' : 'Turn on 2-step'}</button></div></div>
    </div>
    ${tblCard(html`<h2>Sessions</h2><small>browsers and terminals signed in</small>`, '', ['Device', 'Kind', 'IP', 'Started', 'Last used', 'Expires', ''],
      D.sessions.map(x => html`<tr style="${x.live ? '' : 'opacity:.55'}"><td><b style="color:var(--bone)">${x.device_label || 'Unknown'}</b><small>${(x.user_agent || '').slice(0, 60)}</small></td><td>${x.kind}</td><td class="mono">${x.ip || '—'}</td>
        <td class="nw">${dtime(x.created_at)}</td><td class="nw">${ago(x.last_used_at)}</td><td class="nw">${x.live ? date(x.expires_at) : html`<span class="st-pill mute">${x.revoked ? 'Revoked' : 'Expired'}</span>`}</td>
        <td class="r">${x.live ? html`<button type="button" class="btn btn-sm" data-ses="${x.id}">Revoke</button>` : ''}</td></tr>`), 'No sessions')}
    ${tblCard(html`<h2>Sign-in history</h2>`, '', ['When', 'Result', 'Typed', 'IP', 'Device'],
      D.logins.map(l => html`<tr><td class="nw">${dtime(l.at)}</td><td>${l.success ? html`<span class="st-pill ok">OK</span>` : html`<span class="st-pill bad">Failed</span>`}</td><td class="mono">${l.login_id || '—'}</td><td class="mono">${l.ip || l.location || '—'}</td><td><small style="margin:0">${(l.user_agent || '—').slice(0, 70)}</small></td></tr>`), 'No sign-ins yet')}`;
  },

  billing() {
    const st = ['paid', 'failed', 'refunded', 'cancelled', 'created'];
    return html`${tblCard(html`<h2>Orders &amp; invoices</h2><small>${inr(D.stats.ltv)} paid</small>`, html`<button type="button" class="btn btn-sm btn-gold" data-order>${icon('plus')}Manual order</button>`,
      ['Order', 'Date', 'Item', '>Total', 'Paid with', 'Invoice', 'Status', ''],
      D.orders.map(o => html`<tr><td class="mono">${o.order_no}</td><td class="nw">${date(o.created_at)}</td><td>${o.description || cap(o.plan_code)}<small>${o.billing_cycle || ''}${o.coupon_code ? ` · ${o.coupon_code}` : ''}${o.failure_reason ? ` · ${o.failure_reason}` : ''}</small></td>
        <td class="r mono">${inr(o.total, true)}<small>GST ${inr(o.gst_amount, true)}</small></td><td>${o.paid_with || '—'}</td><td class="mono">${o.invoice_no || '—'}</td>
        <td><select class="mini-sel" data-ost="${o.id}" style="height:30px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--bone);padding:0 8px">${st.map(s => html`<option value="${s}" ${s === o.status ? 'selected' : ''}>${cap(s)}</option>`)}</select></td>
        <td class="r"><button type="button" class="btn btn-sm btn-quiet" data-oedit="${o.id}" title="Edit order">${icon('edit')}</button></td></tr>`), 'No orders')}
    ${tblCard(html`<h2>Payment methods</h2><small>only brand, last 4 and expiry are stored</small>`, html`<button type="button" class="btn btn-sm" data-pmedit="">${icon('plus')}Add method</button>`, ['Method', 'Details', 'Bank', 'Added', 'State', ''],
      D.methods.map(m => html`<tr style="${m.status === 'removed' ? 'opacity:.5' : ''}"><td><b style="color:var(--bone)">${m.method_type === 'card' ? cap(m.card_brand) : m.method_type === 'upi' ? 'UPI Autopay' : 'Net banking'}</b>${m.is_default ? html` <span class="st-pill gold">Default</span>` : ''}</td>
        <td class="mono">${m.method_type === 'card' ? `•••• ${m.card_last4} · ${String(m.card_exp_month).padStart(2, '0')}/${m.card_exp_year}` : m.upi_vpa_masked || m.bank_name || '—'}</td>
        <td>${m.card_issuer_bank || m.bank_name || '—'}<small>${m.card_funding || ''}</small></td><td class="nw">${date(m.created_at)}</td>
        <td><span class="st-pill ${m.status === 'active' ? 'ok' : m.status === 'expired' ? 'warn' : 'mute'}">${m.status}</span></td>
        <td class="r nw">${m.status !== 'removed' && !m.is_default ? html`<button type="button" class="btn btn-sm" data-pm="${m.id}" data-w="default">Make default</button>` : ''} ${m.status !== 'removed' ? html`<button type="button" class="btn btn-sm btn-quiet" data-pm="${m.id}" data-w="remove">Remove</button>` : ''} <button type="button" class="btn btn-sm btn-quiet" data-pmedit="${m.id}" title="Edit">${icon('edit')}</button></td></tr>`), 'No saved methods')}`;
  },

  support() {
    return tblCard(html`<h2>Tickets</h2>`, '', ['Ticket', 'Subject', 'Category', 'Priority', 'Status', 'Updated'],
      D.tickets.map(t => html`<tr class="go" data-href="#/support/${t.id}" style="cursor:pointer"><td class="mono">${t.ticket_no}</td><td><b style="color:var(--bone)">${t.subject}</b><small>${t.messages} message${t.messages === 1 ? '' : 's'}</small></td><td>${t.category}</td><td>${cap(t.priority)}</td><td>${ticketPill(t.status)}</td><td class="nw">${ago(t.updated_at)}</td></tr>`), 'No tickets');
  },

  messages() {
    return tblCard(html`<h2>Messages sent to them</h2><small>push and in-app ones show in their bell until read</small>`, html`<button type="button" class="btn btn-sm btn-gold" data-a2="msg">${icon('send')}New message</button>`, ['When', 'Channel', 'Title', 'Read', ''],
      D.notes.map(n => html`<tr><td class="nw">${dtime(n.created_at)}</td><td><span class="st-pill ${n.channel === 'email' ? 'info' : n.channel === 'push' ? 'vio' : 'gold'}">${n.channel.replace('_', '-')}</span></td><td><b style="color:var(--bone)">${n.title}</b><small>${(n.body || '').slice(0, 140)}</small></td>
        <td>${n.is_read ? 'Read' : html`<span class="st-pill info">Unread</span>`}</td>
        <td class="r nw"><button type="button" class="btn btn-sm" data-nread="${n.id}" data-on="${n.is_read ? '' : '1'}">${n.is_read ? 'Mark unread' : 'Mark read'}</button> <button type="button" class="btn btn-sm btn-quiet" data-ndel="${n.id}" title="Delete">${icon('trash')}</button></td></tr>`), 'Nothing sent yet');
  },

  activity() { return html`<div class="card lit"><div class="card-h"><h2>Everything, newest first</h2></div><div class="feed">${D.feed.map(feed)}</div></div>`; },
};

const FEED_IC = { join: 'user', login: 'check', fail: 'alert', order: 'cash', ticket: 'help', admin: 'shield', audit: 'pulse' };
const feed = f => html`<div class="feed-i k-${f.kind}"><span class="feed-ic">${icon(FEED_IC[f.kind] || 'pulse')}</span><div class="feed-t"><b>${f.what}</b>${f.extra ? html`<small>${f.extra}</small>` : ''}</div><span class="feed-w" title="${new Date(f.at).toLocaleString('en-IN')}">${ago(f.at)}</span></div>`;

/* ── wiring per pane ─────────────────────────────────────────────── */
const formObj = form => { const o = Object.fromEntries(new FormData(form)); $$('input[type=checkbox]', form).forEach(c => { o[c.name] = c.checked; }); return o; };
const onSubmit = (p, sel, fn, msg) => $(sel, p)?.addEventListener('submit', async e => { e.preventDefault(); const b = $('button[type=submit]', e.target); try { await act(b, () => fn(formObj(e.target)), msg); reload(); } catch { /* toast shown */ } });

const WIRE = {
  overview(p) {
    barChart($('#u-days', p), { labels: D.days.map(d => d.day), height: 180, xfmt: (s, l) => (l ? new Date(s).toDateString() : dshort(s)), series: [{ name: 'Sign-ins', values: D.days.map(d => d.n), color: 'var(--c2)' }] });
    $('[data-go]', p)?.addEventListener('click', () => $(`#u-tabs [data-t="activity"]`).click());
  },
  profile(p) {
    onSubmit(p, '#f-user', f => api.do('updateUser', uid, { ...f, created_at: f.created_at ? new Date(f.created_at).toISOString() : null }), 'Account saved');
    onSubmit(p, '#f-prof', f => api.do('updateProfile', uid, f), 'Details saved');
    onSubmit(p, '#f-prefs', f => api.do('updatePrefs', uid, f), 'Switches saved');
  },
  plan(p) {
    onSubmit(p, '#f-sub', f => api.do('saveSubscription', uid, {
      ...f, current_period_start: f.current_period_start ? new Date(f.current_period_start).toISOString() : null,
      current_period_end: f.current_period_end ? new Date(f.current_period_end).toISOString() : null,
      trial_end: f.trial_end ? new Date(f.trial_end).toISOString() : null,
    }), 'Subscription saved');
    $$('[data-ext]', p).forEach(b => b.addEventListener('click', async () => {
      let n = b.dataset.ext;
      if (n === 'custom') {
        n = await modal({ title: 'Add or remove days', text: 'Positive adds access, negative takes it away. Counted from the later of now or the current end.',
          body: html`<div class="fld"><label>Days</label><input name="days" type="number" value="14" min="-3660" max="3660" required></div>`,
          actions: [{ label: 'Cancel', value: null, cls: 'btn-quiet' }, { label: 'Apply', submit: true, cls: 'btn-gold' }], submit: f => +f.days });
        if (!n) return;
      }
      act(b, () => api.do('extend', uid, +n), r => `Access now runs to ${date(r.current_period_end)}`).then(reload, () => {});
    }));
    $$('[data-q]', p).forEach(b => b.addEventListener('click', async () => {
      const w = b.dataset.q;
      if (['expire', 'remove', 'halt'].includes(w) && !await confirmBox(w === 'remove' ? 'Remove their plan?' : w === 'expire' ? 'End their access now?' : 'Halt the subscription?',
        w === 'remove' ? 'The subscription becomes history and they drop to the free terminal.' : 'They lose access to paid features on their next check.', { label: 'Yes, do it', danger: true })) return;
      act(b, () => (w === 'remove' ? api.do('removePlan', uid) : api.do('subQuick', uid, w)), 'Subscription updated').then(reload, () => {});
    }));
  },
  licence(p) {
    $$('[data-copy]', p).forEach(b => b.addEventListener('click', () => copy(b.dataset.copy, 'Licence key copied')));
    $$('[data-lic]', p).forEach(b => b.addEventListener('click', async () => {
      const w = b.dataset.lic;
      if (w === 'revoke' && !await confirmBox('Revoke this licence?', 'Their terminal stops accepting the key on its next check.', { label: 'Revoke', danger: true })) return;
      if (w === 'regenerate' && !await confirmBox('Issue a new key?', 'The old key stops working. They need the new one to activate the terminal again.', { label: 'New key' })) return;
      if (w === 'signout_all' && !await confirmBox('Sign out every terminal?', 'Each of their PCs must sign in again with the password. Their PC slots stay theirs.', { label: 'Sign out all', danger: true })) return;
      act(b, () => api.do('licence', uid, w), r => (r?.key ? `New key ${r.key}` : w === 'signout_all' ? `Signed out (${r?.tokens ?? 0} sign-ins ended)` : 'Licence updated')).then(reload, () => {});
    }));
    $$('[data-l]', p).forEach(i => i.addEventListener('change', () => act(null, () => api.do('licence', uid, i.dataset.l,
      i.dataset.l === 'broker_since' && i.value ? new Date(i.value).toISOString() : i.value), 'Licence updated').then(reload, () => {})));
    $$('[data-devedit]', p).forEach(b => b.addEventListener('click', async () => {
      const d = D.devices.find(x => String(x.id) === b.dataset.devedit);
      const r = await modal({ title: 'Edit PC', text: 'What they see under Licence & devices on their account page.',
        body: html`<div class="form-g"><div class="fld"><label>Name</label><input name="label" value="${d.label || ''}" required></div>
          <div class="fld"><label>OS</label><input name="os" value="${d.os || ''}"></div><div class="fld"><label>App version</label><input name="app_version" value="${d.app_version || ''}"></div></div>`,
        actions: [{ label: 'Cancel', value: null, cls: 'btn-quiet' }, { label: 'Save', submit: true, cls: 'btn-gold' }],
        submit: f => api.do('deviceEdit', d.id, f).then(() => true) });
      if (r) { toast('PC saved'); reload(); }
    }));
    $$('[data-dev]', p).forEach(b => b.addEventListener('click', async () => {
      const w = b.dataset.w;
      if (w === 'delete' && !await confirmBox('Delete this PC?', 'The record is removed; the PC can register again.', { label: 'Delete', danger: true })) return;
      let reason;
      if (w === 'block') {
        reason = await modal({ title: 'Block this PC?', danger: true,
          text: 'It is signed out now and can never use this account again, even with the right password. Unblock to undo.',
          body: html`<div class="form-g"><div class="fld wide"><label>Reason (only admins see it)</label><input name="reason" maxlength="200" placeholder="e.g. key shared with another person"></div></div>`,
          actions: [{ label: 'Cancel', value: null, cls: 'btn-quiet' }, { label: 'Block PC', submit: true, cls: 'btn-danger' }],
          submit: f => f.reason || '' });
        if (reason == null) return;
      }
      const msg = { revoke: 'PC signed out', restore: 'PC restored', block: 'PC blocked', unblock: 'PC unblocked', delete: 'PC deleted' }[w] || 'PC updated';
      act(b, () => api.do('device', b.dataset.dev, w, reason), msg).then(reload, () => {});
    }));
  },
  security(p) {
    const pwForm = $('#f-pw', p), pwIn = pwForm.password;
    const gen = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', r = crypto.getRandomValues(new Uint32Array(12));
      pwIn.value = 'EIMC-' + [...r].map(n => A[n % A.length]).join('').replace(/(.{4})(?=.)/g, '$1-'); pwIn.focus(); pwIn.select(); };
    $('[data-pw="gen"]', p).addEventListener('click', gen);
    $('[data-pw="copy"]', p).addEventListener('click', () => pwIn.value && copy(pwIn.value, 'Password copied'));
    pwForm.addEventListener('submit', async e => {
      e.preventDefault();
      const pw = pwIn.value, out = pwForm.signout.checked;
      if (pw.length < 8) return toast('Use at least 8 characters', true);
      try { await act($('[type=submit]', pwForm), () => api.do('setPassword', uid, pw, out), 'Password set'); copy(pw, 'Password set and copied: send it to them'); reload(); } catch { /* toast shown */ }
    });
    $('[data-sec="out"]', p).addEventListener('click', e => act(e.currentTarget, () => api.do('signOutEverywhere', uid), r => `Signed out of ${r.count} session${r.count === 1 ? '' : 's'}`).then(reload, () => {}));
    $('[data-sec="unlock"]', p).addEventListener('click', e => act(e.currentTarget, () => api.do('unlock', uid), 'Unlocked').then(reload, () => {}));
    $('[data-sec="2fa"]', p).addEventListener('click', e => act(e.currentTarget, () => api.do('setTwoFactor', uid, !D.security?.two_factor_enabled), '2-step sign-in updated').then(reload, () => {}));
    $$('[data-ses]', p).forEach(b => b.addEventListener('click', () => act(b, () => api.do('revokeSession', b.dataset.ses), 'Session revoked').then(reload, () => {})));
  },
  billing(p) {
    $$('[data-ost]', p).forEach(s => s.addEventListener('change', async () => {
      if (!await confirmBox(`Mark this order ${s.value}?`, 'The payment and invoice follow: refunded marks the invoice refunded, cancelled voids it.', { label: 'Change' })) { s.value = D.orders.find(o => String(o.id) === s.dataset.ost).status; return; }
      act(null, () => api.do('orderStatus', s.dataset.ost, s.value), 'Order updated').then(reload, () => {});
    }));
    $$('[data-pm]', p).forEach(b => b.addEventListener('click', () => act(b, () => api.do('paymentMethod', b.dataset.pm, b.dataset.w), 'Payment method updated').then(reload, () => {})));
    $$('[data-pmedit]', p).forEach(b => b.addEventListener('click', () => editMethod(D.methods.find(m => String(m.id) === b.dataset.pmedit))));
    $$('[data-oedit]', p).forEach(b => b.addEventListener('click', () => editOrder(D.orders.find(o => String(o.id) === b.dataset.oedit))));
    $('[data-order]', p)?.addEventListener('click', async () => {
      const r = await modal({ title: 'Manual order', wide: true, text: 'For an offline payment, a comp or a correction. A paid order gets a GST invoice and counts in revenue.',
        body: html`<div class="form-g">
          <div class="fld"><label>Description</label><input name="description" value="${D.sub ? `${D.sub.plan_name} — ${D.sub.billing_cycle}` : 'Manual order'}" required></div>
          <div class="fld"><label>Plan</label><select name="plan_code"><option value="">—</option>${D.plans.map(p2 => html`<option value="${p2.code}" ${p2.code === D.sub?.plan_code ? 'selected' : ''}>${p2.name}</option>`)}</select></div>
          <div class="fld"><label>Cycle</label><select name="billing_cycle"><option value="">—</option><option>monthly</option></select></div>
          <div class="fld"><label>Amount before GST (₹)</label><input name="amount" type="number" min="0" step="0.01" value="${D.sub?.price ?? 0}" required></div>
          <div class="fld"><label>Discount (₹)</label><input name="discount" type="number" min="0" step="0.01" value="0"></div>
          <div class="fld"><label>Coupon</label><input name="coupon_code"></div>
          <div class="fld"><label>Status</label><select name="status"><option value="paid">Paid</option><option value="created">Created (unpaid)</option><option value="failed">Failed</option></select></div></div>`,
        actions: [{ label: 'Cancel', value: null, cls: 'btn-quiet' }, { label: 'Create order', submit: true, cls: 'btn-gold' }],
        submit: f => api.do('createOrder', uid, f) });
      if (r) { toast(`Created ${r.order_no} · ${inr(r.total, true)}`); reload(); }
    });
  },
  support(p) { $$('tr[data-href]', p).forEach(tr => tr.addEventListener('click', () => CTX.nav(tr.dataset.href))); },
  messages(p) {
    $('[data-a2="msg"]', p)?.addEventListener('click', messageUser);
    $$('[data-nread]', p).forEach(b => b.addEventListener('click', () => act(b, () => api.do('noteRead', b.dataset.nread, !!b.dataset.on), 'Message updated').then(reload, () => {})));
    $$('[data-ndel]', p).forEach(b => b.addEventListener('click', async () => {
      if (!await confirmBox('Delete this message?', 'It disappears from their bell and account page.', { label: 'Delete', danger: true })) return;
      act(b, () => api.do('noteDelete', b.dataset.ndel), 'Message deleted').then(reload, () => {});
    }));
  },
};

/* ── shared dialogs ───────────────────────────────────────────────── */
async function editOrder(o) {
  if (!o) return;
  const r = await modal({ title: `Edit ${o.order_no}`, wide: true, text: 'Everything they see on Orders & invoices. GST and total are worked out from these; the payment and invoice follow.',
    body: html`<div class="form-g">
      <div class="fld wide"><label>Item / description</label><input name="description" value="${o.description || ''}" required></div>
      <div class="fld"><label>Date</label><input name="created_at" type="datetime-local" value="${isoLocal(o.created_at)}" required></div>
      <div class="fld"><label>Invoice number</label><input name="invoice_no" class="mono" value="${o.invoice_no || ''}" ${o.invoice_no ? '' : 'disabled placeholder="no invoice (unpaid)"'}></div>
      <div class="fld"><label>Amount before GST (₹)</label><input name="amount" type="number" min="0" step="0.01" value="${o.amount}" required></div>
      <div class="fld"><label>Discount (₹)</label><input name="discount" type="number" min="0" step="0.01" value="${o.discount || 0}"></div>
      <div class="fld"><label>GST rate (%)</label><input name="gst_rate" type="number" min="0" max="50" step="0.01" value="${o.gst_rate ?? 18}"></div>
      <div class="fld"><label>Coupon</label><input name="coupon_code" value="${o.coupon_code || ''}"></div></div>`,
    actions: [{ label: 'Cancel', value: null, cls: 'btn-quiet' }, { label: 'Save order', submit: true, cls: 'btn-gold' }],
    submit: f => api.do('orderEdit', o.id, { ...f, created_at: f.created_at ? new Date(f.created_at).toISOString() : null }) });
  if (r) { toast(`${r.order_no} saved · ${inr(r.total, true)}`); reload(); }
}

async function editMethod(m) {
  const x = m || { method_type: 'card', status: 'active' };
  const opt = (list, v) => list.map(o => html`<option value="${o}" ${o === v ? 'selected' : ''}>${cap(o)}</option>`);
  const r = await modal({ title: m ? 'Edit payment method' : 'Add payment method', wide: true,
    text: 'For records only: what their account page shows. Never enter a full card number or CVV.',
    body: html`<div class="form-g">
      <div class="fld"><label>Type</label><select name="method_type">${opt(['card', 'upi', 'netbanking'], x.method_type)}</select></div>
      <div class="fld"><label>State</label><select name="status">${opt(['active', 'expired', 'removed'], x.status)}</select></div>
      <div class="fld"><label>Card brand</label><select name="card_brand">${opt(['visa', 'mastercard', 'rupay', 'amex', 'diners'], x.card_brand)}</select></div>
      <div class="fld"><label>Last 4 digits</label><input name="card_last4" class="mono" maxlength="4" inputmode="numeric" value="${x.card_last4 || ''}"></div>
      <div class="fld"><label>Expiry month</label><input name="card_exp_month" type="number" min="1" max="12" value="${x.card_exp_month || ''}"></div>
      <div class="fld"><label>Expiry year</label><input name="card_exp_year" type="number" min="2000" max="2100" value="${x.card_exp_year || ''}"></div>
      <div class="fld"><label>Name on card</label><input name="card_holder_name" value="${x.card_holder_name || ''}"></div>
      <div class="fld"><label>Card type</label><select name="card_funding"><option value="">—</option>${opt(['credit', 'debit', 'prepaid'], x.card_funding)}</select></div>
      <div class="fld"><label>Bank</label><input name="card_issuer_bank" value="${x.card_issuer_bank || x.bank_name || ''}"></div>
      <div class="fld"><label>UPI ID (masked)</label><input name="upi_vpa_masked" value="${x.upi_vpa_masked || ''}" placeholder="ab****@okhdfc"></div></div>`,
    actions: [{ label: 'Cancel', value: null, cls: 'btn-quiet' }, { label: m ? 'Save' : 'Add method', submit: true, cls: 'btn-gold' }],
    submit: f => api.do('paymentMethodSave', uid, m ? m.id : null, { ...f, bank_name: f.card_issuer_bank }) });
  if (r) { toast(m ? 'Payment method saved' : 'Payment method added'); reload(); }
}

export async function messageUser() {
  const r = await modal({ title: `Message ${D.user.full_name}`, wide: true,
    text: html`Goes to ${D.user.email}. Use ${raw('<code class="src">{{first_name}}</code>')}, ${raw('<code class="src">{{plan}}</code>')}, ${raw('<code class="src">{{access_until}}</code>')} in the text.`,
    body: html`<div class="chn"><label><input type="checkbox" name="ch_email" checked>${icon('mail')}Email</label><label><input type="checkbox" name="ch_push" checked>${icon('bell')}Push</label><label><input type="checkbox" name="ch_in_app">${icon('chat')}In-app</label></div>
      <div class="form-g" style="grid-template-columns:1fr"><div class="fld"><label>Title / subject</label><input name="title" required maxlength="200" value="Hi {{first_name}}"></div>
      <div class="fld"><label>Message</label><textarea name="body" required rows="6"></textarea></div>
      <div class="fld"><label>Button (optional)</label><div style="display:grid;grid-template-columns:1fr 2fr;gap:10px"><input name="cta" placeholder="Open account"><input name="ctaUrl" placeholder="https://eimc.vercel.app/account.html"></div></div></div>`,
    actions: [{ label: 'Cancel', value: null, cls: 'btn-quiet' }, { label: 'Send now', submit: true, cls: 'btn-gold' }],
    submit: f => {
      const channels = ['email', 'push', 'in_app'].filter(c => f['ch_' + c]);
      return api.do('notify', { ids: [uid] }, { channels, title: f.title, body: f.body, cta: f.cta, ctaUrl: f.ctaUrl });
    } });
  if (r) { toast(sentMsg(r), r.emailFailed > 0); reload(); }
}
export const sentMsg = r => [r.email ? `${r.email} email${r.email > 1 ? 's' : ''} ${r.mode === 'outbox' ? 'saved to outbox (no mail provider set)' : 'sent'}` : '', r.push ? `${r.push} push` : '', r.in_app ? `${r.in_app} in-app` : '',
  r.emailFailed ? `${r.emailFailed} email failed: ${r.errors[0] || ''}` : ''].filter(Boolean).join(' · ');
