'use strict';
const crypto = require('node:crypto');

// Unambiguous alphabet: no 0/O, 1/I/L
const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function licenceKey() {
  const block = () => Array.from({ length: 4 }, () => KEY_ALPHABET[crypto.randomInt(KEY_ALPHABET.length)]).join('');
  return `SNPQ-${block()}-${block()}-${block()}`;
}

function normaliseKey(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(SNPQ)?(.{4})(.{4})(.{4})$/, 'SNPQ-$2-$3-$4');
}

function publicId(prefix = 'ord') {
  return `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function isEmail(s) { return typeof s === 'string' && s.length <= 254 && EMAIL_RE.test(s); }

function maskEmail(e) {
  const [u, d] = String(e || '').split('@');
  if (!d) return '';
  return `${u.slice(0, 2)}${'*'.repeat(Math.max(1, u.length - 2))}@${d}`;
}

function rupees(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN');
}

function hmacHex(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Small fixed-window rate limiter kept in memory (fine for a single server)
function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  return function limited(key) {
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) { h = { count: 0, reset: now + windowMs }; hits.set(key, h); }
    h.count++;
    return h.count > max;
  };
}

function nowIso() { return new Date().toISOString(); }

module.exports = { licenceKey, normaliseKey, publicId, esc, slugify, isEmail, maskEmail, rupees, hmacHex, safeEqual, rateLimiter, nowIso };
