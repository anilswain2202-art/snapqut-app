'use strict';
const { hmacHex, safeEqual } = require('./util');

const KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

const enabled = () => Boolean(KEY_ID && KEY_SECRET);

async function createOrder({ amountPaise, receipt, notes }) {
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64'),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, notes })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.description || `Razorpay responded ${res.status}`);
  return body; // { id: 'order_...', amount, currency, ... }
}

// Checkout handler signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret)
function verifyCheckoutSignature({ orderId, paymentId, signature }) {
  if (!orderId || !paymentId || !signature) return false;
  return safeEqual(hmacHex(KEY_SECRET, `${orderId}|${paymentId}`), signature);
}

// Webhook signature: HMAC_SHA256(raw request body, webhook secret)
function verifyWebhookSignature(rawBody, signature) {
  if (!WEBHOOK_SECRET || !signature) return false;
  return safeEqual(hmacHex(WEBHOOK_SECRET, rawBody), signature);
}

module.exports = { enabled, createOrder, verifyCheckoutSignature, verifyWebhookSignature, keyId: () => KEY_ID, webhookEnabled: () => Boolean(WEBHOOK_SECRET) };
