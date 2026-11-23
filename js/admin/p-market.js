'use strict';
/* Market data: the one Dhan account every customer's live data comes from (through the relay),
   the go-live switch, and the relay's health. Customers never need a EIMC-DATA account of their own.
   The EIMC-DATA token is stored encrypted (EIMC_BROKER_KEY) and never comes back to this page. */
import { $, api, html, put, icon, num, dtime, ago, toast, act, modal, confirmBox } from './core.js';

let D, CTX, timer;

function tokenState(b) {
  if (!b.token_set || !b.token_expires_at) return { pill: 'bad', label: 'No token', note: 'Paste a EIMC-DATA access token below.' };
  const left = new Date(b.token_expires_at) - Date.now();
  if (left <= 0) return { pill: 'bad', label: 'Expired', note: `Expired ${ago(b.token_expires_at)}. Live data stops until a fresh token is pasted.` };
  const h = left / 36e5, mins = Math.max(1, Math.floor(left / 6e4));
  const when = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
  return { pill: h < 1 ? 'bad' : h < 3 ? 'warn' : 'ok', label: h < 3 ? 'Expiring soon' : 'Valid', note: `Valid for another ${when} (until ${dtime(b.token_expires_at)}).` };
}

const kv = (k, v) => html`<div><span>${k}</span><b>${v}</b></div>`;

