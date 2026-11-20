'use strict';
/* Email & push: write once, send to one person, a selection or a segment.
   People can be picked here by client ID, name, email or phone, or come
   pre-selected from the Users page. */
import { $, $$, api, html, put, raw, icon, num, dtime, ago, avatar, toast, fail, confirmBox, debounce, esc } from './core.js';
import { dataTable } from './table.js';
import { sentMsg } from './p-user.js';

const SEGMENTS = [
  ['all', 'Everyone', 'All active customers'], ['paying', 'Paying', 'Active or past-due paid plans'], ['trialing', 'On trial', 'Trial running now'],
  ['expiring', 'Ending ≤ 7 days', 'Access ends this week'], ['at_risk', 'Payment trouble', 'Past due or halted'], ['churned', 'Churned', 'Cancelled or expired'],
  ['no_plan', 'No plan', 'Free terminal only'], ['inactive', 'Idle 14 days', 'Have not signed in lately'], ['plan_pro', 'Pro plan', ''],
  ['offers_opt_in', 'Opted into offers', 'OK with marketing'],
];
const TEMPLATES = [
  { k: 'Renewal reminder', t: 'Your EIMC {{plan}} plan renews soon', b: 'Hi {{first_name}},\n\nYour **{{plan}}** plan is active until **{{access_until}}**. Renewal is automatic, so there is nothing for you to do.\n\nIf you want to change your plan or card, open your account.\n\nThe EIMC team' },
  { k: 'Payment failed', t: 'Action needed: your EIMC payment did not go through', b: 'Hi {{first_name}},\n\nWe could not charge your card for your **{{plan}}** renewal. Your access continues for a short grace period.\n\nPlease update your payment method in your account to keep the terminal running without interruption.\n\nThe EIMC team' },
  { k: 'New version', t: 'EIMC Terminal has a new version', b: 'Hi {{first_name}},\n\nA new version of the EIMC Terminal is out with faster charts and fixes. It installs itself the next time you open the terminal.\n\nHappy trading,\nThe EIMC team' },
  { k: 'Win back', t: '{{first_name}}, come back to EIMC', b: 'Hi {{first_name}},\n\nIt has been a while. Since you left we shipped a lot: a TradingView-exact volume profile, option flow scoring and live order-book density on NIFTY.\n\nYour account (client {{client_id}}) is still here whenever you want it.\n\nThe EIMC team' },
];

let target = 'all', picked = null, history;

