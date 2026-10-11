'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');

const { db, q, getSettings, saveSettings, createOrder, markPaidAndIssue, DATA_DIR } = require('./src/db');
const render = require('./src/render');
const mail = require('./src/mail');
const rzp = require('./src/razorpay');
const auth = require('./src/auth');
const r2 = require('./src/r2');
const cf = require('./src/cashfree');
const coupons = require('./src/coupons');
const { isEmail, publicId, normaliseKey, maskEmail, rateLimiter, slugify, nowIso } = require('./src/util');

const PORT = Number(process.env.PORT) || 3000;
const PROD = process.env.NODE_ENV === 'production';
// Test checkout (no real payment) is allowed only outside production, or when explicitly switched on.
const TEST_CHECKOUT = !rzp.enabled() && !cf.enabled() && (!PROD || process.env.ALLOW_TEST_CHECKOUT === '1');
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const PUBLIC_DIR = path.join(__dirname, 'public');
// Uploaded blog images. On hosts with a temporary filesystem, point this at a persistent disk.
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(PUBLIC_DIR, 'media', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
// The downloadable kit (.zip). Keep it OUTSIDE public/ so it can only be fetched with a valid key.
const KIT_DIR = process.env.KIT_DIR || path.join(DATA_DIR, 'kit');
const KIT_FILE = path.join(KIT_DIR, 'current.zip');
const KIT_MAX_BYTES = (Number(process.env.KIT_MAX_MB) || 4096) * 1024 * 1024;
const LINK_TTL_MS = 10 * 60 * 1000;   // download links work for 10 minutes
const LINK_MAX_USES = 5;              // a few retries/resumes per link
fs.mkdirSync(KIT_DIR, { recursive: true });
// Is there a kit buyers can download right now, wherever it's stored?
function kitAvailable(kit = getSettings('kit')) {
  return kit.storage === 'r2' ? Boolean(kit.objectKey && r2.enabled()) : fs.existsSync(KIT_FILE);
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

// Cashfree wins if both are configured
const paymentMode = () => (cf.enabled() ? 'cashfree' : rzp.enabled() ? 'razorpay' : TEST_CHECKOUT ? 'test' : 'off');
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Razorpay webhook (needs the raw body, so it's registered before the JSON parser) ----------
app.post('/api/webhooks/razorpay', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
  const raw = req.body.toString('utf8');
  if (!rzp.verifyWebhookSignature(raw, req.get('X-Razorpay-Signature'))) return res.status(400).send('bad signature');
  let event;
  try { event = JSON.parse(raw); } catch { return res.status(400).send('bad json'); }
  res.status(200).send('ok'); // acknowledge fast; fulfil after

  const payment = event?.payload?.payment?.entity;
  const orderEntity = event?.payload?.order?.entity;
  const rzpOrderId = payment?.order_id || orderEntity?.id;
  if (!rzpOrderId) return;
  const order = q.orderByRzp.get(rzpOrderId);
  if (!order) return;

  if (event.event === 'payment.captured' || event.event === 'order.paid') {
    const amount = payment?.amount ?? orderEntity?.amount_paid;
    if (amount != null && Number(amount) !== order.amount_paise) {
      console.warn(`[webhook] amount mismatch on ${order.public_id}: got ${amount}, expected ${order.amount_paise}`);
      return;
    }
    const { order: paid, licence, newlyPaid } = markPaidAndIssue(order.id, payment?.id);
    if (newlyPaid) mail.sendLicence(paid, licence).catch((e) => console.error('[webhook] email failed', e));
  } else if (event.event === 'payment.failed' && order.status === 'created') {
    db.prepare("UPDATE orders SET status = 'failed' WHERE id = ? AND status = 'created'").run(order.id);
  }
});

// ---------- Cashfree webhook (raw body for the signature) ----------
app.post('/api/webhooks/cashfree', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
  const raw = req.body.toString('utf8');
  if (!cf.verifyWebhook(raw, req.get('x-webhook-timestamp'), req.get('x-webhook-signature'))) return res.status(400).send('bad signature');
  let event;
  try { event = JSON.parse(raw); } catch { return res.status(400).send('bad json'); }
  res.status(200).send('ok');
  const orderId = event?.data?.order?.order_id;
  const order = orderId && q.orderByPublic.get(orderId);
  if (!order) return;
  const status = event?.data?.payment?.payment_status;
  if (status === 'SUCCESS') {
    const amount = Math.round(Number(event?.data?.order?.order_amount) * 100);
    if (amount !== order.amount_paise) { console.warn(`[cashfree] amount mismatch on ${order.public_id}`); return; }
    const { order: paid, licence, newlyPaid } = markPaidAndIssue(order.id, String(event?.data?.payment?.cf_payment_id || ''));
    if (newlyPaid) mail.sendLicence(paid, licence).catch((e) => console.error('[cashfree webhook] email failed', e));
  } else if (status === 'FAILED' && order.status === 'created') {
    db.prepare("UPDATE orders SET status = 'failed' WHERE id = ? AND status = 'created'").run(order.id);
  }
});

app.use('/api', express.json({ limit: '50kb' }));

// ---------- public pages ----------
app.get(['/', '/index.html'], (req, res) => res.type('html').send(render.landing(getSettings('site'))));

app.get('/download', (req, res) => {
  res.set('X-Robots-Tag', 'noindex').type('html').send(render.download(getSettings('site')));
});

// Legal pages (edited in Admin → Legal pages)
const LEGAL_ROUTES = { '/privacy': 'privacy', '/terms': 'terms', '/refund-policy': 'refund', '/shipping-policy': 'delivery', '/contact': 'contact' };
app.get(Object.keys(LEGAL_ROUTES), (req, res) => {
  res.type('html').send(render.legal(LEGAL_ROUTES[req.path], getSettings('legal'), getSettings('site'), PUBLIC_URL));
});

app.get(['/get', '/get-snapqut.html'], (req, res) => {
  const site = getSettings('site');
  res.type('html').send(render.checkout(site, { mode: paymentMode(), cfMode: cf.env() }));
});

const publishedPosts = db.prepare('SELECT * FROM posts WHERE published = 1 ORDER BY featured DESC, published_at DESC, id DESC');
const postBySlug = db.prepare('SELECT * FROM posts WHERE slug = ?');

app.get(['/blog', '/blog.html'], (req, res) => {
  res.type('html').send(render.blogIndex(publishedPosts.all(), getSettings('site')));
});
app.get('/blog/:slug', (req, res, next) => {
  const slug = req.params.slug.replace(/\.html$/, '');
  if (slug !== req.params.slug) return res.redirect(301, `/blog/${slug}`);
  const p = postBySlug.get(slug);
  if (!p || (!p.published && !auth.isAuthed(req))) return next();
  const others = publishedPosts.all().filter((o) => o.id !== p.id).slice(0, 3);
  res.type('html').send(render.article(p, others, getSettings('site'), { preview: !p.published }));
});

app.get('/robots.txt', (req, res) => res.type('text').send('User-agent: *\nDisallow: /admin\nDisallow: /api\n'));

app.use('/media/uploads', express.static(UPLOAD_DIR, { maxAge: PROD ? '7d' : 0, index: false }));
app.use(express.static(PUBLIC_DIR, { maxAge: PROD ? '7d' : 0, index: false }));

// ---------- checkout ----------
const checkoutLimited = rateLimiter({ windowMs: 10 * 60 * 1000, max: 20 });

app.post('/api/checkout', asyncRoute(async (req, res) => {
  if (checkoutLimited(req.ip)) return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes.' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim().slice(0, 100);
  const phone = String(req.body?.phone || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  if (!isEmail(email)) return res.status(400).json({ error: 'Enter a valid email, like you@example.com.' });
  const mode = paymentMode();
  if (mode === 'cashfree' && !/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
  if (mode === 'off') return res.status(503).json({ error: 'Checkout is temporarily unavailable. Please contact us on WhatsApp.' });

  const site = getSettings('site');
  const pricePaise = Math.round(Number(site.price) * 100);
  let amountPaise = pricePaise, couponCode = null, discountPaise = 0;
  if (req.body?.coupon) {
    const c = coupons.apply(req.body.coupon, pricePaise);
    if (!c.ok) return res.status(400).json({ error: c.error, field: 'coupon' });
    ({ amountPaise, discountPaise } = c); couponCode = c.code;
  }
  const pid = publicId('sq');
  const extra = { couponCode, discountPaise };

  // 100% discount: no payment needed, issue the key straight away
  if (amountPaise === 0) {
    const testish = mode === 'test' || (mode === 'razorpay' && rzp.keyId().startsWith('rzp_test_')) || (mode === 'cashfree' && cf.isTest());
    const o = createOrder({ publicId: pid, name, email, phone, amountPaise: 0, source: testish ? 'test' : 'website', ...extra });
    return fulfilAndRespond(res, o.id, null, { mode: 'free' });
  }

  if (mode === 'cashfree') {
    const o = await cf.createOrder({
      orderId: pid, amountRupees: amountPaise / 100, email, phone, name,
      returnUrl: `${PUBLIC_URL}/get?order_id=${pid}`, notifyUrl: `${PUBLIC_URL}/api/webhooks/cashfree`
    });
    createOrder({ publicId: pid, name, email, phone, amountPaise, source: cf.isTest() ? 'test' : 'website', ...extra });
    return res.json({ mode, publicId: pid, paymentSessionId: o.payment_session_id, cfMode: cf.env() });
  }
  if (mode === 'razorpay') {
    const ro = await rzp.createOrder({ amountPaise, receipt: pid, notes: { email, name } });
    // Orders paid with Razorpay TEST keys are marked 'test' so they never count as real sales
    const source = rzp.keyId().startsWith('rzp_test_') ? 'test' : 'website';
    createOrder({ publicId: pid, name, email, amountPaise, razorpayOrderId: ro.id, source, ...extra });
    return res.json({ mode, publicId: pid, razorpayOrderId: ro.id, amount: ro.amount, currency: ro.currency, keyId: rzp.keyId() });
  }
  createOrder({ publicId: pid, name, email, amountPaise, source: 'test', ...extra });
  res.json({ mode, publicId: pid, amount: amountPaise, currency: 'INR' });
}));

async function fulfilAndRespond(res, orderId, paymentId, extra = {}) {
  const { order, licence, newlyPaid } = markPaidAndIssue(orderId, paymentId);
  if (newlyPaid) await mail.sendLicence(order, licence);
  const fresh = q.orderById.get(orderId);
  res.json({ ok: true, ...extra, publicId: fresh.public_id, email: fresh.email, key: licence.key, emailStatus: fresh.email_status });
}

// Check a discount code and show the new price (the real price is worked out again at checkout)
const couponLimited = rateLimiter({ windowMs: 10 * 60 * 1000, max: 30 });
app.post('/api/coupon', (req, res) => {
  if (couponLimited(req.ip)) return res.status(429).json({ error: 'Too many tries. Please wait a few minutes.' });
  const pricePaise = Math.round(Number(getSettings('site').price) * 100);
  const c = coupons.apply(req.body?.code, pricePaise);
  if (!c.ok) return res.status(400).json({ error: c.error });
  res.json({ code: c.code, label: c.label, pricePaise, discountPaise: c.discountPaise, amountPaise: c.amountPaise });
});

app.post('/api/checkout/verify', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const order = q.orderByPublic.get(String(b.publicId || ''));
  if (!order || order.razorpay_order_id !== b.razorpay_order_id) return res.status(400).json({ error: 'We couldn’t match this payment to an order.' });
  if (!rzp.verifyCheckoutSignature({ orderId: b.razorpay_order_id, paymentId: b.razorpay_payment_id, signature: b.razorpay_signature })) {
    return res.status(400).json({ error: 'We couldn’t verify this payment.' });
  }
  await fulfilAndRespond(res, order.id, b.razorpay_payment_id);
}));

// Cashfree: ask Cashfree whether the order is paid (never trust the browser)
app.post('/api/checkout/verify-cf', asyncRoute(async (req, res) => {
  const order = q.orderByPublic.get(String(req.body?.publicId || ''));
  if (!order) return res.status(400).json({ error: 'We couldn’t find this order.' });
  if (order.status !== 'paid') {
    const o = await cf.getOrder(order.public_id);
    if (o.order_status !== 'PAID') return res.status(402).json({ error: o.order_status === 'ACTIVE' ? 'Payment not completed yet.' : 'Payment was not successful. Please try again.', status: o.order_status });
    if (Math.round(Number(o.order_amount) * 100) !== order.amount_paise) return res.status(400).json({ error: 'Payment amount doesn’t match the order. Please contact support.' });
    return fulfilAndRespond(res, order.id, String(o.cf_order_id || ''));
  }
  await fulfilAndRespond(res, order.id, null);
}));

app.post('/api/checkout/test-pay', asyncRoute(async (req, res) => {
  if (!TEST_CHECKOUT) return res.status(404).json({ error: 'Not available.' });
  const order = q.orderByPublic.get(String(req.body?.publicId || ''));
  if (!order || order.source !== 'test') return res.status(400).json({ error: 'Unknown test order.' });
  await fulfilAndRespond(res, order.id, `test_${crypto.randomBytes(6).toString('hex')}`);
}));

// ---------- licence verification (for the SnapQut tool) ----------
const verifyLimited = rateLimiter({ windowMs: 60 * 1000, max: 30 });
const touchLicence = db.prepare('UPDATE licenses SET last_verified_at = ?, verify_count = verify_count + 1 WHERE id = ?');

app.options('/api/license/verify', (req, res) => {
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' }).sendStatus(204);
});
app.post('/api/license/verify', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (verifyLimited(req.ip)) return res.status(429).json({ valid: false, reason: 'rate_limited' });
  const key = normaliseKey(req.body?.key);
  const lic = /^SNPQ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key) ? q.licenceByKey.get(key) : null;
  if (!lic) return res.json({ valid: false, reason: 'not_found' });
  touchLicence.run(nowIso(), lic.id);
  if (lic.status !== 'active') return res.json({ valid: false, reason: 'revoked' });
  res.json({ valid: true, product: 'SnapQut for Claude', status: lic.status, issuedTo: maskEmail(lic.email), issuedAt: lic.created_at });
});

