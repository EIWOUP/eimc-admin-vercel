'use strict';
/* Overview: the home page. Pure analysis of the live database. */
import { $, api, html, put, raw, icon, num, inr, inrShort, pct, dshort, ago, avatar, subPill, planPill, countUp, daysLeft, cap } from './core.js';
import { lineChart, barChart, donut, heatmap, barList, funnel, spark } from './charts.js';

const STATUS_C = { active: 'var(--teal)', trialing: 'var(--cyan)', past_due: 'var(--heat)', halted: 'var(--red)', cancelled: 'var(--ash)', expired: 'var(--dim)' };
const PLAN = { elite: ['Elite', 'var(--c4)'], pro: ['Pro', 'var(--c1)'], basic: ['Basic', 'var(--c2)'], free: ['Free', 'var(--ash)'], none: ['No plan', 'var(--dim)'] };
const FEED_IC = { join: 'user', login: 'check', fail: 'alert', order: 'cash', ticket: 'help', admin: 'shield', audit: 'pulse' };

const delta = (cur, prev) => {
  if (!prev && !cur) return html`<b class="flat">±0</b>`;
  if (!prev) return html`<b class="rise">new</b>`;
  const d = Math.round(((cur - prev) / prev) * 100);
  return html`<b class="${d > 0 ? 'rise' : d < 0 ? 'down' : 'flat'}">${d > 0 ? '↑' : d < 0 ? '↓' : '±'}${Math.abs(d)}%</b>`;
};
const kpi = ({ label, ic, value, fmt = '', sub, sp, color, href, tone }) => html`
  <a class="card kpi lit ${href ? 'go' : ''}" ${href ? raw(`href="${href}"`) : ''} style="${tone ? `--gold-hi:${tone}` : ''}">
    <div class="kpi-l">${icon(ic)}${label}</div>
    <div class="kpi-v"><span data-count="${value}" data-fmt="${fmt}">0</span></div>
    <div class="kpi-d">${sub || ''}</div>
    <div class="kpi-s">${sp ? spark(sp, color) : ''}</div>
  </a>`;

function feedItem(f, isNew) {
  return html`<div class="feed-i k-${f.kind} ${isNew ? 'new' : ''}">
    <span class="feed-ic">${icon(FEED_IC[f.kind] || 'pulse')}</span>
    <div class="feed-t">${f.user_id ? html`<a href="#/users/${f.user_id}"><b>${f.who || 'Someone'}</b></a>` : html`<b>${f.who || 'System'}</b>`} · ${f.what}${f.extra ? html`<small>${f.extra}</small>` : ''}</div>
    <span class="feed-w" title="${new Date(f.at).toLocaleString('en-IN')}">${ago(f.at)}</span></div>`;
}

