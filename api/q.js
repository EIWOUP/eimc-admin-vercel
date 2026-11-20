/* GET /api/q?v=<view>[&id=..]   - every read the admin makes.
   Views: overview, users, user, subs, orders, activity, tickets, ticket, ideas, plans,
          messages, tables, table, search, pulse */
import { many, one } from './_db.js';
import { UserError, guarded, query, send } from './_auth.js';
import { mailMode } from './_mail.js';

const TZ = 'Asia/Kolkata';
const id = v => { const s = String(v ?? ''); if (!/^\d{1,18}$/.test(s)) throw new UserError('Bad id.'); return s; };

/* ════════════════════════════════════════════════ overview: pure analysis */
async function overview() {
  const [k, signups, revenue, logins, heat, plans, statuses, geo, os, versions, methods, expiring, risk, feed, ideas, funnel, tickets] = await Promise.all([
    one(`WITH cur AS (SELECT s.*, eimc.access_until(s) AS au FROM subscriptions s WHERE s.is_current)
      SELECT
        (SELECT count(*) FROM users WHERE role = 'customer' AND status <> 'deleted') AS users,
        (SELECT count(*) FROM users WHERE role = 'customer' AND created_at > now() - interval '30 days') AS users_30,
        (SELECT count(*) FROM users WHERE role = 'customer' AND created_at > now() - interval '60 days' AND created_at <= now() - interval '30 days') AS users_prev30,
        (SELECT count(*) FROM users WHERE status = 'suspended') AS suspended,
        (SELECT count(*) FROM cur WHERE au IS NOT NULL) AS with_access,
        (SELECT count(*) FROM cur WHERE status IN ('active','past_due') AND billing_cycle <> 'trial' AND plan_code <> 'free') AS paying,
        (SELECT coalesce(sum(price), 0)
           FROM cur WHERE status IN ('active','past_due') AND billing_cycle <> 'trial') AS mrr,
        (SELECT coalesce(sum(price), 0)
           FROM cur WHERE status = 'cancelled' AND au IS NOT NULL) AS mrr_leaving,
        (SELECT count(*) FROM cur WHERE status = 'trialing') AS trialing,
        (SELECT count(*) FROM cur WHERE status IN ('past_due','halted')) AS at_risk,
        (SELECT count(*) FROM cur WHERE status IN ('cancelled','expired')) AS churned,
        (SELECT count(*) FROM cur WHERE cancel_at_period_end) AS cancelling,
        (SELECT coalesce(sum(total), 0) FROM orders WHERE status = 'paid') AS revenue_all,
        (SELECT coalesce(sum(total), 0) FROM orders WHERE status = 'paid' AND created_at > now() - interval '30 days') AS revenue_30,
        (SELECT coalesce(sum(total), 0) FROM orders WHERE status = 'paid' AND created_at > now() - interval '60 days' AND created_at <= now() - interval '30 days') AS revenue_prev30,
        (SELECT coalesce(sum(total), 0) FROM orders WHERE status = 'refunded') AS refunded,
        (SELECT count(*) FROM orders WHERE status = 'paid') AS paid_orders,
        (SELECT count(*) FROM orders WHERE status = 'failed') AS failed_orders,
        (SELECT count(*) FROM orders WHERE status = 'failed' AND created_at > now() - interval '30 days') AS failed_30,
        (SELECT count(*) FROM login_history WHERE success AND at > now() - interval '24 hours') AS logins_24h,
        (SELECT count(*) FROM login_history WHERE NOT success AND at > now() - interval '24 hours') AS fails_24h,
        (SELECT count(DISTINCT user_id) FROM login_history WHERE success AND at > now() - interval '7 days') AS active_7d,
        (SELECT count(DISTINCT user_id) FROM login_history WHERE success AND at > now() - interval '30 days') AS active_30d,
        (SELECT count(*) FROM sessions WHERE NOT revoked AND expires_at > now()) AS live_sessions,
        (SELECT count(*) FROM sessions WHERE NOT revoked AND expires_at > now() AND last_used_at > now() - interval '15 minutes') AS online_now,
        (SELECT count(*) FROM support_tickets WHERE status NOT IN ('resolved','closed')) AS open_tickets,
        (SELECT count(*) FROM devices WHERE NOT revoked) AS devices,
        (SELECT count(*) FROM licences WHERE NOT revoked) AS licences,
        (SELECT count(*) FROM feature_requests) AS ideas`),

    // signups per day, 90 days, with the running total
    many(`WITH d AS (SELECT generate_series((now() AT TIME ZONE $1)::date - 89, (now() AT TIME ZONE $1)::date, '1 day')::date AS day)
      SELECT d.day::text AS day, count(u.id)::int AS n,
             (SELECT count(*) FROM users x WHERE x.role = 'customer' AND (x.created_at AT TIME ZONE $1)::date <= d.day)::int AS total
        FROM d LEFT JOIN users u ON u.role = 'customer' AND (u.created_at AT TIME ZONE $1)::date = d.day
       GROUP BY d.day ORDER BY d.day`, [TZ]),

    // revenue per week, 26 weeks
    many(`WITH w AS (SELECT generate_series(date_trunc('week', now() AT TIME ZONE $1) - interval '25 weeks', date_trunc('week', now() AT TIME ZONE $1), '1 week') AS wk)
      SELECT w.wk::date::text AS day,
             coalesce(sum(o.total) FILTER (WHERE o.status = 'paid'), 0) AS paid,
             coalesce(sum(o.total) FILTER (WHERE o.status = 'refunded'), 0) AS refunded,
             count(o.id) FILTER (WHERE o.status = 'failed')::int AS failed,
             count(o.id) FILTER (WHERE o.status = 'paid')::int AS orders
        FROM w LEFT JOIN orders o ON date_trunc('week', o.created_at AT TIME ZONE $1) = w.wk
       GROUP BY w.wk ORDER BY w.wk`, [TZ]),

    // logins per day, 30 days
    many(`WITH d AS (SELECT generate_series((now() AT TIME ZONE $1)::date - 29, (now() AT TIME ZONE $1)::date, '1 day')::date AS day)
      SELECT d.day::text AS day, count(h.id) FILTER (WHERE h.success)::int AS ok, count(h.id) FILTER (WHERE NOT h.success)::int AS bad,
             count(DISTINCT h.user_id) FILTER (WHERE h.success)::int AS users
        FROM d LEFT JOIN login_history h ON (h.at AT TIME ZONE $1)::date = d.day
       GROUP BY d.day ORDER BY d.day`, [TZ]),

    // when people use it: weekday x hour, IST, 60 days (logins + session activity)
    many(`SELECT extract(isodow FROM t)::int AS dow, extract(hour FROM t)::int AS hr, count(*)::int AS n FROM (
             SELECT at AT TIME ZONE $1 AS t FROM login_history WHERE success AND at > now() - interval '60 days'
             UNION ALL SELECT last_used_at AT TIME ZONE $1 FROM sessions WHERE last_used_at > now() - interval '60 days'
             UNION ALL SELECT last_seen AT TIME ZONE $1 FROM devices WHERE last_seen > now() - interval '60 days') x
           GROUP BY 1, 2`, [TZ]),

    many(`SELECT coalesce(s.plan_code, 'none') AS k, count(*)::int AS n,
                 count(*) FILTER (WHERE eimc.access_until(s) IS NOT NULL)::int AS live
            FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id AND s.is_current
           WHERE u.role = 'customer' AND u.status <> 'deleted' GROUP BY 1`),
    many(`SELECT s.status AS k, count(*)::int AS n FROM subscriptions s JOIN users u ON u.id = s.user_id
           WHERE s.is_current AND u.role = 'customer' GROUP BY 1 ORDER BY 2 DESC`),
    many(`SELECT coalesce(nullif(p.state, ''), 'Unknown') AS state, coalesce(nullif(p.city, ''), '—') AS city, count(*)::int AS n
            FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.role = 'customer' GROUP BY 1, 2 ORDER BY 3 DESC, 1`),
    many(`SELECT coalesce(nullif(os, ''), 'Unknown') AS k, count(*)::int AS n FROM devices WHERE NOT revoked GROUP BY 1 ORDER BY 2 DESC`),
    many(`SELECT coalesce(nullif(app_version, ''), 'Unknown') AS k, count(*)::int AS n FROM devices WHERE NOT revoked GROUP BY 1 ORDER BY 2 DESC LIMIT 6`),
    many(`SELECT CASE WHEN method_type = 'card' THEN coalesce(card_brand, 'card') ELSE method_type END AS k, count(*)::int AS n
            FROM payment_methods WHERE status <> 'removed' GROUP BY 1 ORDER BY 2 DESC`),
    many(`SELECT u.id, u.client_id, u.full_name, s.plan_code, s.status, s.billing_cycle, s.auto_renew, s.cancel_at_period_end,
                 eimc.access_until(s) AS access_until, coalesce(s.trial_end, s.current_period_end) AS period_end
            FROM subscriptions s JOIN users u ON u.id = s.user_id
           WHERE s.is_current AND eimc.access_until(s) BETWEEN now() AND now() + interval '10 days'
           ORDER BY eimc.access_until(s) LIMIT 12`),
    many(`SELECT u.id, u.client_id, u.full_name, s.plan_code, s.status, s.current_period_end,
                 (SELECT p.failure_reason FROM payments p WHERE p.user_id = u.id AND p.status = 'failed' ORDER BY p.paid_at DESC LIMIT 1) AS reason
            FROM subscriptions s JOIN users u ON u.id = s.user_id
           WHERE s.is_current AND s.status IN ('past_due','halted') ORDER BY s.current_period_end LIMIT 12`),
    activityFeed(40),
    many(`SELECT f.id, f.title, f.status, f.tag, f.base_votes + (SELECT count(*) FROM feature_votes v WHERE v.feature_request_id = f.id)::int AS votes
            FROM feature_requests f ORDER BY votes DESC LIMIT 6`),
    one(`SELECT
           (SELECT count(*) FROM users WHERE role = 'customer')::int AS registered,
           (SELECT count(DISTINCT user_id) FROM login_history WHERE success)::int AS logged_in,
           (SELECT count(DISTINCT user_id) FROM subscriptions WHERE billing_cycle = 'trial' OR status = 'trialing')::int AS trialed,
           (SELECT count(DISTINCT user_id) FROM orders WHERE status = 'paid' AND total > 0)::int AS paid_ever,
           (SELECT count(*) FROM subscriptions WHERE is_current AND status IN ('active','past_due') AND billing_cycle <> 'trial')::int AS paying_now`),
    many(`SELECT status AS k, count(*)::int AS n FROM support_tickets GROUP BY 1`),
  ]);
  return { k, signups, revenue, logins, heat, plans, statuses, geo, os, versions, methods, expiring, risk, feed, ideas, funnel, tickets, mail: mailMode(), at: new Date().toISOString() };
}