// ---------- key-gated kit download ----------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const downloadLimited = rateLimiter({ windowMs: 10 * 60 * 1000, max: 15 });
const resendLimited = rateLimiter({ windowMs: 15 * 60 * 1000, max: 3 });
const countDownloads = db.prepare('SELECT COUNT(*) AS n FROM downloads WHERE licence_id = ?');
const insertToken = db.prepare('INSERT INTO download_tokens (token_hash, licence_id, expires_at) VALUES (?, ?, ?)');
const getToken = db.prepare('SELECT * FROM download_tokens WHERE token_hash = ?');
const useToken = db.prepare('UPDATE download_tokens SET uses = uses + 1 WHERE token_hash = ?');
const purgeTokens = db.prepare('DELETE FROM download_tokens WHERE expires_at < ?');
const logDownload = db.prepare('INSERT INTO downloads (licence_id, kit_version, ip, created_at) VALUES (?, ?, ?, ?)');
const licenceById = db.prepare('SELECT * FROM licenses WHERE id = ?');

app.post('/api/download', (req, res) => {
  if (downloadLimited(req.ip)) return res.status(429).json({ error: 'Too many tries. Please wait 10 minutes and try again.' });
  const key = normaliseKey(req.body?.key);
  const lic = /^SNPQ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key) ? q.licenceByKey.get(key) : null;
  if (!lic) return res.status(404).json({ error: 'We couldn’t find that key. Check it against your purchase email, or use “Resend my key” below.' });
  if (lic.status !== 'active') return res.status(403).json({ error: 'This key has been deactivated. If you think that’s a mistake, contact support.' });
  const kit = getSettings('kit');
  if (!kitAvailable(kit)) return res.status(503).json({ error: 'The download isn’t ready yet. Please try again later or contact support.' });
  const used = countDownloads.get(lic.id).n;
  const max = Number(kit.maxDownloads) || 0;
  if (max > 0 && used >= max) return res.status(403).json({ error: `This key has reached its download limit (${max}). Contact support and we’ll sort it out.` });

  const expires = Date.now() + LINK_TTL_MS;
  const base = { fileName: kit.fileName || 'SnapQut.zip', version: kit.version, expiresAt: new Date(expires).toISOString(), issuedTo: maskEmail(lic.email) };

  if (kit.storage === 'r2') {
    // Cloudflare serves the file directly through a signed link; we count the download when the link is issued.
    logDownload.run(lic.id, kit.version, req.ip, nowIso());
    return res.json({ ...base, url: r2.downloadUrl(kit.objectKey, base.fileName, LINK_TTL_MS / 1000), size: kit.size, downloadsLeft: max > 0 ? max - used - 1 : null });
  }
  purgeTokens.run(Date.now());
  const token = crypto.randomBytes(24).toString('base64url');
  insertToken.run(sha256(token), lic.id, expires);
  res.json({ ...base, url: `/download/file/${token}`, size: fs.statSync(KIT_FILE).size, downloadsLeft: max > 0 ? max - used : null });
});

