'use strict';
/* Subscriptions: every current plan, who is renewing, who is slipping. */
import { api, html, put, icon, num, inr, date, ago, avatar, subPill, planPill, daysLeft, toast, fail, confirmBox, countUp } from './core.js';
import { dataTable } from './table.js';
import { donut, barList } from './charts.js';

let subs = [], table;
const mrrOf = s => (['active', 'past_due'].includes(s.status) && s.billing_cycle !== 'trial' ? s.price : 0);

export async function render(root) {
  subs = await api.get('subs');
  const live = subs.filter(s => s.access_until);
  const mrr = subs.reduce((a, s) => a + mrrOf(s), 0);
  const soon = subs.filter(s => s.access_until && daysLeft(s.access_until) <= 7);
  put(root, html`
  <div class="ph"><div><h1>Subscriptions <em>&amp; renewals</em></h1><p>${num(subs.length)} current plans · ${num(live.length)} with access · ${inr(mrr)} MRR · ${num(soon.length)} ending within 7 days</p></div></div>
  <div class="g g4">
    <div class="card kpi lit"><div class="kpi-l">${icon('trend')}MRR</div><div class="kpi-v"><span data-count="${mrr}" data-fmt="inr">0</span></div><div class="kpi-d"><span>monthly plans, paying now</span></div></div>
    <div class="card kpi lit"><div class="kpi-l">${icon('zap')}Auto-renewing</div><div class="kpi-v"><span data-count="${subs.filter(s => s.auto_renew && !s.cancel_at_period_end && s.access_until).length}">0</span></div><div class="kpi-d"><span>of ${num(live.length)} with access</span></div></div>
    <div class="card kpi lit" style="--gold-hi:var(--heat-t)"><div class="kpi-l">${icon('clock')}Ending in 7 days</div><div class="kpi-v"><span data-count="${soon.length}">0</span></div><div class="kpi-d"><span>${num(subs.filter(s => s.cancel_at_period_end).length)} set to cancel</span></div></div>
    <div class="card kpi lit" style="--gold-hi:var(--red-t)"><div class="kpi-l">${icon('alert')}Past due / halted</div><div class="kpi-v"><span data-count="${subs.filter(s => ['past_due', 'halted'].includes(s.status)).length}">0</span></div><div class="kpi-d"><span>${inr(subs.filter(s => s.status === 'past_due').reduce((a, s) => a + mrrOf(s), 0))} MRR at stake</span></div></div>
  </div>
  <div class="g g2">
    <div class="card lit"><div class="card-h"><h2>Billing cycle</h2></div><div id="s-cyc"></div></div>
    <div class="card lit"><div class="card-h"><h2>MRR by plan</h2></div><div id="s-mrr"></div></div>
  </div>
  <div class="mt20" id="st"></div>`);
}

export function mounted(view, ctx) {
  countUp(view);
  const cyc = ['monthly', 'trial'].map((c, i) => ({ label: c[0].toUpperCase() + c.slice(1), value: subs.filter(s => s.billing_cycle === c).length, color: ['var(--c1)', 'var(--c2)', 'var(--c3)'][i] }));
  donut(view.querySelector('#s-cyc'), { parts: cyc, sub: 'plans' });
  const byPlan = {};
  subs.forEach(s => { byPlan[s.plan_code] = (byPlan[s.plan_code] || 0) + mrrOf(s); });
  barList(view.querySelector('#s-mrr'), Object.entries(byPlan).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k[0].toUpperCase() + k.slice(1), value: v, color: k === 'pro' ? 'var(--c1)' : 'var(--c2)' })), { fmt: v => inr(v) });

  table = dataTable(view.querySelector('#st'), {
    rows: subs, key: 'id',
    placeholder: 'Search name, email, client ID…',
    search: s => [s.full_name, s.email, s.client_id, s.plan_code].join(' '),
    chips: [{ key: 'all', label: 'All' }, ...['active', 'trialing', 'past_due', 'halted', 'cancelled', 'expired'].map(k => ({ key: k, label: k.replace('_', ' ').replace(/^./, c => c.toUpperCase()), test: s => s.status === k })),
      { key: 'soon', label: 'Ending ≤ 7 d', test: s => s.access_until && daysLeft(s.access_until) <= 7 }],
    sort: { col: 3, dir: 'asc' },
    columns: [
      { label: 'Customer', sort: s => s.full_name, render: s => html`<div class="who">${avatar(s.full_name)}<div><b>${s.full_name}</b><small>${s.client_id}</small></div></div>` },
      { label: 'Plan', sort: s => s.plan_code, render: s => html`${planPill(s.plan_code)} <span class="mini">${s.billing_cycle}</span>` },
      { label: 'Status', sort: s => s.status, render: s => html`${subPill(s.status)}${s.cancel_at_period_end ? html` <span class="st-pill warn">Ends</span>` : ''}` },
      { label: 'Access until', sort: s => (s.access_until ? +new Date(s.access_until) : Infinity), dir: 'asc', cls: 'nw', render: s => (s.access_until ? html`${date(s.access_until)}<small style="color:${daysLeft(s.access_until) <= 3 ? 'var(--red-t)' : ''}">${daysLeft(s.access_until)} days</small>` : html`<span class="muted">None</span><small>ended ${date(s.current_period_end)}</small>`) },
      { label: 'Price', r: true, cls: 'mono', sort: s => +s.price, render: s => inr(s.price) },
      { label: 'Renewal', render: s => (s.cancel_at_period_end ? html`<span class="muted">Cancelling</span><small>${s.cancel_reason || ''}</small>` : s.auto_renew ? 'Auto' : 'Manual') },
      { label: 'Since', sort: s => +new Date(s.started_at), cls: 'nw', render: s => date(s.started_at) },
      { label: '', render: s => html`<button type="button" class="btn btn-sm" data-ext="${s.user_id}">+30 d</button>` },
    ],
    onRow: s => ctx.nav(`#/users/${s.user_id}?tab=plan`),
    csv: 'eimc-subscriptions',
    csvCols: ['client_id', 'full_name', 'email', 'plan_code', 'billing_cycle', 'status', 'price', 'access_until', 'current_period_end', 'auto_renew', 'cancel_at_period_end', 'started_at'],
    afterRender(tb) {
      tb.querySelectorAll('[data-ext]').forEach(b => b.addEventListener('click', async e => {
        e.stopPropagation();
        b.classList.add('busy');
        try { const r = await api.do('extend', b.dataset.ext, 30); toast(`Extended to ${date(r.current_period_end)}`); subs = await api.get('subs'); table.update(subs); } catch (er) { fail(er); }
        b.classList.remove('busy');
      }));
    },
  });
}
