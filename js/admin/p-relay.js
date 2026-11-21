'use strict';
/* ════════════════════════════════════════════════════════════════════
   Relay server: everything the market-data relay is doing, live.
     · the flow   Dhan (5 sockets) → relay → every connected terminal
     · who        each open socket: customer, PC, network, delay, symbols
     · what       symbols being watched and by how many people
     · delay      exchange → relay → customer, and its spread over time
     · the box    CPU, memory, network, disk and how many more customers fit
     · history    people online, delay, drops, busiest hours (relay_stats)
     · alerts     what the relay has noticed, and the connect / drop log
   Live numbers refresh every 3 s while this page is open (/api/q?v=relay,
   which asks the relay's /health?full=1); history every minute.
   ════════════════════════════════════════════════════════════════════ */
import { $, $$, api, html, raw, put, icon, num, ago, dtime, avatar, toast, act, modal, confirmBox, tip, esc, REDUCED, hue } from './core.js';
import { lineChart, barChart, donut, heatmap, barList } from './charts.js';

const POLL_MS = 3000, KEEP = 120;                      // 120 samples = the last 6 minutes
let D = null, H = null, CTX = null, pollT = null, histT = null, alive = false, range = '24h', filter = '', sortBy = 'subs', showAllSym = false;
const T = { t: [], people: [], conns: [], msgs: [], ticks: [], p50: [], p95: [], p99: [], net: [], cpu: [] };

/* ── small formatters ─────────────────────────────────────────────── */
const ms = v => (v == null ? '—' : v < 10 ? `${(+v).toFixed(1)} ms` : `${Math.round(v)} ms`);
const rate = v => (v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v >= 100 ? Math.round(v) : (+v).toFixed(v < 10 ? 1 : 0));
const dur = s => { if (s == null) return '—'; s = Math.max(0, Math.round(s)); if (s < 60) return `${s}s`; const m = Math.floor(s / 60); if (m < 60) return `${m}m ${s % 60}s`; const h = Math.floor(m / 60); if (h < 48) return `${h}h ${m % 60}m`; return `${Math.floor(h / 24)}d ${h % 24}h`; };
const kb = v => (v == null ? '—' : v >= 1024 ? `${(v / 1024).toFixed(1)} MB/s` : `${Math.round(v)} KB/s`);
const tone = (v, warn, bad) => (v == null ? 'mute' : v >= bad ? 'bad' : v >= warn ? 'warn' : 'ok');
const TONE_C = { ok: 'var(--teal)', warn: 'var(--heat)', bad: 'var(--red)', mute: 'var(--ash)' };
const STATE = { connected: 'ok', connecting: 'info', reconnecting: 'warn', error: 'bad', 'no token': 'bad', idle: 'mute' };
const REASON = {
  CLOSED: 'Closed the app or lost network', SLOW: 'Too slow, reconnected', REPLACED: 'Same PC connected again', ADMIN: 'Reconnected by you',
  RELAY_OFF: 'Live data switched off', SERVICE_DOWN: 'Service down', LICENCE_EXPIRED: 'Licence expired', EXPIRED: 'Subscription ended',
  NO_LIVE_DATA: 'Plan without live data', UPDATE_REQUIRED: 'Update required', BANNED: 'Account blocked', DEVICE_BLOCKED: 'PC blocked',
  DEVICE_REVOKED: 'PC signed out', DEVICE_UNKNOWN: 'Unknown PC', UNKNOWN_USER: 'Unknown account', NO_LICENCE: 'No licence',
};
const reason = r => REASON[r] || (r?.startsWith('RENEW_') ? 'Licence renewal refused' : r?.startsWith('RELAY_') ? `Closed by relay (${r.slice(6)})` : r || '—');