/* everything that happened, newest first */
function activityFeed(limit, userId = null) {
  return many(`SELECT * FROM (
      SELECT 'join' AS kind, u.created_at AS at, u.id AS user_id, u.full_name AS who, u.client_id, 'Joined EIMC' AS what, NULL::text AS extra
        FROM users u WHERE u.role = 'customer' AND ($2::bigint IS NULL OR u.id = $2)
      UNION ALL
      SELECT CASE WHEN h.success THEN 'login' ELSE 'fail' END, h.at, h.user_id, coalesce(u.full_name, h.login_id), u.client_id,
             CASE WHEN h.success THEN 'Signed in' ELSE 'Failed sign-in' END, coalesce(host(h.ip_address), h.location)
        FROM login_history h LEFT JOIN users u ON u.id = h.user_id WHERE ($2::bigint IS NULL OR h.user_id = $2)
      UNION ALL
      SELECT 'order', o.created_at, o.user_id, u.full_name, u.client_id,
             initcap(o.status) || ' · ' || coalesce(o.description, o.plan_code), '₹' || to_char(o.total, 'FM99,99,99,990.00')
        FROM orders o JOIN users u ON u.id = o.user_id WHERE ($2::bigint IS NULL OR o.user_id = $2)
      UNION ALL
      SELECT 'ticket', t.created_at, t.user_id, u.full_name, u.client_id, 'Ticket ' || t.ticket_no || ': ' || t.subject, t.status
        FROM support_tickets t JOIN users u ON u.id = t.user_id WHERE ($2::bigint IS NULL OR t.user_id = $2)
      UNION ALL
      SELECT CASE WHEN a.actor = 'admin' THEN 'admin' ELSE 'audit' END, a.at, a.user_id, coalesce(u.full_name, initcap(a.actor)), u.client_id, a.action,
             CASE WHEN a.details IS NULL THEN NULL ELSE left(a.details::text, 160) END
        FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.action NOT IN ('seed.created','admin.login','admin.login_failed') AND ($2::bigint IS NULL OR a.user_id = $2)
    ) x ORDER BY at DESC LIMIT $1`, [limit, userId]);
}

