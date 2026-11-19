/* Email out of the admin.
   Provider, in this order:
     RESEND_API_KEY                         -> Resend HTTPS API
     SMTP_HOST + SMTP_USER + SMTP_PASS      -> any SMTP server (Gmail app password, Zoho, SES ...)
     neither                                -> "outbox" mode: the message is saved to the user's
                                               notifications (channel 'email') but not delivered.
   MAIL_FROM sets the sender, e.g.  EIMC <support@eimc.app> */

export function mailMode() {
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) return 'smtp';
  return 'outbox';
}

const from = () => process.env.MAIL_FROM || (process.env.SMTP_USER ? `EIMC <${process.env.SMTP_USER}>` : 'EIMC <onboarding@resend.dev>');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* {{name}} style fields */
export function fill(text, u) {
  const map = {
    name: u.full_name, first_name: u.first_name, last_name: u.last_name, email: u.email,
    client_id: u.client_id, plan: u.plan_name || 'Free', status: u.sub_status || 'free',
    access_until: u.access_until ? new Date(u.access_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—',
  };
  return String(text || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => (k in map ? String(map[k] ?? '') : m));
}

/* the branded email: the site's navy, its blue accent, Arial so every client renders it */
export function renderEmail({ subject, body, cta, ctaUrl }) {
  const paras = esc(body).split(/\n{2,}/).map(p => `<p style="margin:0 0 16px;font:15px/1.65 Arial,Helvetica,sans-serif;color:#c3cad7">${p.replace(/\n/g, '<br>')
    .replace(/\*\*(.+?)\*\*/g, '<b style="color:#eef1f7">$1</b>')}</p>`).join('');
  const button = cta && ctaUrl
    ? `<p style="margin:26px 0 6px"><a href="${esc(ctaUrl)}" style="display:inline-block;padding:14px 26px;border-radius:999px;background:#4c7dff;color:#ffffff;font:700 14px/1 Arial,Helvetica,sans-serif;text-decoration:none">${esc(cta)} &rarr;</a></p>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#06080d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#06080d;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 6px 18px"><span style="display:inline-block;width:22px;height:22px;border-radius:6px;background:#141821;border:1px solid #232c3c;vertical-align:middle"></span>
<span style="font:700 14px/1 Arial,Helvetica,sans-serif;letter-spacing:.12em;color:#eef1f7;vertical-align:middle;margin-left:8px">EIMC</span>
<span style="font:400 9px/1 Arial,Helvetica,sans-serif;letter-spacing:.3em;color:#5b6578;vertical-align:middle;margin-left:4px">TERMINAL</span></td></tr>
<tr><td style="background:#0b0f17;border:1px solid #19202d;border-radius:18px;padding:34px 32px">
<div style="height:3px;width:56px;border-radius:3px;background:linear-gradient(90deg,#4c7dff,#38bdf8,#b39dff);margin:0 0 22px"></div>
<h1 style="margin:0 0 18px;font:700 24px/1.25 Arial,Helvetica,sans-serif;letter-spacing:-.02em;color:#eef1f7">${esc(subject)}</h1>
${paras}${button}
</td></tr>
<tr><td style="padding:18px 8px 0;font:12px/1.6 Arial,Helvetica,sans-serif;color:#5b6578">You get this email because you have an EIMC account. Manage emails in your account &rarr; Notifications.<br>&copy; ${new Date().getFullYear()} EIMC &middot; eimc.vercel.app</td></tr>
</table></td></tr></table></body></html>`;
}

let transport;
async function smtp() {
  if (transport) return transport;
  const { default: nodemailer } = await import('nodemailer');
  const port = +(process.env.SMTP_PORT || 465);
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port, secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transport;
}

/* -> { ok, mode, id?, error? } */
export async function sendMail({ to, subject, html, text }) {
  const mode = mailMode();
  try {
    if (mode === 'resend') {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: from(), to: [to], subject, html, text }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, mode, error: j.message || `Resend ${r.status}` };
      return { ok: true, mode, id: j.id };
    }
    if (mode === 'smtp') {
      const info = await (await smtp()).sendMail({ from: from(), to, subject, html, text });
      return { ok: true, mode, id: info.messageId };
    }
    return { ok: true, mode, queued: true };
  } catch (e) {
    return { ok: false, mode, error: String(e.message || e).slice(0, 200) };
  }
}
