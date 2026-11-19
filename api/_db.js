/* Shared PostgreSQL pool for the admin /api functions.
   Same database as eimc.vercel.app: whatever is changed here is what the
   live site reads. DATABASE_URL comes from Vercel (Neon integration) or
   from .env.local when testing on this PC. Files starting with "_" are not routes. */
import pg from 'pg';

const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const local = !raw || /@(localhost|127\.0\.0\.1)[:/]/.test(raw);

// SSL is set explicitly below (full certificate check), so drop the URL's ssl params.
const url = raw.replace(/([?&])(sslmode|channel_binding)=[^&]*/g, '$1').replace(/[?&]+$/, '').replace(/\?&+/, '?');

// numeric / bigint come back as strings by default; the admin wants numbers
pg.types.setTypeParser(1700, v => (v == null ? null : Number(v)));   // numeric
pg.types.setTypeParser(20, v => (v == null ? null : (Math.abs(Number(v)) < 2 ** 53 ? Number(v) : v)));  // int8

const pool = globalThis.__eimcAdminPool ||= new pg.Pool({
  connectionString: url,
  ssl: local ? false : { rejectUnauthorized: true },
  max: 4,
  idleTimeoutMillis: 10_000,
});

export const q = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0] || null;
export const many = async (text, params) => (await pool.query(text, params)).rows;
export const connect = () => pool.connect();

/* run fn(client) inside BEGIN/COMMIT */
export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }
}

/* every admin change leaves a line in audit_log (actor = 'admin') */
export function audit(db, userId, action, details) {
  return (db || pool).query(`INSERT INTO audit_log (user_id, actor, action, details) VALUES ($1, 'admin', $2, $3)`,
    [userId || null, action, details ? JSON.stringify(details) : null]);
}