/* ════════════════════════════════════════════════ users */
const USER_COLS = `u.id, u.client_id, u.first_name, u.last_name, u.full_name, u.email, u.phone, u.role, u.status, u.blocked_reason,
  u.email_verified, u.phone_verified, u.created_at, u.updated_at, u.last_login_at`;

async function users() {
  return many(`SELECT ${USER_COLS}, p.city, p.state,
        s.id AS sub_id, s.plan_code, s.billing_cycle, s.status AS sub_status, s.price, s.current_period_end, s.trial_end,
        s.cancel_at_period_end, s.auto_renew, eimc.access_until(s) AS access_until,
        (SELECT coalesce(sum(total), 0) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid') AS ltv,
        (SELECT count(*) FROM login_history h WHERE h.user_id = u.id AND h.success AND h.at > now() - interval '30 days')::int AS logins_30,
        (SELECT count(*) FROM login_history h WHERE h.user_id = u.id AND NOT h.success AND h.at > now() - interval '30 days')::int AS fails_30,
        (SELECT count(*) FROM devices d WHERE d.user_id = u.id AND NOT d.revoked)::int AS devices,
        (SELECT count(*) FROM support_tickets t WHERE t.user_id = u.id AND t.status NOT IN ('resolved','closed'))::int AS open_tickets,
        EXISTS (SELECT 1 FROM payment_methods pm WHERE pm.user_id = u.id AND pm.status = 'expired') AS card_expired,
        (SELECT max(last_used_at) FROM sessions x WHERE x.user_id = u.id) AS last_seen,
        sec.two_factor_enabled, l.revoked AS licence_revoked, np.offers, np.product
      FROM users u
      LEFT JOIN user_profiles p ON p.user_id = u.id
      LEFT JOIN user_security sec ON sec.user_id = u.id
      LEFT JOIN subscriptions s ON s.user_id = u.id AND s.is_current
      LEFT JOIN licences l ON l.user_id = u.id
      LEFT JOIN notification_preferences np ON np.user_id = u.id
     ORDER BY u.client_id DESC LIMIT 5000`);
}

