'use strict';
/* Database: browse, search, edit, add and delete rows in any eimc table. */
import { $, $$, api, html, put, icon, num, esc, toast, fail, modal, confirmBox, debounce, csv } from './core.js';

let meta, cur, state = { page: 0, search: '', sort: null, dir: 'desc' };
const SECRET = /^(password_hash|token_hash|provider_token|totp_secret_enc|reset_token_hash|email_verify_token_hash)$/;

export async function render(root, ctx) {
  meta = await api.get('tables');
  const name = ctx.params[0] || 'users';
  if (!cur || cur.name !== name) state = { page: 0, search: '', sort: null, dir: 'desc' };
  cur = await api.get('table', { name, page: state.page, search: state.search, ...(state.sort ? { sort: state.sort, dir: state.dir } : {}) });
  ctx.crumb({ label: 'Database', href: '#/db' }, { label: name });
  const total = meta.tables.reduce((a, t) => a + t.rows, 0);
  put(root, html`
  <div class="ph"><div><h1>Database <em>explorer</em></h1><p>Schema <code class="src">eimc</code> · ${meta.tables.length} tables · ${num(total)} rows. Edits go straight to the live data.</p></div>
    <div class="btns"><a class="btn btn-sm" href="#/sql">${icon('code')}SQL console</a></div></div>
  <div class="db">
    <nav class="card db-t">
      <div class="sb-g">Tables</div>
      ${meta.tables.map(t => html`<a href="#/db/${t.name}" class="${t.name === name ? 'on' : ''}">${icon('table')}${t.name}<em>${num(t.rows)}</em></a>`)}
      <div class="sb-g">Views (read-only)</div>
      ${meta.views.map(v => html`<a href="#/db/${v}" class="${v === name ? 'on' : ''}">${icon('eye')}${v}</a>`)}
    </nav>
    <div id="dbt"></div>
  </div>`);
}

export function mounted(view, ctx) { grid(view, ctx); }

function cell(v, col) {
  if (v === null || v === undefined) return html`<span class="cell null">null</span>`;
  if (SECRET.test(col)) return html`<span class="cell" title="hidden">••••••${esc(String(v).slice(-4))}</span>`;
  if (typeof v === 'boolean') return html`<span class="cell ${v ? 't' : 'f'}">${String(v)}</span>`;
  if (typeof v === 'object') return html`<span class="cell" title="${JSON.stringify(v)}">${JSON.stringify(v)}</span>`;
  return html`<span class="cell" title="${String(v)}">${String(v)}</span>`;
}

