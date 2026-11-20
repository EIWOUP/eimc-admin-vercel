// Test of the admin's terminal controls (Releases & access, Market data, Licence & PCs).
//
//   DATABASE_URL=postgres://postgres:PASSWORD@localhost:5432/eimc_admin_test node tools/test-terminal-admin.mjs
//
// SAFETY: refuses any database that is not on localhost or whose name does not contain "test",
// because it changes releases, the version policy, service status and devices. Make one with
//   C:\EIMC\DB\setup-database.ps1 -Database eimc_admin_test
// It starts its own dev server with throwaway admin credentials and a throwaway broker key.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.DATABASE_URL || '';
const m = DB.match(/@(localhost|127\.0\.0\.1)(:\d+)?\/([A-Za-z0-9_]+)/);
if (!m || !/test/.test(m[3])) {
  console.error('Refusing to run: DATABASE_URL must be a LOCAL database whose name contains "test".');
  process.exit(2);
}

const rnd = n => crypto.randomBytes(n).toString('base64url');
const ADMIN = { id: 'qa-admin', password: rnd(18), secret: rnd(32) };
const BROKER_KEY = rnd(40);
const PORT = 4100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const server = spawn(process.execPath, [path.join(root, 'tools', 'dev-server.mjs')], {
  env: { ...process.env, PORT: String(PORT), ADMIN_ID: ADMIN.id, ADMIN_PASSWORD: ADMIN.password, ADMIN_SECRET: ADMIN.secret,
         EIMC_BROKER_KEY: BROKER_KEY, RELAY_URL: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', d => { log += d; });
server.stderr.on('data', d => { log += d; });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const sql = async (t, p) => (await db.query(t, p)).rows;

let passed = 0, cookie = '';
const ok = (c, what) => { if (!c) throw new Error(`FAIL: ${what}`); passed++; console.log(`ok  ${what}`); };
async function req(method, url, data, headers = {}) {
  const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', cookie, ...headers },
    body: data === undefined ? undefined : JSON.stringify(data) });
  const sc = r.headers.get('set-cookie'); if (sc && sc.startsWith('eimc_admin=')) cookie = sc.split(';')[0];
  let json = null; try { json = await r.json(); } catch { /* */ }
  return { status: r.status, json, text: JSON.stringify(json) };
}
const get = (v, p = {}) => req('GET', `/api/q?${new URLSearchParams({ v, ...p })}`);
const doA = (action, ...args) => req('POST', '/api/do', { action, args });
const jwt = claims => [{ typ: 'JWT', alg: 'HS512' }, claims].map(o => Buffer.from(JSON.stringify(o)).toString('base64url')).join('.') + '.' + rnd(32);

async function main() {
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/auth'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }

  let r = await get('access');
  ok(r.status === 401, 'views need an admin session');
  r = await req('POST', '/api/auth', { action: 'login', id: ADMIN.id, password: ADMIN.password });
  ok(r.status === 200 && cookie, 'admin signs in');
  r = await req('POST', '/api/do', { action: 'serviceSave', args: [{ is_down: true, reason: 'x' }] }, { origin: 'https://evil.example' });
  ok(r.status === 403, 'cross-site write refused');

  // ---- access view
  r = await get('access');
  if (r.status !== 200) console.error('access view:', r.status, r.text);
  ok(r.status === 200 && r.json.releases.some(x => x.version === '1.25.218.93' && x.is_latest), 'access lists the seeded latest release');
  ok(r.json.policy.min_supported_version === '0.0.0.0' && r.json.service.is_down === false && r.json.plans.length >= 2, 'policy, service and plans present');
  const pcs = r.json.totals.pcs;
  ok(pcs > 0 && r.json.versions.some(v => v.version === '1.25.218.93'), `versions in use counted (${pcs} PCs)`);

  // ---- cutoff preview + policy
  r = await get('cutoff', { version: '1.26.0.0' });
  ok(r.status === 200 && r.json.pcs === pcs && r.json.accounts > 0, 'cutoff preview counts every older PC');
  r = await get('cutoff', { version: '1.0' });
  ok(r.json.pcs === 0, 'cutoff below every build locks nobody out');
  r = await get('cutoff', { version: 'abc' });
  ok(r.status === 400, 'cutoff rejects a bad version');
  r = await doA('policySave', { min_supported_version: '1.26.0.0', update_message: 'Update please', licence_ttl_hours: 24 });
  ok(r.status === 400 && /newer than the latest release/.test(r.json.error), 'minimum newer than the latest release is refused');

  // ---- releases
  r = await doA('releaseSave', null, { version: '1.26.0.0', channel: 'stable', download_url: 'http://insecure.example/x.exe', is_latest: true });
  ok(r.status === 400 && /https/.test(r.json.error), 'download link must be https');
  r = await doA('releaseSave', null, { version: '1.26.0.0', channel: 'stable', download_url: 'https://cdn.example/EIMC-Setup-1.26.0.0.exe',
    sha256: 'A'.repeat(64), size_bytes: 123456, notes: 'Licensing', is_latest: true });
  ok(r.status === 200 && r.json.id, 'new release added as latest');
  const relId = r.json.id;
  r = await doA('releaseSave', null, { version: '1.26.0.0' });
  ok(r.status === 400 && /already exists/.test(r.json.error), 'duplicate version refused');
  r = await doA('releaseSave', null, { version: '1.26.0.1', sha256: 'zz' });
  ok(r.status === 400, 'bad sha256 refused');
  const rels = await sql(`SELECT version, is_latest, sha256 FROM app_releases ORDER BY version`);
  ok(rels.filter(x => x.is_latest).length === 1 && rels.find(x => x.version === '1.26.0.0').is_latest, 'exactly one latest release');
  ok(rels.find(x => x.version === '1.26.0.0').sha256 === 'a'.repeat(64), 'sha256 stored lowercase');
  r = await doA('releaseDelete', relId);
  ok(r.status === 400 && /latest/.test(r.json.error), 'the latest release cannot be deleted');

  // ---- now the cutoff works, and the database's access rule enforces it
  r = await doA('policySave', { min_supported_version: '1.26.0.0', update_message: 'Install 1.26', licence_ttl_hours: 12 });
  ok(r.status === 200, 'minimum version raised to 1.26.0.0');
  const someone = (await sql(`SELECT d.user_id, d.device_hash FROM devices d JOIN users u ON u.id = d.user_id WHERE NOT d.revoked AND u.status = 'active' LIMIT 1`))[0];
  ok((await sql(`SELECT code FROM app_access($1, $2, '1.25.218.93')`, [someone.user_id, someone.device_hash]))[0].code === 'UPDATE_REQUIRED', 'old build now refused by app_access');
  r = await get('access');
  ok(r.json.policy.min_supported_version === '1.26.0.0' && r.json.policy.licence_ttl_hours === 12, 'policy saved');
  r = await doA('policySave', { min_supported_version: '0.0.0.0', update_message: 'Install 1.26', licence_ttl_hours: 24 });
  ok(r.status === 200, 'cutoff lifted again');
  r = await doA('policySave', { min_supported_version: '0.0.0.0', update_message: 'x', licence_ttl_hours: 500 });
  ok(r.status === 400, 'licence length capped at 168 h');

  // ---- service status
  r = await doA('serviceSave', { is_down: true });
  ok(r.status === 400, 'going down needs a reason');
  r = await doA('serviceSave', { is_down: true, reason: 'Maintenance', message: 'Back at 6 PM', expected_back_at: new Date(Date.now() + 36e5).toISOString() });
  ok(r.status === 200 && (await sql(`SELECT is_down FROM service_status`))[0].is_down, 'service marked down');
  ok((await sql(`SELECT code FROM app_access($1)`, [someone.user_id]))[0].code === 'SERVICE_DOWN', 'app_access reports SERVICE_DOWN');
  r = await doA('serviceSave', { is_down: false });
  ok(r.status === 200 && !(await sql(`SELECT is_down FROM service_status`))[0].is_down, 'service back up');

  // ---- notices
  r = await doA('noticeSave', null, { title: 'Hello', body: 'World', level: 'warning', shown_on: 'terminal', plan_code: 'pro' });
  ok(r.status === 200, 'notice published');
  const nid = r.json.id;
  r = await doA('noticeSave', null, { title: 'Bad', body: 'dates', starts_at: '2030-01-02T00:00:00Z', ends_at: '2030-01-01T00:00:00Z' });
  ok(r.status === 400, 'notice ending before it starts refused');
  r = await doA('noticeSave', null, { title: 'x', body: 'y', plan_code: 'nope' });
  ok(r.status === 400, 'unknown plan refused');
  r = await doA('noticeEnd', nid);
  ok(r.status === 200 && (await get('access')).json.notices.find(n => n.id == nid).state === 'ended', 'notice ended');
  r = await doA('noticeEnd', nid);
  ok(r.status === 400, 'ending twice is refused');
  r = await doA('noticeDelete', nid);
  ok(r.status === 200, 'notice deleted');

  // ---- go-live switch
  r = await doA('relaySwitch', true);
  ok(r.status === 400, 'live data cannot be turned on without the Dhan confirmation');
  r = await doA('relaySwitch', true, 'DHAN-CONFIRMED');
  ok(r.status === 200 && (await sql(`SELECT relay_enabled FROM app_policy`))[0].relay_enabled, 'live data on with confirmation');
  r = await doA('relaySwitch', false);
  ok(r.status === 200 && !(await sql(`SELECT relay_enabled FROM app_policy`))[0].relay_enabled, 'live data off');

  // ---- house Dhan token
  const exp = Math.floor(Date.now() / 1000) + 20 * 3600;
  const good = jwt({ iss: 'dhan', exp, iat: exp - 86400, dhanClientId: '1100000001', tokenConsumerType: 'SELF' });
  r = await doA('houseToken', { token: 'not a token' });
  ok(r.status === 400, 'garbage token refused');
  r = await doA('houseToken', { token: jwt({ iss: 'dhan', exp: Math.floor(Date.now() / 1000) - 60, dhanClientId: '1100000001' }) });
  ok(r.status === 400 && /expired/.test(r.json.error), 'expired token refused');
  r = await doA('houseToken', { token: good, client_id: '2200000002' });
  ok(r.status === 400 && /belongs to Dhan client/.test(r.json.error), 'client id must match the token');
  r = await doA('houseToken', { token: good });
  ok(r.status === 200 && r.json.client_id === '1100000001' && !r.text.includes(good.split('.')[1]), 'token saved; client read from it; token not echoed');
  const stored = (await sql(`SELECT pgp_sym_decrypt(access_token_enc, $1) AS t, access_token_enc::text LIKE '%' || $2 || '%' AS plain,
                                    extract(epoch FROM token_expires_at)::bigint AS e FROM house_broker`, [BROKER_KEY, good.slice(10, 40)]))[0];
  ok(stored.t === good && !stored.plain && Number(stored.e) === exp, 'stored encrypted, decrypts with the broker key, expiry from the token');
  r = await get('market');
  ok(r.json.broker.token_set && r.json.broker.client_id === '1100000001' && !r.text.includes(good.split('.')[1]) && r.json.keyConfigured,
     'market view shows state, never the token');
  ok(r.json.relay.configured === false && r.json.policy.relay_enabled === false, 'relay not configured yet');
  r = await doA('houseTokenClear');
  ok(r.status === 200 && !(await get('market')).json.broker.token_set, 'token removed');

  // ---- devices: sign out, restore, block, unblock; sign out all
  const d = (await sql(`SELECT d.id, d.user_id, d.device_hash FROM devices d WHERE NOT d.revoked LIMIT 1`))[0];
  const addToken = () => sql(`INSERT INTO app_refresh_tokens (user_id, device_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '30 days')`,
    [d.user_id, d.id, crypto.createHash('sha256').update(rnd(32)).digest('hex')]);
  const liveTokens = async () => +(await sql(`SELECT count(*) n FROM app_refresh_tokens WHERE device_id = $1 AND NOT revoked`, [d.id]))[0].n;
  await addToken();
  r = await get('user', { id: d.user_id });
  ok(r.json.devices.find(x => x.id == d.id).signed_in === true && Array.isArray(r.json.licenceEvents), 'user view: PC signed in + licence events');
  r = await doA('device', d.id, 'revoke');
  ok(r.status === 200 && await liveTokens() === 0, 'sign out PC revokes its sign-in');
  ok((await sql(`SELECT revoked FROM devices WHERE id = $1`, [d.id]))[0].revoked, 'and frees its slot');
  r = await doA('device', d.id, 'restore');
  ok(r.status === 200 && !(await sql(`SELECT revoked FROM devices WHERE id = $1`, [d.id]))[0].revoked, 'restore gives the slot back');
  await addToken();
  r = await doA('device', d.id, 'block', 'shared key');
  const blk = (await sql(`SELECT blocked, blocked_reason FROM devices WHERE id = $1`, [d.id]))[0];
  ok(r.status === 200 && blk.blocked && blk.blocked_reason === 'shared key' && await liveTokens() === 0, 'block: flagged, reason kept, signed out');
  ok((await sql(`SELECT code FROM app_access($1, $2)`, [d.user_id, d.device_hash]))[0].code === 'DEVICE_BLOCKED', 'app_access reports DEVICE_BLOCKED');
  r = await doA('device', d.id, 'unblock');
  ok(r.status === 200 && !(await sql(`SELECT blocked FROM devices WHERE id = $1`, [d.id]))[0].blocked, 'unblock');
  r = await doA('device', d.id, 'explode');
  ok(r.status === 400, 'unknown PC change refused');
  await addToken(); await addToken();
  r = await doA('licence', d.user_id, 'signout_all');
  ok(r.status === 200 && r.json.tokens === 2 && await liveTokens() === 0, 'sign out all terminals');
  const evs = await sql(`SELECT reason FROM licence_events WHERE user_id = $1 AND event = 'signout'`, [d.user_id]);
  ok(['ADMIN_SIGNOUT', 'ADMIN_BLOCK', 'ADMIN_SIGNOUT_ALL'].every(x => evs.some(e => e.reason === x)), 'admin sign-outs logged as licence events');

  const acts = (await sql(`SELECT DISTINCT action FROM audit_log WHERE actor = 'admin'`)).map(x => x.action);
  ok(['admin.policy.saved', 'admin.release.created', 'admin.service.down', 'admin.notice.created', 'admin.relay.enabled',
      'admin.house_token.saved', 'admin.device.block', 'admin.licence.signout_all'].every(a => acts.includes(a)), 'every change is in the audit log');
  const leaked = await sql(`SELECT count(*)::int n FROM audit_log WHERE details::text LIKE '%' || $1 || '%'`, [good.slice(10, 40)]);
  ok(leaked[0].n === 0, 'the audit log never holds the Dhan token');
}

main()
  .then(() => { console.log(`\nALL ${passed} ADMIN TERMINAL TESTS PASSED`); process.exitCode = 0; })
  .catch(e => { console.error('\n' + (e.stack || e)); if (log.trim()) console.error('\n--- server log ---\n' + log); process.exitCode = 1; })
  .finally(async () => { server.kill(); await db.end(); });