async function user(uid) {
  const u = await one(`SELECT ${USER_COLS} FROM users u WHERE u.id = $1`, [uid]);
  if (!u) throw new UserError('That user does not exist.', 404);
  const [profile, security, prefs, sub, history, licence, devices, sessions, logins, orders, methods, tickets, notes, feed, ideas, plans, stats] = await Promise.all([
    one(`SELECT * FROM user_profiles WHERE user_id = $1`, [uid]),
    one(`SELECT two_factor_enabled, two_factor_method, password_changed_at, failed_login_count, locked_until FROM user_security WHERE user_id = $1`, [uid]),
    one(`SELECT * FROM notification_preferences WHERE user_id = $1`, [uid]),
    one(`SELECT s.*, eimc.access_until(s) AS access_until, pl.name AS plan_name, pl.price_monthly, pl.list_price, pl.max_devices
           FROM subscriptions s JOIN plans pl ON pl.code = s.plan_code WHERE s.user_id = $1 AND s.is_current`, [uid]),
    many(`SELECT s.*, pl.name AS plan_name FROM subscriptions s JOIN plans pl ON pl.code = s.plan_code
           WHERE s.user_id = $1 ORDER BY s.is_current DESC, s.created_at DESC`, [uid]),
    one(`SELECT * FROM licences WHERE user_id = $1`, [uid]),
    many(`SELECT id, label, os, app_version, first_seen, last_seen, host(last_ip) AS last_ip, revoked FROM devices WHERE user_id = $1 ORDER BY revoked, last_seen DESC`, [uid]),
    many(`SELECT id, kind, device_label, host(ip_address) AS ip, user_agent, created_at, last_used_at, expires_at, revoked,
                 (NOT revoked AND expires_at > now()) AS live
            FROM sessions WHERE user_id = $1 ORDER BY live DESC, coalesce(last_used_at, created_at) DESC LIMIT 40`, [uid]),
    many(`SELECT id, login_id, success, host(ip_address) AS ip, user_agent, location, at FROM login_history WHERE user_id = $1 ORDER BY at DESC LIMIT 60`, [uid]),
    many(`SELECT o.*, i.invoice_no, i.status AS invoice_status,
                 p.status AS payment_status, p.failure_reason, p.provider_payment_id,
                 CASE pm.method_type WHEN 'card' THEN initcap(pm.card_brand) || ' •••• ' || pm.card_last4
                                     WHEN 'upi' THEN 'UPI ' || coalesce(pm.upi_vpa_masked, '') ELSE pm.method_type END AS paid_with
            FROM orders o
            LEFT JOIN invoices i ON i.order_id = o.id
            LEFT JOIN LATERAL (SELECT * FROM payments p WHERE p.order_id = o.id ORDER BY p.paid_at DESC LIMIT 1) p ON true
            LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id
           WHERE o.user_id = $1 ORDER BY o.created_at DESC`, [uid]),
    many(`SELECT id, method_type, card_brand, card_last4, card_exp_month, card_exp_year, card_holder_name, card_issuer_bank, card_funding,
                 upi_vpa_masked, bank_name, provider, is_default, status, created_at
            FROM payment_methods WHERE user_id = $1 ORDER BY status = 'removed', is_default DESC, created_at DESC`, [uid]),
    many(`SELECT t.*, (SELECT count(*) FROM support_messages m WHERE m.ticket_id = t.id)::int AS messages FROM support_tickets t WHERE t.user_id = $1 ORDER BY t.created_at DESC`, [uid]),
    many(`SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 60`, [uid]),
    activityFeed(60, uid),
    many(`SELECT id, title, status, tag, created_at FROM feature_requests WHERE user_id = $1 ORDER BY created_at DESC`, [uid]),
    many(`SELECT code, name, price_monthly, list_price, max_devices, is_sellable FROM plans ORDER BY sort_order`),
    one(`SELECT (SELECT coalesce(sum(total), 0) FROM orders WHERE user_id = $1 AND status = 'paid') AS ltv,
                (SELECT coalesce(sum(total), 0) FROM orders WHERE user_id = $1 AND status = 'refunded') AS refunded,
                (SELECT count(*) FROM login_history WHERE user_id = $1 AND success)::int AS logins,
                (SELECT count(*) FROM login_history WHERE user_id = $1 AND NOT success)::int AS fails,
                (SELECT count(*) FROM login_history WHERE user_id = $1 AND success AND at > now() - interval '30 days')::int AS logins_30`, [uid]),
  ]);
  const days = await many(`WITH d AS (SELECT generate_series((now() AT TIME ZONE $2)::date - 29, (now() AT TIME ZONE $2)::date, '1 day')::date AS day)
     SELECT d.day::text AS day, count(h.id)::int AS n FROM d LEFT JOIN login_history h ON h.user_id = $1 AND h.success AND (h.at AT TIME ZONE $2)::date = d.day
      GROUP BY d.day ORDER BY d.day`, [uid, TZ]);
  return { user: u, profile, security, prefs, sub, history, licence, devices, sessions, logins, orders, methods, tickets, notes, feed, ideas, plans, stats, days };
}