export async function render(root, ctx) {
  CTX = ctx;
  D = await api.get('market');
  const b = D.broker, on = D.policy.relay_enabled, st = tokenState(b), r = D.relay, ev = D.relayEvents;
  put(root, html`
  <div class="ph"><div><h1>Market <em>data</em></h1><p>One EIMC-DATA account feeds every customer through the relay. Customers never connect EIMC-DATA themselves.</p></div></div>

  ${on ? '' : html`<div class="nt warn" style="margin-bottom:16px">${icon('alert')}<span><b>Live data is off for every customer.</b> The relay refuses all connections until you turn it on below. Turn it on only once EIMC-DATA has confirmed in writing that you may show this account's data to your subscribers.</span></div>`}

  <div class="g g2">
    <div class="card lit">
      <div class="card-h"><h2>${icon('zap')} Live data for customers</h2><div class="r">${on ? html`<span class="st-pill ok">On</span>` : html`<span class="st-pill mute">Off</span>`}</div></div>
      <p class="mini" style="margin:0 0 16px">${on
        ? 'Paid customers get live charts through the relay. Free customers and expired trials stay on demo data.'
        : 'Every terminal runs on demo data. Nothing from the EIMC-DATA account reaches a customer.'}</p>
      <div class="kvs" style="grid-template-columns:repeat(3,1fr)">${kv('Connections, 24 h', num(ev.connects))}${kv('Customers, 24 h', num(ev.users))}${kv('Drops, 24 h', num(ev.drops))}</div>
      <div class="qa mt20">${on
        ? html`<button type="button" class="btn btn-danger" data-relay="off">${icon('ban')}Turn live data off</button>`
        : html`<button type="button" class="btn btn-gold" data-relay="on">${icon('zap')}Turn live data on…</button>`}</div>
    </div>

    <div class="card lit">
      <div class="card-h"><h2>${icon('pulse')} Relay server</h2><div class="r">${!r.configured ? html`<span class="st-pill mute">Not set up</span>` : r.ok ? html`<span class="st-pill ok">Healthy · ${r.ms} ms</span>` : html`<span class="st-pill bad">Unreachable</span>`}</div></div>
      ${!r.configured
        ? html`<div class="empty-s">${icon('monitor')}<b style="color:var(--bone)">No relay yet</b><span>Set <span class="mono">RELAY_URL</span> and <span class="mono">RELAY_ADMIN_TOKEN</span> on this site once the relay server is running.</span></div>`
        : html`<p class="mini mono" style="margin:0 0 14px">${r.url}</p>
          ${r.ok && r.data && typeof r.data === 'object'
            ? html`<div class="kvs" style="grid-template-columns:repeat(3,1fr)">${Object.entries(r.data).filter(([, v]) => v == null || typeof v !== 'object').slice(0, 9).map(([k, v]) => kv(k.replace(/_/g, ' '), v == null ? '—' : String(v)))}</div>`
            : html`<div class="nt warn">${icon('alert')}<span>${r.error || `The relay answered ${r.status}.`}</span></div>`}`}
    </div>
  </div>

  <form class="card glow lit mt20" id="f-token" novalidate autocomplete="off">
    <div class="card-h"><h2>${icon('key')} House EIMC-DATA account</h2><div class="r"><span class="st-pill ${st.pill}" id="tok-pill">${st.label}</span></div></div>
    ${D.keyConfigured ? '' : html`<div class="nt warn" style="margin-bottom:16px">${icon('alert')}<span><b>EIMC_BROKER_KEY is not set on this site.</b> It encrypts the EIMC-DATA token. Add a random value of 32+ characters in Vercel (the relay needs the same value), redeploy, then paste the token.</span></div>`}
    <div class="kvs" style="grid-template-columns:repeat(4,1fr);margin-bottom:18px">
      ${kv('EIMC-DATA client', b.client_id ? `••••${b.client_id.slice(-4)}` : '—')}${kv('Token', b.token_set ? 'Saved (encrypted)' : 'None')}
      ${kv('Expires', b.token_expires_at ? dtime(b.token_expires_at) : '—')}${kv('Updated', b.updated_at && b.token_set ? ago(b.updated_at) : '—')}
    </div>
    <p class="mini" id="tok-note" style="margin:0 0 16px">${st.note}</p>
    <div class="form-g">
      <div class="fld"><label>EIMC-DATA client ID</label><input name="client_id" inputmode="numeric" value="${b.client_id || ''}" placeholder="read from the token if blank"></div>
      <div class="fld wide"><label>New access token</label><textarea name="token" rows="3" spellcheck="false" autocomplete="off" class="mono" placeholder="Paste the token from the EIMC-DATA web portal → My Profile → Access APIs"></textarea></div>
    </div>
    <div class="form-f"><span class="mini">EIMC-DATA tokens last 24 hours. Paste a fresh one each morning until automatic renewal is set up.</span>
      <div class="btns">${b.token_set ? html`<button type="button" class="btn btn-sm btn-quiet" data-tok-clear>Remove token</button>` : ''}<button class="btn btn-sm btn-gold" type="submit">Save token</button></div></div>
  </form>`);
}

async function again() {
  const v = $('#view'), h = document.createElement('div');
  await render(h, CTX);
  v.replaceChildren(...h.childNodes);
  mounted(v, CTX);
}

export function mounted(view, ctx) {
  // keep the expiry countdown honest while the page is open
  clearInterval(timer);
  timer = setInterval(() => {
    const st = tokenState(D.broker), pill = $('#tok-pill', view), note = $('#tok-note', view);
    if (!pill) return clearInterval(timer);
    pill.className = `st-pill ${st.pill}`; pill.textContent = st.label; note.textContent = st.note;
  }, 30000);
  ctx?.onLeave?.(() => clearInterval(timer));

  const f = $('#f-token', view);
  f.addEventListener('submit', e => {
    e.preventDefault();
    const o = Object.fromEntries(new FormData(f));
    if (!o.token.trim()) return toast('Paste the new access token first.', true);
    act(f.querySelector('[type=submit]'), () => api.do('houseToken', o), r => `Token saved, valid until ${dtime(r.token_expires_at)}`).then(again, () => {});
  });
  $('[data-tok-clear]', view)?.addEventListener('click', async e => {
    if (!await confirmBox('Remove the EIMC-DATA token?', 'Live data stops for every customer until a new token is saved.', { label: 'Remove', danger: true })) return;
    act(e.currentTarget, () => api.do('houseTokenClear'), 'Token removed').then(again, () => {});
  });

  $('[data-relay="off"]', view)?.addEventListener('click', async e => {
    if (!await confirmBox('Turn live data off?', 'Every customer drops to demo data within about a minute.', { label: 'Turn off', danger: true })) return;
    act(e.currentTarget, () => api.do('relaySwitch', false), 'Live data is off').then(again, () => {});
  });
  $('[data-relay="on"]', view)?.addEventListener('click', async () => {
    const r = await modal({ title: 'Turn live data on?', danger: true,
      text: 'Paid customers start receiving live market data from the house EIMC-DATA account through the relay.',
      body: html`<div class="nt warn" style="margin-bottom:14px">${icon('alert')}<span>Showing one EIMC-DATA account's live NSE data to paying customers may need EIMC-DATA's written approval and an exchange data licence. Do not turn this on without them.</span></div>
        <label class="chk"><input type="checkbox" name="confirmed" value="DHAN-CONFIRMED"><span></span>EIMC-DATA has confirmed in writing that this is allowed</label>`,
      actions: [{ label: 'Cancel', value: null, cls: 'btn-quiet' }, { label: 'Turn live data on', submit: true, cls: 'btn-gold' }],
      submit: o => api.do('relaySwitch', true, o.confirmed || '') });
    if (r) { toast('Live data is on'); again(); }
  });
}