function grid(view, ctx) {
  const host = $('#dbt', view), t = cur;
  const cols = t.columns, pks = cols.filter(c => c.pk);
  const pages = Math.max(1, Math.ceil(t.total / t.limit));
  put(host, html`<div class="card dt">
    <div class="dt-bar"><label class="dt-q">${icon('search')}<input type="search" value="${state.search}" placeholder="Search every column of ${t.name}…"></label>
      <span class="mini">${num(t.total)} rows${t.view ? ' · view' : ''}${pks.length ? ` · key: ${pks.map(c => c.column_name).join(', ')}` : ''}</span>
      <div class="btns" style="margin-left:auto;gap:8px"><button type="button" class="btn btn-sm btn-quiet" data-csv>${icon('download')}CSV</button>${!t.view ? html`<button type="button" class="btn btn-sm btn-gold" data-add>${icon('plus')}Add row</button>` : ''}</div></div>
    <div class="dt-w"><table class="tbl"><thead><tr>${cols.map(c => html`<th class="s ${state.sort === c.column_name || (!state.sort && t.sort === c.column_name) ? t.dir : ''}" data-sort="${c.column_name}" title="${c.data_type}${c.generated ? ' · generated' : ''}">${c.pk ? '🔑 ' : ''}${c.column_name}</th>`)}${!t.view ? html`<th></th>` : ''}</tr></thead>
    <tbody>${t.rows.length ? t.rows.map((r, i) => html`<tr class="${!t.view && pks.length ? 'go' : ''}" data-i="${i}" style="animation-delay:${Math.min(i, 14) * 15}ms">${cols.map(c => html`<td>${cell(r[c.column_name], c.column_name)}</td>`)}
      ${!t.view ? html`<td class="r nw">${pks.length ? html`<button type="button" class="btn btn-sm btn-quiet" data-del="${i}" title="Delete row">${icon('trash')}</button>` : ''}</td>` : ''}</tr>`)
      : html`<tr><td colspan="${cols.length + 1}"><div class="empty-s">${icon('db')}No rows</div></td></tr>`}</tbody></table></div>
    <div class="dt-foot"><span>Page ${t.page + 1} of ${pages}</span><div class="btns"><button type="button" class="btn" data-pg="-1" ${t.page === 0 ? 'disabled' : ''}>${icon('back')}</button><button type="button" class="btn" data-pg="1" style="transform:scaleX(-1)" ${t.page >= pages - 1 ? 'disabled' : ''}>${icon('back')}</button></div></div>
  </div>`);

  const go = async () => {
    try { cur = await api.get('table', { name: t.name, page: state.page, search: state.search, ...(state.sort ? { sort: state.sort, dir: state.dir } : {}) }); grid(view, ctx); }
    catch (e) { fail(e); }
  };
  $('.dt-q input', host).addEventListener('input', debounce(e => { state.search = e.target.value.trim(); state.page = 0; go(); }, 300));
  $$('[data-sort]', host).forEach(th => th.addEventListener('click', () => {
    const c = th.dataset.sort; state.dir = (state.sort || t.sort) === c && state.dir === 'desc' ? 'asc' : 'desc'; state.sort = c; go();
  }));
  $$('[data-pg]', host).forEach(b => b.addEventListener('click', () => { state.page += +b.dataset.pg; go(); }));
  $('[data-csv]', host).addEventListener('click', () => csv(`eimc-${t.name}`, cols.map(c => c.column_name), t.rows));
  $('[data-add]', host)?.addEventListener('click', () => edit(null));
  $$('tr[data-i]', host).forEach(tr => tr.addEventListener('click', e => { if (e.target.closest('button')) return; if (!t.view && pks.length) edit(t.rows[+tr.dataset.i]); }));
  $$('[data-del]', host).forEach(b => b.addEventListener('click', async () => {
    const r = t.rows[+b.dataset.del];
    const pk = Object.fromEntries(pks.map(c => [c.column_name, r[c.column_name]]));
    if (!await confirmBox(`Delete this row from ${t.name}?`, `Key ${JSON.stringify(pk)}. Rows that depend on it may be deleted too (ON DELETE CASCADE). This cannot be undone.`, { label: 'Delete row', danger: true })) return;
    try { const x = await api.do('rowDelete', t.name, pk); toast(`${x.rows} row deleted`); go(); } catch (e) { fail(e); }
  }));

  async function edit(row) {
    const editable = cols.filter(c => !c.generated);
    const val = c => { const v = row?.[c.column_name]; return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); };
    const r = await modal({ title: row ? `Edit ${t.name} row` : `Add a row to ${t.name}`, xl: true,
      text: row ? 'Values are cast by PostgreSQL to each column\'s type. Tick "null" to clear a value.' : 'Leave a field empty to use the column default.',
      body: html`<div class="form-g">${editable.map(c => html`<div class="fld"><label title="${c.data_type}">${c.pk ? '🔑 ' : ''}${c.column_name} <span class="mini" style="font-weight:400">${c.udt_name}</span>
          ${c.nullable ? html`<label class="chk" style="margin-left:auto;font-size:11px"><input type="checkbox" name="__null_${c.column_name}" ${row && row[c.column_name] === null ? 'checked' : ''}><span></span>null</label>` : ''}</label>
        ${c.udt_name === 'bool' ? html`<select name="${c.column_name}"><option value="" ${val(c) === '' ? 'selected' : ''}>—</option><option value="true" ${val(c) === 'true' ? 'selected' : ''}>true</option><option value="false" ${val(c) === 'false' ? 'selected' : ''}>false</option></select>`
          : html`<input name="${c.column_name}" value="${SECRET.test(c.column_name) && row ? '' : val(c)}" placeholder="${SECRET.test(c.column_name) && row ? 'hidden: leave empty to keep' : c.column_default ? `default: ${c.column_default}` : ''}" class="mono">`}</div>`)}</div>`,
      actions: [{ label: 'Cancel', value: null, cls: 'btn-quiet' }, { label: row ? 'Save row' : 'Insert row', submit: true, cls: 'btn-gold' }],
      submit: f => {
        const values = {};
        editable.forEach(c => {
          const k = c.column_name;
          if (f[`__null_${k}`]) { values[k] = null; return; }
          if (row) {
            if (SECRET.test(k) && f[k] === '') return;          // keep hidden secrets as they are
            if (f[k] !== val(c)) values[k] = f[k] === '' && c.nullable ? null : f[k];
          } else if (f[k] !== '') values[k] = f[k];
        });
        const pk = row ? Object.fromEntries(pks.map(c => [c.column_name, row[c.column_name]])) : null;
        return api.do('rowSave', t.name, pk, values);
      } });
    if (r) { toast(row ? 'Row saved' : 'Row inserted'); go(); }
  }
}
