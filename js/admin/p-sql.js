'use strict';
/* SQL console: read-only by default; writes need the switch on and a confirm. */
import { $, $$, api, html, put, icon, num, esc, toast, fail, confirmBox, csv } from './core.js';

const SNIPPETS = [
  ['Customers', `SELECT client_id, full_name, email, plan_name, subscription_status, days_left, lifetime_paid_inr\n  FROM v_user_overview WHERE role = 'customer' ORDER BY client_id;`],
  ['Revenue by month', `SELECT to_char(created_at, 'YYYY-MM') AS month, count(*) AS orders, sum(total) AS revenue\n  FROM orders WHERE status = 'paid' GROUP BY 1 ORDER BY 1 DESC;`],
  ['Ending this week', `SELECT u.client_id, u.full_name, s.plan_code, s.status, eimc.access_until(s) AS access_until\n  FROM subscriptions s JOIN users u ON u.id = s.user_id\n WHERE s.is_current AND eimc.access_until(s) < now() + interval '7 days' ORDER BY 5;`],
  ['Failed sign-ins', `SELECT login_id, host(ip_address) AS ip, count(*) AS tries, max(at) AS last\n  FROM login_history WHERE NOT success GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 50;`],
  ['Admin changes', `SELECT at, action, user_id, details FROM audit_log WHERE actor = 'admin' ORDER BY at DESC LIMIT 100;`],
  ['Table sizes', `SELECT relname AS table, n_live_tup AS rows, pg_size_pretty(pg_total_relation_size(relid)) AS size\n  FROM pg_stat_user_tables WHERE schemaname = 'eimc' ORDER BY pg_total_relation_size(relid) DESC;`],
];
let last = sessionStorage.getItem('admin.sql') || SNIPPETS[0][1];

export async function render(root) {
  put(root, html`
  <div class="ph"><div><h1>SQL <em>console</em></h1><p>Runs against the live database, schema <code class="src">eimc</code>. Read-only unless you switch writes on. 15-second limit, 1,000 rows shown.</p></div></div>
  <div class="card lit">
    <div class="sql-x">${SNIPPETS.map(([l], i) => html`<button type="button" data-snip="${i}">${l}</button>`)}</div>
    <div class="sql-ed mt12"><textarea id="sql" spellcheck="false" autocapitalize="off" aria-label="SQL">${last}</textarea></div>
    <div class="sql-bar">
      <label class="sw" title="Allow INSERT / UPDATE / DELETE"><input type="checkbox" id="wr"><i></i></label><span class="mini" id="wr-l">Read-only: changes are blocked</span>
      <div class="btns"><span class="mini">Ctrl + Enter to run</span><button type="button" class="btn btn-gold" id="run">${icon('play')}Run</button></div>
    </div>
  </div>
  <div id="out" class="mt20"></div>`);
}

export function mounted(view) {
  const ta = $('#sql', view), wr = $('#wr', view), lab = $('#wr-l', view);
  wr.addEventListener('change', () => { lab.textContent = wr.checked ? 'Writes ON: statements will change live data' : 'Read-only: changes are blocked'; lab.classList.toggle('write-on', wr.checked); });
  $$('[data-snip]', view).forEach(b => b.addEventListener('click', () => { ta.value = SNIPPETS[+b.dataset.snip][1]; ta.focus(); }));
  ta.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
    if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); }
  });
  $('#run', view).addEventListener('click', run);

  async function run() {
    const sql = ta.value.trim(); if (!sql) return;
    sessionStorage.setItem('admin.sql', sql); last = sql;
    if (wr.checked && !await confirmBox('Run with writes on?', 'Any INSERT, UPDATE, DELETE or DDL in this query is committed to the live database, and the statement is saved to the audit log.', { label: 'Run and commit', danger: true })) return;
    const b = $('#run', view); b.classList.add('busy');
    const out = $('#out', view);
    try {
      const r = await api.sql(sql, wr.checked);
      if (!r.ok) {
        put(out, html`<div class="sql-err">${r.error}${r.detail ? `\n${r.detail}` : ''}${r.hint ? `\nHint: ${r.hint}` : ''}${r.position ? `\nAt character ${r.position}` : ''}</div>`);
      } else {
        put(out, html`${r.results.map((x, k) => html`<div class="card dt mt12">
          <div class="dt-bar"><span class="st-pill ${x.command === 'SELECT' ? 'info' : 'warn'}">${x.command || 'OK'}</span><span class="mini">${x.fields.length ? `${num(x.rows.length)} row${x.rows.length === 1 ? '' : 's'}${x.truncated ? ' (first 1,000)' : ''}` : `${num(x.rowCount ?? 0)} row${x.rowCount === 1 ? '' : 's'} affected`} · ${r.ms} ms${r.write ? ' · committed' : ''}</span>
            ${x.fields.length ? html`<button type="button" class="btn btn-sm btn-quiet" data-csv="${k}" style="margin-left:auto">${icon('download')}CSV</button>` : ''}</div>
          ${x.fields.length ? html`<div class="dt-w" style="max-height:560px;overflow:auto"><table class="tbl"><thead><tr>${x.fields.map(f => html`<th>${f}</th>`)}</tr></thead>
            <tbody>${x.rows.map((row, i) => html`<tr style="animation-delay:${Math.min(i, 14) * 12}ms">${row.map(v => html`<td><span class="cell ${v === null ? 'null' : v === true ? 't' : v === false ? 'f' : ''}" title="${v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)}">${v === null ? 'null' : typeof v === 'object' ? JSON.stringify(v) : String(v)}</span></td>`)}</tr>`)}</tbody></table></div>` : ''}
        </div>`)}`);
        $$('[data-csv]', out).forEach(c => c.addEventListener('click', () => { const x = r.results[+c.dataset.csv]; csv('eimc-query', x.fields, x.rows.map(row => Object.fromEntries(x.fields.map((f, i) => [f, row[i]])))); }));
        if (r.write) toast('Committed');
      }
    } catch (e) { fail(e); }
    b.classList.remove('busy');
  }
}
