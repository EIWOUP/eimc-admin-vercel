/* /api/auth
   GET                                   -> { admin, mail } or 401
   POST { action:'login', id, password, remember }
   POST { action:'logout' } */
import { body, checkCredentials, clientIp, configured, currentAdmin, endSession, fail, logAttempt, sameOrigin, send, startSession, tooManyFails } from './_auth.js';
import { mailMode } from './_mail.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const admin = currentAdmin(req);
      if (!admin) return send(res, 200, { admin: null });
      return send(res, 200, { admin: { id: admin.id, exp: admin.exp }, mail: mailMode() });
    }
    if (req.method !== 'POST') return fail(res, 405, 'Method not allowed.');
    if (!sameOrigin(req)) return fail(res, 403, 'Bad origin.');
    const b = await body(req);

    if (b.action === 'logout') { endSession(req, res); return send(res, 200, { ok: true }); }

    if (b.action === 'login') {
      if (!configured()) return fail(res, 503, 'Admin sign-in is not set up: add ADMIN_ID, ADMIN_PASSWORD and ADMIN_SECRET to the environment.');
      const ip = clientIp(req);
      if (await tooManyFails(ip)) return fail(res, 429, 'Too many attempts. Wait 15 minutes and try again.', 'locked');
      const id = String(b.id || '').trim().slice(0, 120), password = String(b.password || '').slice(0, 200);
      const ok = !!id && !!password && checkCredentials(id, password);
      await logAttempt(ok, ip, req.headers['user-agent']);
      if (!ok) { await new Promise(r => setTimeout(r, 450)); return fail(res, 401, 'That admin ID and password do not match.', 'auth'); }
      const exp = startSession(req, res, !!b.remember);
      return send(res, 200, { ok: true, exp });
    }
    return fail(res, 400, 'Unknown action.');
  } catch (e) {
    console.error('auth', e);
    return fail(res, 500, 'The server could not sign you in. Is the database reachable?');
  }
}
