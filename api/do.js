/* POST /api/do  { action, args }   - every change the admin makes.
   Each write lands in the same tables eimc.vercel.app reads, so the
   customer's account page shows it on their next load, and each one
   leaves a line in audit_log with actor 'admin'. */
import crypto from 'node:crypto';
import { audit, many, one, q, tx } from './_db.js';
import { UserError, body, guarded, send } from './_auth.js';
import { fill, renderEmail, sendMail } from './_mail.js';
import { qi, tableMeta } from './q.js';

const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const nul = (v, max = 200) => { const s = str(v, max); return s === '' ? null : s; };
const bool = v => v === true || v === 'true' || v === 1;
const id = v => { const s = String(v ?? ''); if (!/^\d{1,18}$/.test(s)) throw new UserError('Bad id.'); return s; };
const pick = (v, list, label) => { if (!list.includes(v)) throw new UserError(`Choose a valid ${label}.`); return v; };
const date = (v, label) => { if (v == null || v === '') return null; const d = new Date(v); if (isNaN(d)) throw new UserError(`${label} is not a valid date.`); return d.toISOString(); };

const SUB_STATUS = ['trialing', 'active', 'past_due', 'halted', 'cancelled', 'expired'];
const CYCLES = ['trial', 'monthly'];   // eimc.vercel.app sells monthly only (plus the 1-day Pro trial)
const USER_STATUS = ['active', 'suspended', 'deleted'];
const ROLES = ['customer', 'admin', 'support'];
const TICKET_STATUS = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'];
const PRIORITY = ['low', 'normal', 'high', 'urgent'];
const IDEA_STATUS = ['new', 'review', 'considering', 'planned', 'shipped'];
const ORDER_STATUS = ['created', 'paid', 'failed', 'refunded', 'cancelled'];
const CHANNELS = ['in_app', 'push', 'email', 'sms', 'whatsapp'];
const licenceKey = () => 'EIMC-' + Array.from({ length: 3 }, () => crypto.randomBytes(2).toString('hex').toUpperCase()).join('-');

async function planPrice(c, code, cycle) {
  const r = await c.query(`SELECT price_monthly, max_devices FROM plans WHERE code = $1`, [code]);
  if (!r.rowCount) throw new UserError('Unknown plan.');
  const p = r.rows[0];
  return { price: cycle === 'trial' ? 0 : p.price_monthly, devices: p.max_devices };
}