/* ════════════════════════════════════════════════ the other pages */
const subs = () => many(`SELECT s.id, s.user_id, u.client_id, u.full_name, u.email, s.plan_code, s.billing_cycle, s.status, s.price, s.started_at,
      s.trial_end, s.current_period_start, s.current_period_end, s.cancel_at_period_end, s.auto_renew, s.next_cycle, s.seats, s.cancel_reason,
      eimc.access_until(s) AS access_until, s.updated_at
    FROM subscriptions s JOIN users u ON u.id = s.user_id WHERE s.is_current ORDER BY eimc.access_until(s) NULLS LAST`);

const orders = () => many(`SELECT o.id, o.order_no, o.user_id, u.client_id, u.full_name, o.plan_code, o.billing_cycle, o.description, o.amount, o.discount,
      o.gst_amount, o.total, o.coupon_code, o.status, o.created_at, i.invoice_no, p.status AS payment_status, p.failure_reason,
      CASE pm.method_type WHEN 'card' THEN initcap(pm.card_brand) || ' •••• ' || pm.card_last4 WHEN 'upi' THEN 'UPI' ELSE pm.method_type END AS paid_with
    FROM orders o JOIN users u ON u.id = o.user_id
    LEFT JOIN invoices i ON i.order_id = o.id
    LEFT JOIN LATERAL (SELECT * FROM payments p WHERE p.order_id = o.id ORDER BY p.paid_at DESC LIMIT 1) p ON true
    LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id
   ORDER BY o.created_at DESC LIMIT 2000`);

