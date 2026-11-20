'use strict';
/* Releases & access: the EIMC Terminal versions, the minimum version (the switch that cuts old
   builds off), service status, notices, and every terminal sign-in. Reads /api/q?v=access;
   the rules themselves live in the database (eimc.app_access, DB/sql/08_licensing.sql). */
import { $, $$, api, html, put, icon, num, date, dtime, ago, isoLocal, cap, toast, act, modal, confirmBox, debounce, countUp } from './core.js';

let D, CTX;
const LVL = { info: 'info', warning: 'warn', critical: 'bad' };
const EV = { activate: 'ok', refresh: 'mute', signout: 'mute', denied: 'warn', relay_connect: 'info', relay_drop: 'mute', token_reuse: 'bad' };
const EV_LABEL = { activate: 'Signed in', refresh: 'Checked', signout: 'Signed out', denied: 'Refused', relay_connect: 'Live data on', relay_drop: 'Live data off', token_reuse: 'Token reused' };
const toIso = v => (v ? new Date(v).toISOString() : '');      // datetime-local is in the admin's own time zone
const NONE = '0.0.0.0';

const tblCard = (title, extra, head, rows, empty = 'Nothing yet') => html`<div class="card flush lit mt20"><div class="card-h" style="padding:20px 22px 0">${title}${extra ? html`<div class="r">${extra}</div>` : ''}</div>
  <div class="dt-w"><table class="tbl"><thead><tr>${head.map(h => html`<th class="${h.startsWith('>') ? 'r' : ''}">${h.replace(/^>/, '')}</th>`)}</tr></thead>
  <tbody>${rows.length ? rows : html`<tr><td colspan="${head.length}"><div class="empty-s">${empty}</div></td></tr>`}</tbody></table></div></div>`;
const kpi = (ic, label, value, sub, count) => html`<div class="card kpi lit"><div class="kpi-l">${icon(ic)}${label}</div>
  <div class="kpi-v">${count ? html`<span data-count="${value}">0</span>` : html`<span class="mono">${value}</span>`}</div><div class="kpi-d"><span>${sub}</span></div></div>`;