function linkGone(res, msg) {
  res.status(410).type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link expired</title><link rel="stylesheet" href="/assets/blog.css"><main class="wrap" style="padding:120px 20px;text-align:center;display:grid;gap:16px;justify-items:center"><h1>${msg}</h1><p style="color:var(--muted)">Download links work for 10 minutes. Enter your key again to get a fresh one.</p><a class="btn" href="/download">Go to the download page</a></main>`);
}

app.get('/download/file/:token', (req, res) => {
  const t = getToken.get(sha256(String(req.params.token)));
  if (!t || t.expires_at < Date.now()) return linkGone(res, 'This download link has expired');
  if (t.uses >= LINK_MAX_USES) return linkGone(res, 'This download link has been used up');
  const lic = licenceById.get(t.licence_id);
  if (!lic || lic.status !== 'active') return linkGone(res, 'This key has been deactivated');
  if (!fs.existsSync(KIT_FILE)) return linkGone(res, 'The download isn’t available right now');
  const kit = getSettings('kit');
  // Count one download per link (resumed or retried requests on the same link don't count again)
  if (t.uses === 0) logDownload.run(lic.id, kit.version, req.ip, nowIso());
  useToken.run(t.token_hash);
  res.set('Cache-Control', 'private, no-store');
  res.download(KIT_FILE, kit.fileName || 'SnapQut.zip');
});

app.post('/api/resend-key', asyncRoute(async (req, res) => {
  const generic = { ok: true, message: 'If that email bought SnapQut, we’ve sent the key to it. Check your inbox and spam folder.' };
  if (resendLimited(req.ip)) return res.status(429).json({ error: 'Too many requests. Please wait 15 minutes.' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!isEmail(email)) return res.status(400).json({ error: 'Enter the email you used when you bought SnapQut.' });
  const order = db.prepare("SELECT * FROM orders WHERE email = ? AND status = 'paid' ORDER BY paid_at DESC LIMIT 1").get(email);
  const lic = order && q.licenceByOrder.get(order.id);
  if (lic && lic.status === 'active') await mail.sendLicence(order, lic);
  res.json(generic); // same answer either way, so nobody can test which emails bought
}));

// ---------- admin ----------
// Admin page: stamp CSS/JS links with a per-start version so browsers never keep stale copies after an update
const BUILD = Date.now().toString(36);
app.get(['/admin', '/admin/'], (req, res) => {
  const html = fs.readFileSync(path.join(__dirname, 'admin', 'index.html'), 'utf8')
    .replace('/admin/static/admin.css', `/admin/static/admin.css?v=${BUILD}`)
    .replace('/admin/static/admin.js', `/admin/static/admin.js?v=${BUILD}`);
  res.set({ 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store' }).type('html').send(html);
});
app.use('/admin/static', express.static(path.join(__dirname, 'admin'), { index: false }));

const adminJson = express.json({ limit: '8mb' });
app.post('/admin/api/login', adminJson, auth.login);
app.post('/admin/api/logout', auth.logout);
app.get('/admin/api/me', (req, res) => {
  res.json({
    authed: auth.isAuthed(req), configured: auth.configured(), email: auth.isAuthed(req) ? auth.adminEmail() : null,
    modes: { payments: paymentMode() === 'cashfree' && cf.isTest() ? 'cashfree-test' : paymentMode() === 'razorpay' && rzp.keyId().startsWith('rzp_test_') ? 'razorpay-test' : paymentMode(), email: mail.mailMode(), webhook: (cf.enabled() || rzp.webhookEnabled()), kit: kitAvailable(), storage: r2.enabled() ? 'r2' : 'server' }
  });
});

const admin = express.Router();
admin.use(adminJson, auth.requireAdmin);

admin.get('/stats', (req, res) => {
  const paidWhere = "status = 'paid' AND source = 'website'";
  const totals = db.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(amount_paise), 0) AS paise FROM orders WHERE ${paidWhere}`).get();
  const today = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_paise),0) AS paise FROM orders WHERE ${paidWhere} AND date(paid_at) = date('now')`).get();
  const days = db.prepare(`SELECT date(paid_at) AS day, COUNT(*) AS n, SUM(amount_paise) AS paise FROM orders WHERE ${paidWhere} AND paid_at >= date('now', '-13 days') GROUP BY day`).all();
  const other = db.prepare("SELECT source, COUNT(*) AS n FROM orders WHERE status = 'paid' AND source != 'website' GROUP BY source").all();
  const pendingEmails = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'paid' AND email_status = 'failed'").get().n;
  const recent = db.prepare(`SELECT o.*, l.key AS licence_key FROM orders o LEFT JOIN licenses l ON l.order_id = o.id WHERE o.status = 'paid' ORDER BY o.paid_at DESC LIMIT 8`).all();
  const downloads = db.prepare('SELECT COUNT(*) AS n FROM downloads').get().n;
  const kitReady = kitAvailable();
  res.json({ totals, today, days, other, pendingEmails, recent, downloads, kitReady });
});

function orderQuery({ search = '', status = '', source = '' }) {
  const where = [], args = [];
  if (search) { where.push('(o.email LIKE ? OR o.name LIKE ? OR o.public_id LIKE ? OR l.key LIKE ? OR o.razorpay_payment_id LIKE ?)'); const s = `%${search}%`; args.push(s, s, s, s, s); }
  if (status) { where.push('o.status = ?'); args.push(status); }
  if (source) { where.push('o.source = ?'); args.push(source); }
  return { sql: `FROM orders o LEFT JOIN licenses l ON l.order_id = o.id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, args };
}

