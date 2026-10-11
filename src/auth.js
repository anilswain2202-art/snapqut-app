'use strict';
const crypto = require('node:crypto');
const { db } = require('./db');
const { safeEqual, rateLimiter } = require('./util');

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const COOKIE = 'sq_admin';
const TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
const loginLimited = rateLimiter({ windowMs: 15 * 60 * 1000, max: 8 });

const ins = db.prepare('INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)');
const get = db.prepare('SELECT * FROM sessions WHERE token_hash = ?');
const del = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
const purge = db.prepare('DELETE FROM sessions WHERE expires_at < ?');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const configured = () => Boolean(ADMIN_EMAIL && ADMIN_PASSWORD && ADMIN_PASSWORD.length >= 10);

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function cookieFlags(req) {
  const secure = process.env.NODE_ENV === 'production' || req.secure;
  return `Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

function login(req, res) {
  if (!configured()) return res.status(503).json({ error: 'Admin login is not set up. Add ADMIN_EMAIL and ADMIN_PASSWORD (10+ characters) to .env and restart.' });
  if (loginLimited(req.ip)) return res.status(429).json({ error: 'Too many attempts. Wait 15 minutes and try again.' });
  const { email, password } = req.body || {};
  const ok = safeEqual(sha(String(email || '').trim().toLowerCase()), sha(ADMIN_EMAIL)) && safeEqual(sha(String(password || '')), sha(ADMIN_PASSWORD));
  if (!ok) return res.status(401).json({ error: 'That email and password don’t match.' });
  const token = crypto.randomBytes(32).toString('base64url');
  purge.run(Date.now());
  ins.run(sha(token), Date.now() + TTL_MS);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Max-Age=${TTL_MS / 1000}; ${cookieFlags(req)}`);
  res.json({ ok: true, email: ADMIN_EMAIL });
}

function logout(req, res) {
  const t = readCookie(req, COOKIE);
  if (t) del.run(sha(t));
  res.setHeader('Set-Cookie', `${COOKIE}=; Max-Age=0; ${cookieFlags(req)}`);
  res.json({ ok: true });
}

function isAuthed(req) {
  const t = readCookie(req, COOKIE);
  if (!t) return false;
  const s = get.get(sha(t));
  return Boolean(s && s.expires_at > Date.now());
}

// Admin API guard. SameSite=Strict cookie + JSON-only POSTs keep cross-site forms out
// (HTML forms can only send GET/POST, and never with a JSON content type).
function requireAdmin(req, res, next) {
  if (!isAuthed(req)) return res.status(401).json({ error: 'Please sign in.' });
  if (req.method === 'POST' && !req.is('application/json')) {
    return res.status(415).json({ error: 'Send JSON.' });
  }
  next();
}

module.exports = { login, logout, isAuthed, requireAdmin, configured, adminEmail: () => ADMIN_EMAIL };