export async function render(root, ctx) {
  CTX = ctx;
  D = await api.get('access');
  const p = D.policy, s = D.service, t = D.totals;
  const latest = D.releases.find(r => r.is_latest && r.channel === 'stable');
  const older = v => v !== 'unknown' && p.min_supported_version !== NONE && cmp(v, p.min_supported_version) < 0;

  put(root, html`
  <div class="ph"><div><h1>Releases <em>&amp; access</em></h1><p>Who may use EIMC Terminal: versions, the minimum version, service status and notices</p></div></div>
  <div class="g g4">
    ${kpi('download', 'Latest release', latest?.version || '—', latest ? (latest.download_url ? `released ${date(latest.released_at)}` : 'no download link yet') : 'none published')}
    ${kpi('lock', 'Minimum version', p.min_supported_version === NONE ? 'None' : p.min_supported_version, p.min_supported_version === NONE ? 'every build is allowed' : 'older builds are refused')}
    ${kpi('monitor', 'PCs in use', t.pcs, `${num(t.signed_in)} signed in · ${num(t.blocked)} blocked`, true)}
    ${kpi('shield', 'Licence checks, 24 h', t.checks_24h, `${num(t.denied_24h)} refused`, true)}
  </div>

  <div class="g g2 mt20">
    <form class="card lit" id="f-policy" novalidate>
      <div class="card-h"><h2>${icon('lock')} Version cutoff</h2><small>updated ${ago(p.updated_at)}</small></div>
      <div class="nt" style="margin-bottom:16px">${icon('info')}<span>Builds older than the minimum get <b>no licence</b> and are told to update; the relay drops them too. Use <b>${NONE}</b> to allow every build. The minimum can never be newer than the latest release.</span></div>
      <div class="form-g">
        <div class="fld"><label>Minimum version</label><input name="min_supported_version" class="mono" value="${p.min_supported_version}" required></div>
        <div class="fld"><label>Licence length (hours)</label><input name="licence_ttl_hours" type="number" min="1" max="168" value="${p.licence_ttl_hours}"></div>
        <div class="fld wide"><label>Message for builds that are too old</label><textarea name="update_message" rows="2" maxlength="500">${p.update_message}</textarea></div>
      </div>
      <div id="cut-prev" class="mini" style="margin-top:12px;min-height:1.4em"></div>
      <div class="form-f"><span class="mini">A licence lasts this long before the terminal must check again.</span><div class="btns"><button class="btn btn-sm btn-gold" type="submit">Save</button></div></div>
    </form>

    <form class="card lit" id="f-service" novalidate>
      <div class="card-h"><h2>${icon('alert')} Service status</h2><div class="r">${s.is_down ? html`<span class="st-pill bad">Down</span>` : html`<span class="st-pill ok">Up</span>`}</div></div>
      <div class="nt ${s.is_down ? 'warn' : ''}" style="margin-bottom:16px">${icon(s.is_down ? 'alert' : 'info')}<span>${s.is_down
        ? html`<b>Customers cannot use EIMC Terminal right now.</b> They see your message.${s.updated_at ? ` Since ${dtime(s.updated_at)}.` : ''}`
        : html`While <b>down</b> is on, no terminal gets a licence and customers see the message below instead.`}</span></div>
      <label class="chk" style="margin-bottom:14px"><input type="checkbox" name="is_down" ${s.is_down ? 'checked' : ''}><span></span>Service is down</label>
      <div class="form-g">
        <div class="fld"><label>Reason (short)</label><input name="reason" maxlength="120" value="${s.reason || ''}" placeholder="Scheduled maintenance"></div>
        <div class="fld"><label>Expected back</label><input name="expected_back_at" type="datetime-local" value="${isoLocal(s.expected_back_at)}"></div>
        <div class="fld wide"><label>Message for customers</label><textarea name="message" rows="2" maxlength="1000" placeholder="We are upgrading the data servers. Back by 6 PM.">${s.message || ''}</textarea></div>
      </div>
      <div class="form-f"><span class="mini">Reaches every terminal within about a minute.</span><div class="btns"><button class="btn btn-sm btn-gold" type="submit">Save</button></div></div>
    </form>
  </div>

  ${tblCard(html`<h2>Releases</h2><small>what the terminal offers as the update</small>`, html`<button type="button" class="btn btn-sm btn-gold" data-rel-new>${icon('plus')}New release</button>`,
    ['Version', 'Channel', 'Released', 'Download', 'Notes', 'State', ''],
    D.releases.map(r => html`<tr><td><b class="mono" style="color:var(--bone)">${r.version}</b></td><td>${cap(r.channel)}</td><td class="nw">${date(r.released_at)}</td>
      <td>${r.download_url ? html`<a href="${r.download_url}" target="_blank" rel="noopener" class="mono">${host(r.download_url)}</a>${r.sha256 ? html`<small class="mono" title="${r.sha256}">sha ${r.sha256.slice(0, 10)}…</small>` : ''}` : html`<span class="st-pill warn">No link</span>`}</td>
      <td style="max-width:320px"><small>${r.notes || '—'}</small></td>
      <td>${r.is_latest ? html`<span class="st-pill ok">Latest</span>` : older(r.version) ? html`<span class="st-pill bad">Below minimum</span>` : html`<span class="st-pill mute">Older</span>`}</td>
      <td class="r nw">${r.is_latest ? '' : html`<button type="button" class="btn btn-sm" data-rel-latest="${r.id}">Make latest</button> `}<button type="button" class="btn btn-sm btn-quiet" data-rel-edit="${r.id}" title="Edit">${icon('edit')}</button>${r.is_latest ? '' : html` <button type="button" class="btn btn-sm btn-quiet" data-rel-del="${r.id}" title="Delete">${icon('trash')}</button>`}</td></tr>`),
    'No releases yet')}

  ${tblCard(html`<h2>Versions in use</h2><small>active PCs by the build they last reported</small>`, '', ['Version', '>PCs', '>Accounts', 'Last seen', 'State'],
    D.versions.map(v => html`<tr><td class="mono"><b style="color:var(--bone)">${v.version}</b></td><td class="r mono">${num(v.pcs)}</td><td class="r mono">${num(v.accounts)}</td><td class="nw">${ago(v.last_seen)}</td>
      <td>${older(v.version) ? html`<span class="st-pill bad">Locked out</span>` : latest && v.version === latest.version ? html`<span class="st-pill ok">Latest</span>` : html`<span class="st-pill mute">Allowed</span>`}</td></tr>`),
    'No PCs have signed in yet')}

  ${tblCard(html`<h2>Notices</h2><small>banners for everyone, or one plan</small>`, html`<button type="button" class="btn btn-sm btn-gold" data-note-new>${icon('plus')}New notice</button>`,
    ['Notice', 'Level', 'Shown on', 'For', 'From', 'Until', 'State', ''],
    D.notices.map(n => html`<tr><td style="max-width:360px"><b style="color:var(--bone)">${n.title}</b><small>${n.body}</small></td><td><span class="st-pill ${LVL[n.level]}">${cap(n.level)}</span></td>
      <td>${n.shown_on === 'both' ? 'Site + terminal' : cap(n.shown_on)}</td><td>${n.plan_name || 'Everyone'}</td><td class="nw">${dtime(n.starts_at)}</td><td class="nw">${n.ends_at ? dtime(n.ends_at) : 'Until ended'}</td>
      <td><span class="st-pill ${n.state === 'live' ? 'ok' : n.state === 'scheduled' ? 'info' : 'mute'}">${cap(n.state)}</span></td>
      <td class="r nw">${n.state !== 'ended' ? html`<button type="button" class="btn btn-sm" data-note-end="${n.id}">End now</button> ` : ''}<button type="button" class="btn btn-sm btn-quiet" data-note-edit="${n.id}" title="Edit">${icon('edit')}</button> <button type="button" class="btn btn-sm btn-quiet" data-note-del="${n.id}" title="Delete">${icon('trash')}</button></td></tr>`),
    'No notices')}

  ${tblCard(html`<h2>Terminal sign-ins</h2><small>the last 100 licence events</small>`, '', ['When', 'Customer', 'Event', 'Reason', 'PC', 'Version', 'IP'],
    D.events.map(e => html`<tr><td class="nw" title="${dtime(e.at)}">${ago(e.at)}</td>
      <td>${e.user_id ? html`<a href="#/users/${e.user_id}?tab=licence">${e.full_name || 'User ' + e.user_id}</a><small class="mono">${e.client_id || ''}</small>` : html`<span class="mini">unknown</span>`}</td>
      <td><span class="st-pill ${EV[e.event] || 'mute'}">${EV_LABEL[e.event] || e.event}</span></td><td class="mono"><small>${e.reason || ''}</small></td>
      <td>${e.pc || '—'}</td><td class="mono">${e.app_version || '—'}</td><td class="mono">${e.ip || '—'}</td></tr>`),
    'No terminal has signed in yet')}`);
}

