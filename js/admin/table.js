'use strict';
/* ════════════════════════════════════════════════════════════════════
   One data table for every list in the admin: search, filter chips with
   counts, sortable columns, multi-select with bulk actions, paging, CSV.
   ════════════════════════════════════════════════════════════════════ */
import { $, $$, html, put, icon, raw, csv } from './core.js';

export function dataTable(host, o) {
  const st = {
    rows: o.rows || [], q: '', chip: o.chips?.[0]?.key ?? null, page: 0,
    sort: o.sort?.col ?? null, dir: o.sort?.dir ?? 'desc', sel: new Set(),
  };
  const size = o.pageSize || 25;
  const key = r => String(r[o.key || 'id']);

  put(host, html`<div class="card dt">
    <div class="dt-bar">
      ${o.search !== false ? html`<label class="dt-q">${icon('search')}<input type="search" placeholder="${o.placeholder || 'Search…'}" aria-label="Search"></label>` : ''}
      <div class="chips" data-chips></div>
      <div class="btns" style="margin-left:auto;gap:8px">${o.tools || ''}${o.csv ? html`<button type="button" class="btn btn-sm btn-quiet" data-csv>${icon('download')}CSV</button>` : ''}</div>
    </div>
    ${o.bulk ? html`<div class="dt-sel" data-sel><span data-seln></span><div class="btns">${o.bulk.map((b, i) => html`<button type="button" class="btn ${b.cls || ''}" data-bulk="${i}">${b.icon ? icon(b.icon) : ''}${b.label}</button>`)}<button type="button" class="btn btn-quiet" data-clear>Clear</button></div></div>` : ''}
    <div class="dt-w"><table class="tbl"><thead><tr>
      ${o.bulk ? html`<th class="ck"><label class="chk"><input type="checkbox" data-all aria-label="Select all"><span></span></label></th>` : ''}
      ${o.columns.map((c, i) => html`<th class="${c.sort ? 's' : ''} ${c.r ? 'r' : ''}" data-c="${i}">${c.label}</th>`)}
    </tr></thead><tbody></tbody></table></div>
    <div class="dt-foot"><span data-count></span><div class="btns"><button type="button" class="btn" data-prev>${icon('back')}</button><button type="button" class="btn" data-next style="transform:scaleX(-1)">${icon('back')}</button></div></div>
  </div>`);

  const tbody = $('tbody', host);
  const sortVal = (c, r) => (typeof c.sort === 'function' ? c.sort(r) : r[c.key]);

  function visible() {
    let list = st.rows;
    if (st.chip != null && o.chips) { const ch = o.chips.find(c => c.key === st.chip); if (ch?.test) list = list.filter(ch.test); }
    if (st.q && o.search) { const t = st.q.toLowerCase(); list = list.filter(r => o.search(r).toLowerCase().includes(t)); }
    if (st.sort != null) {
      const c = o.columns[st.sort];
      if (c) {
        const m = st.dir === 'asc' ? 1 : -1;
        list = [...list].sort((a, b) => {
          const x = sortVal(c, a), y = sortVal(c, b);
          if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
          return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true })) * m;
        });
      }
    }
    return list;
  }

  function chips() {
    const box = $('[data-chips]', host);
    if (!o.chips) return;
    put(box, html`${o.chips.map(c => html`<button type="button" class="chip ${st.chip === c.key ? 'on' : ''}" data-chip="${c.key}">${c.label}<em>${c.test ? st.rows.filter(c.test).length : st.rows.length}</em></button>`)}`);
    $$('[data-chip]', box).forEach(b => b.addEventListener('click', () => { st.chip = b.dataset.chip; st.page = 0; chips(); body(); }));
  }

  function body() {
    const list = visible();
    const pages = Math.max(1, Math.ceil(list.length / size));
    st.page = Math.min(st.page, pages - 1);
    const slice = list.slice(st.page * size, st.page * size + size);
    const cols = o.columns.length + (o.bulk ? 1 : 0);
    put(tbody, slice.length ? html`${slice.map((r, i) => html`<tr class="${o.onRow ? 'go' : ''} ${st.sel.has(key(r)) ? 'sel' : ''}" data-k="${key(r)}" style="animation-delay:${Math.min(i, 14) * 18}ms">
        ${o.bulk ? html`<td class="ck"><label class="chk"><input type="checkbox" data-pick ${st.sel.has(key(r)) ? 'checked' : ''}><span></span></label></td>` : ''}
        ${o.columns.map(c => html`<td class="${c.cls || ''} ${c.r ? 'r' : ''}">${c.render ? c.render(r) : r[c.key] ?? '—'}</td>`)}</tr>`)}`
      : html`<tr><td colspan="${cols}"><div class="empty-s">${icon('search')}${o.empty || 'Nothing here'}</div></td></tr>`);
    $('[data-count]', host).textContent = list.length
      ? `${st.page * size + 1}–${st.page * size + slice.length} of ${list.length}${list.length !== st.rows.length ? ` (filtered from ${st.rows.length})` : ''}`
      : `0 of ${st.rows.length}`;
    $('[data-prev]', host).disabled = st.page === 0;
    $('[data-next]', host).disabled = st.page >= pages - 1;
    $$('th[data-c]', host).forEach(th => { th.classList.toggle('asc', +th.dataset.c === st.sort && st.dir === 'asc'); th.classList.toggle('desc', +th.dataset.c === st.sort && st.dir === 'desc'); });
    const map = new Map(st.rows.map(r => [key(r), r]));
    $$('tr[data-k]', tbody).forEach(tr => {
      const r = map.get(tr.dataset.k);
      tr.addEventListener('click', e => {
        if (e.target.closest('a,button,input,label,select')) return;
        o.onRow?.(r, e);
      });
      $('[data-pick]', tr)?.addEventListener('change', e => { e.target.checked ? st.sel.add(tr.dataset.k) : st.sel.delete(tr.dataset.k); tr.classList.toggle('sel', e.target.checked); selBar(); });
    });
    o.afterRender?.(tbody, slice);
    selBar();
  }

  function selBar() {
    if (!o.bulk) return;
    const bar = $('[data-sel]', host);
    bar.classList.toggle('on', st.sel.size > 0);
    $('[data-seln]', host).innerHTML = `<b>${st.sel.size}</b> selected`;
    const vis = visible();
    const all = $('[data-all]', host);
    all.checked = vis.length > 0 && vis.every(r => st.sel.has(key(r)));
    all.indeterminate = !all.checked && vis.some(r => st.sel.has(key(r)));
  }

  $('.dt-q input', host)?.addEventListener('input', e => { st.q = e.target.value.trim(); st.page = 0; body(); });
  $$('th[data-c]', host).forEach(th => th.addEventListener('click', () => {
    const c = o.columns[+th.dataset.c]; if (!c.sort) return;
    if (st.sort === +th.dataset.c) st.dir = st.dir === 'asc' ? 'desc' : 'asc'; else { st.sort = +th.dataset.c; st.dir = c.dir || 'desc'; }
    body();
  }));
  $('[data-prev]', host).addEventListener('click', () => { st.page--; body(); });
  $('[data-next]', host).addEventListener('click', () => { st.page++; body(); });
  $('[data-all]', host)?.addEventListener('change', e => { visible().forEach(r => (e.target.checked ? st.sel.add(key(r)) : st.sel.delete(key(r)))); body(); });
  $('[data-clear]', host)?.addEventListener('click', () => { st.sel.clear(); body(); });
  $$('[data-bulk]', host).forEach(b => b.addEventListener('click', () => {
    const picked = st.rows.filter(r => st.sel.has(key(r)));
    o.bulk[+b.dataset.bulk].run(picked, b, () => { st.sel.clear(); body(); });
  }));
  $('[data-csv]', host)?.addEventListener('click', () => { const list = visible(); csv(o.csv, o.csvCols || Object.keys(list[0] || {}), list); });

  chips(); body();
  return {
    update(rows) { st.rows = rows; const k = new Set(rows.map(key)); st.sel.forEach(s => k.has(s) || st.sel.delete(s)); chips(); body(); },
    setQuery(q) { st.q = q; const i = $('.dt-q input', host); if (i) i.value = q; body(); },
    setChip(c) { st.chip = c; chips(); body(); },
    selected: () => st.rows.filter(r => st.sel.has(key(r))),
  };
}
export { raw };
