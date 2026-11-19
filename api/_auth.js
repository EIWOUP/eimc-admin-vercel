/* Admin sign-in: one operator account from the environment
   (ADMIN_ID / ADMIN_PASSWORD), and a signed, HttpOnly session cookie.
   The cookie is an HMAC-SHA256 token (ADMIN_SECRET), so no session table is
   needed and nothing in the live site's schema changes. */
import crypto from 'node:crypto';
import { one, q } from './_db.js';

export const COOKIE = 'eimc_admin';
const HOURS = 12;
const LONG_DAYS = 7;

const b64 = s => Buffer.from(s).toString('base64url');
const secret = () => process.env.ADMIN_SECRET || '';
const sign = data => crypto.createHmac('sha256', secret()).update(data).digest('base64url');
const sha = s => crypto.createHash('sha256').update(String(s)).digest();

export function configured() {
  return !!(process.env.ADMIN_ID && process.env.ADMIN_PASSWORD && secret().length >= 16);
}

/* constant-time compare of what was typed against the env pair */
export function checkCredentials(id, password) {
  const a = crypto.timingSafeEqual(sha(id), sha(process.env.ADMIN_ID || ''));
  const b = crypto.timingSafeEqual(sha(password), sha(process.env.ADMIN_PASSWORD || ''));
  return configured() && a && b;
}

export function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = xf || req.socket?.remoteAddress || '';
  return /^[0-9a-f.:]+$/i.test(ip) ? ip.replace(/^::ffff:/, '') : null;
}

function cookieHeader(req, value, maxAgeSec) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || process.env.VERCEL ? '; Secure' : '';
  const age = maxAgeSec == null ? '' : `; Max-Age=${maxAgeSec}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict${secure}${age}`;
}

export function startSession(req, res, remember) {
  const ms = remember ? LONG_DAYS * 864e5 : HOURS * 36e5;
  const payload = b64(JSON.stringify({ sub: process.env.ADMIN_ID, iat: Date.now(), exp: Date.now() + ms, n: crypto.randomBytes(6).toString('hex') }));
  res.setHeader('Set-Cookie', cookieHeader(req, `${payload}.${sign(payload)}`, remember ? LONG_DAYS * 86400 : null));
  return Date.now() + ms;
}

export function endSession(req, res) { res.setHeader('Set-Cookie', cookieHeader(req, '', 0)); }

/* the admin for this request, or null */
export function currentAdmin(req) {
  if (!configured()) return null;
  const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]+)\\.([A-Za-z0-9_-]+)`));
  if (!m) return null;
  const [, payload, sig] = m;
  const want = Buffer.from(sign(payload)), got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (p.sub !== process.env.ADMIN_ID || !(p.exp > Date.now())) return null;
    return { id: p.sub, exp: p.exp };
  } catch { return null; }
}

/* failed admin sign-ins in the last 15 minutes from this IP (kept in audit_log) */
export async function tooManyFails(ip) {
  const r = await one(`SELECT count(*)::int AS n FROM audit_log
                        WHERE actor = 'admin' AND action = 'admin.login_failed' AND at > now() - interval '15 minutes'
                          AND details->>'ip' IS NOT DISTINCT FROM $1`, [ip]);
  return r.n >= 6;
}
export const logAttempt = (ok, ip, ua) =>
  q(`INSERT INTO audit_log (actor, action, details) VALUES ('admin', $1, $2)`,
    [ok ? 'admin.login' : 'admin.login_failed', JSON.stringify({ ip, ua: String(ua || '').slice(0, 200) })]);

/* small JSON helpers shared by the routes */
export function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}
export const fail = (res, status, message, code) => send(res, status, { error: message, code: code || null });

export async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 2_000_000) break; }
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

/* only accept same-site writes */
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

export function query(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  return Object.fromEntries(new URL(req.url, 'http://x').searchParams);
}

export class UserError extends Error { constructor(m, status = 400) { super(m); this.status = status; } }

/* wrap a route: signed-in admin only, JSON errors */
export function guarded(handler) {
  return async (req, res) => {
    try {
      const admin = currentAdmin(req);
      if (!admin) return fail(res, 401, 'Your admin session has ended. Sign in again.', 'expired');
      if (req.method !== 'GET' && !sameOrigin(req)) return fail(res, 403, 'Bad origin.');
      return await handler(req, res, admin);
    } catch (e) {
      if (e instanceof UserError) return fail(res, e.status, e.message);
      if (e && e.code && /^[0-9A-Z]{5}$/.test(e.code)) {   // a PostgreSQL error: show it, the admin can act on it
        return fail(res, 400, `Database: ${e.message}${e.detail ? ` (${e.detail})` : ''}`, e.code);
      }
      console.error('admin api', e);
      return fail(res, 500, 'Something went wrong on the server. Try again.');
    }
  };
}
