'use strict';
const { q, getSettings } = require('./db');
const { esc, nowIso, rupees } = require('./util');

const RESEND_KEY = process.env.RESEND_API_KEY || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');

function licenceEmail({ name, key, order }) {
  const e = getSettings('email');
  const site = getSettings('site');
  const steps = String(e.setupSteps || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const hi = name ? `Hi ${esc(name.split(' ')[0])},` : 'Hi,';
  const amount = rupees(order.amount_paise / 100);
  // Key goes in the #fragment: browsers never send it to the server, so it stays out of logs.
  const downloadLink = `${PUBLIC_URL}/download#${encodeURIComponent(key)}`;

  const html = `<!doctype html><html><body style="margin:0;background:#f4f2fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#17151f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2fb;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6e1f5">
<tr><td style="padding:28px 32px 8px"><img src="${PUBLIC_URL}/assets/logo-dark.png" alt="SnapQut" width="150" style="display:block;height:auto"></td></tr>
<tr><td style="padding:12px 32px 0;font-size:16px;line-height:1.6">
<p style="margin:0 0 12px">${hi}</p>
<p style="margin:0 0 20px">Thanks for buying SnapQut. Here is your access key. Keep this email safe: you'll need the key to activate SnapQut.</p>
</td></tr>
<tr><td style="padding:0 32px">
<div style="border-radius:12px;background:#120f22;padding:20px;text-align:center">
<div style="color:#b9a3ff;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:8px">Your access key</div>
<div style="color:#ffffff;font-family:SFMono-Regular,Menlo,Consolas,monospace;font-size:22px;letter-spacing:2px;font-weight:700">${esc(key)}</div>
</div></td></tr>
<tr><td align="center" style="padding:24px 32px 4px"><a href="${downloadLink}" style="display:inline-block;background:#8b5cf6;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:999px">Download SnapQut</a>
<div style="font-size:12.5px;color:#6b6780;margin-top:10px">Or go to <a href="${PUBLIC_URL}/download" style="color:#7c3aed">${esc(PUBLIC_URL.replace(/^https?:\/\//, ''))}/download</a> and enter your key.</div></td></tr>
${steps.length ? `<tr><td style="padding:20px 32px 0;font-size:15px;line-height:1.6"><p style="margin:0 0 8px;font-weight:700">Set it up in a few minutes</p><ol style="margin:0;padding-left:20px">${steps.map((s) => `<li style="margin:0 0 6px">${esc(s)}</li>`).join('')}</ol></td></tr>` : ''}
<tr><td style="padding:24px 32px;font-size:13px;line-height:1.6;color:#6b6780">
<hr style="border:0;border-top:1px solid #eee;margin:0 0 16px">
Order <b>${esc(order.public_id)}</b> · ${amount} · one-time purchase<br>
Questions? Reply to this email${site.whatsapp ? ` or WhatsApp us at ${esc(site.whatsapp)}` : ''}.
</td></tr></table>
</td></tr></table></body></html>`;

  const text = [
    name ? `Hi ${name.split(' ')[0]},` : 'Hi,',
    '',
    'Thanks for buying SnapQut. Your access key:',
    '',
    `    ${key}`,
    '',
    `Download: ${downloadLink}\n(or go to ${PUBLIC_URL}/download and enter your key)\n`,
    steps.length ? 'Set it up:\n' + steps.map((s, i) => `${i + 1}. ${s}`).join('\n') + '\n' : '',
    `Order ${order.public_id} · ${amount}`,
    `Questions? Reply to this email${site.whatsapp ? ` or WhatsApp ${site.whatsapp}` : ''}.`
  ].join('\n');

  return { subject: e.subject, html, text };
}

// Sends through Resend when RESEND_API_KEY is set; otherwise records the email as "logged" (visible in the admin outbox).
async function send({ to, subject, html, text, orderId = null }) {
  const e = getSettings('email');
  if (!RESEND_KEY) {
    q.logEmail.run(orderId, to, subject, 'logged', null, null, html, nowIso());
    console.log(`[mail] RESEND_API_KEY not set. Logged email to ${to}: "${subject}"`);
    return { status: 'logged' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${e.fromName} <${e.fromEmail}>`, to: [to], reply_to: e.replyTo || undefined, subject, html, text })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || `Resend responded ${res.status}`);
    q.logEmail.run(orderId, to, subject, 'sent', body.id || null, null, html, nowIso());
    return { status: 'sent', id: body.id };
  } catch (err) {
    q.logEmail.run(orderId, to, subject, 'failed', null, String(err.message || err), html, nowIso());
    return { status: 'failed', error: String(err.message || err) };
  }
}

async function sendLicence(order, licence) {
  const mail = licenceEmail({ name: order.name, key: licence.key, order });
  const r = await send({ to: order.email, ...mail, orderId: order.id });
  q.setEmailStatus.run(r.status, r.error || null, r.status === 'failed' ? null : nowIso(), order.id);
  return r;
}

module.exports = { send, sendLicence, licenceEmail, mailMode: () => (RESEND_KEY ? 'resend' : 'log') };
