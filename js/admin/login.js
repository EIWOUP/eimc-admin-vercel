'use strict';
/* Admin sign-in page. POST /api/auth, then into app.html. */
import { mountThemeToggle } from '/js/theme-toggle.js';

const $ = s => document.querySelector(s);
const form = $('#lg-form'), id = $('#lg-id'), pw = $('#lg-pw'), go = $('#lg-go'), err = $('#lg-err'), card = $('#lg-card');
$('#yr').textContent = new Date().getFullYear();
mountThemeToggle();

$('#lg-eye').addEventListener('click', e => {
  const on = pw.type === 'password';
  pw.type = on ? 'text' : 'password';
  e.currentTarget.setAttribute('aria-pressed', String(on));
  pw.focus();
});
pw.addEventListener('keyup', e => { $('#lg-caps').hidden = !e.getModifierState?.('CapsLock'); });

const show = msg => {
  err.textContent = msg; err.classList.add('on');
  card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
};

form.addEventListener('submit', async e => {
  e.preventDefault();
  err.classList.remove('on');
  [id, pw].forEach(i => i.closest('.inp').classList.toggle('bad', !i.value.trim()));
  if (!id.value.trim() || !pw.value) return show('Enter your admin ID and password.');
  go.disabled = true; go.classList.add('busy');
  try {
    const r = await fetch('/api/auth', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', id: id.value.trim(), password: pw.value, remember: $('#lg-remember').checked }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Could not sign in.');
    go.classList.remove('busy'); go.classList.add('ok');
    $('.lg-go-t').textContent = 'Welcome back';
    const next = new URLSearchParams(location.search).get('next') || '';
    setTimeout(() => location.replace('app.html' + (next.startsWith('#') ? next : '')), 450);
  } catch (ex) {
    go.disabled = false; go.classList.remove('busy');
    pw.value = ''; pw.focus();
    show(ex.message === 'Failed to fetch' ? 'Cannot reach the server. Is it running?' : ex.message);
  }
});
id.focus();
