'use strict';
/* ════════════════════════════════════════════════════════════════════
   The EIMC mark on every page: the favicon, the mark in the header,
   and the large hero mark where a page has one.

   There is no boot splash any more (removed 2026-11-18). Visitors land
   straight on the page; the site's entry point is now the Log in
   button in the header. The mark itself is still the product's own
   code from /static/js/logo.js, byte-for-byte.
   ════════════════════════════════════════════════════════════════════ */

import { logoHTML, faviconURL, Logo } from '/static/js/logo.js';

/* the real generated favicon — the sheet, the bands, the journey, the tip */
try {
  const link = document.querySelector('link[rel="icon"]');
  if (link) link.href = faviconURL();
} catch { /* a favicon is never worth breaking a page over */ }

/* every small mark: the header, the login page, the account sidebar */
document.querySelectorAll('#nav-mark, [data-mark]').forEach(host => {
  const size = +host.dataset.size || 26;
  host.innerHTML = logoHTML({ size, boot: false });
  const logo = new Logo(host, { defer: true });
  logo.wake();
  host.addEventListener('mouseenter', () => logo.replay());
});

/* the large hero mark, drawn in once */
const heroHost = document.getElementById('hero-mark');
if (heroHost) {
  const size = +heroHost.dataset.size || 240;
  heroHost.innerHTML = logoHTML({ size, boot: true, tempo: 1 });
  const heroLogo = new Logo(heroHost);
  heroHost.addEventListener('mouseenter', () => heroLogo.replay());
}

document.documentElement.classList.add('booted');
document.body.classList.add('booted');
