'use strict';
/* Users: every account, searchable, with health, plan, value and use. */
import { $, api, html, put, icon, num, inr, ago, date, avatar, subPill, planPill, userPill, health, healthBar, modal, toast, fail, act, confirmBox, daysLeft } from './core.js';
import { dataTable } from './table.js';

let users = [], table;

export async function render(root, ctx) {
  users = await api.get('users');
  const k = {
    total: users.filter(u => u.role === 'customer').length,
    access: users.filter(u => u.access_until).length,
    ltv: users.reduce((a, u) => a + (u.ltv || 0), 0),
    avgHealth: Math.round(users.filter(u => u.role === 'customer').reduce((a, u) => a + health(u), 0) / Math.max(1, users.filter(u => u.role === 'customer').length)),
  };
  put(root, html`
  <div class="ph">
    <div><h1>Users <em>&amp; their accounts</em></h1>
      <p>${num(k.total)} customers · ${num(k.access)} with access · ${inr(k.ltv)} paid in total · average health ${k.avgHealth}/100</p></div>
    <div class="btns">
      <a class="btn btn-sm" href="#/messages">${icon('send')}Message a segment</a>
      <button type="button" class="btn btn-sm btn-gold" data-new>${icon('plus')}Add user</button>
    </div>
  </div>
  <div id="ut"></div>`);
}

export function mounted(view, ctx) {
  table = dataTable(view.querySelector('#ut'), {
    rows: users,
    placeholder: 'Search name, email, phone, client ID, city…',
    search: u => [u.full_name, u.email, u.phone, u.client_id, u.city, u.state, u.plan_code].join(' '),
    chips: [
      { key: 'all', label: 'Everyone' },
      { key: 'access', label: 'With access', test: u => !!u.access_until },
      { key: 'paying', label: 'Paying', test: u => ['active', 'past_due'].includes(u.sub_status) && u.billing_cycle !== 'trial' },
      { key: 'trial', label: 'Trial', test: u => u.sub_status === 'trialing' },
      { key: 'risk', label: 'At risk', test: u => ['past_due', 'halted'].includes(u.sub_status) || health(u) < 45 },
      { key: 'churn', label: 'Churned', test: u => ['cancelled', 'expired'].includes(u.sub_status) },
      { key: 'free', label: 'No plan', test: u => !u.sub_status },
      { key: 'idle', label: 'Idle 14 d+', test: u => !u.last_login_at || Date.now() - new Date(u.last_login_at) > 14 * 864e5 },
      { key: 'blocked', label: 'Suspended', test: u => u.status !== 'active' },
      { key: 'staff', label: 'Staff', test: u => u.role !== 'customer' },
    ],
    sort: { col: 0, dir: 'desc' },
    columns: [
      { label: 'Customer', sort: u => u.client_id, render: u => html`<div class="who">${avatar(u.full_name)}<div><b>${u.full_name}</b><small>${u.client_id} · ${u.email}</small></div></div>` },
      { label: 'Plan', sort: u => u.plan_code || '', render: u => html`${planPill(u.plan_code)} <span class="mini">${u.billing_cycle || ''}</span>` },
      { label: 'Status', sort: u => u.sub_status || '', render: u => html`${subPill(u.sub_status)}${u.status !== 'active' ? html` ${userPill(u.status)}` : ''}${u.cancel_at_period_end ? html` <span class="st-pill warn">Ends</span>` : ''}` },
      { label: 'Access until', sort: u => (u.access_until ? +new Date(u.access_until) : 0), cls: 'nw', render: u => u.access_until ? html`${date(u.access_until)}<small>${daysLeft(u.access_until)} days left</small>` : html`<span class="muted">No access</span>` },
      { label: 'Health', sort: u => health(u), render: u => healthBar(health(u)) },
      { label: 'Paid', r: true, sort: u => u.ltv, cls: 'mono', render: u => inr(u.ltv) },
      { label: 'Sign-ins 30 d', r: true, sort: u => u.logins_30, cls: 'mono', render: u => html`${num(u.logins_30)}${u.fails_30 ? html`<small style="color:var(--red-t)">${u.fails_30} failed</small>` : ''}` },
      { label: 'Last seen', sort: u => +new Date(u.last_login_at || 0), cls: 'nw', render: u => html`${ago(u.last_login_at)}<small>${u.devices} PC${u.devices === 1 ? '' : 's'}${u.open_tickets ? ` · ${u.open_tickets} ticket${u.open_tickets > 1 ? 's' : ''}` : ''}</small>` },
      { label: 'Location', sort: u => u.city || '', render: u => html`${u.city || '—'}<small>${u.state || ''}</small>` },
    ],
    onRow: u => ctx.nav(`#/users/${u.id}`),
    csv: 'eimc-users',
    csvCols: ['client_id', 'full_name', 'email', 'phone', 'status', 'role', 'plan_code', 'billing_cycle', 'sub_status', 'access_until', 'ltv', 'logins_30', 'last_login_at', 'city', 'state', 'created_at'],
    bulk: [
      { label: 'Email / push', icon: 'send', cls: 'btn-gold', run: rows => { sessionStorage.setItem('admin.msg.ids', JSON.stringify(rows.map(r => r.id))); ctx.nav('#/messages'); } },
      { label: 'Extend +30 d', icon: 'calendar', run: async (rows, b, clear) => {
        if (!await confirmBox(`Give ${rows.length} people 30 more days?`, 'Each person with a subscription gets 30 days added to the later of today or their current end date. Expired and halted plans become active.', { label: 'Extend' })) return;
        await bulk(rows, r => api.do('extend', r.id, 30), b, 'extended'); clear(); reload(ctx);
      } },
      { label: 'Suspend', icon: 'ban', run: async (rows, b, clear) => {
        if (!await confirmBox(`Suspend ${rows.length} account${rows.length > 1 ? 's' : ''}?`, 'They are signed out everywhere at once and cannot sign in to eimc.vercel.app until you reactivate them.', { label: 'Suspend', danger: true })) return;
        await bulk(rows, r => setStatus(r, 'suspended'), b, 'suspended'); clear(); reload(ctx);
      } },
      { label: 'Reactivate', icon: 'check', run: async (rows, b, clear) => { await bulk(rows, r => setStatus(r, 'active'), b, 'reactivated'); clear(); reload(ctx); } },
    ],
  });
  view.querySelector('[data-new]').addEventListener('click', () => newUser(ctx));
  const onNew = () => newUser(ctx);
  document.addEventListener('admin:new-user', onNew);
  ctx.onLeave(() => document.removeEventListener('admin:new-user', onNew));
}

