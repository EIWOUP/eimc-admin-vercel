/* POST /api/sql  { sql, write }
   The SQL console. Runs in one transaction with a 15 s timeout.
   write = false (the default) runs READ ONLY, so a slip cannot change data.
   write = true commits, and the statement is recorded in audit_log. */
import { audit, connect } from './_db.js';
import { UserError, body, guarded, send } from './_auth.js';

const MAX_ROWS = 1000;

export default guarded(async (req, res) => {
  if (req.method !== 'POST') throw new UserError('Method not allowed.', 405);
  const b = await body(req);
  const sql = String(b.sql || '').trim();
  if (!sql) throw new UserError('Write a query first.');
  if (sql.length > 100_000) throw new UserError('That query is too long.');
  const write = b.write === true;

  const c = await connect();
  const t0 = Date.now();
  try {
    await c.query(write ? 'BEGIN' : 'BEGIN READ ONLY');
    await c.query(`SET LOCAL statement_timeout = '15s'`);
    await c.query(`SET LOCAL search_path = eimc, public`);
    let out;
    try {
      out = await c.query({ text: sql, rowMode: 'array' });
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      return send(res, 200, { ok: false, error: e.message, detail: e.detail || null, hint: e.hint || null, position: e.position || null, code: e.code || null, ms: Date.now() - t0 });
    }
    await c.query('COMMIT');
    const results = (Array.isArray(out) ? out : [out]).map(r => ({
      command: r.command, rowCount: r.rowCount,
      fields: (r.fields || []).map(f => f.name),
      rows: (r.rows || []).slice(0, MAX_ROWS),
      truncated: (r.rows || []).length > MAX_ROWS,
    }));
    if (write) await audit(null, null, 'admin.sql.executed', { sql: sql.slice(0, 2000), commands: results.map(r => `${r.command} ${r.rowCount ?? ''}`.trim()) });
    return send(res, 200, { ok: true, write, ms: Date.now() - t0, results });
  } finally { c.release(); }
});