admin.get('/orders', (req, res) => {
  const { sql, args } = orderQuery({ search: String(req.query.q || '').trim(), status: String(req.query.status || ''), source: String(req.query.source || '') });
  const limit = Math.min(200, Number(req.query.limit) || 50), offset = Math.max(0, Number(req.query.offset) || 0);
  const total = db.prepare(`SELECT COUNT(*) AS n ${sql}`).get(...args).n;
  const rows = db.prepare(`SELECT o.*, l.id AS licence_id, l.key AS licence_key, l.status AS licence_status, l.last_verified_at, l.verify_count, (SELECT COUNT(*) FROM downloads d WHERE d.licence_id = l.id) AS download_count, (SELECT MAX(created_at) FROM downloads d WHERE d.licence_id = l.id) AS last_download_at ${sql} ORDER BY o.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  res.json({ total, rows });
});

admin.get('/orders.csv', (req, res) => {
  const { sql, args } = orderQuery({ search: String(req.query.q || '').trim(), status: String(req.query.status || ''), source: String(req.query.source || '') });
  const rows = db.prepare(`SELECT o.public_id, o.created_at, o.paid_at, o.name, o.email, o.amount_paise, o.status, o.source, o.razorpay_payment_id, l.key AS licence_key, l.status AS licence_status, o.email_status, o.coupon_code, o.discount_paise, (SELECT COUNT(*) FROM downloads d WHERE d.licence_id = l.id) AS downloads ${sql} ORDER BY o.id DESC`).all(...args);
  const cols = ['public_id', 'created_at', 'paid_at', 'name', 'email', 'amount_inr', 'status', 'source', 'razorpay_payment_id', 'licence_key', 'licence_status', 'email_status', 'coupon_code', 'discount_inr', 'downloads'];
  const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; };
  const csv = [cols.join(',')].concat(rows.map((r) => cols.map((c) => cell(c === 'amount_inr' ? r.amount_paise / 100 : c === 'discount_inr' ? (r.discount_paise || 0) / 100 : r[c])).join(','))).join('\n');
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="snapqut-orders-${new Date().toISOString().slice(0, 10)}.csv"` }).send(csv);
});