const setStatus = (u, status) => api.do('updateUser', u.id, { first_name: u.first_name, last_name: u.last_name, email: u.email, phone: u.phone, role: u.role, status, blocked_reason: status === 'active' ? null : u.blocked_reason || 'Suspended by admin', email_verified: u.email_verified, phone_verified: u.phone_verified });

async function bulk(rows, fn, btn, verb) {
  btn.classList.add('busy');
  let ok = 0; const errs = [];
  for (const r of rows) { try { await fn(r); ok++; } catch (e) { errs.push(`${r.full_name}: ${e.message}`); } }
  btn.classList.remove('busy');
  toast(`${ok} ${verb}${errs.length ? ` · ${errs.length} failed: ${errs[0]}` : ''}`, !!errs.length);
}
async function reload(ctx) { try { users = await api.get('users'); table.update(users); ctx.refreshPulse(); } catch (e) { fail(e); } }

export async function newUser(ctx) {
  const plans = await api.get('plans').then(p => p.plans).catch(() => []);
  const id = await modal({
    title: 'Add a user', wide: true,
    text: 'Creates the account, profile, security and notification rows the live site expects. With a plan, a licence key is issued too. They sign in at eimc.vercel.app with their client ID or email.',
    body: html`<div class="form-g">
      <div class="fld"><label>First name</label><input name="first_name" required maxlength="60"></div>
      <div class="fld"><label>Last name</label><input name="last_name" maxlength="60"></div>
      <div class="fld"><label>Email</label><input name="email" type="email" required></div>
      <div class="fld"><label>Mobile</label><input name="phone" inputmode="tel" placeholder="+91…"></div>
      <div class="fld"><label>Password</label><input name="password" type="text" minlength="8" required value="${'EIMC@' + Math.random().toString(36).slice(2, 8)}"></div>
      <div class="fld"><label>City</label><input name="city"></div>
      <div class="fld"><label>State</label><input name="state" value="Gujarat"></div>
      <div class="fld"><label>Plan</label><select name="plan"><option value="none">No plan (free)</option>${plans.map(p => html`<option value="${p.code}">${p.name}</option>`)}</select></div>
      <div class="fld"><label>Cycle</label><select name="cycle"><option value="trial">Trial</option><option value="monthly" selected>Monthly</option></select></div>
      <div class="fld"><label>Days of access</label><input name="days" type="number" min="1" max="3660" placeholder="30 / 365 / 1"></div>
      <label class="chk" style="align-self:end;padding-bottom:12px"><input type="checkbox" name="email_verified" value="true" checked><span></span>Email verified</label>
    </div>`,
    actions: [{ label: 'Cancel', value: null, cls: 'btn-quiet' }, { label: 'Create user', submit: true, cls: 'btn-gold' }],
    submit: f => api.do('createUser', { ...f, email_verified: f.email_verified === 'true' }),
  });
  if (id?.id) { toast(`Created client ${id.client_id}`); ctx.nav(`#/users/${id.id}`); }
}