/* ═══════════════════════════════════════════════════════ users */
const actions = {
  async updateUser([uid, d = {}]) {
    uid = id(uid);
    const first = str(d.first_name, 60), last = str(d.last_name, 60), email = str(d.email, 320).toLowerCase();
    const phoneRaw = str(d.phone, 20).replace(/[\s-]/g, '');
    if (!first) throw new UserError('First name is required.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new UserError('Enter a valid email address.');
    if (phoneRaw && !/^\+?\d{10,15}$/.test(phoneRaw)) throw new UserError('Enter a valid mobile number.');
    const phone = phoneRaw ? (phoneRaw.startsWith('+') ? phoneRaw : `+91${phoneRaw.slice(-10)}`) : null;
    const status = pick(d.status, USER_STATUS, 'status'), role = pick(d.role, ROLES, 'role');
    await tx(async c => {
      await c.query(`UPDATE users SET first_name = $2, last_name = $3, email = $4, phone = $5, status = $6, role = $7,
                       blocked_reason = $8, email_verified = $9, phone_verified = $10 WHERE id = $1`,
        [uid, first, last, email, phone, status, role, nul(d.blocked_reason, 300), bool(d.email_verified), bool(d.phone_verified)]);
      // a suspended or deleted account is signed out everywhere at once
      if (status !== 'active') await c.query(`UPDATE sessions SET revoked = true WHERE user_id = $1 AND NOT revoked`, [uid]);
      await audit(c, uid, 'admin.user.updated', { status, role, email });
    }).catch(e => { if (e.code === '23505') throw new UserError('That email or mobile number already belongs to another account.'); throw e; });
  },

  async updateProfile([uid, d = {}]) {
    uid = id(uid);
    const gstin = str(d.gstin, 15).toUpperCase();
    if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) throw new UserError('That is not a valid 15-character GSTIN.');
    const F = ['city', 'state', 'pincode', 'country', 'address_line1', 'address_line2', 'company_name', 'experience', 'trades', 'language',
      'billing_name', 'billing_line1', 'billing_line2', 'billing_city', 'billing_state', 'billing_pin'];
    const vals = F.map(k => nul(d[k], 200));
    vals[F.indexOf('country')] ||= 'India';
    vals[F.indexOf('language')] ||= 'English';
    await q(`INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [uid]);
    await q(`UPDATE user_profiles SET ${F.map((k, i) => `${k} = $${i + 2}`).join(', ')}, gstin = $${F.length + 2},
               date_of_birth = $${F.length + 3}, updated_at = now() WHERE user_id = $1`,
      [uid, ...vals, gstin || null, d.date_of_birth ? date(d.date_of_birth, 'Date of birth') : null]);
    await audit(null, uid, 'admin.profile.updated');
  },

  async updatePrefs([uid, d = {}]) {
    uid = id(uid);
    const F = ['renewal', 'invoices', 'product', 'setups', 'offers', 'email_billing', 'email_product_updates', 'email_marketing', 'sms_alerts', 'whatsapp_alerts', 'push_alerts'];
    await q(`INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [uid]);
    await q(`UPDATE notification_preferences SET ${F.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE user_id = $1`,
      [uid, ...F.map(k => bool(d[k]))]);
    await audit(null, uid, 'admin.prefs.updated');
  },

  async setPassword([uid, password, signOut]) {
    uid = id(uid);
    const p = String(password || '');
    if (p.length < 8 || p.length > 128) throw new UserError('Use 8 to 128 characters.');
    await tx(async c => {
      await c.query(`SELECT eimc.set_password($1, $2)`, [uid, p]);
      await c.query(`UPDATE user_security SET failed_login_count = 0, locked_until = NULL WHERE user_id = $1`, [uid]);
      if (signOut !== false) await c.query(`UPDATE sessions SET revoked = true WHERE user_id = $1 AND NOT revoked`, [uid]);
      await audit(c, uid, 'admin.password.set', { signedOut: signOut !== false });
    });
  },

  async signOutEverywhere([uid]) {
    uid = id(uid);
    const r = await q(`UPDATE sessions SET revoked = true WHERE user_id = $1 AND NOT revoked`, [uid]);
    await audit(null, uid, 'admin.sessions.revoked', { count: r.rowCount });
    return { count: r.rowCount };
  },

  async revokeSession([sid]) {
    if (!/^[0-9a-f-]{36}$/i.test(String(sid))) throw new UserError('Bad session id.');
    const r = await one(`UPDATE sessions SET revoked = true WHERE id = $1 RETURNING user_id`, [sid]);
    if (r) await audit(null, r.user_id, 'admin.session.revoked');
  },

  async unlock([uid]) {
    uid = id(uid);
    await q(`INSERT INTO user_security (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [uid]);
    await q(`UPDATE user_security SET failed_login_count = 0, locked_until = NULL WHERE user_id = $1`, [uid]);
    // clear the live site's 15-minute login lock for this account's ids
    await q(`DELETE FROM login_history h USING users u WHERE u.id = $1 AND NOT h.success AND h.at > now() - interval '15 minutes'
               AND (h.user_id = u.id OR lower(h.login_id) IN (lower(u.email), u.client_id::text))`, [uid]);
    await audit(null, uid, 'admin.user.unlocked');
  },

  async setTwoFactor([uid, on]) {
    uid = id(uid);
    await q(`UPDATE user_security SET two_factor_enabled = $2, two_factor_method = CASE WHEN $2 THEN coalesce(two_factor_method, 'email') END,
               totp_secret_enc = CASE WHEN $2 THEN totp_secret_enc END WHERE user_id = $1`, [uid, bool(on)]);
    await audit(null, uid, bool(on) ? 'admin.2fa.enabled' : 'admin.2fa.disabled');
  },

  async deleteUser([uid, hard]) {
    uid = id(uid);
    if (bool(hard)) {
      const r = await one(`DELETE FROM users WHERE id = $1 RETURNING client_id, full_name, email`, [uid]);
      if (!r) throw new UserError('That user no longer exists.');
      await audit(null, null, 'admin.user.deleted', r);
      return { deleted: true };
    }
    await tx(async c => {
      await c.query(`UPDATE users SET status = 'deleted' WHERE id = $1`, [uid]);
      await c.query(`UPDATE sessions SET revoked = true WHERE user_id = $1`, [uid]);
      await audit(c, uid, 'admin.user.soft_deleted');
    });
  },

  async createUser([d = {}]) {
    const first = str(d.first_name, 60), last = str(d.last_name, 60), email = str(d.email, 320).toLowerCase();
    const phoneRaw = str(d.phone, 20).replace(/[\s-]/g, '');
    const password = String(d.password || '');
    if (!first) throw new UserError('First name is required.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new UserError('Enter a valid email address.');
    if (phoneRaw && !/^\+?\d{10,15}$/.test(phoneRaw)) throw new UserError('Enter a valid mobile number.');
    if (password.length < 8) throw new UserError('The password needs at least 8 characters.');
    const phone = phoneRaw ? (phoneRaw.startsWith('+') ? phoneRaw : `+91${phoneRaw.slice(-10)}`) : null;
    const plan = d.plan && d.plan !== 'none' ? d.plan : null;
    return tx(async c => {
      const u = (await c.query(`INSERT INTO users (first_name, last_name, email, phone, password_hash, email_verified)
                                VALUES ($1, $2, $3, $4, crypt($5, gen_salt('bf', 10)), $6) RETURNING id, client_id`,
        [first, last, email, phone, password, bool(d.email_verified)])).rows[0];
      await c.query(`INSERT INTO user_profiles (user_id, city, state, billing_name) VALUES ($1, $2, $3, $4)`, [u.id, nul(d.city, 80), nul(d.state, 80), `${first} ${last}`.trim()]);
      await c.query(`INSERT INTO user_security (user_id) VALUES ($1)`, [u.id]);
      await c.query(`INSERT INTO notification_preferences (user_id) VALUES ($1)`, [u.id]);
      if (plan) {
        const cycle = pick(d.cycle || 'monthly', CYCLES, 'billing cycle');
        const { price, devices } = await planPrice(c, plan, cycle);
        const days = Math.max(1, Math.min(3660, +d.days || (cycle === 'trial' ? 1 : 30)));
        await c.query(`INSERT INTO subscriptions (user_id, plan_code, billing_cycle, status, price, current_period_start, current_period_end, trial_end, seats, auto_renew)
                       VALUES ($1, $2, $3, $4, $5, now(), now() + make_interval(days => $6), CASE WHEN $3 = 'trial' THEN now() + make_interval(days => $6) END, $7, $3 <> 'trial')`,
          [u.id, plan, cycle, cycle === 'trial' ? 'trialing' : 'active', price, days, devices]);
        await c.query(`INSERT INTO licences (user_id, licence_key, max_devices) VALUES ($1, $2, $3)`, [u.id, licenceKey(), devices]);
      }
      await audit(c, u.id, 'admin.user.created', { plan });
      return { id: u.id, client_id: u.client_id };
    }).catch(e => { if (e.code === '23505') throw new UserError('That email or mobile number already belongs to another account.'); throw e; });
  },

  /* ═══════════════════════════════════════════════════════ subscription */
  async saveSubscription([uid, d = {}]) {
    uid = id(uid);
    const plan = str(d.plan_code, 20);
    const cycle = pick(d.billing_cycle, CYCLES, 'billing cycle');
    const status = pick(d.status, SUB_STATUS, 'status');
    const end = date(d.current_period_end, 'Period end');
    const start = date(d.current_period_start, 'Period start');
    const trialEnd = cycle === 'trial' ? (date(d.trial_end, 'Trial end') || end) : null;
    const nextCycle = d.next_cycle ? pick(d.next_cycle, ['monthly'], 'next cycle') : null;
    return tx(async c => {
      const { price: listPrice, devices } = await planPrice(c, plan, cycle);
      const price = d.price === '' || d.price == null ? listPrice : Math.max(0, Number(d.price));
      if (!isFinite(price)) throw new UserError('Price is not a number.');
      const seats = d.seats ? Math.max(1, Math.min(50, +d.seats)) : devices;
      const cur = (await c.query(`SELECT * FROM subscriptions WHERE user_id = $1 AND is_current FOR UPDATE`, [uid])).rows[0];
      const vals = [plan, cycle, status, price, start, end, trialEnd, bool(d.cancel_at_period_end), bool(d.auto_renew), nextCycle, seats, nul(d.cancel_reason, 500)];
      let subId;
      if (cur && cur.plan_code === plan && cur.billing_cycle === cycle) {
        // same plan: edit the current row in place
        await c.query(`UPDATE subscriptions SET plan_code = $2, billing_cycle = $3, status = $4, price = $5,
                         current_period_start = coalesce($6, current_period_start), current_period_end = $7, trial_end = $8,
                         cancel_at_period_end = $9, auto_renew = $10, next_cycle = $11, seats = $12, cancel_reason = $13,
                         cancelled_at = CASE WHEN $4 = 'cancelled' OR $9 THEN coalesce(cancelled_at, now()) END
                       WHERE id = $1`, [cur.id, ...vals]);
        subId = cur.id;
      } else {
        // a plan or cycle change: keep the old row as history, start a new current one
        if (cur) await c.query(`UPDATE subscriptions SET is_current = false, status = CASE WHEN status IN ('active','trialing','past_due') THEN 'expired' ELSE status END WHERE id = $1`, [cur.id]);
        const r = await c.query(`INSERT INTO subscriptions (user_id, plan_code, billing_cycle, status, price, current_period_start, current_period_end, trial_end,
                                   cancel_at_period_end, auto_renew, next_cycle, seats, cancel_reason, payment_method_id, started_at)
                                 VALUES ($1, $2, $3, $4, $5, coalesce($6, now()), $7, $8, $9, $10, $11, $12, $13,
                                   (SELECT id FROM payment_methods WHERE user_id = $1 AND is_default AND status = 'active' LIMIT 1), now())
                                 RETURNING id`, [uid, ...vals]);
        subId = r.rows[0].id;
      }
      // the licence follows the plan's device limit
      await c.query(`INSERT INTO licences (user_id, licence_key, max_devices) VALUES ($1, $2, $3)
                     ON CONFLICT (user_id) DO UPDATE SET max_devices = EXCLUDED.max_devices`, [uid, licenceKey(), seats]);
      await audit(c, uid, 'admin.subscription.saved', { from: cur ? `${cur.plan_code}/${cur.billing_cycle}/${cur.status}` : null, to: `${plan}/${cycle}/${status}`, end });
      return { id: subId };
    });
  },

  /* +days of access, from today or from the current end, whichever is later */
  async extend([uid, days]) {
    uid = id(uid);
    const n = Math.round(+days);
    if (!(n >= -3660 && n <= 3660 && n !== 0)) throw new UserError('Days must be between -3660 and 3660.');
    const r = await one(`UPDATE subscriptions SET
          current_period_end = greatest(coalesce(CASE WHEN status = 'trialing' THEN trial_end END, current_period_end), now()) + make_interval(days => $2),
          trial_end = CASE WHEN status = 'trialing' THEN greatest(trial_end, now()) + make_interval(days => $2) ELSE trial_end END,
          status = CASE WHEN $2 > 0 AND status IN ('expired','halted','past_due') THEN 'active' ELSE status END
        WHERE user_id = $1 AND is_current RETURNING current_period_end, status`, [uid, n]);
    if (!r) throw new UserError('This user has no subscription. Give them a plan first.');
    await audit(null, uid, 'admin.subscription.extended', { days: n, until: r.current_period_end });
    return r;
  },

  async subQuick([uid, what]) {
    uid = id(uid);
    const SQL = {
      cancel: `cancel_at_period_end = true, auto_renew = false, cancelled_at = now(), status = CASE WHEN status = 'active' THEN 'cancelled' ELSE status END`,
      resume: `cancel_at_period_end = false, auto_renew = true, cancelled_at = NULL, cancel_reason = NULL,
               status = CASE WHEN status = 'cancelled' AND current_period_end > now() THEN 'active' ELSE status END`,
      expire: `status = 'expired', current_period_end = least(current_period_end, now()), trial_end = CASE WHEN trial_end > now() THEN now() ELSE trial_end END, auto_renew = false`,
      activate: `status = 'active', current_period_end = greatest(current_period_end, now() + interval '1 day')`,
      past_due: `status = 'past_due'`,
      halt: `status = 'halted'`,
    };
    if (!Object.hasOwn(SQL, what)) throw new UserError('Unknown change.');
    const r = await q(`UPDATE subscriptions SET ${SQL[what]} WHERE user_id = $1 AND is_current`, [uid]);
    if (!r.rowCount) throw new UserError('This user has no subscription.');
    await audit(null, uid, `admin.subscription.${what}`);
  },

  async removePlan([uid]) {
    uid = id(uid);
    const r = await q(`UPDATE subscriptions SET is_current = false, status = 'expired', auto_renew = false WHERE user_id = $1 AND is_current`, [uid]);
    await audit(null, uid, 'admin.subscription.removed', { rows: r.rowCount });
  },

  /* ═══════════════════════════════════════════════════════ licence & devices */
  async licence([uid, what, value]) {
    uid = id(uid);
    if (what === 'issue' || what === 'regenerate') {
      const key = licenceKey();
      await q(`INSERT INTO licences (user_id, licence_key, max_devices) VALUES ($1, $2, coalesce((SELECT seats FROM subscriptions WHERE user_id = $1 AND is_current), 1))
               ON CONFLICT (user_id) DO UPDATE SET licence_key = EXCLUDED.licence_key, last_issued_at = now(), revoked = false`, [uid, key]);
      await audit(null, uid, `admin.licence.${what}`);
      return { key };
    }
    const SQL = {
      revoke: () => [`revoked = true, broker_status = 'expired'`],
      restore: () => [`revoked = false`],
      devices: () => [`max_devices = $2`, Math.max(1, Math.min(50, +value || 1))],
      broker: () => [`broker_status = $2`, pick(value, ['connected', 'not connected', 'expired'], 'broker status')],
      version: () => [`app_version = $2`, str(value, 40) || 'v1.25.218.93'],
    };
    if (!Object.hasOwn(SQL, what)) throw new UserError('Unknown licence change.');
    const [set, v] = SQL[what]();
    const r = await q(`UPDATE licences SET ${set} WHERE user_id = $1`, v === undefined ? [uid] : [uid, v]);
    if (!r.rowCount) throw new UserError('This user has no licence yet. Issue one first.');
    await audit(null, uid, `admin.licence.${what}`, v === undefined ? null : { value: v });
  },

  async device([did, what]) {
    did = id(did);
    let r;
    if (what === 'delete') r = await one(`DELETE FROM devices WHERE id = $1 RETURNING user_id, label`, [did]);
    else r = await one(`UPDATE devices SET revoked = $2 WHERE id = $1 RETURNING user_id, label`, [did, what === 'revoke']);
    if (!r) throw new UserError('That device was not found.');
    await audit(null, r.user_id, `admin.device.${what}`, { label: r.label });
  },

  async paymentMethod([pid, what]) {
    pid = id(pid);
    const pm = await one(`SELECT user_id FROM payment_methods WHERE id = $1`, [pid]);
    if (!pm) throw new UserError('That payment method was not found.');
    await tx(async c => {
      if (what === 'default') {
        await c.query(`UPDATE payment_methods SET is_default = false WHERE user_id = $1 AND is_default`, [pm.user_id]);
        await c.query(`UPDATE payment_methods SET is_default = true, status = 'active' WHERE id = $1`, [pid]);
        await c.query(`UPDATE subscriptions SET payment_method_id = $1 WHERE user_id = $2 AND is_current`, [pid, pm.user_id]);
      } else if (what === 'remove') {
        await c.query(`UPDATE payment_methods SET status = 'removed', is_default = false WHERE id = $1`, [pid]);
      } else throw new UserError('Unknown change.');
      await audit(c, pm.user_id, `admin.payment_method.${what}`);
    });
  },

  /* ═══════════════════════════════════════════════════════ orders */
  async orderStatus([oid, status]) {
    oid = id(oid);
    status = pick(status, ORDER_STATUS, 'order status');
    await tx(async c => {
      const o = (await c.query(`UPDATE orders SET status = $2 WHERE id = $1 RETURNING user_id, order_no, total`, [oid, status])).rows[0];
      if (!o) throw new UserError('That order was not found.');
      const ps = { paid: 'captured', failed: 'failed', refunded: 'refunded' }[status];
      if (ps) await c.query(`UPDATE payments SET status = $2 WHERE order_id = $1`, [oid, ps]);
      if (status === 'refunded') await c.query(`UPDATE invoices SET status = 'refunded' WHERE order_id = $1`, [oid]);
      if (status === 'paid') await c.query(`UPDATE invoices SET status = 'paid' WHERE order_id = $1`, [oid]);
      if (status === 'cancelled') await c.query(`UPDATE invoices SET status = 'void' WHERE order_id = $1`, [oid]);
      await audit(c, o.user_id, `admin.order.${status}`, { order: o.order_no, total: o.total });
    });
  },

  /* a manual order: offline payment, a comp, a correction. Paid ones get an invoice. */
  async createOrder([uid, d = {}]) {
    uid = id(uid);
    const amount = Math.max(0, Number(d.amount)), discount = Math.max(0, Number(d.discount || 0));
    if (!isFinite(amount)) throw new UserError('Amount is not a number.');
    if (discount > amount) throw new UserError('Discount is larger than the amount.');
    const status = pick(d.status || 'paid', ORDER_STATUS, 'order status');
    const cycle = d.billing_cycle ? pick(d.billing_cycle, CYCLES, 'billing cycle') : null;
    return tx(async c => {
      const u = (await c.query(`SELECT u.full_name, p.billing_name, p.gstin FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = $1`, [uid])).rows[0];
      if (!u) throw new UserError('That user does not exist.');
      const o = (await c.query(`INSERT INTO orders (user_id, subscription_id, plan_code, billing_cycle, description, amount, discount, coupon_code, status, provider_order_id)
                                VALUES ($1, (SELECT id FROM subscriptions WHERE user_id = $1 AND is_current), $2, $3, $4, $5, $6, $7, $8, $9)
                                RETURNING id, order_no, gst_amount, total`,
        [uid, nul(d.plan_code, 20), cycle, str(d.description, 200) || 'Manual order', amount, discount, nul(d.coupon_code, 40), status, `admin_${Date.now()}`])).rows[0];
      if (status === 'paid') {
        await c.query(`INSERT INTO payments (order_id, user_id, amount, status, provider, provider_payment_id) VALUES ($1, $2, $3, 'captured', 'manual', $4)`,
          [o.id, uid, o.total, `manual_${o.id}`]);
        const no = (await c.query(`SELECT 'EIMC/' || to_char(now(), 'YY') || '-' || lpad(nextval('eimc.invoice_no_seq')::text, 5, '0') AS n`)).rows[0].n;
        await c.query(`INSERT INTO invoices (invoice_no, order_id, user_id, billing_name, billing_gstin, subtotal, gst_amount, total, status)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'paid')`,
          [no, o.id, uid, u.billing_name || u.full_name, u.gstin, amount - discount, o.gst_amount, o.total]);
      }
      await audit(c, uid, 'admin.order.created', { order: o.order_no, total: o.total, status });
      return o;
    });
  },

  /* ═══════════════════════════════════════════════════════ support */
  async ticketReply([tid, text, status]) {
    tid = id(tid);
    const msg = str(text, 4000);
    if (!msg) throw new UserError('Write a reply first.');
    const next = status ? pick(status, TICKET_STATUS, 'ticket status') : 'waiting_customer';
    await tx(async c => {
      const t = (await c.query(`UPDATE support_tickets SET status = $2, resolved_at = CASE WHEN $2 IN ('resolved','closed') THEN now() END
                                WHERE id = $1 RETURNING user_id, ticket_no, subject`, [tid, next])).rows[0];
      if (!t) throw new UserError('That ticket was not found.');
      await c.query(`INSERT INTO support_messages (ticket_id, sender, body) VALUES ($1, 'agent', $2)`, [tid, msg]);
      await c.query(`INSERT INTO notifications (user_id, channel, title, body) VALUES ($1, 'in_app', $2, $3)`,
        [t.user_id, `Reply on ${t.ticket_no}: ${t.subject}`.slice(0, 200), msg.slice(0, 500)]);
      await audit(c, t.user_id, 'admin.ticket.replied', { ticket: t.ticket_no, status: next });
    });
  },

  async ticketSet([tid, d = {}]) {
    tid = id(tid);
    const status = pick(d.status, TICKET_STATUS, 'ticket status'), priority = pick(d.priority, PRIORITY, 'priority');
    const r = await one(`UPDATE support_tickets SET status = $2, priority = $3,
                           resolved_at = CASE WHEN $2 IN ('resolved','closed') THEN coalesce(resolved_at, now()) END
                         WHERE id = $1 RETURNING user_id, ticket_no`, [tid, status, priority]);
    if (!r) throw new UserError('That ticket was not found.');
    await audit(null, r.user_id, 'admin.ticket.updated', { ticket: r.ticket_no, status, priority });
  },

  async ticketDelete([tid]) {
    tid = id(tid);
    const r = await one(`DELETE FROM support_tickets WHERE id = $1 RETURNING user_id, ticket_no`, [tid]);
    if (r) await audit(null, r.user_id, 'admin.ticket.deleted', { ticket: r.ticket_no });
  },

  /* ═══════════════════════════════════════════════════════ ideas board */
  async ideaSave([fid, d = {}]) {
    const title = str(d.title, 90);
    if (!title) throw new UserError('The idea needs a title.');
    const status = pick(d.status, IDEA_STATUS, 'status');
    const vals = [title, str(d.description, 1200), status, str(d.tag, 30) || 'Terminal', Math.max(0, Math.round(+d.base_votes || 0)), nul(d.shipped_version, 30)];
    if (fid) {
      fid = id(fid);
      await q(`UPDATE feature_requests SET title = $2, description = $3, status = $4, tag = $5, base_votes = $6, shipped_version = $7 WHERE id = $1`, [fid, ...vals]);
      await audit(null, null, 'admin.idea.updated', { id: fid, status });
      return { id: fid };
    }
    const r = await one(`INSERT INTO feature_requests (title, description, status, tag, base_votes, shipped_version) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, vals);
    await audit(null, null, 'admin.idea.created', { id: r.id });
    return r;
  },
  async ideaDelete([fid]) {
    fid = id(fid);
    await q(`DELETE FROM feature_requests WHERE id = $1`, [fid]);
    await audit(null, null, 'admin.idea.deleted', { id: fid });
  },

  /* ═══════════════════════════════════════════════════════ plans */
  async planSave([code, d = {}]) {
    const name = str(d.name, 40);
    if (!name) throw new UserError('The plan needs a name.');
    const pm = Number(d.price_monthly), dev = Math.round(+d.max_devices);
    const lp = d.list_price === '' || d.list_price == null ? null : Number(d.list_price);
    if (!(pm >= 0) || (lp != null && !(lp >= 0))) throw new UserError('Prices must be numbers, 0 or more.');
    if (lp != null && lp > 0 && lp <= pm) throw new UserError('The regular price must be higher than the price charged, or left blank.');
    if (!(dev >= 1 && dev <= 50)) throw new UserError('Devices must be 1 to 50.');
    const r = await q(`UPDATE plans SET name = $2, description = $3, price_monthly = $4, list_price = $5, max_devices = $6, is_sellable = $7, sort_order = $8 WHERE code = $1`,
      [str(code, 20), name, str(d.description, 200), pm, lp || null, dev, bool(d.is_sellable), Math.round(+d.sort_order || 0)]);
    if (!r.rowCount) throw new UserError('Unknown plan.');
    await audit(null, null, 'admin.plan.updated', { code, price_monthly: pm, list_price: lp || null });
  },
  async planCreate([d = {}]) {
    const code = str(d.code, 20).toLowerCase();
    if (!/^[a-z][a-z0-9_]{1,19}$/.test(code)) throw new UserError('Code: lowercase letters, digits, underscore.');
    await q(`INSERT INTO plans (code, name, description, price_monthly, list_price, max_devices, is_sellable, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, false, (SELECT coalesce(max(sort_order), 0) + 1 FROM plans))`,
      [code, str(d.name, 40) || code, str(d.description, 200), Math.max(0, +d.price_monthly || 0), +d.list_price > 0 ? +d.list_price : null, Math.max(1, +d.max_devices || 1)])
      .catch(e => { if (e.code === '23505') throw new UserError('A plan with that code already exists.'); throw e; });
    await audit(null, null, 'admin.plan.created', { code });
  },
  async planFeature([code, feature, on]) {
    if (bool(on)) await q(`INSERT INTO plan_features (plan_code, feature_code) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [str(code, 20), str(feature, 40)]);
    else await q(`DELETE FROM plan_features WHERE plan_code = $1 AND feature_code = $2`, [str(code, 20), str(feature, 40)]);
    await audit(null, null, 'admin.plan.feature', { code, feature, on: bool(on) });
  },

  /* ═══════════════════════════════════════════════════════ messaging: email + push */
  async audience([target]) { const list = await audienceOf(target); return { count: list.length, sample: list.slice(0, 12).map(u => ({ id: u.id, name: u.full_name, email: u.email })) }; },

  async notify([target, m = {}]) {
    const channels = (Array.isArray(m.channels) ? m.channels : [m.channel]).filter(ch => CHANNELS.includes(ch));
    if (!channels.length) throw new UserError('Pick at least one channel.');
    const title = str(m.title, 200), text = str(m.body, 8000);
    if (!title || !text) throw new UserError('Add a title and a message.');
    const people = await audienceOf(target);
    if (!people.length) throw new UserError('Nobody matches that audience.');
    if (people.length > 2000) throw new UserError('That is more than 2,000 people. Narrow the audience.');

    const out = { people: people.length, push: 0, in_app: 0, email: 0, emailFailed: 0, errors: [], mode: null };
    const rows = [];
    for (const ch of channels.filter(c => c !== 'email')) {
      for (const u of people) rows.push([u.id, ch, fill(title, u), fill(text, u).slice(0, 4000)]);
      out[ch] = people.length;
    }
    if (channels.includes('email')) {
      const queue = [...people];
      const work = async () => {
        while (queue.length) {
          const u = queue.shift();
          const subject = fill(title, u), bodyText = fill(text, u);
          const r = await sendMail({ to: u.email, subject, text: bodyText, html: renderEmail({ subject, body: bodyText, cta: m.cta, ctaUrl: m.ctaUrl }) });
          out.mode = r.mode;
          if (r.ok) { out.email++; rows.push([u.id, 'email', subject, bodyText.slice(0, 4000)]); }
          else { out.emailFailed++; if (out.errors.length < 5) out.errors.push(`${u.email}: ${r.error}`); }
        }
      };
      await Promise.all(Array.from({ length: Math.min(5, people.length) }, work));
    }
    // one multi-row insert for the record
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      await q(`INSERT INTO notifications (user_id, channel, title, body) VALUES ${chunk.map((_, j) => `($${j * 4 + 1}, $${j * 4 + 2}, $${j * 4 + 3}, $${j * 4 + 4})`).join(', ')}`, chunk.flat());
    }
    await audit(null, people.length === 1 ? people[0].id : null, 'admin.message.sent',
      { channels, title, people: people.length, email: out.email, emailFailed: out.emailFailed, mode: out.mode, target: typeof target === 'string' ? target : 'selected' });
    return out;
  },

  async previewEmail([m = {}, uid]) {
    const u = uid ? await audienceOf({ ids: [uid] }).then(r => r[0]) : null;
    const sample = u || { full_name: 'Gaurav Ahir', first_name: 'Gaurav', last_name: 'Ahir', email: 'customer@example.com', client_id: 2222001, plan_name: 'Pro', sub_status: 'active', access_until: new Date(Date.now() + 20 * 864e5) };
    const subject = fill(str(m.title, 200) || 'Your subject', sample);
    const text = fill(str(m.body, 8000) || 'Your message', sample);
    return { subject, text, html: renderEmail({ subject, body: text, cta: m.cta, ctaUrl: m.ctaUrl }) };
  },

  async noteDelete([nid]) { await q(`DELETE FROM notifications WHERE id = $1`, [id(nid)]); },
  async noteRead([nid, on]) { await q(`UPDATE notifications SET is_read = $2 WHERE id = $1`, [id(nid), bool(on)]); },

  /* ═══════════════════════════════════════════════════════ database explorer */
  async rowSave([table, pk, values = {}]) {
    const meta = await tableMeta();
    const cols = meta[table];
    if (!cols) throw new UserError('Unknown table.');
    const pks = cols.filter(c => c.pk);
    const editable = cols.filter(c => !c.generated && Object.hasOwn(values, c.column_name));
    const set = editable.map((c, i) => `${qi(c.column_name)} = $${i + 1}`);
    const vals = editable.map(c => (values[c.column_name] === null ? null : String(values[c.column_name])));
    let r;
    if (pk && Object.keys(pk).length) {
      if (!pks.length || !pks.every(c => Object.hasOwn(pk, c.column_name))) throw new UserError('This table has no primary key to edit by.');
      if (!set.length) return { rows: 0 };
      const where = pks.map((c, i) => `${qi(c.column_name)}::text = $${vals.length + i + 1}`).join(' AND ');
      r = await q(`UPDATE eimc.${qi(table)} SET ${set.join(', ')} WHERE ${where}`, [...vals, ...pks.map(c => String(pk[c.column_name]))]);
    } else {
      const given = editable.filter(c => values[c.column_name] !== '' || c.nullable === false);
      const gv = given.map(c => (values[c.column_name] === null ? null : String(values[c.column_name])));
      r = given.length
        ? await q(`INSERT INTO eimc.${qi(table)} (${given.map(c => qi(c.column_name)).join(', ')}) VALUES (${given.map((_, i) => `$${i + 1}`).join(', ')})`, gv)
        : await q(`INSERT INTO eimc.${qi(table)} DEFAULT VALUES`);
    }
    await audit(null, null, pk ? 'admin.db.row_updated' : 'admin.db.row_inserted', { table, pk: pk || null });
    return { rows: r.rowCount };
  },

  async rowDelete([table, pk]) {
    const meta = await tableMeta();
    const cols = meta[table];
    if (!cols) throw new UserError('Unknown table.');
    const pks = cols.filter(c => c.pk);
    if (!pks.length || !pk || !pks.every(c => Object.hasOwn(pk, c.column_name))) throw new UserError('This table has no primary key to delete by.');
    const r = await q(`DELETE FROM eimc.${qi(table)} WHERE ${pks.map((c, i) => `${qi(c.column_name)}::text = $${i + 1}`).join(' AND ')}`, pks.map(c => String(pk[c.column_name])));
    await audit(null, null, 'admin.db.row_deleted', { table, pk });
    return { rows: r.rowCount };
  },
};

/* who a message goes to: { ids:[..] } or a segment name */
const SEGMENTS = {
  all: `true`,
  paying: `s.status IN ('active','past_due') AND s.billing_cycle <> 'trial'`,
  trialing: `s.status = 'trialing'`,
  at_risk: `s.status IN ('past_due','halted')`,
  churned: `s.status IN ('cancelled','expired')`,
  expiring: `eimc.access_until(s) BETWEEN now() AND now() + interval '7 days'`,
  no_plan: `(s.id IS NULL OR s.plan_code = 'free')`,
  inactive: `(u.last_login_at IS NULL OR u.last_login_at < now() - interval '14 days')`,
  plan_pro: `s.plan_code = 'pro'`,
  offers_opt_in: `np.offers`,
};
async function audienceOf(target) {
  const base = `SELECT u.id, u.client_id, u.first_name, u.last_name, u.full_name, u.email, pl.name AS plan_name, s.status AS sub_status, eimc.access_until(s) AS access_until
      FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id AND s.is_current LEFT JOIN plans pl ON pl.code = s.plan_code
      LEFT JOIN notification_preferences np ON np.user_id = u.id`;
  if (target && typeof target === 'object' && Array.isArray(target.ids)) {
    const ids = target.ids.map(String).filter(v => /^\d{1,18}$/.test(v)).slice(0, 5000);
    if (!ids.length) return [];
    return many(`${base} WHERE u.id = ANY($1::bigint[]) AND u.status <> 'deleted' ORDER BY u.client_id`, [ids]);
  }
  if (typeof target !== 'string' || !Object.hasOwn(SEGMENTS, target)) throw new UserError('Choose who to send to.');
  return many(`${base} WHERE u.role = 'customer' AND u.status = 'active' AND (${SEGMENTS[target]}) ORDER BY u.client_id`);
}

export default guarded(async (req, res) => {
  if (req.method !== 'POST') throw new UserError('Method not allowed.', 405);
  const b = await body(req);
  const fn = Object.hasOwn(actions, b.action) ? actions[b.action] : null;
  if (!fn) throw new UserError('Unknown action.');
  const result = await fn(Array.isArray(b.args) ? b.args : []);
  return send(res, 200, result ?? { ok: true });
});
