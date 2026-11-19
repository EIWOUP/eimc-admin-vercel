'use strict';
/* Support: the ticket inbox, and a thread view to answer as the EIMC team.
   Replies land in support_messages, which the customer's account page shows. */
import { $, $$, api, html, put, icon, num, ago, dtime, avatar, ticketPill, cap, toast, fail, act, confirmBox } from './core.js';
import { dataTable } from './table.js';

let list, T;
const ST = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'];
const PR = ['low', 'normal', 'high', 'urgent'];

export async function render(root, ctx) {
  const id = ctx.params[0];
  if (id) return thread(root, ctx, id);
  list = await api.get('tickets');
  const open = list.filter(t => !['resolved', 'closed'].includes(t.status));
  put(root, html`<div class="ph"><div><h1>Support <em>inbox</em></h1><p>${num(open.length)} open · ${num(list.filter(t => t.last_sender === 'customer' && !['resolved', 'closed'].includes(t.status)).length)} waiting on us · ${num(list.length)} all-time</p></div></div><div id="tt"></div>`);
}

export function mounted(view, ctx) {
  if (T) return wireThread(view, ctx);
  dataTable($('#tt', view), {
    rows: list, placeholder: 'Search ticket, subject, customer…',
    search: t => [t.ticket_no, t.subject, t.full_name, t.email, t.category, t.last_body].join(' '),
    chips: [{ key: 'open', label: 'Needs a reply', test: t => !['resolved', 'closed'].includes(t.status) && t.last_sender !== 'agent' },
      { key: 'active', label: 'Not resolved', test: t => !['resolved', 'closed'].includes(t.status) }, { key: 'all', label: 'All' },
      ...ST.map(s => ({ key: s, label: cap(s), test: t => t.status === s }))],
    sort: { col: 5, dir: 'desc' },
    columns: [
      { label: 'Ticket', cls: 'mono', sort: t => t.ticket_no, render: t => t.ticket_no },
      { label: 'Subject', render: t => html`<b style="color:var(--bone)">${t.subject}</b><small>${t.last_sender === 'agent' ? 'You: ' : ''}${t.last_body || ''}</small>` },
      { label: 'Customer', sort: t => t.full_name, render: t => html`<div class="who">${avatar(t.full_name, 'sm')}<div><b>${t.full_name}</b><small>${t.client_id}</small></div></div>` },
      { label: 'Topic', sort: t => t.category, render: t => t.category },
      { label: 'Priority', sort: t => PR.indexOf(t.priority), render: t => html`<span class="st-pill ${t.priority === 'urgent' ? 'bad' : t.priority === 'high' ? 'warn' : 'mute'}">${t.priority}</span>` },
      { label: 'Updated', sort: t => +new Date(t.updated_at), cls: 'nw', render: t => html`${ago(t.updated_at)}<small>${t.messages} msg</small>` },
      { label: 'Status', sort: t => ST.indexOf(t.status), render: t => ticketPill(t.status) },
    ],
    onRow: t => ctx.nav(`#/support/${t.id}`),
    empty: 'Inbox zero',
  });
}

async function thread(root, ctx, id) {
  T = await api.get('ticket', { id });
  ctx.crumb({ label: 'Support', href: '#/support' }, { label: `${T.ticket_no}` });
  put(root, html`
  <div class="ph"><div><div class="kicker plain"><a class="tlink sm" href="#/support" style="flex-direction:row-reverse">← Inbox</a></div>
    <h1>${T.subject}</h1><p>${T.ticket_no} · ${T.category} · opened ${dtime(T.created_at)} by <a class="gold" href="#/users/${T.user_id}">${T.full_name}</a> (${T.client_id})</p></div>
    <div class="btns">${ticketPill(T.status)}</div></div>
  <div class="g g31">
    <div class="card lit">
      <div class="thread">${T.messages.map((m, i) => html`<div class="msg ${m.sender}" style="animation-delay:${i * 60}ms"><small>${m.sender === 'agent' ? 'EIMC team' : T.full_name} · ${dtime(m.created_at)}</small>${m.body}</div>`)}</div>
      <form id="rep" class="mt20">
        <div class="fld"><label>Reply as the EIMC team</label><textarea name="body" rows="6" required placeholder="Hi ${T.full_name.split(' ')[0]}, …"></textarea></div>
        <div class="form-f"><div class="fld" style="flex-direction:row;align-items:center;gap:10px"><label style="white-space:nowrap">Then set status</label>
          <select name="status" style="min-height:38px">${ST.map(s => html`<option value="${s}" ${s === 'waiting_customer' ? 'selected' : ''}>${cap(s)}</option>`)}</select></div>
          <div class="btns"><button type="submit" class="btn btn-gold btn-sm">${icon('send')}Send reply</button></div></div>
      </form>
    </div>
    <div class="card lit"><div class="card-h"><h2>Ticket</h2></div>
      <form id="tset" class="form-g" style="grid-template-columns:1fr">
        <div class="fld"><label>Status</label><select name="status">${ST.map(s => html`<option value="${s}" ${s === T.status ? 'selected' : ''}>${cap(s)}</option>`)}</select></div>
        <div class="fld"><label>Priority</label><select name="priority">${PR.map(s => html`<option value="${s}" ${s === T.priority ? 'selected' : ''}>${cap(s)}</option>`)}</select></div>
        <button type="submit" class="btn btn-sm">Save</button>
      </form>
      <div class="kvs mt20" style="grid-template-columns:1fr 1fr"><div><span>Customer</span><b><a href="#/users/${T.user_id}">${T.full_name}</a></b></div><div><span>Email</span><b>${T.email}</b></div>
        <div><span>System info</span><b>${T.include_system ? 'Attached' : 'No'}</b></div><div><span>Resolved</span><b>${T.resolved_at ? dtime(T.resolved_at) : '—'}</b></div></div>
      <hr class="sep"><button type="button" class="btn btn-sm btn-danger" id="tdel">${icon('trash')}Delete ticket</button>
    </div>
  </div>`);
}

function wireThread(view, ctx) {
  const id = T.id;
  $('#rep', view).addEventListener('submit', async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { await act($('[type=submit]', e.target), () => api.do('ticketReply', id, f.body, f.status), 'Reply sent. They also get an in-app notification.'); T = null; ctx.nav(`#/support/${id}`); dispatchEvent(new HashChangeEvent('hashchange')); } catch { /* toast shown */ }
  });
  $('#tset', view).addEventListener('submit', async e => {
    e.preventDefault();
    try { await act($('[type=submit]', e.target), () => api.do('ticketSet', id, Object.fromEntries(new FormData(e.target))), 'Ticket updated'); T = null; dispatchEvent(new HashChangeEvent('hashchange')); } catch { /* toast shown */ }
  });
  $('#tdel', view).addEventListener('click', async () => {
    if (!await confirmBox('Delete this ticket?', 'The ticket and its messages are removed from the customer\'s account too.', { label: 'Delete', danger: true })) return;
    try { await api.do('ticketDelete', id); toast('Ticket deleted'); T = null; ctx.nav('#/support'); } catch (e) { fail(e); }
  });
  T = null;
}