export async function render(root, ctx) {
  const d = await api.get('overview');
  const k = d.k;
  const h = +new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false });
  const hello = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const loginsPerDay = d.logins.map(x => x.ok);
  const totals = d.signups.map(x => x.total);
  const fun = d.funnel;
  const conv = pct(fun.paid_ever, fun.registered);

  put(root, html`
  <div class="ph">
    <div>
      <div class="kicker"><b>Live</b>&nbsp;· read from the database ${ago(d.at)}</div>
      <h1>${hello}. <em>Here is EIMC right now.</em></h1>
      <p>${num(k.users)} customers · ${num(k.with_access)} with access today · ${num(k.online_now)} online · ${num(k.open_tickets)} open tickets</p>
    </div>
    <div class="btns">
      <a class="btn btn-sm" href="#/messages">${icon('send')}Message customers</a>
      <a class="btn btn-sm btn-gold" href="#/users" data-new>${icon('plus')}Add user</a>
    </div>
  </div>

  <div class="hx">
    <div class="card glow hx-main lit">
      <div class="hx-k">${icon('trend')} Monthly recurring revenue</div>
      <div class="hx-v"><b data-count="${k.mrr}" data-fmt="inr">₹0</b><span>ARR ${inrShort(k.mrr * 12)} · ${num(k.paying)} paying ${k.paying === 1 ? 'customer' : 'customers'}</span></div>
      <div class="hx-row">
        <div>Revenue, 30 days<b>${inr(k.revenue_30)} <span class="kpi-d" style="display:inline-flex;margin:0">${delta(k.revenue_30, k.revenue_prev30)}</span></b></div>
        <div>Lifetime revenue<b>${inr(k.revenue_all)}</b></div>
        <div>Leaving at period end<b style="color:var(--heat-t)">${inr(k.mrr_leaving)}/mo</b></div>
        <div>Refunded<b>${inr(k.refunded)}</b></div>
      </div>
      <div class="hx-ch" id="ch-rev"></div>
    </div>
    <div class="hx-side">
      ${kpi({ label: 'Customers', ic: 'users', value: k.users, sub: html`${delta(k.users_30, k.users_prev30)}<span>${num(k.users_30)} joined in 30 days</span>`, sp: totals.slice(-30), color: 'var(--c1)', href: '#/users' })}
      ${kpi({ label: 'With access', ic: 'zap', value: k.with_access, sub: html`<span>${pct(k.with_access, k.users)}% of customers</span>`, sp: null, href: '#/subs' })}
      ${kpi({ label: 'On trial', ic: 'clock', value: k.trialing, sub: html`<span>${conv}% have ever paid</span>`, href: '#/subs' })}
      ${kpi({ label: 'At risk', ic: 'alert', value: k.at_risk, tone: 'var(--red-t)', sub: html`<span>past due or halted · ${num(k.cancelling)} cancelling</span>`, href: '#/subs' })}
    </div>
  </div>

  <div class="g g4">
    ${kpi({ label: 'Sign-ins, 24 h', ic: 'check', value: k.logins_24h, sub: html`<span>${num(k.active_7d)} people active this week</span>`, sp: loginsPerDay, color: 'var(--c2)', href: '#/activity' })}
    ${kpi({ label: 'Failed sign-ins, 24 h', ic: 'shield', value: k.fails_24h, tone: k.fails_24h ? 'var(--red-t)' : '', sub: html`<span>${num(k.live_sessions)} live sessions</span>`, sp: d.logins.map(x => x.bad), color: 'var(--red)', href: '#/activity' })}
    ${kpi({ label: 'Terminals', ic: 'monitor', value: k.devices, sub: html`<span>on ${num(k.licences)} active licences</span>`, href: '#/db/devices' })}
    ${kpi({ label: 'Failed payments, 30 d', ic: 'card', value: k.failed_30, tone: k.failed_30 ? 'var(--heat-t)' : '', sub: html`<span>${num(k.paid_orders)} paid orders all-time</span>`, sp: d.revenue.map(x => x.failed), color: 'var(--heat)', href: '#/orders' })}
  </div>

  <div class="g g21">
    <div class="card lit"><div class="card-h"><h2>Customer growth</h2><small>total customers, last 90 days</small><div class="r"><span class="st-pill gold">+${num(d.signups.reduce((a, x) => a + x.n, 0))} in 90 d</span></div></div><div id="ch-grow"></div></div>
    <div class="card lit"><div class="card-h"><h2>Plan mix</h2><small>every customer's current plan</small></div><div id="ch-plan"></div></div>
  </div>

  <div class="g g2">
    <div class="card lit"><div class="card-h"><h2>Sign-ins per day</h2><small>last 30 days</small></div><div id="ch-log"></div>
      <div class="lgd"><span style="--c:var(--c2)"><i></i>Successful</span><span style="--c:var(--red)"><i></i>Failed</span></div></div>
    <div class="card lit"><div class="card-h"><h2>When customers use EIMC</h2><small>sign-ins, sessions and terminal pings</small></div><div id="ch-heat"></div></div>
  </div>

  <div class="g g3">
    <div class="card lit"><div class="card-h"><h2>Subscription status</h2></div><div id="ch-status"></div></div>
    <div class="card lit"><div class="card-h"><h2>Conversion funnel</h2><small>all-time</small></div><div id="ch-fun"></div></div>
    <div class="card lit"><div class="card-h"><h2>Where customers are</h2></div><div id="ch-geo"></div></div>
  </div>

  <div class="g g3">
    <div class="card lit"><div class="card-h"><h2>${icon('clock')} Access ending soon</h2><small>next 10 days</small></div>
      <div class="ls">${d.expiring.length ? d.expiring.map(x => html`<a class="ls-i" href="#/users/${x.id}">${avatar(x.full_name)}<span><b>${x.full_name}</b><small>${cap(x.plan_code)} · ${x.billing_cycle} · ${x.cancel_at_period_end ? 'will not renew' : x.auto_renew ? 'auto-renews' : 'manual renewal'}</small></span><span>${subPill(x.status)}<br><span class="mini">${dshort(x.access_until)} · ${daysLeft(x.access_until)}d</span></span></a>`) : html`<div class="empty-s">${icon('check')}Nobody's access ends in the next 10 days</div>`}</div></div>
    <div class="card lit"><div class="card-h"><h2>${icon('alert')} Payment trouble</h2><small>past due or halted</small></div>
      <div class="ls">${d.risk.length ? d.risk.map(x => html`<a class="ls-i" href="#/users/${x.id}">${avatar(x.full_name)}<span><b>${x.full_name}</b><small>${x.reason || 'Renewal not paid'}</small></span><span>${subPill(x.status)}<br><span class="mini">since ${dshort(x.current_period_end)}</span></span></a>`) : html`<div class="empty-s">${icon('check')}No payment trouble</div>`}</div></div>
    <div class="card lit"><div class="card-h"><h2>${icon('pulse')} Live activity</h2><div class="r"><span class="st-pill ok">Live</span></div></div>
      <div class="feed" id="feed" style="max-height:420px;overflow-y:auto">${d.feed.slice(0, 18).map(f => feedItem(f))}</div></div>
  </div>

  <div class="g g3">
    <div class="card lit"><div class="card-h"><h2>Terminals by OS</h2></div><div id="ch-os"></div><hr class="sep"><div class="card-h" style="margin-bottom:12px"><h2>App versions</h2></div><div id="ch-ver"></div></div>
    <div class="card lit"><div class="card-h"><h2>Saved payment methods</h2></div><div id="ch-pm"></div></div>
    <div class="card lit"><div class="card-h"><h2>${icon('bulb')} Most wanted ideas</h2><div class="r"><a class="tlink sm" href="#/ideas">All ideas</a></div></div>
      <div class="ls">${d.ideas.map(i => html`<a class="ls-i" href="#/ideas"><span class="feed-ic k-admin" style="width:34px;height:34px">${icon('bulb')}</span><span><b>${i.title}</b><small>${i.tag} · ${cap(i.status)}</small></span><span><b style="font-size:15px">${num(i.votes)}</b><span class="mini">votes</span></span></a>`)}</div></div>
  </div>`);

  // feed auto-refresh: new events slide in at the top
  let seen = new Set(d.feed.map(f => f.kind + f.at + f.what));
  const timer = setInterval(async () => {
    if (document.hidden || !ctx.isCurrent()) return;
    try {
      const n = await api.get('overview');
      const box = $('#feed', root.isConnected ? root : document); if (!box) return;
      put(box, html`${n.feed.slice(0, 18).map(f => feedItem(f, !seen.has(f.kind + f.at + f.what)))}`);
      seen = new Set(n.feed.map(f => f.kind + f.at + f.what));
    } catch { /* next tick will try again */ }
  }, 30000);
  ctx.onLeave(() => clearInterval(timer));
  D = d;
}
let D;

/* charts need the real box size, so they draw once the page is in place */
export function mounted(view, ctx) {
  const d = D, q = s => view.querySelector(s);
  countUp(view);
  q('[data-new]')?.addEventListener('click', () => setTimeout(() => document.dispatchEvent(new CustomEvent('admin:new-user')), 400));

  lineChart(q('#ch-rev'), { labels: d.revenue.map(x => x.day), height: 120, fmt: v => inr(v), yfmt: v => inrShort(v), ticks: 2,
    xfmt: (s, long) => (long ? `Week of ${dshort(s)}` : dshort(s)), series: [{ name: 'Paid', values: d.revenue.map(x => x.paid), color: 'var(--c1)' }] });

  lineChart(q('#ch-grow'), { labels: d.signups.map(x => x.day), height: 240, xfmt: (s, long) => (long ? new Date(s).toDateString() : dshort(s)),
    series: [{ name: 'Customers', values: d.signups.map(x => x.total), color: 'var(--c1)' }, { name: 'Joined that day', values: d.signups.map(x => x.n), color: 'var(--c2)', area: false, dash: true }] });

  const order = ['elite', 'pro', 'basic', 'free', 'none'];
  const plans = order.map(c => ({ code: c, ...(d.plans.find(p => p.k === c) || { n: 0 }) })).filter(p => p.n);
  donut(q('#ch-plan'), { parts: plans.map(p => ({ label: PLAN[p.code]?.[0] || cap(p.code), value: p.n, color: PLAN[p.code]?.[1] || 'var(--ash)' })), sub: 'customers',
    onClick: () => ctx.nav('#/users') });

  barChart(q('#ch-log'), { labels: d.logins.map(x => x.day), height: 220, xfmt: (s, long) => (long ? new Date(s).toDateString() : dshort(s)),
    series: [{ name: 'Successful', values: d.logins.map(x => x.ok), color: 'var(--c2)' }, { name: 'Failed', values: d.logins.map(x => x.bad), color: 'var(--red)' }],
    onClick: () => ctx.nav('#/activity') });

  heatmap(q('#ch-heat'), d.heat, { label: 'events' });

  barList(q('#ch-status'), d.statuses.map(s => ({ label: cap(s.k), value: s.n, color: STATUS_C[s.k] })), { onClick: () => ctx.nav('#/subs') });
  const f = d.funnel;
  funnel(q('#ch-fun'), [{ label: 'Registered', value: f.registered }, { label: 'Signed in at least once', value: f.logged_in }, { label: 'Started a trial', value: f.trialed },
    { label: 'Paid at least once', value: f.paid_ever }, { label: 'Paying now', value: f.paying_now }]);
  const states = {};
  d.geo.forEach(g => { states[g.state] = (states[g.state] || 0) + g.n; });
  barList(q('#ch-geo'), Object.entries(states).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([s, n]) => ({ label: s, value: n })), { color: 'var(--c1)' });
  barList(q('#ch-os'), d.os.map(o => ({ label: o.k, value: o.n })), { color: 'var(--c4)' });
  barList(q('#ch-ver'), d.versions.map(o => ({ label: o.k, value: o.n })), { color: 'var(--c2)' });
  const pmc = { visa: 'var(--c1)', mastercard: 'var(--c3)', rupay: 'var(--c2)', amex: 'var(--c4)', upi: 'var(--cyan)', netbanking: 'var(--ash)' };
  donut(q('#ch-pm'), { parts: d.methods.map(m => ({ label: m.k === 'upi' ? 'UPI' : cap(m.k), value: m.n, color: pmc[m.k] || 'var(--ash)' })), sub: 'saved' });
}