async function activity() {
  const [logins, sessions, audit, ips] = await Promise.all([
    many(`SELECT h.id, h.user_id, u.client_id, u.full_name, h.login_id, h.success, host(h.ip_address) AS ip, h.user_agent, h.location, h.at
            FROM login_history h LEFT JOIN users u ON u.id = h.user_id ORDER BY h.at DESC LIMIT 500`),
    many(`SELECT s.id, s.user_id, u.client_id, u.full_name, s.kind, s.device_label, host(s.ip_address) AS ip, s.created_at, s.last_used_at, s.expires_at
            FROM sessions s JOIN users u ON u.id = s.user_id WHERE NOT s.revoked AND s.expires_at > now() ORDER BY s.last_used_at DESC NULLS LAST`),
    many(`SELECT a.id, a.user_id, u.client_id, u.full_name, a.actor, a.action, a.details, a.at
            FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.at DESC LIMIT 500`),
    many(`SELECT host(ip_address) AS ip, count(*)::int AS n, count(*) FILTER (WHERE NOT success)::int AS bad,
                 count(DISTINCT user_id)::int AS users, max(at) AS last
            FROM login_history WHERE ip_address IS NOT NULL AND at > now() - interval '30 days' GROUP BY 1 ORDER BY bad DESC, n DESC LIMIT 20`),
  ]);
  return { logins, sessions, audit, ips };
}

const tickets = () => many(`SELECT t.*, u.client_id, u.full_name, u.email,
      (SELECT count(*) FROM support_messages m WHERE m.ticket_id = t.id)::int AS messages,
      (SELECT m.sender FROM support_messages m WHERE m.ticket_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_sender,
      (SELECT left(m.body, 160) FROM support_messages m WHERE m.ticket_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_body
    FROM support_tickets t JOIN users u ON u.id = t.user_id
   ORDER BY (t.status IN ('resolved','closed')), t.updated_at DESC`);

