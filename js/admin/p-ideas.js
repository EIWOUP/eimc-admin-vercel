'use strict';
/* Ideas board: the feature requests customers vote on in their account. */
import { $, api, html, put, icon, num, date, cap, toast, fail, modal, confirmBox } from './core.js';
import { dataTable } from './table.js';

let ideas;
const ST = ['new', 'review', 'considering', 'planned', 'shipped'];
const TAGS = ['Charts', 'Order flow', 'Options', 'Setups', 'Trading', 'Terminal', 'Platform', 'Account'];
const pill = s => html`<span class="st-pill ${s === 'shipped' ? 'ok' : s === 'planned' ? 'gold' : s === 'review' ? 'info' : s === 'considering' ? 'vio' : 'mute'}">${s}</span>`;

export async function render(root) {
  ideas = await api.get('ideas');
  const votes = i => i.base_votes + i.real_votes;
  put(root, html`<div class="ph"><div><h1>Ideas <em>board</em></h1><p>${num(ideas.length)} ideas · ${num(ideas.reduce((a, i) => a + votes(i), 0))} votes · ${num(ideas.filter(i => i.status === 'shipped').length)} shipped</p></div>
    <div class="btns"><button type="button" class="btn btn-sm btn-gold" data-new>${icon('plus')}Add idea</button></div></div>
  <div class="g g4" style="margin-bottom:16px">${ST.slice(1).map(s => html`<div class="card kpi lit"><div class="kpi-l">${icon('bulb')}${cap(s)}</div><div class="kpi-v">${num(ideas.filter(i => i.status === s).length)}</div><div class="kpi-d"><span>${num(ideas.filter(i => i.status === s).reduce((a, i) => a + votes(i), 0))} votes</span></div></div>`)}</div>
  <div id="it"></div>`);
}

export function mounted(view) {
  const votes = i => i.base_votes + i.real_votes;
  const t = dataTable($('#it', view), {
    rows: ideas, placeholder: 'Search ideas…',
    search: i => [i.title, i.description, i.tag, i.full_name].join(' '),
    chips: [{ key: 'all', label: 'All' }, ...ST.map(s => ({ key: s, label: cap(s), test: i => i.status === s }))],
    sort: { col: 1, dir: 'desc' },
    columns: [
      { label: 'Idea', sort: i => i.title, render: i => html`<b style="color:var(--bone)">${i.title}</b><small>${(i.description || '').slice(0, 120)}</small>` },
      { label: 'Votes', r: true, cls: 'mono', sort: votes, render: i => html`<b style="color:var(--bone);font-size:15px">${num(votes(i))}</b><small>${i.real_votes} real · ${i.base_votes} carried</small>` },
      { label: 'Tag', sort: i => i.tag, render: i => i.tag },
      { label: 'Status', sort: i => ST.indexOf(i.status), render: i => html`${pill(i.status)}${i.shipped_version ? html`<small>${i.shipped_version}</small>` : ''}` },
      { label: 'From', render: i => (i.user_id ? html`<a href="#/users/${i.user_id}">${i.full_name}</a>` : html`<span class="muted">EIMC</span>`) },
      { label: 'Added', sort: i => +new Date(i.created_at), cls: 'nw', render: i => date(i.created_at) },
    ],
    onRow: i => edit(i),
  });
  const reload = async () => { try { ideas = await api.get('ideas'); t.update(ideas); } catch (e) { fail(e); } };
  async function edit(i = {}) {
    const r = await modal({ title: i.id ? 'Edit idea' : 'Add an idea', wide: true, text: 'Customers see this on the Feature requests page of their account.',
      body: html`<div class="form-g">
        <div class="fld wide" style="grid-column:1/-1"><label>Title</label><input name="title" value="${i.title || ''}" maxlength="90" required></div>
        <div class="fld wide" style="grid-column:1/-1"><label>Description</label><textarea name="description" rows="3">${i.description || ''}</textarea></div>
        <div class="fld"><label>Status</label><select name="status">${ST.map(s => html`<option ${s === (i.status || 'new') ? 'selected' : ''}>${s}</option>`)}</select></div>
        <div class="fld"><label>Tag</label><select name="tag">${TAGS.map(s => html`<option ${s === (i.tag || 'Terminal') ? 'selected' : ''}>${s}</option>`)}</select></div>
        <div class="fld"><label>Carried-over votes</label><input name="base_votes" type="number" min="0" value="${i.base_votes || 0}"></div>
        <div class="fld"><label>Shipped in version</label><input name="shipped_version" value="${i.shipped_version || ''}" placeholder="v1.25.218"></div></div>`,
      actions: [...(i.id ? [{ label: 'Delete', value: 'del', cls: 'btn-danger' }] : []), { label: 'Cancel', value: null, cls: 'btn-quiet' }, { label: 'Save', submit: true, cls: 'btn-gold' }],
      submit: f => api.do('ideaSave', i.id || null, f) });
    if (r === 'del') {
      if (!await confirmBox('Delete this idea?', 'Its votes go with it.', { label: 'Delete', danger: true })) return;
      try { await api.do('ideaDelete', i.id); toast('Idea deleted'); reload(); } catch (e) { fail(e); }
    } else if (r) { toast('Idea saved'); reload(); }
  }
  view.querySelector('[data-new]').addEventListener('click', () => edit());
}
