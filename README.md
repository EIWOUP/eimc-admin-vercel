# EIMC-Admin

The control room for **eimc.vercel.app**. It reads and writes the same PostgreSQL database
as the live site, so every change here shows up on the customer's account page on their next load.
It uses the live site's theme files without changes: fonts, the EIMC mark, `site.css`, `account.css`,
and the light/dark switch with its particle dissolve.

## Run it on this PC

1. Start the database: `C:\EIMC\DB\start-postgres.bat` (it is probably running already).
2. In this folder, run:

   ```
   npm install
   npm run dev
   ```

3. Open http://localhost:4000 and sign in with the admin ID and password from `.env.local`.

`.env.local` already points at the local `eimc` database, the same one `C:\EIMC\eimc.vercel.app.v1.25.218.93`
uses on port 3000. Edits to `api/*.js` route files are picked up without a restart. Shared modules
(`api/_*.js`) need a restart.

## Pages

| Page | What it does |
|---|---|
| Overview | MRR, ARR, revenue, growth, sign-ins, usage heatmap (IST), funnel, plan mix, ending-soon, payment trouble, live activity feed |
| Activity | Every sign-in attempt, live sessions (revoke), the full audit trail, IPs with failures |
| Users | Search, filter (paying, trial, at risk, idle…), health score, CSV export, bulk email/push, +30 days, suspend |
| User | Profile, plan, access dates, licence & PCs, sessions, password, 2-step, orders, refunds, payment methods, tickets, messages, timeline |
| Subscriptions | Every current plan, MRR by plan, ending soon, one-click +30 days |
| Orders & revenue | Monthly revenue, revenue by plan, refund or mark paid, CSV |
| Plans & pricing | Monthly price, regular (struck-through) price, PC limit, on-sale switch, feature matrix. eimc.vercel.app reads these live through its `/api/plans`, so the pricing, offer, buy and account pages follow within a minute. Plans sold: Free and Pro, monthly only. |
| Email & push | Segments or hand-picked users, templates, `{{first_name}}`-style fields, live email and push preview, history |
| Support | Ticket inbox, reply as the EIMC team, status and priority |
| Ideas board | Edit, ship, or delete feature requests |
| Database | Browse, search, edit, add and delete rows in any table |
| SQL console | Read-only by default; writes need a switch and a confirm and go to the audit log |

Shortcuts: **Ctrl K** or **/** opens search, **R** refreshes.

## Email and push

- **Email** goes out through Resend (`RESEND_API_KEY`) or any SMTP server (`SMTP_HOST`, `SMTP_USER`,
  `SMTP_PASS`, optional `SMTP_PORT`). Set `MAIL_FROM` too. With neither, emails are only saved to
  the customer's notifications ("outbox" mode). The app tells you which mode it is in.
- **Push** and **in-app** messages are saved to the `notifications` table with channel `push` or
  `in_app`. Customers see them under **Account → Notifications** on eimc.vercel.app (with an
  unread count in the sidebar); opening that page marks them as read.

## Put it on Vercel

1. Create a new Vercel project from this folder (no build step; it is static pages + `/api` functions).
2. Add environment variables: `DATABASE_URL` (the same pooled Neon URL the live site uses),
   `ADMIN_ID`, `ADMIN_PASSWORD`, `ADMIN_SECRET` (32+ random characters), and the mail keys if you want email.
3. Deploy. The site sends `noindex` and refuses to be framed.

## Security notes

- One admin account, from the environment. The session is an HMAC-signed, HttpOnly, SameSite=Strict
  cookie: 12 hours, or 7 days with "keep me signed in".
- 6 failed sign-ins from one IP in 15 minutes locks that IP out for the rest of the window.
- Every write is checked for same-origin and logged to `audit_log` with actor `admin`.
- Use a long `ADMIN_PASSWORD` before deploying. The admin can change and delete anything.
