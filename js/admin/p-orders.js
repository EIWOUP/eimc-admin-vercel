'use strict';
/* Orders & revenue: every order, payment and invoice, and the money over time. */
import { api, html, put, icon, num, inr, inrShort, date, avatar, orderPill, cap, countUp, toast, fail, confirmBox } from './core.js';
import { dataTable } from './table.js';
import { barChart, donut } from './charts.js';

let orders = [], table;

export async function render(root) {
  orders = await api.get('orders');
  const paid = orders.filter(o => o.status === 'paid');
  const total = paid.reduce((a, o) => a + o.total, 0);
  const gst = paid.reduce((a, o) => a + o.gst_amount, 0);
  const failRate = orders.length ? Math.round((orders.filter(o => o.status === 'failed').length / orders.length) * 100) : 0;
  put(root, html`
  <div class="ph"><div><h1>Orders <em>&amp; revenue</em></h1><p>${num(orders.length)} orders · ${inr(total)} collected incl. GST · ${inr(gst)} GST · ${failRate}% of payments failed</p></div></div>
  <div class="g g4">
    <div class="card kpi lit"><div class="kpi-l">${icon('cash')}Collected</div><div class="kpi-v"><span data-count="${total}" data-fmt="inr">0</span></div><div class="kpi-d"><span>${num(paid.length)} paid orders</span></div></div>
    <div class="card kpi lit"><div class="kpi-l">${icon('receipt')}Net of GST</div><div class="kpi-v"><span data-count="${total - gst}" data-fmt="inr">0</span></div><div class="kpi-d"><span>${inr(gst)} GST to file</span></div></div>
    <div class="card kpi lit"><div class="kpi-l">${icon('trend')}Average order</div><div class="kpi-v"><span data-count="${paid.length ? total / paid.length : 0}" data-fmt="inr">0</span></div><div class="kpi-d"><span>${num(paid.filter(o => o.discount > 0).length)} used a discount</span></div></div>
    <div class="card kpi lit" style="--gold-hi:var(--red-t)"><div class="kpi-l">${icon('alert')}Failed / refunded</div><div class="kpi-v"><span data-count="${orders.filter(o => o.status === 'failed').length}">0</span><small>/ ${orders.filter(o => o.status === 'refunded').length}</small></div><div class="kpi-d"><span>${inr(orders.filter(o => o.status === 'refunded').reduce((a, o) => a + o.total, 0))} refunded</span></div></div>
  </div>
  <div class="g g21">
    <div class="card lit"><div class="card-h"><h2>Revenue per month</h2><small>paid orders incl. GST, last 12 months</small></div><div id="o-mon"></div></div>
    <div class="card lit"><div class="card-h"><h2>Revenue by plan</h2></div><div id="o-plan"></div></div>
  </div>
  <div class="mt20" id="ot"></div>`);
}

export function mounted(view, ctx) {
  countUp(view);
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
  const by = (st) => months.map(m => orders.filter(o => o.status === st && new Date(o.created_at).toISOString().slice(0, 7) === m).reduce((a, o) => a + o.total, 0));
  const mlabel = (m, long) => new Date(m + '-01').toLocaleDateString('en-IN', { month: long ? 'long' : 'short', year: long ? 'numeric' : '2-digit' });
  barChart(view.querySelector('#o-mon'), { labels: months, height: 240, fmt: v => inr(v), yfmt: inrShort, xfmt: mlabel,
    series: [{ name: 'Paid', values: by('paid'), color: 'var(--c1)' }, { name: 'Refunded', values: by('refunded'), color: 'var(--c3)' }] });
  const plan = {};
  orders.filter(o => o.status === 'paid').forEach(o => { const k = o.plan_code || 'other'; plan[k] = (plan[k] || 0) + o.total; });
  const PC = { pro: 'var(--c1)', free: 'var(--c2)', other: 'var(--ash)' };
  donut(view.querySelector('#o-plan'), { parts: Object.entries(plan).map(([k, v]) => ({ label: cap(k), value: v, color: PC[k] || 'var(--c3)' })), fmt: inrShort, center: inrShort(Object.values(plan).reduce((a, b) => a + b, 0)), sub: 'all-time' });

  const STATUS = ['paid', 'failed', 'refunded', 'cancelled', 'created'];
  table = dataTable(view.querySelector('#ot'), {
    rows: orders,
    placeholder: 'Search order, invoice, customer, coupon…',
    search: o => [o.order_no, o.invoice_no, o.full_name, o.client_id, o.coupon_code, o.description].join(' '),
    chips: [{ key: 'all', label: 'All' }, ...STATUS.map(s => ({ key: s, label: cap(s), test: o => o.status === s }))],
    sort: { col: 1, dir: 'desc' },
    columns: [
      { label: 'Order', sort: o => o.order_no, cls: 'mono', render: o => html`${o.order_no}<small>${o.invoice_no || 'no invoice'}</small>` },
      { label: 'Date', sort: o => +new Date(o.created_at), cls: 'nw', render: o => date(o.created_at) },
      { label: 'Customer', sort: o => o.full_name, render: o => html`<div class="who">${avatar(o.full_name, 'sm')}<div><b>${o.full_name}</b><small>${o.client_id}</small></div></div>` },
      { label: 'Item', render: o => html`${o.description || cap(o.plan_code)}<small>${[o.billing_cycle, o.coupon_code, o.failure_reason].filter(Boolean).join(' · ')}</small>` },
      { label: 'Total', r: true, cls: 'mono', sort: o => o.total, render: o => html`${inr(o.total, true)}<small>${o.discount ? `−${inr(o.discount)} · ` : ''}GST ${inr(o.gst_amount, true)}</small>` },
      { label: 'Paid with', render: o => o.paid_with || '—' },
      { label: 'Status', sort: o => o.status, render: o => orderPill(o.status) },
      { label: '', render: o => (o.status === 'paid' ? html`<button type="button" class="btn btn-sm btn-quiet" data-refund="${o.id}">Refund</button>` : o.status === 'failed' || o.status === 'created' ? html`<button type="button" class="btn btn-sm btn-quiet" data-markpaid="${o.id}">Mark paid</button>` : '') },
    ],
    onRow: o => ctx.nav(`#/users/${o.user_id}?tab=billing`),
    csv: 'eimc-orders',
    csvCols: ['order_no', 'invoice_no', 'created_at', 'client_id', 'full_name', 'plan_code', 'billing_cycle', 'description', 'amount', 'discount', 'gst_amount', 'total', 'coupon_code', 'status', 'paid_with'],
    afterRender(tb) {
      const go = async (b, id, st, msg) => {
        if (!await confirmBox(st === 'refunded' ? 'Mark this order refunded?' : 'Mark this order paid?', st === 'refunded' ? 'This records the refund here and marks the invoice refunded. Send the money back in Razorpay yourself.' : 'The payment is marked captured and the invoice paid.', { label: msg })) return;
        b.classList.add('busy');
        try { await api.do('orderStatus', id, st); toast('Order updated'); orders = await api.get('orders'); table.update(orders); } catch (e) { fail(e); }
        b.classList.remove('busy');
      };
      tb.querySelectorAll('[data-refund]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); go(b, b.dataset.refund, 'refunded', 'Mark refunded'); }));
      tb.querySelectorAll('[data-markpaid]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); go(b, b.dataset.markpaid, 'paid', 'Mark paid'); }));
    },
  });
}