/* ── live visuals, drawn without intro animations (they redraw every 3 s) ── */
function liveSpark(values, color) {
  const v = values.filter(x => x != null);
  if (v.length < 2) return '';
  const W = 240, H2 = 40, max = Math.max(1e-9, ...v), n = values.length;
  const pts = values.map((x, i) => [(i * W) / (n - 1), H2 - 3 - ((x || 0) / max) * (H2 - 8)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const id = `rs${Math.random().toString(36).slice(2, 8)}`;
  return `<svg viewBox="0 0 ${W} ${H2}" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${d}L${W},${H2}L0,${H2}Z" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" vector-effect="non-scaling-stroke"/></svg>`;
}

/* rolling multi-line chart with a hover readout (no intro animation, no flicker) */
function liveLines(el, { series, labels, height = 170, fmt = ms }) {
  if (!el) return;
  const W = Math.max(280, el.clientWidth || 600), pad = { l: 44, r: 10, t: 10, b: 18 };
  const all = series.flatMap(s => s.values).filter(v => v != null);
  const max = Math.max(1, ...all) * 1.15, n = Math.max(2, labels.length);
  const iw = W - pad.l - pad.r, ih = height - pad.t - pad.b;
  const X = i => pad.l + (i * iw) / (n - 1), Y = v => pad.t + ih - (Math.min(v, max) / max) * ih;
  const ticks = [0, max / 2, max];
  const path = s => s.values.map((v, i) => (v == null ? null : `${X(i).toFixed(1)},${Y(v).toFixed(1)}`)).filter(Boolean).map((p, i) => `${i ? 'L' : 'M'}${p}`).join('');
  const id = `ll${Math.random().toString(36).slice(2, 8)}`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${height}" height="${height}" width="100%" role="img">
    <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${series[0].color}" stop-opacity=".28"/><stop offset="1" stop-color="${series[0].color}" stop-opacity="0"/></linearGradient></defs>
    <g class="grid">${ticks.map(v => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${pad.l - 8}" y="${Y(v) + 3.5}" text-anchor="end">${esc(fmt(v))}</text>`).join('')}</g>
    ${series[0].values.some(v => v != null) ? `<path d="${path(series[0])}L${X(series[0].values.length - 1)},${Y(0)}L${X(series[0].values.findIndex(v => v != null))},${Y(0)}Z" fill="url(#${id})"/>` : ''}
    ${series.map(s => `<path d="${path(s)}" fill="none" stroke="${s.color}" stroke-width="1.8" ${s.dash ? 'stroke-dasharray="4 4"' : ''} stroke-linejoin="round"/>`).join('')}
    <line class="cross" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ih}"/>
    <rect class="hit" x="${pad.l}" y="${pad.t}" width="${iw}" height="${ih}" fill="transparent"/></svg>`;
  el.classList.add('ch');
  const s = el.querySelector('svg'), hit = s.querySelector('.hit'), cross = s.querySelector('.cross');
  hit.addEventListener('pointermove', e => {
    const r = s.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(labels.length - 1, Math.round(((x - pad.l) / iw) * (n - 1))));
    el.classList.add('hov'); cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i));
    tip.show(html`<div class="t">${labels[i] || ''}</div>${series.map(se => html`<div class="r" style="--c:${raw(se.color)}"><i></i>${se.name}<b>${fmt(se.values[i])}</b></div>`)}`, e.clientX, e.clientY);
  });
  hit.addEventListener('pointerleave', () => { el.classList.remove('hov'); tip.hide(); });
}

/* radial gauge 0..100 */
const gauge = (v, label, sub, warn = 70, bad = 85) => {
  const t = tone(v, warn, bad), val = v == null ? 0 : Math.max(0, Math.min(100, v));
  return html`<div class="rl-gauge" style="--gc:${raw(TONE_C[t])}">
    <svg viewBox="0 0 120 120"><circle class="tr" cx="60" cy="60" r="50" pathLength="100"/><circle class="va" cx="60" cy="60" r="50" pathLength="100" style="stroke-dasharray:${val * 0.75} 100"/></svg>
    <div class="rl-gv"><b>${v == null ? '—' : Math.round(v)}<small>${v == null ? '' : '%'}</small></b><span>${label}</span></div>
    <em>${sub}</em></div>`;
};

/* ── page ─────────────────────────────────────────────────────────── */
export async function render(root, ctx) {
  CTX = ctx;
  D = await api.get('relay');
  put(root, html`
  <div class="ph">
    <div>
      <div class="kicker" id="rl-kick"><b>Live</b>&nbsp;· refreshes every 3 s</div>
      <h1>Relay <em>server</em></h1>
      <p id="rl-sub">${D.url || 'No relay configured'}</p>
    </div>
    <div class="btns">
      <button type="button" class="btn btn-sm" data-act="deep">${icon('layers')}200-level books</button>
      <button type="button" class="btn btn-sm" data-act="kick-all">${icon('refresh')}Reconnect everyone</button>
      <button type="button" class="btn btn-sm btn-gold" data-act="restart">${icon('zap')}Restart Dhan link</button>
    </div>
  </div>
  <div id="rl-banner"></div>

  <div class="card glow lit rl-flow" id="rl-flow"></div>

  <div class="rl-kpis" id="rl-kpis"></div>

  <div class="g rl-g2 mt20">
    <div class="card lit"><div class="card-h"><h2>${icon('clock')} Where the time goes</h2><small>median delay, exchange to customer</small></div>
      <div id="rl-path"></div>
      <div class="rl-legend"><span style="--c:var(--c2)"><i></i>p50 in relay</span><span style="--c:var(--c1)"><i></i>p95</span><span style="--c:var(--c3)"><i></i>p99</span><span style="--c:var(--c4)"><i></i>network p50</span></div>
      <div id="rl-delay-ch" class="rl-live-ch"></div>
      <div id="rl-delay-chips" class="rl-chips"></div>
    </div>
    <div class="card lit"><div class="card-h"><h2>${icon('monitor')} The server</h2><small id="rl-srv-sub"></small></div>
      <div id="rl-server"></div>
    </div>
  </div>

  <div class="card flush lit mt20">
    <div class="card-h rl-th"><h2>${icon('users')} Open sockets</h2><small id="rl-conn-sub"></small>
      <div class="r"><div class="rl-search">${icon('search')}<input id="rl-q" placeholder="Name, client ID, IP or symbol" autocomplete="off" spellcheck="false"></div>
        <select id="rl-sort" class="rl-sel"><option value="subs">Most symbols</option><option value="msgs">Busiest</option><option value="rtt">Slowest network</option><option value="for">Longest connected</option><option value="new">Newest</option></select></div></div>
    <div class="dt-w" id="rl-conns"></div>
  </div>

  <div class="g rl-g2 mt20">
    <div class="card flush lit"><div class="card-h" style="padding:20px 22px 0"><h2>${icon('eye')} What people are watching</h2><small id="rl-sym-sub"></small></div>
      <div id="rl-syms"></div></div>
    <div class="card lit"><div class="card-h"><h2>${icon('zap')} Dhan connection</h2><small>5 sockets per account</small></div>
      <div id="rl-sockets"></div>
      <div id="rl-token" class="mt20"></div>
      <div id="rl-rest" class="mt20"></div></div>
  </div>

  <div class="card lit mt20" id="rl-hist-card">
    <div class="card-h"><h2>${icon('trend')} History</h2><small>one point a minute from the relay, kept 90 days</small>
      <div class="r rl-range">${['24h', '7d', '30d'].map(r => html`<button type="button" class="chip ${r === range ? 'on' : ''}" data-range="${r}">${r}</button>`)}</div></div>
    <div id="rl-hist"><div class="sk" style="height:260px"></div></div>
  </div>

  <div class="g rl-g2 mt20">
    <div class="card flush lit"><div class="card-h" style="padding:20px 22px 0"><h2>${icon('alert')} Alerts</h2><small>problems the relay noticed</small></div><div id="rl-alerts"></div></div>
    <div class="card flush lit"><div class="card-h" style="padding:20px 22px 0"><h2>${icon('pulse')} Connections log</h2><small>connects and drops, newest first</small></div><div id="rl-events" class="rl-events"></div></div>
  </div>`);
}

export function mounted(view, ctx) {
  alive = true;
  ctx?.onLeave?.(() => { alive = false; clearTimeout(pollT); clearTimeout(histT); tip.hide(); });
  paint(D, true);
  loadHistory();
  schedule();

  $('#rl-q', view).addEventListener('input', e => { filter = e.target.value.trim().toLowerCase(); paintConns(); });
  $('#rl-sort', view).addEventListener('change', e => { sortBy = e.target.value; paintConns(); });
  $$('[data-range]', view).forEach(b => b.addEventListener('click', () => {
    range = b.dataset.range;
    $$('[data-range]', view).forEach(x => x.classList.toggle('on', x === b));
    loadHistory();
  }));
  view.addEventListener('click', onClick);
  document.addEventListener('visibilitychange', onVis);
  ctx?.onLeave?.(() => { alive = false; clearTimeout(pollT); clearTimeout(histT); tip.hide(); document.removeEventListener('visibilitychange', onVis); });
}

const onVis = () => { if (!document.hidden && alive) { clearTimeout(pollT); poll(); } };
function schedule() { clearTimeout(pollT); if (alive) pollT = setTimeout(poll, document.hidden ? 30000 : POLL_MS); }
async function poll() {
  if (!alive || !CTX?.isCurrent?.()) return;
  try { const d = await api.get('relay'); if (!alive) return; D = d; paint(d); }
  catch (e) { if (e?.message !== 'Signed out') put($('#rl-banner'), html`<div class="nt warn rl-nt">${icon('alert')}<span>Could not refresh: ${e.message}. Showing the last numbers.</span></div>`); }
  schedule();
}

/* ── one refresh ──────────────────────────────────────────────────── */
function paint(d, first = false) {
  const r = d.relay;
  const banner = $('#rl-banner');
  if (!d.configured) {
    put(banner, html`<div class="nt warn rl-nt">${icon('alert')}<span><b>No relay yet.</b> Set <span class="mono">RELAY_URL</span> and <span class="mono">RELAY_ADMIN_TOKEN</span> on this site.</span></div>`);
    return;
  }
  if (!r) {
    put(banner, html`<div class="nt bad rl-nt">${icon('alert')}<span><b>The relay is not answering.</b> ${d.error || ''} Customers keep their last data until it is back; terminals reconnect by themselves.</span></div>`);
    put($('#rl-kick'), html`<b class="off">Offline</b>&nbsp;· checked ${ago(d.at)}`);
    paintAlerts(d); paintEvents(d);
    return;
  }
  const open = (d.alerts || []).filter(a => !a.resolved_at && a.level !== 'info' && !a.acked_at);
  put(banner, !d.policy?.relay_enabled
    ? html`<div class="nt warn rl-nt">${icon('alert')}<span><b>Live data is off for customers.</b> The relay refuses terminals until it is turned on in <a href="#/market">Market data</a>.</span></div>`
    : open.length ? html`<div class="nt bad rl-nt">${icon('alert')}<span><b>${open.length} open alert${open.length === 1 ? '' : 's'}:</b> ${open[0].message}${open.length > 1 ? ` (+${open.length - 1} more below)` : ''}</span></div>` : '');

  // rolling history (client side)
  const lat = r.latency || {};
  const push = (k, v) => { T[k].push(v ?? null); if (T[k].length > KEEP) T[k].shift(); };
  push('t', new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
  push('people', r.customers); push('conns', r.connections); push('msgs', r.hub?.msgs_out_per_s); push('ticks', r.hub?.ticks_in_per_s);
  push('p50', lat.relay?.p50); push('p95', lat.relay?.p95); push('p99', lat.relay?.p99); push('net', lat.net?.p50); push('cpu', r.server?.cpu);

  const up = r.server?.boot_s, started = r.started ? r.now - r.started : r.hub?.uptime_s;
  put($('#rl-kick'), html`<b>Live</b>&nbsp;· relay ${r.version} · up ${dur(started)} · answered in ${d.ms} ms`);
  put($('#rl-sub'), html`<span class="mono">${d.url}</span>${up ? html` · server up ${dur(up)}` : ''}`);

  paintFlow(r); paintKpis(r); paintPath(r); paintServer(r); paintConns(); paintSymbols(r); paintSockets(r); paintAlerts(d); paintEvents(d);
  if (first) requestAnimationFrame(() => $('#rl-flow')?.classList.add('in'));
}

/* the signature: Dhan → relay → customers, particles at the real rates */
function paintFlow(r) {
  const hub = r.hub || {}, socks = r.sockets || [], conns = r.conns || [];
  const slots = Array.from({ length: 5 }, (_, i) => socks[i] || null);
  const people = [...new Map(conns.map(c => [c.user_id, c])).values()];
  const tin = hub.ticks_in_per_s || 0, out = hub.msgs_out_per_s || 0;
  const speed = v => (v <= 0 ? 0 : Math.max(0.55, 3.2 - Math.log10(v + 1) * 0.9));
  const stream = (v, cls) => { const s = speed(v); return html`<div class="rl-stream ${cls} ${s ? '' : 'still'}" style="--sp:${s || 3}s">${Array.from({ length: 7 }, (_, i) => raw(`<i style="animation-delay:${(-i * (s || 3)) / 7}s"></i>`))}</div>`; };
  const p99 = r.latency?.relay?.p99, t99 = tone(p99, 150, 500);
  const feed = socks.find(s => s.key === 'feed');
  put($('#rl-flow'), html`
    <div class="rl-node rl-dhan">
      <div class="rl-nk">${icon('globe')}Dhan · house account</div>
      <div class="rl-nv">${num(feed?.load || 0)}<small>symbols subscribed</small></div>
      <div class="rl-slots">${slots.map(s => s
        ? html`<span class="rl-slot ${STATE[s.state] || 'mute'}" title="${s.label}: ${s.state}${s.reconnects ? ` · ${s.reconnects} reconnects` : ''}"><i></i>${s.key === 'feed' ? 'Feed' : s.key === 'depth20' ? '20L' : '200L'}</span>`
        : html`<span class="rl-slot free" title="Free: Dhan allows 5 sockets per account"><i></i>free</span>`)}</div>
    </div>
    <div class="rl-pipe">${stream(tin, 'in')}<div class="rl-pl"><b>${rate(tin)}</b> ticks/s in</div></div>
    <div class="rl-node rl-core ${t99}">
      <div class="rl-orb"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" pathLength="100" class="tr"/><circle cx="50" cy="50" r="44" pathLength="100" class="va" style="stroke-dasharray:${Math.min(100, r.server?.relay_cpu || 0)} 100"/></svg>
        <div><b>${p99 == null ? '—' : Math.round(p99)}</b><span>ms p99</span></div></div>
      <div class="rl-nk">Relay · ${r.server?.relay_cpu == null ? '' : `${Math.round(r.server.relay_cpu)}% of a core`}</div>
    </div>
    <div class="rl-pipe">${stream(out, 'out')}<div class="rl-pl"><b>${rate(out)}</b> messages/s out</div></div>
    <div class="rl-node rl-people">
      <div class="rl-nk">${icon('users')}Terminals</div>
      <div class="rl-nv">${num(r.customers)}<small>${r.customers === 1 ? 'person' : 'people'} · ${num(r.connections)} socket${r.connections === 1 ? '' : 's'}</small></div>
      <div class="rl-faces">${people.slice(0, 14).map(c => html`<a href="#/users/${c.user_id}" title="${c.name}${c.city ? ` · ${c.city}` : ''}">${avatar(c.name, 'sm')}</a>`)}${people.length > 14 ? html`<span class="rl-more">+${people.length - 14}</span>` : ''}${people.length ? '' : html`<span class="rl-none">Nobody connected</span>`}</div>
    </div>`);
}

function paintKpis(r) {
  const hub = r.hub || {}, lat = r.latency || {}, p99 = lat.relay?.p99, cap = r.server?.capacity || {};
  const tile = (label, ic, value, sub, spark, color, extra = '') => html`<div class="card kpi lit rl-kpi ${extra}"><div class="kpi-l">${icon(ic)}${label}</div>
    <div class="kpi-v">${value}</div><div class="kpi-d">${sub}</div><div class="kpi-s">${raw(spark ? liveSpark(spark, color) : '')}</div></div>`;
  put($('#rl-kpis'), html`
    ${tile('People online', 'users', num(r.customers), html`<span>${cap.more != null ? `room for ~${num(cap.more)} more` : 'connected now'}</span>`, T.people, 'var(--c1)')}
    ${tile('Open sockets', 'monitor', num(r.connections), html`<span>${num(hub.lingering || 0)} symbols lingering</span>`, T.conns, 'var(--c4)')}
    ${tile('Symbols live', 'eye', num(r.instruments), html`<span>${num(hub.depth20_books || 0)} with 20-level · ${num(hub.deep_books || 0)} with 200-level</span>`, null)}
    ${tile('Messages / s', 'send', rate(hub.msgs_out_per_s), html`<span>${rate(hub.ticks_in_per_s)} ticks/s from Dhan</span>`, T.msgs, 'var(--c2)')}
    ${tile('Delay p99', 'clock', p99 == null ? '—' : html`${Math.round(p99)}<small>ms</small>`, html`<b class="${p99 == null ? 'flat' : p99 > 500 ? 'down' : p99 > 150 ? 'flat' : 'rise'}">${p99 == null ? 'idle' : p99 > 500 ? 'slow' : p99 > 150 ? 'ok' : 'fast'}</b><span>p50 ${ms(lat.relay?.p50)}</span>`, T.p99, TONE_C[tone(p99, 150, 500)])}`);
}

function paintPath(r) {
  const p = r.latency?.path_p50 || {}, lat = r.latency || {};
  const parts = [['Exchange → relay ≈', p.exchange, 'var(--c3)', 'From the trade on the exchange to the relay. Dhan stamps trades in whole seconds, so this is an estimate (±0.5 s): watch its trend, not one value'],
    ['Inside the relay', p.relay, 'var(--c2)', 'Waiting in a customer\'s queue before being sent'],
    ['Relay → customer', p.network, 'var(--c4)', 'Half the ping round trip to the terminal']];
  const known = parts.filter(x => x[1] != null), total = known.reduce((a, x) => a + x[1], 0);
  put($('#rl-path'), html`<div class="rl-path">
      <div class="rl-tot"><b>${known.length ? ms(total) : '—'}</b><span>end to end, median</span></div>
      <div class="rl-bar">${known.length ? known.map(([l, v, c]) => html`<i style="--w:${Math.max(4, (v / (total || 1)) * 100)}%;--c:${raw(c)}" title="${l}: ${ms(v)}"></i>`) : html`<i style="--w:100%;--c:var(--line)"></i>`}</div>
      <div class="rl-parts">${parts.map(([l, v, c, t]) => html`<div style="--c:${raw(c)}" title="${t}"><i></i><span>${l}</span><b>${ms(v)}</b></div>`)}</div></div>`);
  liveLines($('#rl-delay-ch'), { labels: T.t, series: [
    { name: 'p50 in relay', values: T.p50, color: 'var(--c2)' }, { name: 'p95', values: T.p95, color: 'var(--c1)' },
    { name: 'p99', values: T.p99, color: 'var(--c3)' }, { name: 'network p50', values: T.net, color: 'var(--c4)', dash: true }] });
  const chip = (l, v) => html`<span class="rl-chip"><span>${l}</span><b>${v}</b></span>`;
  put($('#rl-delay-chips'), html`${chip('Relay max', ms(lat.relay?.max))}${chip('Network p95', ms(lat.net?.p95))}${chip('Network worst', ms(lat.net?.max))}${chip('Exchange lag p95', ms(lat.feed_lag?.p95))}${chip('Slow drops', num(r.hub?.dropped_slow || 0))}${chip('Replaced', num(r.hub?.kicked || 0))}`);
}

function paintServer(r) {
  const s = r.server || {}, cap = s.capacity || {};
  put($('#rl-srv-sub'), html`${s.cores ? `${s.cores} CPU · ${num(s.mem_total_mb)} MB` : ''}`);
  if (!s.at) return put($('#rl-server'), html`<div class="empty-s">${icon('monitor')}The relay does not report server numbers yet (update it to 1.2).</div>`);
  const capPct = cap.more != null && r.customers != null ? Math.round(100 * r.customers / (r.customers + cap.more || 1)) : null;
  put($('#rl-server'), html`
    <div class="rl-gauges">
      ${gauge(s.cpu, 'CPU', `relay ${Math.round(s.relay_cpu || 0)}% of a core`)}
      ${gauge(s.mem, 'Memory', `${num(s.mem_used_mb)} / ${num(s.mem_total_mb)} MB`, 75, 90)}
      ${gauge(s.disk, 'Disk', `${s.disk_free_gb} GB free`, 75, 90)}
      ${gauge(capPct, 'Capacity', cap.more != null ? `~${num(cap.more)} more customers` : 'estimating', 60, 85)}
    </div>
    <div class="rl-srv">
      <div><span>${icon('download')}Network in</span><b>${kb(s.net_in_kbs)}</b><small>${num(s.net_in_total_mb)} MB since boot</small></div>
      <div><span>${icon('send')}Network out</span><b>${kb(s.net_out_kbs)}</b><small>${num(s.net_out_total_mb)} MB since boot</small></div>
      <div><span>${icon('db')}Database</span><b class="${s.db_ms == null ? 'bad' : ''}">${s.db_ms == null ? 'unreachable' : ms(s.db_ms)}</b><small>round trip from the relay</small></div>
      <div><span>${icon('pulse')}Relay memory</span><b>${num(s.relay_mb)} MB</b><small>${s.fds != null ? `${num(s.fds)} open files` : ''}${s.load ? ` · load ${s.load[0]}` : ''}</small></div>
    </div>
    <div class="rl-cpu-ch" id="rl-cpu-ch"></div>
    <p class="mini rl-note">${cap.measured ? 'Capacity is measured from the relay\'s own CPU per connected customer.' : 'Capacity is estimated from the load test (1000 customers ≈ 93 % of one core) until enough customers are online to measure it.'}</p>`);
  liveLines($('#rl-cpu-ch'), { labels: T.t, height: 90, fmt: v => `${Math.round(v)}%`, series: [{ name: 'CPU', values: T.cpu, color: 'var(--c1)' }] });
}

function paintConns() {
  const r = D?.relay; if (!r) return;
  let rows = (r.conns || []).slice();
  if (filter) rows = rows.filter(c => [c.name, c.client_id, c.ip, c.city, c.pc_label, ...(c.symbols || [])].some(v => String(v || '').toLowerCase().includes(filter)));
  const sorters = { subs: (a, b) => b.subs - a.subs, msgs: (a, b) => b.msgs_s - a.msgs_s, rtt: (a, b) => (b.rtt_ms || 0) - (a.rtt_ms || 0), for: (a, b) => b.for_s - a.for_s, new: (a, b) => a.for_s - b.for_s };
  rows.sort(sorters[sortBy] || sorters.subs);
  const maxRtt = Math.max(50, ...rows.map(c => c.rtt_ms || 0));
  put($('#rl-conn-sub'), html`${num(r.connections)} open · ${num(r.customers)} people${filter ? ` · ${rows.length} match` : ''}`);
  put($('#rl-conns'), rows.length ? html`<table class="tbl rl-tbl"><thead><tr><th>Customer</th><th>PC</th><th>Network</th><th>Connected</th><th>Watching</th><th class="r">Flow</th><th class="r">Wait</th><th></th></tr></thead><tbody>
    ${rows.slice(0, 300).map(c => html`<tr>
      <td><a class="rl-who" href="#/users/${c.user_id}">${avatar(c.name, 'sm')}<span><b>${c.name}</b><small class="mono">${c.client_id || c.user_id}${c.city ? ` · ${c.city}` : ''}</small></span></a></td>
      <td><span class="rl-pc"><b>${c.pc_label || 'PC'}</b><small class="mono">v${c.version}${c.os ? ` · ${c.os}` : ''}</small></span></td>
      <td><span class="rl-net"><span class="mono">${c.ip || '—'}</span><span class="rl-rtt" style="--w:${c.rtt_ms ? Math.min(100, (c.rtt_ms / maxRtt) * 100) : 0}%;--c:${raw(TONE_C[tone(c.rtt_ms, 150, 400)])}"><i></i><em>${c.rtt_ms ? `${Math.round(c.rtt_ms)} ms` : 'measuring'}</em></span></span></td>
      <td class="nw" title="since ${dtime(c.since * 1000)}">${dur(c.for_s)}</td>
      <td><span class="rl-watch" title="${(c.symbols || []).join(', ')}"><b>${num(c.subs)}</b> symbols${c.depth ? html` · <em>${c.depth} books</em>` : ''}${c.deep ? html` · <em class="d2">200L</em>` : ''}<small>${(c.symbols || []).slice(0, 3).join(' · ')}${c.subs > 3 ? ' …' : ''}</small></span></td>
      <td class="r nw mono">${rate(c.msgs_s)}/s${c.queue ? html`<small class="rl-q">${num(c.queue)} queued</small>` : ''}</td>
      <td class="r nw mono">${ms(c.wait_ms)}</td>
      <td class="r nw"><button type="button" class="btn btn-sm btn-quiet" data-kick="${c.id}" title="Close this socket; the terminal reconnects within a second">${icon('refresh')}</button></td>
    </tr>`)}</tbody></table>${rows.length > 300 ? html`<p class="mini" style="padding:10px 22px">Showing 300 of ${num(rows.length)}. Search to narrow down.</p>` : ''}`
    : html`<div class="empty-s">${icon('users')}${filter ? 'Nobody matches that search' : 'No terminal is connected right now'}</div>`);
}

function paintSymbols(r) {
  const s = r.symbols || [], lim = r.limits || {};
  put($('#rl-sym-sub'), html`${num(r.instruments)} of ${num(lim.feed || 5000)} on the feed`);
  if (!s.length) return put($('#rl-syms'), html`<div class="empty-s">${icon('eye')}Nobody is watching anything right now</div>`);
  const max = Math.max(1, ...s.map(x => x.viewers)), list = showAllSym ? s : s.slice(0, 14);
  put($('#rl-syms'), html`<div class="rl-syms">${list.map((x, i) => html`<div class="rl-sym">
      <span class="rl-rank">${i + 1}</span>
      <span class="rl-sn"><b title="${x.k}">${x.name}</b><small class="mono">${x.k}</small></span>
      <span class="rl-sb"><i style="--w:${(x.viewers / max) * 100}%;--h:${hue(x.name)}"></i></span>
      <span class="rl-sv"><b>${num(x.viewers)}</b><small>watching</small></span>
      <span class="rl-st mono">${rate(x.ticks_s)}/s<small class="${x.last_s == null ? '' : x.last_s < 5 ? 'fresh' : x.last_s < 60 ? 'warm' : 'cold'}">${x.last_s == null ? 'no tick yet' : `${dur(x.last_s)} ago`}</small></span>
      <span class="rl-tags">${x.full ? html`<em title="${x.full} want 5-level depth">5L</em>` : ''}${x.depth20 ? html`<em title="${x.depth20} on the 20-level book">20L</em>` : ''}${x.deep ? html`<em class="d2" title="${x.deep} on the 200-level book">200L</em>` : ''}</span>
    </div>`)}</div>
    ${s.length > 14 ? html`<button type="button" class="rl-all" data-syms>${showAllSym ? 'Show fewer' : `Show all ${num(s.length)}`}</button>` : ''}`);
}

function paintSockets(r) {
  const socks = r.sockets || [];
  const slots = Array.from({ length: 5 }, (_, i) => socks[i] || null);
  put($('#rl-sockets'), html`<div class="rl-socks">${slots.map(s => s ? html`<div class="rl-sock ${STATE[s.state] || 'mute'}">
      <div class="rl-sh"><i></i><b>${s.label}</b><span class="st-pill ${STATE[s.state] || 'mute'}">${s.state}</span></div>
      <div class="rl-sm"><span>${s.state === 'connected' ? 'up' : 'for'} ${dur(s.for_s)}</span><span>${num(s.reconnects)} reconnect${s.reconnects === 1 ? '' : 's'}</span><span>${s.last_msg_s == null ? 'no data yet' : `last data ${dur(s.last_msg_s)} ago`}</span></div>
      <div class="rl-load" title="${num(s.load)} of ${num(s.cap)}"><i style="--w:${Math.min(100, (s.load / (s.cap || 1)) * 100)}%"></i><span>${num(s.load)} / ${num(s.cap)}</span></div>
    </div>` : html`<div class="rl-sock free"><div class="rl-sh"><i></i><b>Free socket</b></div><div class="rl-sm"><span>Dhan allows 5 per account. Add a 200-level book to use it.</span></div></div>`)}</div>`);

  const t = r.house_token || {}, left = t.expires_in_min;
  const tt = !t.token ? 'bad' : left == null ? 'mute' : left <= 0 ? 'bad' : left < 120 ? 'warn' : 'ok';
  const pctLeft = left == null ? 0 : Math.max(0, Math.min(100, (left / (24 * 60)) * 100));
  put($('#rl-token'), html`<div class="rl-tok ${tt}">
      <div class="rl-tk-h"><span>${icon('key')}Dhan token ${t.client ? html`<span class="mono">${t.client}</span>` : ''}</span><span class="st-pill ${tt}">${!t.token ? 'none' : left <= 0 ? 'expired' : left < 120 ? 'expiring' : 'valid'}</span></div>
      <div class="rl-tk-bar"><i style="--w:${pctLeft}%"></i></div>
      <div class="rl-tk-f"><span>${left == null ? 'No expiry known' : left <= 0 ? 'Expired' : `${Math.floor(left / 60)} h ${left % 60} min left`}</span><span>${t.auto_renew ? 'renews by itself' : html`<a href="#/market">paste a fresh one daily</a>`}${t.renew_error ? html` · <b class="bad">${t.renew_error}</b>` : ''}</span></div></div>`);

  const rest = r.rest || {}, fam = rest.families || {};
  const F = [['data', 'Charts'], ['quote', 'Quotes'], ['chain', 'Option chain']];
  const hitPct = f => (f && f.requests ? Math.round((Math.min(f.hits, f.requests) / f.requests) * 100) : null);
  const all = rest.requests ? Math.round(100 * (1 - (rest.dhan_calls || 0) / rest.requests)) : null;
  put($('#rl-rest'), html`<div class="rl-rest">
      <div class="rl-ring" style="--p:${all == null ? 0 : Math.max(0, all)}"><svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="34" pathLength="100" class="tr"/><circle cx="40" cy="40" r="34" pathLength="100" class="va"/></svg><div><b>${all == null ? '—' : `${Math.max(0, all)}%`}</b><span>never reached Dhan</span></div></div>
      <div class="rl-fams">${F.map(([k, l]) => { const f = fam[k] || {}, h = hitPct(f); return html`<div><span>${l}</span><b>${num(f.requests || 0)}</b><small>${h == null ? 'no requests yet' : `${h}% shared or cached · ${num(f.dhan || 0)} to Dhan`}</small></div>`; })}
        <div><span>Dhan answers in</span><b>${ms(rest.dhan_ms?.p50)}</b><small>p95 ${ms(rest.dhan_ms?.p95)} · ${num(rest.dhan_429 || 0)} rate-limited · queue ${Math.max(...Object.values(rest.backlog_s || { a: 0 }))} s</small></div></div></div>`);
}

function paintAlerts(d) {
  const live = (d.relay?.alerts || []).map(a => ({ ...a, live: true, started_at: a.since * 1000 }));
  const db = d.alerts || [];
  const kinds = new Set(db.filter(a => !a.resolved_at).map(a => a.kind));
  const list = [...live.filter(a => !kinds.has(a.kind)), ...db];
  put($('#rl-alerts'), list.length ? html`<div class="rl-alerts">${list.slice(0, 20).map(a => html`<div class="rl-al ${a.resolved_at ? 'done' : a.level}">
      <span class="rl-al-ic">${icon(a.resolved_at ? 'check' : a.level === 'info' ? 'info' : 'alert')}</span>
      <div><b>${a.message}</b><small>${a.resolved_at ? `cleared ${ago(a.resolved_at)} · lasted ${dur((new Date(a.resolved_at) - new Date(a.started_at)) / 1000)}` : `since ${ago(a.started_at)}`}${a.acked_at ? ' · acknowledged' : ''}${a.notified_at ? ' · emailed' : ''}</small></div>
      ${!a.resolved_at && !a.acked_at && a.id ? html`<button type="button" class="btn btn-sm btn-quiet" data-ack="${a.id}">${icon('check')}OK</button>` : ''}
    </div>`)}</div>` : html`<div class="empty-s">${icon('shield')}All clear. The relay has nothing to report.</div>`);
}

function paintEvents(d) {
  const ev = d.events || [];
  put($('#rl-events'), ev.length ? html`<div class="feed">${ev.map(e => {
    const k = e.event === 'relay_connect' ? 'ok' : e.event === 'denied' ? 'bad' : e.reason === 'CLOSED' ? 'mute' : 'warn';
    const what = e.event === 'relay_connect' ? 'connected' : e.event === 'denied' ? `refused · ${reason(e.reason?.replace(/^RELAY_/, 'RELAY_'))}` : reason(e.reason);
    const secs = e.details?.secs;
    return html`<div class="feed-i rl-ev ${k}"><span class="feed-ic">${icon(e.event === 'relay_connect' ? 'zap' : e.event === 'denied' ? 'ban' : 'out')}</span>
      <div class="feed-t">${e.user_id ? html`<a href="#/users/${e.user_id}"><b>${e.full_name || 'Someone'}</b></a>` : html`<b>Unknown</b>`} · ${what}
        <small>${[e.client_id, e.ip, e.app_version ? `v${e.app_version}` : null, secs != null ? `stayed ${dur(secs)}` : null].filter(Boolean).join(' · ')}</small></div>
      <span class="feed-w" title="${dtime(e.at)}">${ago(e.at)}</span></div>`;
  })}</div>` : html`<div class="empty-s">${icon('pulse')}No connections yet</div>`);
}

/* ── history (relay_stats) ────────────────────────────────────────── */
async function loadHistory() {
  clearTimeout(histT);
  try { H = await api.get('relayHistory', { range }); if (alive) paintHistory(); }
  catch (e) { if (alive) put($('#rl-hist'), html`<div class="nt warn">${icon('alert')}<span>${e.message}</span></div>`); }
  if (alive) histT = setTimeout(loadHistory, 60000);
}

function paintHistory() {
  const h = H, s = h.series || [];
  const lab = s.map(x => x.t), fmtT = (t, long) => new Date(t).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', ...(range === '24h' ? { hour: '2-digit', minute: '2-digit', hour12: false } : { day: 'numeric', month: 'short', ...(long ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}) }) });
  const peak = Math.max(0, ...s.map(x => x.peak || 0));
  const custHours = s.reduce((a, x) => a + (x.customers || 0), 0) * ({ '24h': 10, '7d': 60, '30d': 360 }[range] / 60);
  const drops = (h.drops || []).reduce((a, x) => a + x.n, 0);
  const avg = k => { const v = s.map(x => x[k]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  put($('#rl-hist'), s.length ? html`
    <div class="rl-hk">
      <div><span>Peak people online</span><b>${num(peak)}</b></div>
      <div><span>Customer hours</span><b>${num(custHours)}</b></div>
      <div><span>Average delay p50</span><b>${ms(avg('delay_p50'))}</b></div>
      <div><span>Average CPU</span><b>${avg('cpu') == null ? '—' : `${Math.round(avg('cpu'))}%`}</b></div>
      <div><span>Disconnects</span><b>${num(drops)}</b></div>
    </div>
    <div class="g rl-g2">
      <div><div class="rl-ht">People online</div><div id="rl-h-people"></div></div>
      <div><div class="rl-ht">Delay</div><div id="rl-h-delay"></div></div>
    </div>
    <div class="g rl-g2 mt20">
      <div><div class="rl-ht">Messages per second</div><div id="rl-h-msgs"></div></div>
      <div><div class="rl-ht">Server</div><div id="rl-h-cpu"></div></div>
    </div>
    <div class="g g3 mt20 rl-g3">
      <div><div class="rl-ht">Why people disconnected</div><div id="rl-h-drops"></div></div>
      <div><div class="rl-ht">Busiest times · last 30 days</div><div id="rl-h-heat"></div></div>
      <div><div class="rl-ht">Most time on live data</div><div id="rl-h-top"></div></div>
    </div>
    <div class="rl-ht mt20">Day by day</div>
    <div class="dt-w"><table class="tbl"><thead><tr><th>Day</th><th class="r">People</th><th class="r">Connections</th><th class="r">Peak online</th><th class="r">Customer hours</th><th class="r">Messages sent</th><th class="r">Delay p99</th><th class="r">CPU</th></tr></thead><tbody>
      ${(h.days || []).slice(0, 30).map(x => html`<tr><td class="nw">${new Date(x.day).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
        <td class="r mono">${num(x.users)}</td><td class="r mono">${num(x.connects)}</td><td class="r mono">${x.peak == null ? '—' : num(x.peak)}</td>
        <td class="r mono">${x.customer_hours == null ? '—' : x.customer_hours}</td><td class="r mono">${x.msgs == null ? '—' : num(x.msgs)}</td>
        <td class="r mono">${ms(x.delay_p99)}</td><td class="r mono">${x.cpu == null ? '—' : `${x.cpu}%`}</td></tr>`)}
    </tbody></table></div>`
    : html`<div class="empty-s">${icon('trend')}<b style="color:var(--bone)">No history yet</b><span>The relay saves one point a minute once it runs version 1.2 on a database with 11_relay_monitor.sql.</span></div>`);
  if (!s.length) return;
  lineChart($('#rl-h-people'), { labels: lab, xfmt: fmtT, height: 200, series: [{ name: 'Peak', values: s.map(x => x.peak || 0), color: 'var(--c1)' }, { name: 'Average', values: s.map(x => Math.round((x.customers || 0) * 10) / 10), color: 'var(--c4)', area: false }] });
  lineChart($('#rl-h-delay'), { labels: lab, xfmt: fmtT, height: 200, fmt: ms, series: [{ name: 'p99 in relay', values: s.map(x => x.delay_p99 || 0), color: 'var(--c3)' }, { name: 'p50 in relay', values: s.map(x => x.delay_p50 || 0), color: 'var(--c2)', area: false }, { name: 'Network p50', values: s.map(x => x.net_p50 || 0), color: 'var(--c4)', area: false, dash: true }] });
  barChart($('#rl-h-msgs'), { labels: lab, xfmt: fmtT, height: 180, fmt: v => rate(v), series: [{ name: 'Messages/s out', values: s.map(x => Math.round(x.msgs_out || 0)), color: 'var(--c2)' }] });
  lineChart($('#rl-h-cpu'), { labels: lab, xfmt: fmtT, height: 180, fmt: v => `${Math.round(v)}%`, minMax: 100, series: [{ name: 'CPU peak', values: s.map(x => x.cpu_max || 0), color: 'var(--c3)' }, { name: 'CPU', values: s.map(x => x.cpu || 0), color: 'var(--c1)', area: false }, { name: 'Memory', values: s.map(x => x.mem || 0), color: 'var(--c4)', area: false }] });
  const DC = ['var(--c1)', 'var(--c3)', 'var(--c2)', 'var(--c4)', 'var(--red)', 'var(--ash)'];
  (h.drops || []).length ? donut($('#rl-h-drops'), { parts: h.drops.slice(0, 6).map((x, i) => ({ label: reason(x.reason), value: x.n, color: DC[i % DC.length] })), sub: 'disconnects' })
    : put($('#rl-h-drops'), html`<div class="ch-empty">No disconnects</div>`);
  heatmap($('#rl-h-heat'), (h.heat || []).map(x => ({ dow: x.dow, hr: x.hr, n: Math.round(x.n * 10) })), { label: '×0.1 people online on average' });
  barList($('#rl-h-top'), (h.top || []).map(x => ({ label: x.full_name || x.client_id, value: x.secs, user_id: x.user_id })), { fmt: v => dur(v), onClick: x => CTX?.nav?.(`#/users/${x.user_id}`) });
}

/* ── actions ──────────────────────────────────────────────────────── */
async function onClick(e) {
  const b = e.target.closest('button, [data-act]'); if (!b) return;
  if (b.dataset.syms != null) { showAllSym = !showAllSym; paintSymbols(D.relay); return; }
  if (b.dataset.kick) {
    const c = D.relay?.conns?.find(x => String(x.id) === b.dataset.kick);
    if (!await confirmBox(`Reconnect ${c?.name || 'this terminal'}?`, 'Its live-data socket closes and the terminal reconnects by itself within a second. Use it when one customer is stuck.', { label: 'Reconnect' })) return;
    return act(b, () => api.do('relayKick', { conn_ids: [Number(b.dataset.kick)] }), 'Reconnecting').then(() => setTimeout(poll, 1200), () => {});
  }
  if (b.dataset.ack) return act(b, () => api.do('relayAlertAck', b.dataset.ack), 'Acknowledged').then(poll, () => {});
  const a = b.dataset.act;
  if (a === 'restart') {
    if (!await confirmBox('Restart the Dhan connection?', 'The relay closes its Dhan sockets and opens them again at once. Customers see a pause of a second or two. Use it when prices look stuck.', { label: 'Restart' })) return;
    return act(b, () => api.do('relayRestart'), r => `Restarted ${r?.closed ?? 0} Dhan socket${r?.closed === 1 ? '' : 's'}`).then(() => setTimeout(poll, 1500), () => {});
  }
  if (a === 'kick-all') {
    if (!await confirmBox('Reconnect every terminal?', `All ${num(D.relay?.connections || 0)} sockets close and every terminal reconnects by itself within a few seconds.`, { label: 'Reconnect everyone', danger: true })) return;
    return act(b, () => api.do('relayKick', { all: true }), r => `Reconnecting ${num(r?.closed || 0)} terminals`).then(() => setTimeout(poll, 1500), () => {});
  }
  if (a === 'deep') {
    const cur = D.policy?.relay_deep, def = (D.relay?.limits?.deep_default || []).join(', ') || 'none';
    const r = await modal({ title: '200-level order books', text: 'Dhan streams 200 levels for one book per socket, and allows 5 sockets in all: the live feed, the 20-level books, and up to 3 of these. Index futures roll to the next month by themselves.',
      body: html`<div class="fld wide"><label>Books (up to 3, comma separated)</label><input name="spec" class="mono" value="${cur ?? ''}" placeholder="${def}"></div>
        <div class="rl-presets">${['NIFTY-FUT', 'BANKNIFTY-FUT', 'FINNIFTY-FUT', 'MIDCPNIFTY-FUT', 'SENSEX-FUT'].map(p => html`<button type="button" class="chip" data-preset="${p}">${p}</button>`)}</div>
        <p class="mini">Empty = the relay's default (${def}). Customers' terminals switch within about 15 seconds.</p>`,
      actions: [{ label: 'Cancel', value: null, cls: 'btn-quiet' }, { label: 'Save', submit: true, cls: 'btn-gold' }],
      onOpen: f => $$('[data-preset]', f).forEach(p => p.addEventListener('click', () => {
        const inp = f.elements.spec, have = inp.value.split(',').map(s => s.trim()).filter(Boolean);
        if (!have.includes(p.dataset.preset)) inp.value = [...have, p.dataset.preset].slice(-3).join(', ');
      })),
      submit: o => api.do('relayDeep', o.spec.trim() ? o.spec : 'default') });
    if (r) { toast('200-level list saved'); D.policy = { ...D.policy, relay_deep: r.relay_deep }; setTimeout(poll, 1500); }
  }
}
