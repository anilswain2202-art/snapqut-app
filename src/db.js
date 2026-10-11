'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { licenceKey, nowIso } = require('./util');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'snapqut.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id                  INTEGER PRIMARY KEY,
  public_id           TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL DEFAULT '',
  email               TEXT NOT NULL,
  amount_paise        INTEGER NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'INR',
  status              TEXT NOT NULL DEFAULT 'created',   -- created | paid | failed
  source              TEXT NOT NULL DEFAULT 'website',   -- website | manual | test
  razorpay_order_id   TEXT UNIQUE,
  razorpay_payment_id TEXT,
  created_at          TEXT NOT NULL,
  paid_at             TEXT,
  email_status        TEXT NOT NULL DEFAULT 'pending',   -- pending | sent | logged | failed
  email_error         TEXT,
  email_sent_at       TEXT,
  note                TEXT
);
CREATE INDEX IF NOT EXISTS orders_email ON orders(email);
CREATE INDEX IF NOT EXISTS orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS licenses (
  id               INTEGER PRIMARY KEY,
  key              TEXT NOT NULL UNIQUE,
  order_id         INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  email            TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active',       -- active | revoked
  created_at       TEXT NOT NULL,
  last_verified_at TEXT,
  verify_count     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS posts (
  id           INTEGER PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'Guides',
  dek          TEXT NOT NULL DEFAULT '',
  cover        TEXT NOT NULL DEFAULT '[]',               -- JSON array of image paths
  body_md      TEXT NOT NULL DEFAULT '',
  read_mins    INTEGER NOT NULL DEFAULT 4,
  featured     INTEGER NOT NULL DEFAULT 0,
  published    INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_log (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER REFERENCES orders(id),
  to_email    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  status      TEXT NOT NULL,                              -- sent | logged | failed
  provider_id TEXT,
  error       TEXT,
  html        TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

-- Short-lived download links handed out after a key is checked
CREATE TABLE IF NOT EXISTS download_tokens (
  token_hash TEXT PRIMARY KEY,
  licence_id INTEGER NOT NULL REFERENCES licenses(id),
  expires_at INTEGER NOT NULL,
  uses       INTEGER NOT NULL DEFAULT 0
);

-- One row per kit download started
CREATE TABLE IF NOT EXISTS downloads (
  id          INTEGER PRIMARY KEY,
  licence_id  INTEGER NOT NULL REFERENCES licenses(id),
  kit_version TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS downloads_licence ON downloads(licence_id);
`);

// Columns added after the first release
db.exec(`CREATE TABLE IF NOT EXISTS coupons (
  code        TEXT PRIMARY KEY,                 -- stored upper-case
  kind        TEXT NOT NULL,                    -- percent | flat
  value       INTEGER NOT NULL,                 -- percent (1-100) or rupees off
  max_uses    INTEGER NOT NULL DEFAULT 0,       -- 0 = unlimited
  expires_at  TEXT,                             -- ISO date (end of that day, IST) or NULL
  active      INTEGER NOT NULL DEFAULT 1,
  note        TEXT,
  created_at  TEXT NOT NULL
)`);
for (const sql of ['ALTER TABLE orders ADD COLUMN phone TEXT', 'ALTER TABLE orders ADD COLUMN coupon_code TEXT', 'ALTER TABLE orders ADD COLUMN discount_paise INTEGER NOT NULL DEFAULT 0']) {
  try { db.exec(sql); } catch { /* already there */ }
}

// ---------- settings ----------
const DEFAULT_SETTINGS = {
  site: {
    heroTitle: 'Create professional videos in minutes,',
    heroHighlight: 'without becoming an editor',
    heroLead: 'Give Claude your footage, describe the video you want in one sentence, and SnapQut does the editing: cuts, captions, B-roll and the final render.',
    price: 890,
    comparePrice: 1100,
    priceNotice: 'Price goes up to ₹1,100 on 15 Oct',
    supportEmail: 'support@reelabs.in',
    whatsapp: '+91 92204 76516',
    faq: [
      { q: 'Do I need Claude Code?', a: 'Not strictly, but Claude Code is the best way to use SnapQut and gives the most consistent results.' },
      { q: 'Do I need video editing skills?', a: 'No. You describe the video you want and SnapQut handles the cutting, captions and rendering.' },
      { q: 'Do I need complicated editing software?', a: "No. Everything happens inside Claude. There's no editor to install and no timeline to learn." },
      { q: "Can SnapQut learn another creator's style?", a: 'Yes. Give it 3 to 6 videos from that creator and it studies their cuts, pacing, captions and B-roll.' },
      { q: 'Can I create my own custom style?', a: 'Yes. Describe the look or pacing you want in plain language and SnapQut builds the style.' },
      { q: 'Can it make long-form videos?', a: 'Yes. It edits long-form videos as well as Reels, Shorts and TikToks.' },
      { q: 'Can it make ads?', a: 'Yes, including PAS, AIDA, Before-After-Bridge and UGC-style ad structures.' },
      { q: 'How long does a video take?', a: 'Usually 3 to 8 minutes, depending on the length of your footage.' },
      { q: 'Is it a subscription?', a: "No. It's a one-time purchase." },
      { q: 'How many videos can I create?', a: "As many as you like. There's no per-render charge from SnapQut." }
    ],
    testimonials: [
      { name: 'Rajat Ranjan', quote: 'Saved me hours' },
      { name: 'Siddhartha Singh', quote: 'The style feature is crazy' },
      { name: 'Aarav Sharma', quote: 'No more editing headaches' },
      { name: 'Priyanshu', quote: 'Way easier than I expected' },
      { name: 'Vaishnavi', quote: 'My content output went up' },
      { name: 'Tanya', quote: 'Goodbye, editing timeline' },
      { name: 'Kabeer', quote: '₹890 was an easy decision' },
      { name: 'Raghav', quote: 'Finally useful AI editing' },
      { name: 'Aman', quote: 'I actually want to edit now' }
    ]
  },
  email: {
    fromName: 'SnapQut',
    fromEmail: 'keys@yourdomain.com',
    replyTo: 'support@reelabs.in',
    subject: 'Your SnapQut access key',
    setupSteps: 'Click "Download SnapQut" above. Your key is already filled in, so just press Download.\nUnzip the file into a folder on your computer.\nOpen Claude (Claude Code works best) and choose that folder.\nAttach a raw video and describe what you want in one sentence.'
  },
  // Legal pages (Markdown with {business} {email} {whatsapp} {address} {price} {site} placeholders)
  legal: require('./legal-defaults'),
  // The downloadable kit. The file itself lives in KIT_DIR; this holds its details.
  kit: {
    storage: 'server',     // 'server' (file on this server's disk) or 'r2' (private Cloudflare R2 bucket)
    objectKey: '',         // R2 object key when storage = 'r2'
    fileName: '',          // name the buyer's download is saved as, e.g. SnapQut-1.0.zip
    version: '1.0',
    size: 0,
    uploadedAt: null,
    maxDownloads: 5        // per key; 0 = unlimited
  }
};

const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

function getSettings(name) {
  const row = getSettingStmt.get(name);
  const saved = row ? JSON.parse(row.value) : {};
  return { ...DEFAULT_SETTINGS[name], ...saved };
}
function saveSettings(name, value) {
  const merged = { ...getSettings(name), ...value };
  setSettingStmt.run(name, JSON.stringify(merged));
  return merged;
}

// ---------- orders & licences ----------
const q = {
  insertOrder: db.prepare(`INSERT INTO orders (public_id, name, email, amount_paise, currency, status, source, razorpay_order_id, created_at, note, phone, coupon_code, discount_paise)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  orderByPublic: db.prepare('SELECT * FROM orders WHERE public_id = ?'),
  orderById: db.prepare('SELECT * FROM orders WHERE id = ?'),
  orderByRzp: db.prepare('SELECT * FROM orders WHERE razorpay_order_id = ?'),
  markPaid: db.prepare(`UPDATE orders SET status = 'paid', paid_at = ?, razorpay_payment_id = COALESCE(?, razorpay_payment_id) WHERE id = ? AND status != 'paid'`),
  insertLicence: db.prepare('INSERT INTO licenses (key, order_id, email, created_at) VALUES (?, ?, ?, ?)'),
  licenceByOrder: db.prepare('SELECT * FROM licenses WHERE order_id = ?'),
  licenceByKey: db.prepare('SELECT * FROM licenses WHERE key = ?'),
  setEmailStatus: db.prepare('UPDATE orders SET email_status = ?, email_error = ?, email_sent_at = ? WHERE id = ?'),
  logEmail: db.prepare('INSERT INTO email_log (order_id, to_email, subject, status, provider_id, error, html, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
};

function createOrder({ publicId, name, email, amountPaise, currency = 'INR', status = 'created', source = 'website', razorpayOrderId = null, note = null, phone = null, couponCode = null, discountPaise = 0 }) {
  q.insertOrder.run(publicId, name || '', email, amountPaise, currency, status, source, razorpayOrderId, nowIso(), note, phone, couponCode, discountPaise);
  return q.orderByPublic.get(publicId);
}

// Marks an order paid and issues its licence exactly once. Returns { order, licence, newlyPaid }.
function markPaidAndIssue(orderId, paymentId) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const res = q.markPaid.run(nowIso(), paymentId || null, orderId);
    const order = q.orderById.get(orderId);
    let licence = q.licenceByOrder.get(orderId);
    if (!licence) {
      let key;
      do { key = licenceKey(); } while (q.licenceByKey.get(key));
      q.insertLicence.run(key, orderId, order.email, nowIso());
      licence = q.licenceByOrder.get(orderId);
    }
    db.exec('COMMIT');
    return { order: q.orderById.get(orderId), licence, newlyPaid: res.changes > 0 };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---------- seed blog posts on first run ----------
const postCount = db.prepare('SELECT COUNT(*) AS n FROM posts').get().n;
if (postCount === 0) {
  const insert = db.prepare(`INSERT INTO posts (slug, title, category, dek, cover, body_md, read_mins, featured, published, published_at, updated_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`);
  for (const p of require('./seed-posts')) {
    insert.run(p.slug, p.title, p.category, p.dek, JSON.stringify(p.cover), p.body, p.mins, p.featured ? 1 : 0, p.date, nowIso());
  }
}

module.exports = { db, q, getSettings, saveSettings, createOrder, markPaidAndIssue, DATA_DIR };
