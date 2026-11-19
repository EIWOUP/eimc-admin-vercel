'use strict';
/* Plans & pricing: the plans table, its prices, devices and features. */
import { $$, api, html, put, icon, num, inr, cap, toast, fail, act, modal } from './core.js';

let D;
export async function render(root) {
  D = await api.get('plans');
  const has = (p, f) => D.links.some(l => l.plan_code === p && l.feature_code === f);
  put(root, html`
  <div class="ph"><div><h1>Plans <em>&amp; pricing</em></h1><p>${D.plans.length} plans · ${D.features.length} features</p></div>
    <div class="btns"><button type="button" class="btn btn-sm btn-gold" data-newplan>${icon('plus')}New plan</button></div></div>
  <div class="nt warn" style="margin-bottom:16px">${icon('info')}<span>Prices here are what the <b>account page, renewals and this admin</b> use. The public pricing page on eimc.vercel.app reads its own <b>js/pricing-data.js</b>, so change both when you change a price.</span></div>
  <div class="g g4">${D.plans.map(p => html`<form class="card lit" data-plan="${p.code}">
    <div class="card-h"><h2>${p.name}</h2><div class="r"><span class="st-pill ${p.is_sellable ? 'ok' : 'mute'}">${p.is_sellable ? 'On sale' : 'Hidden'}</span></div></div>
    <div class="kvs" style="grid-template-columns:repeat(3,1fr);margin-bottom:18px"><div><span>Plans</span><b>${num(p.subscribers)}</b></div><div><span>Access</span><b>${num(p.live)}</b></div><div><span>Revenue</span><b>${inr(p.revenue)}</b></div></div>
    <div class="form-g" style="grid-template-columns:1fr 1fr;gap:12px">
      <div class="fld"><label>Name</label><input name="name" value="${p.name}" required></div>
      <div class="fld"><label>Code</label><input value="${p.code}" readonly></div>
      <div class="fld"><label>₹ / month</label><input name="price_monthly" type="number" min="0" step="1" value="${p.price_monthly}"></div>
      <div class="fld"><label>₹ / year</label><input name="price_yearly" type="number" min="0" step="1" value="${p.price_yearly}"></div>
      <div class="fld"><label>PCs</label><input name="max_devices" type="number" min="1" max="50" value="${p.max_devices}"></div>
      <div class="fld"><label>Order</label><input name="sort_order" type="number" value="${p.sort_order}"></div>
      <div class="fld wide"><label>Description</label><input name="description" value="${p.description || ''}"></div>
    </div>
    <div class="form-f"><label class="chk"><input type="checkbox" name="is_sellable" ${p.is_sellable ? 'checked' : ''}><span></span>On sale</label><div class="btns"><button class="btn btn-sm btn-gold" type="submit">Save</button></div></div>
  </form>`)}</div>
  <div class="card flush lit mt20"><div class="card-h" style="padding:20px 22px 0"><h2>Feature matrix</h2><small>what each plan unlocks in the terminal</small></div>
    <div class="dt-w"><table class="tbl"><thead><tr><th>Feature</th>${D.plans.map(p => html`<th style="text-align:center">${p.name}</th>`)}</tr></thead><tbody>
    ${D.features.map(f => html`<tr><td><b style="color:var(--bone)">${f.name}</b><small class="mono">${f.code}</small></td>${D.plans.map(p => html`<td style="text-align:center"><label class="sw" style="display:inline-block;margin:0"><input type="checkbox" data-pf="${p.code}|${f.code}" ${has(p.code, f.code) ? 'checked' : ''}><i></i></label></td>`)}</tr>`)}
    </tbody></table></div></div>`);
}

export function mounted(view, ctx) {
  $$('form[data-plan]', view).forEach(f => f.addEventListener('submit', e => {
    e.preventDefault();
    const o = Object.fromEntries(new FormData(f)); o.is_sellable = f.is_sellable.checked;
    act(f.querySelector('[type=submit]'), () => api.do('planSave', f.dataset.plan, o), `${o.name} saved`).catch(() => {});
  }));
  $$('[data-pf]', view).forEach(c => c.addEventListener('change', async () => {
    const [p, ft] = c.dataset.pf.split('|');
    try { await api.do('planFeature', p, ft, c.checked); toast(`${cap(ft)} ${c.checked ? 'added to' : 'removed from'} ${cap(p)}`); } catch (e) { c.checked = !c.checked; fail(e); }
  }));
  view.querySelector('[data-newplan]').addEventListener('click', async () => {
    const r = await modal({ title: 'New plan', text: 'It starts hidden (not on sale). Turn it on once it is ready.',
      body: html`<div class="form-g"><div class="fld"><label>Code</label><input name="code" placeholder="e.g. pro_plus" required pattern="[a-z][a-z0-9_]+"></div><div class="fld"><label>Name</label><input name="name" required></div>
        <div class="fld"><label>₹ / month</label><input name="price_monthly" type="number" min="0" value="0"></div><div class="fld"><label>₹ / year</label><input name="price_yearly" type="number" min="0" value="0"></div>
        <div class="fld"><label>PCs</label><input name="max_devices" type="number" min="1" value="1"></div><div class="fld"><label>Description</label><input name="description"></div></div>`,
      actions: [{ label: 'Cancel', value: null, cls: 'btn-quiet' }, { label: 'Create plan', submit: true, cls: 'btn-gold' }],
      submit: f => api.do('planCreate', f) });
    if (r) { toast('Plan created'); ctx.nav('#/plans'); location.reload(); }
  });
}