export async function render(root) {
  const ids = JSON.parse(sessionStorage.getItem('admin.msg.ids') || 'null');
  sessionStorage.removeItem('admin.msg.ids');
  picked = Array.isArray(ids) && ids.length ? ids : null;
  if (picked) target = { ids: picked };
  else if (typeof target !== 'string') target = 'all';
  history = await api.get('messages');
  const mode = history.mail;
  put(root, html`
  <div class="ph"><div><h1>Email <em>&amp; push</em></h1><p>Reach one person, your selection, or a whole segment. Every message is saved to their notifications.</p></div></div>
  ${mode === 'outbox' ? html`<div class="nt warn" style="margin-bottom:16px">${icon('alert')}<span><b>No email provider is set up yet</b>, so emails are saved to each person's notifications but not delivered. Add <code class="src">RESEND_API_KEY</code> (or <code class="src">SMTP_HOST</code>, <code class="src">SMTP_USER</code>, <code class="src">SMTP_PASS</code>) and <code class="src">MAIL_FROM</code> to the environment to send real email.</span></div>`
    : html`<div class="nt" style="margin-bottom:16px">${icon('check')}<span>Email is sent through <b>${mode === 'resend' ? 'Resend' : 'SMTP'}</b>.</span></div>`}
  <div class="compose">
    <form class="card glow lit" id="cmp">
      <div class="card-h"><h2>${icon('users')} Who</h2><div class="r"><span class="st-pill gold" id="aud-n">…</span></div></div>
      <div class="ppl" id="ppl">
        <label class="ppl-l" for="ppl-q">Specific people</label>
        <div class="ppl-in">${icon('search')}<input id="ppl-q" type="search" autocomplete="off" spellcheck="false" placeholder="Search by client ID, name, email or phone" aria-controls="ppl-res" aria-autocomplete="list"></div>
        <div class="ppl-res" id="ppl-res" role="listbox" hidden></div>
        <div class="ppl-chips" id="ppl-chips"></div>
      </div>
      <div class="ppl-or"><span>or a whole group</span></div>
      <div class="aud" id="aud">${SEGMENTS.map(([k, l, s]) => html`<button type="button" data-seg="${k}" class="${target === k ? 'on' : ''}"><b>${l}</b>${s ? html`<span>${s}</span>` : ''}</button>`)}</div>
      <div class="mini mt12" id="aud-s"></div>
      <hr class="sep">
      <div class="card-h"><h2>${icon('send')} How</h2></div>
      <div class="chn"><label><input type="checkbox" name="ch" value="email" checked>${icon('mail')}Email</label><label><input type="checkbox" name="ch" value="push" checked>${icon('bell')}Push</label><label><input type="checkbox" name="ch" value="in_app">${icon('chat')}In-app</label></div>
      <hr class="sep">
      <div class="card-h"><h2>${icon('edit')} What</h2><div class="r"><select id="tpl" style="height:32px;border-radius:9px;border:1px solid var(--line);background:transparent;color:var(--bone);padding:0 10px;font-size:12.5px"><option value="">Start from a template…</option>${TEMPLATES.map((t, i) => html`<option value="${i}">${t.k}</option>`)}</select></div></div>
      <div class="form-g" style="grid-template-columns:1fr">
        <div class="fld"><label>Title / subject</label><input name="title" required maxlength="200" placeholder="e.g. Your EIMC plan renews soon"></div>
        <div class="fld"><label>Message <span class="mini" style="font-weight:400">blank line = new paragraph · **bold**</span></label><textarea name="body" rows="9" required placeholder="Hi {{first_name}}, …"></textarea></div>
        <div class="vars">${['first_name', 'name', 'client_id', 'plan', 'status', 'access_until', 'email'].map(v => html`<button type="button" data-var="${v}">{{${v}}}</button>`)}</div>
        <div class="fld"><label>Button in the email (optional)</label><div style="display:grid;grid-template-columns:1fr 2fr;gap:10px"><input name="cta" placeholder="Open my account"><input name="ctaUrl" placeholder="https://eimc.vercel.app/account.html"></div></div>
      </div>
      <div class="form-f"><span class="mini" id="send-hint"></span><div class="btns"><button type="submit" class="btn btn-gold">${icon('send')}Send</button></div></div>
    </form>
    <div class="card lit" style="position:sticky;top:calc(var(--tb-h) + 16px)">
      <div class="card-h"><h2>${icon('eye')} Preview</h2><small id="pv-who">as the first person in the audience</small></div>
      <div class="pv-push" id="pv-push"><div class="brand-mark" data-mark data-size="34"></div><div><small>EIMC · now</small><b id="pv-pt">Your title</b><p id="pv-pb">Your message</p></div></div>
      <div class="pv"><iframe id="pv" title="Email preview" sandbox="allow-same-origin"></iframe></div>
    </div>
  </div>
  <div class="mt20" id="hist"></div>`);
}

export function mounted(view, ctx) {
  const form = $('#cmp', view);
  let sample = null;
  // the mark in the push preview
  import('/static/js/logo.js').then(({ logoHTML, Logo }) => { const h = $('#pv-push .brand-mark', view); if (h) { h.innerHTML = logoHTML({ size: 34, boot: false }); new Logo(h, { defer: true }).wake(); } }).catch(() => {});

  const audience = async () => {
    $('#aud-n', view).textContent = '…';
    try {
      const r = await api.do('audience', target);
      $('#aud-n', view).textContent = `${num(r.count)} ${r.count === 1 ? 'person' : 'people'}`;
      put($('#aud-s', view), html`${r.sample.slice(0, 8).map(s => html`<span style="display:inline-flex;align-items:center;gap:6px;margin:0 10px 6px 0">${avatar(s.name, 'sm')}${s.name}</span>`)}${r.count > 8 ? html`<span>+${r.count - 8} more</span>` : ''}`);
      sample = r.sample[0]?.id || null;
      $('#pv-who', view).textContent = sample ? `as ${r.sample[0].name}` : 'nobody matches';
      preview();
    } catch (e) { fail(e); }
  };
  const preview = debounce(async () => {
    const f = Object.fromEntries(new FormData(form));
    $('#pv-pt', view).textContent = f.title || 'Your title';
    $('#pv-pb', view).textContent = (f.body || 'Your message').replace(/\*\*/g, '').slice(0, 160);
    try {
      const r = await api.do('previewEmail', { title: f.title, body: f.body, cta: f.cta, ctaUrl: f.ctaUrl }, sample);
      $('#pv', view).srcdoc = r.html;
      $('#pv-pt', view).textContent = r.subject;
      $('#pv-pb', view).textContent = r.text.replace(/\*\*/g, '').replace(/\s+/g, ' ').slice(0, 160);
    } catch { /* preview is best-effort */ }
  }, 350);

  /* ── specific people: search, pick, remove ── */
  const people = new Map();                     // user id -> { name, client_id }
  const q = $('#ppl-q', view), res = $('#ppl-res', view), chips = $('#ppl-chips', view);
  let hits = [], active = -1;
  const drawChips = () => {
    put(chips, html`${[...people].map(([id, p]) => html`<span class="ppl-chip">${avatar(p.name, 'sm')}<b>${p.name}</b><small>${p.client_id}</small><button type="button" data-unpick="${id}" aria-label="Remove ${p.name}">${icon('x')}</button></span>`)}`);
    $$('[data-unpick]', chips).forEach(b => b.addEventListener('click', () => { people.delete(+b.dataset.unpick); usePeople(); }));
  };
  const usePeople = () => {
    drawChips();
    if (people.size) { target = { ids: [...people.keys()] }; $$('[data-seg]', view).forEach(x => x.classList.remove('on')); }
    else if (typeof target !== 'string') { target = 'all'; $('[data-seg="all"]', view).classList.add('on'); }
    audience();
  };
  const closeRes = () => { res.hidden = true; active = -1; };
  const drawRes = () => {
    if (!hits.length) { put(res, html`<div class="ppl-none">Nobody matches “${q.value.trim()}”</div>`); res.hidden = false; return; }
    put(res, html`${hits.map((u, i) => html`<button type="button" role="option" class="${i === active ? 'on' : ''} ${people.has(u.id) ? 'got' : ''}" data-hit="${i}">
      ${avatar(u.full_name, 'sm')}<span><b>${u.full_name}</b><small>${u.client_id} · ${u.email}</small></span>${people.has(u.id) ? html`<em>Added</em>` : html`<em>${icon('plus')}Add</em>`}</button>`)}`);
    res.hidden = false;
    $$('[data-hit]', res).forEach(b => b.addEventListener('mousedown', e => { e.preventDefault(); pick(hits[+b.dataset.hit]); }));
  };
  const pick = u => {
    if (!u) return;
    people.has(u.id) ? people.delete(u.id) : people.set(u.id, { name: u.full_name, client_id: u.client_id });
    q.value = ''; closeRes(); q.focus(); usePeople();
  };
  const find = debounce(async () => {
    const s = q.value.trim();
    if (!s) return closeRes();
    try { hits = (await api.get('search', { q: s })).users || []; active = hits.length ? 0 : -1; drawRes(); } catch (e) { fail(e); }
  }, 200);
  q.addEventListener('input', find);
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (!hits.length) return; e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length; drawRes(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (!res.hidden) pick(hits[active]); }
    else if (e.key === 'Escape') closeRes();
    else if (e.key === 'Backspace' && !q.value && people.size) { people.delete([...people.keys()].pop()); usePeople(); }
  });
  q.addEventListener('blur', () => setTimeout(closeRes, 120));
  q.addEventListener('focus', () => { if (q.value.trim()) find(); });
  // people pre-selected on the Users page arrive as ids: name them from the audience sample
  if (picked) api.do('audience', { ids: picked }).then(r => { r.sample.forEach(s => people.set(s.id, { name: s.name, client_id: s.client_id })); drawChips(); }).catch(() => {});

  $$('[data-seg]', view).forEach(b => b.addEventListener('click', () => {
    target = b.dataset.seg; picked = null; people.clear(); drawChips();
    $$('[data-seg]', view).forEach(x => x.classList.toggle('on', x === b));
    audience();
  }));
  $$('[data-var]', view).forEach(b => b.addEventListener('click', () => {
    const ta = form.body, at = ta.selectionStart ?? ta.value.length, v = `{{${b.dataset.var}}}`;
    ta.value = ta.value.slice(0, at) + v + ta.value.slice(ta.selectionEnd ?? at); ta.focus(); ta.selectionStart = ta.selectionEnd = at + v.length; preview();
  }));
  $('#tpl', view).addEventListener('change', e => { const t = TEMPLATES[+e.target.value]; if (!t) return; form.title.value = t.t; form.body.value = t.b; preview(); e.target.value = ''; });
  form.addEventListener('input', preview);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const channels = $$('input[name=ch]:checked', form).map(c => c.value);
    if (!channels.length) return toast('Pick at least one channel', true);
    if (!f.title.trim() || !f.body.trim()) return toast('Add a title and a message', true);
    const n = $('#aud-n', view).textContent;
    if (!await confirmBox(`Send to ${n}?`, `By ${channels.join(' + ')}. This cannot be unsent.`, { label: 'Send now' })) return;
    const btn = $('[type=submit]', form); btn.classList.add('busy');
    try {
      const r = await api.do('notify', target, { channels, title: f.title, body: f.body, cta: f.cta, ctaUrl: f.ctaUrl });
      toast(sentMsg(r) || 'Sent', r.emailFailed > 0);
      history = await api.get('messages'); hist(view, ctx);
    } catch (er) { fail(er); }
    btn.classList.remove('busy');
  });

  audience(); hist(view, ctx);
}

function hist(view, ctx) {
  dataTable($('#hist', view), {
    rows: history.list, placeholder: 'Search sent messages…',
    search: n => [n.title, n.body, n.full_name, n.email, n.channel].join(' '),
    chips: [{ key: 'all', label: 'All sent' }, ...['email', 'push', 'in_app'].map(c => ({ key: c, label: c === 'in_app' ? 'In-app' : c[0].toUpperCase() + c.slice(1), test: n => n.channel === c })), { key: 'unread', label: 'Unread', test: n => !n.is_read }],
    sort: { col: 0, dir: 'desc' },
    columns: [
      { label: 'When', sort: n => +new Date(n.created_at), cls: 'nw', render: n => html`${dtime(n.created_at)}<small>${ago(n.created_at)}</small>` },
      { label: 'To', sort: n => n.full_name, render: n => html`<div class="who">${avatar(n.full_name, 'sm')}<div><b>${n.full_name}</b><small>${n.client_id}</small></div></div>` },
      { label: 'Channel', sort: n => n.channel, render: n => html`<span class="st-pill ${n.channel === 'email' ? 'info' : n.channel === 'push' ? 'vio' : 'gold'}">${n.channel.replace('_', '-')}</span>` },
      { label: 'Message', render: n => html`<b style="color:var(--bone)">${n.title}</b><small>${(n.body || '').slice(0, 120)}</small>` },
      { label: 'Read', sort: n => n.is_read, render: n => (n.is_read ? 'Read' : html`<span class="st-pill info">Unread</span>`) },
      { label: '', render: n => html`<button type="button" class="btn btn-sm btn-quiet" data-del="${n.id}" title="Delete">${icon('trash')}</button>` },
    ],
    onRow: n => ctx.nav(`#/users/${n.user_id}?tab=messages`),
    csv: 'eimc-messages', csvCols: ['created_at', 'client_id', 'full_name', 'email', 'channel', 'title', 'body', 'is_read'],
    afterRender(tb) {
      tb.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async e => {
        e.stopPropagation();
        try { await api.do('noteDelete', b.dataset.del); b.closest('tr').remove(); toast('Deleted'); } catch (er) { fail(er); }
      }));
    },
  });
}