function host(u) { try { return new URL(u).host; } catch { return u; } }
function cmp(a, b) {
  const k = v => String(v).replace(/^v/i, '').split('.').map(n => +n || 0).concat([0, 0, 0, 0]).slice(0, 4);
  const x = k(a), y = k(b);
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

async function again() {
  const v = $('#view'), h = document.createElement('div');
  await render(h, CTX);
  v.replaceChildren(...h.childNodes);
  mounted(v, CTX);
}

export function mounted(view) {
  countUp(view);

  /* cutoff: preview who it would lock out, confirm before saving one that locks anyone out */
  const fp = $('#f-policy', view), prev = $('#cut-prev', view);
  let lastPreview = null;
  const preview = debounce(async () => {
    const v = fp.min_supported_version.value.trim().replace(/^v/i, '');
    lastPreview = null;
    if (!/^\d+(\.\d+){1,3}$/.test(v)) return put(prev, html`<span style="color:var(--heat-t)">Use a version like 1.26.0.0</span>`);
    if (v === NONE || /^0(\.0)*$/.test(v)) return put(prev, html`${icon('check')} Every build is allowed.`);
    try {
      const r = await api.get('cutoff', { version: v });
      lastPreview = r;
      put(prev, r.pcs
        ? html`<span style="color:var(--heat-t)">${icon('alert')} This would lock out <b>${num(r.pcs)} PC${r.pcs === 1 ? '' : 's'}</b> on <b>${num(r.accounts)} account${r.accounts === 1 ? '' : 's'}</b> (${num(r.recent)} used this week) until they update.</span>`
        : html`${icon('check')} No PC in use is older than ${v}.`);
    } catch (e) { put(prev, html`<span style="color:var(--heat-t)">${e.message}</span>`); }
  }, 250);
  fp.min_supported_version.addEventListener('input', preview);
  preview();
  fp.addEventListener('submit', async e => {
    e.preventDefault();
    const o = Object.fromEntries(new FormData(fp));
    if (lastPreview?.pcs && !await confirmBox('Lock out older builds?',
      `${num(lastPreview.pcs)} PCs on ${num(lastPreview.accounts)} accounts are on older builds. They stop working until they install the latest release.`, { label: 'Lock them out', danger: true })) return;
    act(fp.querySelector('[type=submit]'), () => api.do('policySave', o), 'Version policy saved').then(again, () => {});
  });

  /* service status */
  const fs = $('#f-service', view);
  fs.addEventListener('submit', async e => {
    e.preventDefault();
    const o = Object.fromEntries(new FormData(fs));
    o.is_down = fs.is_down.checked; o.expected_back_at = toIso(o.expected_back_at);
    if (o.is_down && !D.service.is_down && !await confirmBox('Take EIMC Terminal down?',
      'No terminal gets a licence while this is on. Every customer sees your message instead of the app.', { label: 'Take it down', danger: true })) return;
    act(fs.querySelector('[type=submit]'), () => api.do('serviceSave', o), o.is_down ? 'Service marked down' : 'Service is up').then(again, () => {});
  });

  /* releases */
  const relForm = (r = {}) => html`<div class="form-g">
    <div class="fld"><label>Version</label><input name="version" class="mono" value="${r.version || ''}" placeholder="1.26.0.0" required></div>
    <div class="fld"><label>Channel</label><select name="channel">${['stable', 'beta'].map(c => html`<option value="${c}" ${c === (r.channel || 'stable') ? 'selected' : ''}>${cap(c)}</option>`)}</select></div>
    <div class="fld wide"><label>Download link (https)</label><input name="download_url" value="${r.download_url || ''}" placeholder="https://…/EIMC-Setup-1.26.0.0.exe"></div>
    <div class="fld wide"><label>SHA-256 of the installer</label><input name="sha256" class="mono" value="${r.sha256 || ''}" placeholder="certutil -hashfile EIMC-Setup.exe SHA256"></div>
    <div class="fld"><label>Size (bytes)</label><input name="size_bytes" type="number" min="1" value="${r.size_bytes || ''}"></div>
    <div class="fld"><label>Released</label><input name="released_at" type="datetime-local" value="${isoLocal(r.released_at || new Date())}"></div>
    <div class="fld wide"><label>Release notes (customers see these)</label><textarea name="notes" rows="3" maxlength="4000">${r.notes || ''}</textarea></div>
  </div><label class="chk mt20"><input type="checkbox" name="is_latest" ${r.id ? (r.is_latest ? 'checked' : '') : 'checked'}><span></span>Latest on its channel: the terminal offers this one as the update</label>`;
  const relSubmit = id => f => { f.is_latest = f.is_latest === 'on'; f.released_at = toIso(f.released_at); return api.do('releaseSave', id, f); };
  $('[data-rel-new]', view).addEventListener('click', async () => {
    const r = await modal({ title: 'New release', text: 'Publish the installer first (it needs an https link), then add it here.', wide: true, body: relForm(),
      actions: [{ label: 'Cancel', value: null, cls: 'btn-quiet' }, { label: 'Add release', submit: true, cls: 'btn-gold' }], submit: relSubmit(null) });
    if (r) { toast('Release added'); again(); }
  });
  $$('[data-rel-edit]', view).forEach(b => b.addEventListener('click', async () => {
    const rel = D.releases.find(x => String(x.id) === b.dataset.relEdit);
    const r = await modal({ title: `Release ${rel.version}`, wide: true, body: relForm(rel),
      actions: [{ label: 'Cancel', value: null, cls: 'btn-quiet' }, { label: 'Save', submit: true, cls: 'btn-gold' }], submit: relSubmit(rel.id) });
    if (r) { toast('Release saved'); again(); }
  }));
  $$('[data-rel-latest]', view).forEach(b => b.addEventListener('click', () => {
    const rel = D.releases.find(x => String(x.id) === b.dataset.relLatest);
    act(b, () => api.do('releaseSave', rel.id, { ...rel, is_latest: true }), `${rel.version} is now the latest`).then(again, () => {});
  }));
  $$('[data-rel-del]', view).forEach(b => b.addEventListener('click', async () => {
    const rel = D.releases.find(x => String(x.id) === b.dataset.relDel);
    if (!await confirmBox(`Delete release ${rel.version}?`, 'Only the record is removed; PCs on this build keep working unless it is below the minimum.', { label: 'Delete', danger: true })) return;
    act(b, () => api.do('releaseDelete', rel.id), 'Release deleted').then(again, () => {});
  }));

  /* notices */
  const noteForm = (n = {}) => html`<div class="form-g">
    <div class="fld wide"><label>Title</label><input name="title" maxlength="120" value="${n.title || ''}" required></div>
    <div class="fld wide"><label>Message</label><textarea name="body" rows="3" maxlength="2000" required>${n.body || ''}</textarea></div>
    <div class="fld"><label>Level</label><select name="level">${['info', 'warning', 'critical'].map(l => html`<option value="${l}" ${l === (n.level || 'info') ? 'selected' : ''}>${cap(l)}</option>`)}</select></div>
    <div class="fld"><label>Shown on</label><select name="shown_on">${[['both', 'Site + terminal'], ['terminal', 'Terminal'], ['site', 'Website']].map(([v, l]) => html`<option value="${v}" ${v === (n.shown_on || 'both') ? 'selected' : ''}>${l}</option>`)}</select></div>
    <div class="fld"><label>For</label><select name="plan_code"><option value="">Everyone</option>${D.plans.map(p => html`<option value="${p.code}" ${p.code === n.plan_code ? 'selected' : ''}>${p.name} plan only</option>`)}</select></div>
    <div class="fld"><label>From</label><input name="starts_at" type="datetime-local" value="${isoLocal(n.starts_at || new Date())}"></div>
    <div class="fld"><label>Until (blank = until ended)</label><input name="ends_at" type="datetime-local" value="${isoLocal(n.ends_at)}"></div>
  </div>`;
  const noteSubmit = id => f => { f.starts_at = toIso(f.starts_at); f.ends_at = toIso(f.ends_at); return api.do('noticeSave', id, f); };
  $('[data-note-new]', view).addEventListener('click', async () => {
    const r = await modal({ title: 'New notice', text: 'A banner for everyone (or one plan) on the website, in the terminal, or both.', wide: true, body: noteForm(),
      actions: [{ label: 'Cancel', value: null, cls: 'btn-quiet' }, { label: 'Publish', submit: true, cls: 'btn-gold' }], submit: noteSubmit(null) });
    if (r) { toast('Notice published'); again(); }
  });
  $$('[data-note-edit]', view).forEach(b => b.addEventListener('click', async () => {
    const n = D.notices.find(x => String(x.id) === b.dataset.noteEdit);
    const r = await modal({ title: 'Edit notice', wide: true, body: noteForm(n),
      actions: [{ label: 'Cancel', value: null, cls: 'btn-quiet' }, { label: 'Save', submit: true, cls: 'btn-gold' }], submit: noteSubmit(n.id) });
    if (r) { toast('Notice saved'); again(); }
  }));
  $$('[data-note-end]', view).forEach(b => b.addEventListener('click', () => act(b, () => api.do('noticeEnd', b.dataset.noteEnd), 'Notice ended').then(again, () => {})));
  $$('[data-note-del]', view).forEach(b => b.addEventListener('click', async () => {
    if (!await confirmBox('Delete this notice?', 'It disappears from the site and the terminal.', { label: 'Delete', danger: true })) return;
    act(b, () => api.do('noticeDelete', b.dataset.noteDel), 'Notice deleted').then(again, () => {});
  }));
}
