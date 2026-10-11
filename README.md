# SnapQut website

The SnapQut landing page, blog and checkout, with:

- **Automatic licence emails.** A buyer enters their email and pays with Razorpay. The server then creates a unique key (`SNPQ-XXXX-XXXX-XXXX`), saves the order and emails the key through Resend.
- **Key-gated downloads.** The kit `.zip` is never publicly linked. Buyers enter their key at `/download` (the email button fills it in for them) and get a private link that works for 10 minutes, with a per-key download limit.
- **An admin console at `/admin`.** See every buyer and their key, resend emails, revoke keys, issue keys by hand, export a CSV, write and publish blog posts, and edit prices, FAQ, reviews and contact details.
- **A key-check API** the SnapQut tool can call to confirm a key is real and not revoked.

Built with Node.js and the SQLite database that ships with Node, so there's nothing else to install or host.

---

## Run it on your computer

Needs Node.js 22.13 or newer.

```bash
npm install
cp .env.example .env     # then fill in ADMIN_EMAIL and ADMIN_PASSWORD
npm run dev
```

Open http://localhost:3000. The admin console is at http://localhost:3000/admin.

Without Razorpay keys, checkout runs in **test mode**: buyers see a "Simulate successful payment" button and no money moves. Without a Resend key, emails are saved to the **Emails** tab in the admin instead of being sent. This way you can try the whole flow before connecting anything.

---

## Go live

### 1. Host the app (Render, about 10 minutes)

