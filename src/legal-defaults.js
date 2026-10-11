'use strict';
// Starting templates for the legal pages. Edit them in Admin → Legal pages.
// Placeholders filled in when the page is shown: {business} {email} {whatsapp} {address} {price} {site}
module.exports = {
  businessName: 'SnapQut',
  address: '',
  updated: '2026-10-11',

  privacy: `**{business}** ("we", "us") runs {site} and sells SnapQut, a video editing kit for Claude. This page explains what personal information we collect and how we use it.

## What we collect

- **When you buy:** your name (optional), email address, and, depending on the payment provider, your mobile number. Payments are processed by our payment partner (Razorpay). We never see or store your card, UPI or bank details.
- **When you download:** the date, time and IP address of each download, linked to your licence key.
- **When you browse:** basic technical information your browser sends (such as IP address and browser type) in our server logs.

## How we use it

- To deliver your licence key and download link by email.
- To check your licence key when you download SnapQut.
- To help you if you contact support, and to handle refunds.
- To prevent misuse, such as sharing licence keys.

We don't sell your personal information, and we don't send marketing emails unless you've asked for them.

## Who we share it with

Only the services we need to run the store: our payment partner (Razorpay), our email delivery service (Resend), and our hosting and file storage providers. Each only receives what it needs to do its job.

## How long we keep it

We keep order and licence records for as long as needed to support your licence and to meet legal and tax requirements.

## Your choices

You can ask us to correct or delete your information by emailing **{email}**. We may need to keep some records where the law requires it.

## Contact

{business} · {email} · WhatsApp {whatsapp}
`,

  terms: `These terms apply when you buy or use SnapQut from {site}, run by **{business}**. By buying SnapQut you agree to them.

## What you're buying

SnapQut is a downloadable kit that works with Claude to edit videos. You pay **{price} once** and receive a personal licence key and access to download the kit. There is no subscription.

## Your licence

- Your licence is for **you** (one person). You can use SnapQut on your own computers for your own and your clients' videos.
- You may **not** share, resell, publish or give away the kit, your licence key or your download link.
- Each key has a download limit. Contact us if you need more downloads.
- We can deactivate a key that's been shared, resold or bought with a disputed payment.

## Your content

You own the videos you create with SnapQut. You're responsible for having the rights to the footage, music and other material you use.

## Third-party services

SnapQut works with Claude, which is a separate product with its own terms and costs. We're not responsible for changes to or outages of third-party services.

## Updates and support

We may release updates to the kit. Support is provided by email and WhatsApp.

## Limitation of liability

SnapQut is provided "as is". To the extent the law allows, our total liability for any claim is limited to the amount you paid for SnapQut.

## Changes

We may update these terms. The version on this page applies to purchases made after the update.

## Contact

{business} · {email} · WhatsApp {whatsapp}
`,

  refund: `SnapQut is a digital product that's delivered instantly, so we handle refunds case by case and by a real person.

## When you can get a refund

- **The kit doesn't work for you** and our support can't fix it within a reasonable time: email us within **7 days** of purchase for a full refund.
- **You were charged twice** for the same purchase: we'll refund the extra payment in full.
- **You paid but never received your key** and we can't deliver it: full refund.

## When refunds aren't available

- After **7 days** from purchase.
- If you've simply changed your mind after downloading the kit.
- If the licence has been shared or misused.

## How to ask

Email **{email}** (or WhatsApp {whatsapp}) with your order email and, if you have it, your licence key or order reference. Tell us briefly what went wrong.

## What happens next

Approved refunds go back to your original payment method within **5–7 working days**. When a refund is issued, your licence key is deactivated.

## Chargebacks

Please contact us before raising a chargeback with your bank. We'll usually sort things out faster.
`,

  delivery: `SnapQut is a **digital product**. Nothing is shipped physically.

## How you receive it

1. As soon as your payment is confirmed, your licence key appears on screen.
2. We also email the key and a download link to the address you gave at checkout. This usually takes a few minutes; check your spam folder too.
3. Download SnapQut from the download page by entering your key. Each download link works for 10 minutes; you can request a new one with your key anytime.

## If it doesn't arrive

If you don't receive the email within **1 hour**, use **Resend my key** on the download page, or contact us at **{email}** / WhatsApp {whatsapp}.

## Delivery charges

There are no delivery charges.
`
};