async function ticket(tid) {
  const t = await one(`SELECT t.*, u.client_id, u.full_name, u.email FROM support_tickets t JOIN users u ON u.id = t.user_id WHERE t.id = $1`, [tid]);
  if (!t) throw new UserError('That ticket does not exist.', 404);
  t.messages = await many(`SELECT * FROM support_messages WHERE ticket_id = $1 ORDER BY created_at`, [tid]);
  return t;
}

const ideas = () => many(`SELECT f.*, u.client_id, u.full_name,
      (SELECT count(*) FROM feature_votes v WHERE v.feature_request_id = f.id)::int AS real_votes
    FROM feature_requests f LEFT JOIN users u ON u.id = f.user_id ORDER BY f.created_at DESC`);

async function plans() {
  const [list, features, links] = await Promise.all([
    many(`SELECT p.*, (SELECT count(*) FROM subscriptions s WHERE s.plan_code = p.code AND s.is_current)::int AS subscribers,
                 (SELECT count(*) FROM subscriptions s WHERE s.plan_code = p.code AND s.is_current AND eimc.access_until(s) IS NOT NULL)::int AS live,
                 (SELECT coalesce(sum(total), 0) FROM orders o WHERE o.plan_code = p.code AND o.status = 'paid') AS revenue
            FROM plans p ORDER BY p.sort_order`),
    many(`SELECT * FROM features ORDER BY code`),
    many(`SELECT * FROM plan_features`),
  ]);
  return { plans: list, features, links };
}

async function messages() {
  const [list, counts] = await Promise.all([
    many(`SELECT n.*, u.client_id, u.full_name, u.email FROM notifications n JOIN users u ON u.id = n.user_id ORDER BY n.created_at DESC LIMIT 400`),
    many(`SELECT channel AS k, count(*)::int AS n, count(*) FILTER (WHERE NOT is_read)::int AS unread FROM notifications GROUP BY 1`),
  ]);
  return { list, counts, mail: mailMode() };
}

/* ════════════════════════════════════════════════ database explorer */
export async function tableMeta() {
  const rows = await many(`SELECT c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable = 'YES' AS nullable, c.column_default,
        c.is_generated = 'ALWAYS' AS generated, c.ordinal_position,
        EXISTS (SELECT 1 FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage k
                  ON k.constraint_name = tc.constraint_name AND k.table_schema = tc.table_schema
                 WHERE tc.table_schema = 'eimc' AND tc.table_name = c.table_name AND tc.constraint_type = 'PRIMARY KEY' AND k.column_name = c.column_name) AS pk
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'eimc' AND t.table_type = 'BASE TABLE'
     ORDER BY c.table_name, c.ordinal_position`);
  const map = {};
  for (const r of rows) (map[r.table_name] ||= []).push(r);
  return map;
}
export const qi = s => `"${String(s).replace(/"/g, '""')}"`;

async function tables() {
  const meta = await tableMeta();
  const counts = await Promise.all(Object.keys(meta).map(t => one(`SELECT count(*)::int AS n FROM eimc.${qi(t)}`).then(r => [t, r.n])));
  const views = await many(`SELECT table_name FROM information_schema.views WHERE table_schema = 'eimc' ORDER BY 1`);
  return { tables: counts.map(([name, n]) => ({ name, rows: n, columns: meta[name] })), views: views.map(v => v.table_name) };
}

async function table(qs) {
  const meta = await tableMeta();
  const views = (await many(`SELECT table_name FROM information_schema.views WHERE table_schema = 'eimc'`)).map(v => v.table_name);
  const name = String(qs.name || '');
  let cols = meta[name];
  if (!cols && views.includes(name)) {
    cols = (await many(`SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema = 'eimc' AND table_name = $1 ORDER BY ordinal_position`, [name]))
      .map(c => ({ ...c, generated: true, pk: false }));
  }
  if (!cols) throw new UserError('Unknown table.');
  const limit = Math.min(200, Math.max(1, +qs.limit || 50));
  const page = Math.max(0, +qs.page || 0);
  const sort = cols.find(c => c.column_name === qs.sort)?.column_name || (cols.find(c => c.pk) || cols[0]).column_name;
  const dir = qs.dir === 'asc' ? 'ASC' : 'DESC';
  const search = String(qs.search || '').trim().slice(0, 100);
  const where = search ? `WHERE ${cols.map(c => `${qi(c.column_name)}::text ILIKE $1`).join(' OR ')}` : '';
  const params = search ? [`%${search}%`] : [];
  const [rows, total] = await Promise.all([
    many(`SELECT * FROM eimc.${qi(name)} ${where} ORDER BY ${qi(sort)} ${dir} NULLS LAST LIMIT ${limit} OFFSET ${page * limit}`, params),
    one(`SELECT count(*)::int AS n FROM eimc.${qi(name)} ${where}`, params),
  ]);
  return { name, view: !meta[name], columns: cols, rows, total: total.n, page, limit, sort, dir: dir.toLowerCase() };
}

