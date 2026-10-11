'use strict';
// Discount codes. The server always computes the price; the browser only displays it.
const { db } = require('./db');
const { nowIso } = require('./util');

const clean = (code) => String(code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 30);

const getCoupon = db.prepare('SELECT * FROM coupons WHERE code = ?');
const usesOf = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE coupon_code = ? AND status = 'paid' AND source != 'test'");

// Expiry date "2026-10-15" means: valid until the end of 15 Oct, India time
const expired = (c) => c.expires_at && Date.now() > Date.parse(`${c.expires_at}T23:59:59+05:30`);

function describe(c) {
  return c.kind === 'percent' ? `${c.value}% off` : `₹${Number(c.value).toLocaleString('en-IN')} off`;
}

// Returns { ok: true, code, label, discountPaise, amountPaise } or { ok: false, error }
function apply(rawCode, pricePaise) {
  const code = clean(rawCode);
  if (!code) return { ok: false, error: 'Enter a discount code.' };
  const c = getCoupon.get(code);
  if (!c || !c.active) return { ok: false, error: 'That code isn’t valid.' };
  if (expired(c)) return { ok: false, error: 'That code has expired.' };
  if (c.max_uses > 0 && usesOf.get(code).n >= c.max_uses) return { ok: false, error: 'That code has been fully used.' };
  let discount = c.kind === 'percent' ? Math.round(pricePaise * c.value / 100) : c.value * 100;
  discount = Math.min(discount, pricePaise);
  let amount = pricePaise - discount;
  // Payment providers need at least ₹1; anything below that becomes a free order
  if (amount > 0 && amount < 100) { amount = 0; discount = pricePaise; }
  return { ok: true, code, label: describe(c), discountPaise: discount, amountPaise: amount };
}

function list() {
  return db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all().map((c) => ({
    ...c, uses: usesOf.get(c.code).n, label: describe(c), expired: Boolean(expired(c))
  }));
}

function create(b) {
  const code = clean(b.code);
  if (code.length < 3) throw Object.assign(new Error('Codes need at least 3 letters or numbers.'), { status: 400 });
  const kind = b.kind === 'flat' ? 'flat' : 'percent';
  const value = Math.round(Number(b.value));
  if (!(value > 0) || (kind === 'percent' && value > 100)) throw Object.assign(new Error(kind === 'percent' ? 'Percent must be between 1 and 100.' : 'Amount off must be more than ₹0.'), { status: 400 });
  const maxUses = Math.max(0, Math.round(Number(b.max_uses) || 0));
  const expires = /^\d{4}-\d{2}-\d{2}$/.test(String(b.expires_at || '')) ? b.expires_at : null;
  if (getCoupon.get(code)) throw Object.assign(new Error('A code with that name already exists.'), { status: 409 });
  db.prepare('INSERT INTO coupons (code, kind, value, max_uses, expires_at, active, note, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
    .run(code, kind, value, maxUses, expires, String(b.note || '').slice(0, 200), nowIso());
  return getCoupon.get(code);
}

const setActive = (code, on) => db.prepare('UPDATE coupons SET active = ? WHERE code = ?').run(on ? 1 : 0, clean(code)).changes;
const remove = (code) => db.prepare('DELETE FROM coupons WHERE code = ?').run(clean(code)).changes;

module.exports = { apply, list, create, setActive, remove, clean };