1. Put this folder in a GitHub repository. `.env` and `data/` are git-ignored, so no secrets or customer data go to GitHub.
2. On [render.com](https://render.com), choose **New → Blueprint** and pick the repository. `render.yaml` sets up the web service and a 1 GB persistent disk for the database and uploaded images.
3. Fill in the environment variables Render asks for (see steps 2–4 below).
4. Point your domain at the service (Render → Settings → Custom Domains) and set `PUBLIC_URL` to it, for example `https://snapqut.com`.

Any host that runs Node works (Railway, a VPS, Hostinger VPS). Keep `DATA_DIR` and `UPLOAD_DIR` on storage that survives redeploys.

### 2. Admin login

| Variable | Value |
|---|---|
| `ADMIN_EMAIL` | the email you'll sign in with |
| `ADMIN_PASSWORD` | a long random password, at least 10 characters |

### 3. Razorpay

1. In the Razorpay Dashboard → **Account & Settings → API Keys**, generate keys and set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. Use test keys first, then live keys.
2. Go to **Webhooks → Add New Webhook**:
   - **URL:** `https://YOUR-DOMAIN/api/webhooks/razorpay`
   - **Secret:** any long random string. Put the same value in `RAZORPAY_WEBHOOK_SECRET`.
   - **Events:** `payment.captured`, `order.paid`, `payment.failed`
3. Make sure payments are set to **auto-capture** (the default).

The webhook means a buyer still gets their key even if they close the tab right after paying. Each order gets exactly one key and one email, even when both the payment confirmation and the webhook arrive.

### 4. Resend (emails)

1. Sign up at [resend.com](https://resend.com) and add your domain (for example `snapqut.com`). Add the DNS records it shows you and wait until it says **Verified**.
2. Create an API key and set `RESEND_API_KEY`.
3. In the admin console → **Emails**, set the **From address** to an address on that domain (for example `keys@snapqut.com`) and click **Send test email**.

### 5. Upload the kit

In the admin console → **Kit & downloads**, upload the kit as a `.zip` and set the version. Leave out `node_modules`, `my-files`, `output`, `projects` and `transcripts`. Set how many downloads each key gets (default 5). Until a kit is uploaded, the download page tells buyers it isn't ready yet, and the dashboard shows a warning.

### 6. Final check

In the admin sidebar, all four badges should be green: **Payments: Razorpay live**, **Email: Resend**, **Webhook: On**, **Kit file: Uploaded**. Then make one real purchase yourself, check the email arrives, and refund it in Razorpay.

---

## Checking keys from the SnapQut tool

```http
POST https://YOUR-DOMAIN/api/license/verify
Content-Type: application/json

{ "key": "SNPQ-7KQ2-M9XA-4HTD" }
```

Responses:

```json
{ "valid": true, "product": "SnapQut for Claude", "status": "active", "issuedTo": "pr***@gmail.com", "issuedAt": "2026-10-11T12:30:00.000Z" }
{ "valid": false, "reason": "not_found" }
{ "valid": false, "reason": "revoked" }
```

Spaces, dashes and lowercase in the key are ignored. Requests are limited to 30 a minute per IP. The admin **Orders** table shows how many times each key was checked.

A minimal check in Node:

```js
const r = await fetch('https://YOUR-DOMAIN/api/license/verify', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ key: userKey })
});
const { valid } = await r.json();
if (!valid) throw new Error('This SnapQut key is not valid. Check the email you received after purchase.');
```

---

## Admin console

| Tab | What you can do |
|---|---|
| Dashboard | Revenue, number of buyers, today's sales, a 14-day sales chart, failed emails, latest buyers |
| Orders & keys | Search by email, name, key or payment ID. Resend an email, revoke or restore a key, reset a buyer's download count, issue a key manually, export CSV. Click a key to copy it. |
| Kit & downloads | Upload a new kit version, set the download limit per key and the file name, and see every download (who, when, which version). |
| Blog | Create, edit, publish/unpublish, feature and delete posts. Markdown editor with preview, cover image picker and uploads. |
| Site content | Hero text, price, crossed-out price, price notice, support email, WhatsApp, FAQ and reviews. Saves go live immediately. |
| Emails | Licence email sender, subject and setup steps, a live preview, test sends, and a log of every email. |

### Writing blog posts

Posts are Markdown. Two extras:

- A ` ```prompt ` code block renders as a "You type" prompt box.
- A `>` blockquote renders as a highlighted callout.

Drafts are visible only to you while you're signed in. Open the post's address to preview it.

---

## Kit storage: Cloudflare R2

When the four `R2_` settings are present, the kit lives in a **private** Cloudflare R2 bucket:
- The admin's browser uploads the zip straight into the bucket (it never passes through the server), so a 1 GB kit uploads fine.
- Each buyer gets a signed Cloudflare link that expires after 10 minutes. Cloudflare carries the download, and R2 has no download-traffic fees.
- Without the `R2_` settings, the kit is stored on the server instead.

Setup steps, including the CORS policy the bucket needs, are in `LAUNCH-CHECKLIST.md`.

## How downloads work

1. The licence email's **Download SnapQut** button opens `/download#SNPQ-…`. The key goes after `#`, so browsers never send it to the server and it stays out of logs. The page fills it in and checks it.
2. The server checks that the key exists, isn't revoked and is under its download limit. It then returns a private link that works for 10 minutes.
3. Each link counts as one download, even if the buyer's browser retries or resumes it. A revoked key also stops links that were already handed out.
4. Buyers who lost their key can use **Resend my key** on the download page. It answers the same way whether or not the email bought, so nobody can test which emails are customers.

This stops shared or forwarded download links and lets you see and limit downloads per key. It can't stop someone sharing a zip they already downloaded. For that, the kit itself would need an activation check.

## Backups

Everything lives in one file: `data/snapqut.db` (or `DATA_DIR/snapqut.db`). Uploaded images are in `UPLOAD_DIR`, and the kit is in `KIT_DIR` (default `DATA_DIR/kit`). Back up both regularly. On Render, the disk has daily snapshots.

## Security notes

- Admin sessions use an HttpOnly, SameSite=Strict cookie that lasts 12 hours. Login is limited to 8 attempts per 15 minutes per IP.
- Razorpay payments are confirmed by checking Razorpay's signature on the server. Webhooks are checked against your webhook secret, and the amount must match the order.
- Test checkout switches itself off when `NODE_ENV=production`, unless `ALLOW_TEST_CHECKOUT=1` is set. Don't leave that on.
- Never commit `.env`.