admin.post('/orders/:id/resend', asyncRoute(async (req, res) => {
  const order = q.orderById.get(Number(req.params.id));
  const licence = order && q.licenceByOrder.get(order.id);
  if (!order || order.status !== 'paid' || !licence) return res.status(400).json({ error: 'Only paid orders with a key can be resent.' });
  const r = await mail.sendLicence(order, licence);
  res.json({ ok: r.status !== 'failed', status: r.status, error: r.error });
}));

admin.post('/orders/manual', asyncRoute(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim().slice(0, 100);
  const amount = Math.max(0, Number(req.body?.amount) || 0);
  if (!isEmail(email)) return res.status(400).json({ error: 'Enter a valid email.' });
  const o = createOrder({ publicId: publicId('sq'), name, email, amountPaise: Math.round(amount * 100), source: 'manual', note: String(req.body?.note || '').slice(0, 500) });
  const { order, licence } = markPaidAndIssue(o.id, null);
  let emailStatus = 'skipped';
  if (req.body?.sendEmail !== false) emailStatus = (await mail.sendLicence(order, licence)).status;
  else q.setEmailStatus.run('skipped', null, null, order.id);
  res.json({ ok: true, key: licence.key, emailStatus });
}));

// Wipe every test order (and its key, downloads and emails), e.g. right before launch
admin.post('/orders/delete-test', (req, res) => {
  const ids = db.prepare("SELECT id FROM orders WHERE source = 'test'").all().map((r) => r.id);
  if (!ids.length) return res.json({ ok: true, deleted: 0 });
  const marks = ids.map(() => '?').join(',');
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM download_tokens WHERE licence_id IN (SELECT id FROM licenses WHERE order_id IN (${marks}))`).run(...ids);
    db.prepare(`DELETE FROM downloads WHERE licence_id IN (SELECT id FROM licenses WHERE order_id IN (${marks}))`).run(...ids);
    db.prepare(`DELETE FROM licenses WHERE order_id IN (${marks})`).run(...ids);
    db.prepare(`DELETE FROM email_log WHERE order_id IN (${marks})`).run(...ids);
    db.prepare(`DELETE FROM orders WHERE id IN (${marks})`).run(...ids);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  res.json({ ok: true, deleted: ids.length });
});

admin.post('/licences/:id/status', (req, res) => {
  const status = req.body?.status;
  if (!['active', 'revoked'].includes(status)) return res.status(400).json({ error: 'Status must be active or revoked.' });
  const r = db.prepare('UPDATE licenses SET status = ? WHERE id = ?').run(status, Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Key not found.' });
  res.json({ ok: true });
});

// One order with everything about it
admin.get('/orders/:id', (req, res) => {
  const o = q.orderById.get(Number(req.params.id));
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  const lic = q.licenceByOrder.get(o.id) || null;
  const downloads = lic ? db.prepare('SELECT kit_version, ip, created_at FROM downloads WHERE licence_id = ? ORDER BY id DESC').all(lic.id) : [];
  const emails = db.prepare('SELECT id, subject, status, error, created_at FROM email_log WHERE order_id = ? ORDER BY id DESC').all(o.id);
  res.json({ order: o, licence: lic, downloads, emails, maxDownloads: Number(getSettings('kit').maxDownloads) || 0 });
});

// Discount codes
admin.get('/coupons', (req, res) => res.json(coupons.list()));
admin.post('/coupons', (req, res) => res.json(coupons.create(req.body || {})));
admin.put('/coupons/:code', (req, res) => {
  if (!coupons.setActive(req.params.code, Boolean(req.body?.active))) return res.status(404).json({ error: 'Code not found.' });
  res.json({ ok: true });
});
admin.delete('/coupons/:code', (req, res) => {
  if (!coupons.remove(req.params.code)) return res.status(404).json({ error: 'Code not found.' });
  res.json({ ok: true });
});

// Blog
const allPosts = db.prepare('SELECT * FROM posts ORDER BY COALESCE(published_at, updated_at) DESC, id DESC');
admin.get('/posts', (req, res) => res.json(allPosts.all()));

function cleanPost(b, existing = {}) {
  const title = String(b.title ?? existing.title ?? '').trim();
  if (!title) throw Object.assign(new Error('Add a title.'), { status: 400 });
  const slug = slugify(b.slug || existing.slug || title);
  if (!slug) throw Object.assign(new Error('Add a URL slug.'), { status: 400 });
  const cover = Array.isArray(b.cover) ? b.cover.filter((c) => typeof c === 'string' && c.startsWith('/media/')).slice(0, 3) : JSON.parse(existing.cover || '[]');
  const words = String(b.body_md ?? existing.body_md ?? '').split(/\s+/).length;
  return {
    slug, title,
    category: String(b.category ?? existing.category ?? 'Guides').trim().slice(0, 40) || 'Guides',
    dek: String(b.dek ?? existing.dek ?? '').trim().slice(0, 400),
    cover: JSON.stringify(cover),
    body_md: String(b.body_md ?? existing.body_md ?? ''),
    read_mins: Number(b.read_mins) > 0 ? Math.round(Number(b.read_mins)) : Math.max(1, Math.round(words / 220)),
    featured: b.featured ? 1 : 0,
    published: b.published ? 1 : 0
  };
}
function saveFeatured(id, featured) { if (featured) db.prepare('UPDATE posts SET featured = 0 WHERE id != ?').run(id); }

admin.post('/posts', (req, res) => {
  const p = cleanPost(req.body || {});
  if (postBySlug.get(p.slug)) return res.status(409).json({ error: 'Another post already uses that URL slug.' });
  const r = db.prepare(`INSERT INTO posts (slug, title, category, dek, cover, body_md, read_mins, featured, published, published_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(p.slug, p.title, p.category, p.dek, p.cover, p.body_md, p.read_mins, p.featured, p.published, p.published ? nowIso() : null, nowIso());
  saveFeatured(r.lastInsertRowid, p.featured);
  res.json(db.prepare('SELECT * FROM posts WHERE id = ?').get(r.lastInsertRowid));
});

admin.put('/posts/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Post not found.' });
  const p = cleanPost(req.body || {}, existing);
  const clash = postBySlug.get(p.slug);
  if (clash && clash.id !== existing.id) return res.status(409).json({ error: 'Another post already uses that URL slug.' });
  const publishedAt = p.published ? (existing.published_at || nowIso()) : existing.published_at;
  db.prepare(`UPDATE posts SET slug=?, title=?, category=?, dek=?, cover=?, body_md=?, read_mins=?, featured=?, published=?, published_at=?, updated_at=? WHERE id=?`)
    .run(p.slug, p.title, p.category, p.dek, p.cover, p.body_md, p.read_mins, p.featured, p.published, publishedAt, nowIso(), existing.id);
  saveFeatured(existing.id, p.featured);
  res.json(db.prepare('SELECT * FROM posts WHERE id = ?').get(existing.id));
});

