'use strict';
// Cashfree Payment Gateway (API version 2023-08-01).
// Flow: server creates order → browser opens Cashfree checkout with payment_session_id →
// server asks Cashfree whether the order is PAID (never trusts the browser) → webhook as backup.
const crypto = require('node:crypto');
const { safeEqual } = require('./util');

const APP_ID = process.env.CASHFREE_APP_ID || '';
const SECRET = process.env.CASHFREE_SECRET_KEY || '';
const ENV = (process.env.CASHFREE_ENV || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
const BASE = ENV === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
const API_VERSION = '2023-08-01';

const enabled = () => Boolean(APP_ID && SECRET);
const headers = () => ({ 'x-client-id': APP_ID, 'x-client-secret': SECRET, 'x-api-version': API_VERSION, 'Content-Type': 'application/json', Accept: 'application/json' });

async function call(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || `Cashfree responded ${res.status}`), { status: 502, expose: true });
  return data;
}

// amountRupees: number; orderId: our public id (letters, numbers, - and _)
function createOrder({ orderId, amountRupees, email, phone, name, returnUrl, notifyUrl }) {
  return call('POST', '/orders', {
    order_id: orderId,
    order_amount: amountRupees,
    order_currency: 'INR',
    customer_details: { customer_id: orderId, customer_email: email, customer_phone: phone, customer_name: name || undefined },
    order_meta: { return_url: returnUrl, notify_url: notifyUrl },
    order_note: 'SnapQut for Claude'
  });
}

const getOrder = (orderId) => call('GET', `/orders/${encodeURIComponent(orderId)}`);

// Webhook signature: base64(HMAC_SHA256(timestamp + rawBody, secret key))
function verifyWebhook(rawBody, timestamp, signature) {
  if (!SECRET || !timestamp || !signature) return false;
  const expected = crypto.createHmac('sha256', SECRET).update(String(timestamp) + rawBody).digest('base64');
  return safeEqual(expected, signature);
}

module.exports = { enabled, createOrder, getOrder, verifyWebhook, env: () => ENV, isTest: () => ENV !== 'production' };
