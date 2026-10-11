# SnapQut launch checklist

| Day | Date | Goal |
|---|---|---|
| Today | Sat 11 Oct | Set up accounts and deploy |
| Tomorrow | Sun 12 Oct | Test everything with Razorpay **test** keys |
| Launch | Mon 13 Oct | Switch to live keys and go |

Secrets (keys, passwords) go **only** into Render's environment variables or the local `.env` file. Never paste them into chat, email or GitHub.

---

## Today: set up (about 2 hours)

### 1. Cloudflare R2: where the kit lives (20 min)

1. Sign up at **dash.cloudflare.com** (free). Cloudflare may ask for a card to switch on R2. The free allowance still applies (10 GB storage, no download fees).
2. Left menu → **R2 Object Storage** → **Create bucket**
   - Name: `snapqut-kit`
   - Location: Automatic
   - Leave **Public access off** (don't enable the r2.dev URL or a custom domain). The bucket must stay private.
3. Open the bucket → **Settings** → **CORS policy** → **Add CORS policy**, and paste the policy below. Replace `snapqut.com` with your real domain, and keep the localhost line for testing on your computer:
   ```json
   [
     {
       "AllowedOrigins": ["https://snapqut.com", "https://www.snapqut.com", "http://localhost:3000"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
   This lets the admin console upload the zip straight from your browser into the bucket.
4. R2 overview page → **Manage R2 API Tokens** (or "API" → "Manage API tokens") → **Create API token**
   - Permissions: **Object Read & Write**
   - Specify bucket: **Apply to specific buckets only → snapqut-kit**
   - Create, then copy the **Access Key ID** and **Secret Access Key**. The secret is shown only once.
5. Copy your **Account ID**. It's shown on the R2 overview page, and is also the first part of the S3 endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
6. Put the four values into `.env` (and later into Render):
   ```
   R2_ACCOUNT_ID=...
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   R2_BUCKET=snapqut-kit
   ```

### 2. Prepare the kit zip (15 min)

Zip the kit folder **without** `node_modules`, `my-files`, `output`, `projects`, `transcripts`, and `models`. The kit downloads its speech model on first run, so `models` doesn't need to be in the zip. Leaving these out keeps the zip small and keeps your own test files out of it.

### 3. Resend: the licence emails (15 min + DNS wait)

1. Sign up at **resend.com** → **Domains** → **Add domain** → your domain.
2. Add the DNS records Resend shows you at your domain registrar. Verification can take from a few minutes to a few hours, so do this early.
3. **API Keys** → create one with **Sending access** → copy it into `RESEND_API_KEY`.

### 4. Razorpay: TEST keys for tomorrow (15 min)

1. Razorpay Dashboard → switch to **Test Mode** (toggle at the top).
2. **Account & Settings → API Keys** → generate test keys (they start with `rzp_test_`) → `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
3. **Webhooks → Add New Webhook** (still in Test Mode):
   - URL: `https://YOUR-DOMAIN/api/webhooks/razorpay`
   - Secret: a long random string, which also goes in `RAZORPAY_WEBHOOK_SECRET`
   - Events: `payment.captured`, `order.paid`, `payment.failed`

### 5. Deploy on Render (30 min)

1. Put the `snapqut-app` folder in a **private** GitHub repository. `.env` and `data/` are already excluded.
2. render.com → **New → Blueprint** → pick the repo. `render.yaml` creates the web service and its disk.
3. Fill in the environment variables: `PUBLIC_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (a long new password, not the local one), the Razorpay test keys and webhook secret, `RESEND_API_KEY`, and the four `R2_` values.
4. **Settings → Custom Domains** → add your domain and follow the DNS steps. Set `PUBLIC_URL` to `https://your-domain`.
5. Add `https://your-domain` to the R2 CORS policy (step 1.3) if you haven't already.

### 5b. Free test deploy (if you're not ready to pay yet)

Free instances have **no permanent disk** and **sleep after 15 minutes**, so the database is wiped whenever Render restarts the app. Use this for testing only, and switch to Starter + disk before launch.

1. render.com → **New → Web Service** → connect GitHub → pick `snapqut-app`.
2. Language **Node**, Branch **main**, Build command `npm install`, Start command `npm start`, Instance type **Free**.
3. Environment variables:
   - `NODE_ENV` = `production`
   - `ADMIN_EMAIL` and `ADMIN_PASSWORD` (a new, long password)
   - `PUBLIC_URL` = the address Render shows, e.g. `https://snapqut-app.onrender.com`. Add it after the first deploy if you don't know it yet.
   - The Razorpay test keys and webhook secret, `RESEND_API_KEY` (if you have one), and the four `R2_` values.
   - `ALLOW_TEST_CHECKOUT` = `1` **only if** you have no Razorpay test keys yet. Remove it once you do.
4. **Create Web Service** and wait for "Live".
5. **Before launch:** Settings → Instance Type → **Starter**, then Disks → **Add disk** (mount path `/var/data`, 1 GB), and set `DATA_DIR=/var/data` and `UPLOAD_DIR=/var/data/uploads`.

### 6. Admin console (15 min)

Open `https://your-domain/admin` and sign in.

- **Emails:** set the from address (for example `keys@your-domain`), reply-to and setup steps. **Send a test email** to yourself.
- **Site content:** check the price, price notice, support email and WhatsApp number. The defaults are reelabs' details.
- **Kit & downloads:** upload the zip. The progress bar should say "to Cloudflare". Set the version and the downloads-per-key limit.
- **Sidebar:** Payments shows **Razorpay test keys** (amber) until launch day. Email, Webhook, Kit file and Storage should be green.

---

## Tomorrow: test (about 1 hour)

Use Razorpay's test cards and UPI from their docs ("Test card details"). No real money moves.

| # | Do this | Expect |
|---|---|---|
| 1 | Open the homepage on a phone and on a laptop | Everything loads, videos play, no sideways scrolling |
| 2 | Click **Get SnapQut**, enter your email, pay with a test card | Razorpay window opens. After paying: "Payment received" with your key and a Download button |
| 3 | Check your inbox (and spam) | Licence email from your domain, with the key and a Download button |
| 4 | Click **Download SnapQut** in the email | Download page opens with the key filled in → **Download now** → the zip saves |
| 5 | Unzip it, open it in Claude, make one video | The kit works from a fresh download |
| 6 | Buy again, but **close the tab right after paying** | The key email still arrives (that's the webhook) |
| 7 | On `/download`, enter a made-up key `SNPQ-AAAA-BBBB-CCCC` | "We couldn't find that key" |
| 8 | Copy a download link and open it 11+ minutes later | Cloudflare refuses it (expired) |
| 9 | Download with one key until it hits the limit | "This key has reached its download limit" |
| 10 | Admin → Orders → **Revoke** a key, then try to download with it | "This key has been deactivated" |
| 11 | `/download` → **Resend my key** with your purchase email | The key email arrives again |
| 12 | Admin → **Dashboard / Orders / Kit & downloads** | Test orders show a **test** tag, downloads are listed, revenue stays ₹0 |
| 13 | Admin → Blog → edit a post and save | The change shows on `/blog` |
| 14 | Admin → Site content → change the price, save, check `/` and `/get`, then change it back | The price updates everywhere |

Write down anything odd, with the step number and a screenshot.

---

## Launch day: go live (30 min)

1. Razorpay → switch to **Live Mode** → generate **live** keys (`rzp_live_…`) → replace `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in Render.
2. In Live Mode, add the **same webhook** again (live mode has its own webhook list), with a new secret → update `RAZORPAY_WEBHOOK_SECRET`.
3. Render restarts by itself after you change environment variables. Wait for "Live".
4. Admin → Orders → **Delete test orders**.
5. Make one real purchase yourself, check the email and download, then refund it in Razorpay → Admin → Orders → **Revoke** that key.
6. Announce it.

## If something goes wrong

| Problem | Where to look |
|---|---|
| Buyer paid but got no email | Admin → Orders → their row → the Email column. Click **Resend**. Admin → Emails shows the error. |
| Buyer lost their key | They can use **Resend my key** on `/download`, or you can **Resend** from Orders |
| Buyer hit the download limit | Orders → **Reset downloads** |
| Upload to Cloudflare fails | Check the R2 CORS policy includes your site's exact address, and the R2 keys in Render |
| Payment works but no order shows as paid | Razorpay → Webhooks → check the delivery log for errors. The URL must be `https://YOUR-DOMAIN/api/webhooks/razorpay` |