admin.delete('/posts/:id', (req, res) => {
  const r = db.prepare('DELETE FROM posts WHERE id = ?').run(Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Post not found.' });
  res.json({ ok: true });
});

admin.post('/preview', (req, res) => res.json({ html: render.renderMarkdown(req.body?.body_md || '').html }));

// Media library (for blog covers)
const IMG_EXT = /\.(jpe?g|png|webp)$/i;
function listImages(dir, base) {
  let out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name), url = `${base}/${ent.name}`;
    if (ent.isDirectory()) { if (url !== '/media/uploads') out = out.concat(listImages(full, url)); }
    else if (IMG_EXT.test(ent.name)) out.push(url);
  }
  return out;
}
admin.get('/media', (req, res) => {
  const uploads = listImages(UPLOAD_DIR, '/media/uploads').reverse(); // newest-ish first
  res.json(uploads.concat(listImages(path.join(PUBLIC_DIR, 'media'), '/media')));
});
admin.post('/media', (req, res) => {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.data || ''));
  if (!m) return res.status(400).json({ error: 'Upload a PNG, JPG or WebP image.' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 5 * 1024 * 1024) return res.status(413).json({ error: 'Images must be 5 MB or smaller.' });
  const magic = { png: [0x89, 0x50], jpeg: [0xff, 0xd8], webp: [0x52, 0x49] }[m[1]];
  if (buf[0] !== magic[0] || buf[1] !== magic[1]) return res.status(400).json({ error: 'That file isn’t a valid image.' });
  const dir = UPLOAD_DIR;
  const name = `${slugify(String(req.body?.name || 'image').replace(/\.\w+$/, '')) || 'image'}-${crypto.randomBytes(3).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(dir, name), buf);
  res.json({ url: `/media/uploads/${name}` });
});

// Kit file + download limits
admin.get('/kit', (req, res) => {
  const kit = getSettings('kit');
  const present = kitAvailable(kit);
  const total = db.prepare('SELECT COUNT(*) AS n FROM downloads').get().n;
  const recent = db.prepare(`SELECT d.created_at, d.kit_version, d.ip, l.key, l.email, o.name FROM downloads d
    JOIN licenses l ON l.id = d.licence_id JOIN orders o ON o.id = l.order_id ORDER BY d.id DESC LIMIT 30`).all();
  const size = kit.storage === 'r2' ? kit.size : (fs.existsSync(KIT_FILE) ? fs.statSync(KIT_FILE).size : 0);
  res.json({ ...kit, present, size, r2Enabled: r2.enabled(), r2Bucket: r2.bucket(), totalDownloads: total, recent });
});

admin.put('/kit', (req, res) => {
  const b = req.body || {};
  const max = Math.max(0, Math.min(1000, Math.round(Number(b.maxDownloads))));
  if (!Number.isFinite(max)) return res.status(400).json({ error: 'Download limit must be a number (0 for unlimited).' });
  const version = String(b.version ?? '').trim().slice(0, 30) || '1.0';
  let fileName = String(b.fileName ?? '').trim().replace(/[^\w.\- ]+/g, '').slice(0, 80);
  if (fileName && !/\.zip$/i.test(fileName)) fileName += '.zip';
  res.json(saveSettings('kit', { maxDownloads: max, version, ...(fileName ? { fileName } : {}) }));
});

// Upload the kit zip as a raw stream (can be hundreds of MB): PUT /admin/api/kit/file?name=SnapQut-1.2.zip&version=1.2
admin.put('/kit/file', (req, res) => {
  if (!/^application\/(zip|octet-stream|x-zip-compressed)/.test(req.get('Content-Type') || '')) {
    return res.status(415).json({ error: 'Upload a .zip file.' });
  }
  const tmp = path.join(KIT_DIR, `upload-${crypto.randomBytes(6).toString('hex')}.tmp`);
  const out = fs.createWriteStream(tmp);
  let bytes = 0, head = Buffer.alloc(0), failed = null;
  const fail = (status, msg) => { if (failed) return; failed = { status, msg }; req.unpipe(out); out.destroy(); fs.rm(tmp, { force: true }, () => {}); res.status(status).json({ error: msg }); req.resume(); };
  req.on('data', (chunk) => {
    bytes += chunk.length;
    if (head.length < 4) head = Buffer.concat([head, chunk]).subarray(0, 4);
    if (bytes > KIT_MAX_BYTES) fail(413, `The file is bigger than the ${Math.round(KIT_MAX_BYTES / 1048576)} MB limit.`);
  });
  req.on('aborted', () => fail(400, 'Upload was interrupted. Please try again.'));
  out.on('error', () => fail(500, 'Could not save the file on the server.'));
  out.on('finish', () => {
    if (failed) return;
    if (!(head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04)) return fail(400, 'That isn’t a valid .zip file.');
    fs.renameSync(tmp, KIT_FILE);
    let fileName = String(req.query.name || '').trim().replace(/[^\w.\- ]+/g, '').slice(0, 80) || 'SnapQut.zip';
    if (!/\.zip$/i.test(fileName)) fileName += '.zip';
    const version = String(req.query.version || '').trim().slice(0, 30) || getSettings('kit').version;
    res.json(saveSettings('kit', { storage: 'server', objectKey: '', fileName, version, size: bytes, uploadedAt: nowIso() }));
  });
  req.pipe(out);
});

// Cloudflare R2: the admin's browser uploads the zip straight to the private bucket using a signed link
const cleanZipName = (n) => { let f = String(n || '').trim().replace(/[^\w.\- ]+/g, '').slice(0, 80) || 'SnapQut.zip'; return /\.zip$/i.test(f) ? f : f + '.zip'; };
admin.post('/kit/r2-upload-url', (req, res) => {
  if (!r2.enabled()) return res.status(400).json({ error: 'Cloudflare R2 isn’t connected. Add the R2 settings to .env and restart.' });
  const fileName = cleanZipName(req.body?.fileName);
  const objectKey = `kits/${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(4).toString('hex')}-${fileName.replace(/\s+/g, '-')}`;
  res.json({ objectKey, url: r2.uploadUrl(objectKey, 3600) });
});
// After the upload (or for a file you put in the bucket yourself), check it's really there and make it the live kit
admin.post('/kit/r2-activate', asyncRoute(async (req, res) => {
  if (!r2.enabled()) return res.status(400).json({ error: 'Cloudflare R2 isn’t connected.' });
  const objectKey = String(req.body?.objectKey || '').trim().replace(/^\/+/, '');
  if (!objectKey || objectKey.length > 300 || objectKey.includes('..')) return res.status(400).json({ error: 'Enter the file’s path inside the bucket, e.g. kits/SnapQut-1.0.zip' });
  const info = await r2.head(objectKey);
  if (!info) return res.status(404).json({ error: `No file called “${objectKey}” in the ${r2.bucket()} bucket.` });
  const fileName = cleanZipName(req.body?.fileName || objectKey.split('/').pop());
  const version = String(req.body?.version || '').trim().slice(0, 30) || getSettings('kit').version;
  res.json(saveSettings('kit', { storage: 'r2', objectKey, fileName, version, size: info.size, uploadedAt: nowIso() }));
}));

admin.post('/licences/:id/reset-downloads', (req, res) => {
  const r = db.prepare('DELETE FROM downloads WHERE licence_id = ?').run(Number(req.params.id));
  res.json({ ok: true, cleared: r.changes });
});

// Site content + email settings
admin.get('/settings', (req, res) => res.json({ site: getSettings('site'), email: getSettings('email'), legal: getSettings('legal') }));
admin.put('/settings', (req, res) => {
  const b = req.body || {};
  const out = {};
  if (b.site) {
    const s = b.site;
    const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
    const price = Number(s.price), compare = Number(s.comparePrice);
    if (!(price > 0)) return res.status(400).json({ error: 'Price must be more than 0.' });
    out.site = saveSettings('site', {
      heroTitle: str(s.heroTitle, 200), heroHighlight: str(s.heroHighlight, 200), heroLead: str(s.heroLead, 600),
      price: Math.round(price), comparePrice: compare > 0 ? Math.round(compare) : 0, priceNotice: str(s.priceNotice, 200),
      supportEmail: str(s.supportEmail, 200), whatsapp: str(s.whatsapp, 60),
      faq: (Array.isArray(s.faq) ? s.faq : []).map((f) => ({ q: str(f.q, 300), a: str(f.a, 2000) })).filter((f) => f.q && f.a).slice(0, 40),
      testimonials: (Array.isArray(s.testimonials) ? s.testimonials : []).map((t) => ({ name: str(t.name, 80), quote: str(t.quote, 200) })).filter((t) => t.name && t.quote).slice(0, 30)
    });
  }
  if (b.legal) {
    const l = b.legal, str = (v, max) => String(v ?? '').slice(0, max);
    out.legal = saveSettings('legal', {
      businessName: str(l.businessName, 120).trim() || 'SnapQut', address: str(l.address, 400).trim(),
      privacy: str(l.privacy, 30000), terms: str(l.terms, 30000), refund: str(l.refund, 30000), delivery: str(l.delivery, 30000),
      updated: new Date().toISOString().slice(0, 10)
    });
  }
  if (b.email) {
    const e = b.email, str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
    if (e.fromEmail && !isEmail(str(e.fromEmail))) return res.status(400).json({ error: 'The “from” address must be a valid email.' });
    out.email = saveSettings('email', {
      fromName: str(e.fromName, 80) || 'SnapQut', fromEmail: str(e.fromEmail, 200), replyTo: str(e.replyTo, 200),
      subject: str(e.subject, 200) || 'Your SnapQut access key', setupSteps: str(e.setupSteps, 4000)
    });
  }
  res.json(out);
});

admin.post('/email/test', asyncRoute(async (req, res) => {
  const to = String(req.body?.to || '').trim();
  if (!isEmail(to)) return res.status(400).json({ error: 'Enter a valid email to send the test to.' });
  const sample = { public_id: 'sq_TEST', amount_paise: Math.round(getSettings('site').price * 100) };
  const m = mail.licenceEmail({ name: 'Test', key: 'SNPQ-TEST-ABCD-2345', order: sample });
  const r = await mail.send({ to, subject: `[Test] ${m.subject}`, html: m.html, text: m.text });
  res.json(r);
}));
admin.get('/emails', (req, res) => {
  res.json(db.prepare('SELECT id, order_id, to_email, subject, status, error, created_at FROM email_log ORDER BY id DESC LIMIT 100').all());
});
admin.get('/emails/:id', (req, res) => {
  const row = db.prepare('SELECT html FROM email_log WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Not found.' });
  res.json(row);
});
admin.get('/email/preview', (req, res) => {
  const sample = { public_id: 'sq_PREVIEW', amount_paise: Math.round(getSettings('site').price * 100) };
  res.json(mail.licenceEmail({ name: 'Priya Sharma', key: 'SNPQ-7KQ2-M9XA-4HTD', order: sample }));
});

app.use('/admin/api', admin);

// ---------- errors ----------
app.use((req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/admin/api')) return res.status(404).json({ error: 'Not found.' });
  res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/blog.css"><main class="wrap" style="padding:120px 20px;text-align:center;display:grid;gap:16px;justify-items:center"><h1>Page not found</h1><p style="color:var(--muted)">That page doesn’t exist.</p><a class="btn" href="/">Go to the homepage</a></main>');
});
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.expose ? 'Something went wrong on our side. Please try again.' : err.message });
});

app.listen(PORT, () => {
  console.log(`SnapQut running on http://localhost:${PORT}`);
  console.log(`  payments: ${paymentMode()}  ·  email: ${mail.mailMode()}  ·  webhook: ${(cf.enabled() || rzp.webhookEnabled()) ? 'on' : 'off'}  ·  admin: ${auth.configured() ? 'on' : 'NOT SET (add ADMIN_EMAIL/ADMIN_PASSWORD)'}  ·  kit: ${kitAvailable() ? getSettings('kit').storage : 'not uploaded yet'}  ·  R2: ${r2.enabled() ? 'connected' : 'off'}`);
});
