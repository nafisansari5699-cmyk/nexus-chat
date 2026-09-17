/**
 * js/utils.js — shared helpers: avatars, time, toasts, API fetch wrapper.
 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ── deterministic gradient avatar per user ── */
const PALETTES = [
  ['#00d4a0', '#0084ff'], ['#f97316', '#db2777'], ['#8b5cf6', '#2563eb'],
  ['#10b981', '#0ea5e9'], ['#ef4444', '#f59e0b'], ['#06b6d4', '#3b82f6'],
  ['#a855f7', '#ec4899'], ['#84cc16', '#14b8a6'],
];

export function initialsOf(name = '?') {
  const parts = String(name).trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

export function styleAvatar(el, name, id = 0) {
  const p = PALETTES[(Number(id) || 0) % PALETTES.length];
  el.style.background = `linear-gradient(135deg, ${p[0]}, ${p[1]})`;
  el.textContent = initialsOf(name);
}

export function makeAvatarEl(name, id, cls = 'avatar') {
  const el = document.createElement('span');
  el.className = cls;
  styleAvatar(el, name, id);
  return el;
}

/* ── time formatting ── */
export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function fmtDayChip(ts) {
  const d = new Date(ts), today = new Date();
  const strip = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = (strip(today) - strip(d)) / 86400000;
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

export function fmtListTime(ts) {
  if (!ts) return '';
  const d = new Date(ts), today = new Date();
  if (d.toDateString() === today.toDateString()) return fmtTime(ts);
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
}

export function fmtDuration(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtBytes(n) {
  if (n > 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n > 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}

/* ── toasts ── */
export function toast(msg, kind = '', ms = 2800) {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, ms - 300);
  setTimeout(() => el.remove(), ms);
}

/* ── API helper ── */
export async function api(path, opts = {}) {
  const token = localStorage.getItem('auth:token');
  const res = await fetch(window.API(path), {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  let body = null;
  try { body = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error((body && body.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

/* ── misc ── */
const ENT = { '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": '#39' };

export function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => '&' + ENT[c] + ';');
}

export function linkify(text) {
  // escape first, then hyperlink bare URLs
  return escapeHtml(text).replace(
    /(https?:\/\/[^\s<]+)/g,
    (m) => `<a href="${m}" target="_blank" rel="noopener noreferrer">${m}</a>`
  );
}

export function isEmojiOnly(s) {
  const t = s.replace(/\s/g, '');
  return t.length > 0 && [...t].length <= 3 && !/[\w\d]/.test(t);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); return true; } catch { return false; }
    finally { ta.remove(); }
  }
}