/* ════════════════════════════════════════════════ search (command palette) */
async function search(term) {
  const s = String(term || '').trim().slice(0, 80);
  if (!s) return { users: [], orders: [], tickets: [] };
  const like = `%${s}%`;
  const [users, ords, tks] = await Promise.all([
    many(`SELECT u.id, u.client_id, u.full_name, u.email, u.phone, u.status, s.plan_code, s.status AS sub_status
            FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id AND s.is_current
           WHERE u.full_name ILIKE $1 OR u.email ILIKE $1 OR u.phone ILIKE $1 OR u.client_id::text LIKE $1
           ORDER BY u.client_id LIMIT 8`, [like]),
    many(`SELECT o.id, o.order_no, o.user_id, o.total, o.status, u.full_name FROM orders o JOIN users u ON u.id = o.user_id
           WHERE o.order_no ILIKE $1 OR o.provider_order_id ILIKE $1 ORDER BY o.created_at DESC LIMIT 5`, [like]),
    many(`SELECT t.id, t.ticket_no, t.subject, t.status, t.user_id FROM support_tickets t
           WHERE t.ticket_no ILIKE $1 OR t.subject ILIKE $1 ORDER BY t.created_at DESC LIMIT 5`, [like]),
  ]);
  return { users, orders: ords, tickets: tks };
}

/* ════════════════════════════════════════════════ pulse: the small live numbers in the top bar */
const pulse = () => one(`SELECT
    (SELECT count(*) FROM sessions WHERE NOT revoked AND expires_at > now() AND last_used_at > now() - interval '15 minutes')::int AS online,
    (SELECT count(*) FROM support_tickets WHERE status IN ('open','in_progress'))::int AS tickets,
    (SELECT count(*) FROM login_history WHERE NOT success AND at > now() - interval '1 hour')::int AS fails_1h,
    (SELECT count(*) FROM users WHERE role = 'customer' AND status <> 'deleted')::int AS users,
    (SELECT count(*) FROM subscriptions WHERE is_current AND status IN ('past_due','halted'))::int AS at_risk,
    (SELECT max(at) FROM (SELECT max(at) AS at FROM login_history UNION ALL SELECT max(created_at) FROM orders
                          UNION ALL SELECT max(at) FROM audit_log WHERE action NOT LIKE 'admin.login%') x) AS last_event,
    now() AS db_time`);

const VIEWS = {
  overview: () => overview(),
  users: () => users(),
  user: qs => user(id(qs.id)),
  subs: () => subs(),
  orders: () => orders(),
  activity: () => activity(),
  tickets: () => tickets(),
  ticket: qs => ticket(id(qs.id)),
  ideas: () => ideas(),
  plans: () => plans(),
  messages: () => messages(),
  tables: () => tables(),
  table: qs => table(qs),
  search: qs => search(qs.q),
  pulse: () => pulse(),
};

export default guarded(async (req, res) => {
  if (req.method !== 'GET') throw new UserError('Method not allowed.', 405);
  const qs = query(req);
  const fn = Object.hasOwn(VIEWS, qs.v) ? VIEWS[qs.v] : null;
  if (!fn) throw new UserError('Unknown view.');
  return send(res, 200, await fn(qs));
});
