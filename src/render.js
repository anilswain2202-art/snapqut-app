'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { marked } = require('marked');
const { esc, slugify, rupees } = require('./util');

const VIEWS = path.join(__dirname, '..', 'views');
const tpl = (name) => fs.readFileSync(path.join(VIEWS, name), 'utf8');

// {{key}} = escaped, {{{key}}} = raw HTML
function fill(template, vars) {
  return template
    .replace(/\{\{\{(\w+)\}\}\}/g, (_, k) => (vars[k] ?? ''))
    .replace(/\{\{(\w+)\}\}/g, (_, k) => esc(vars[k] ?? ''));
}

// ---------- Markdown ----------
marked.use({
  gfm: true,
  renderer: {
    code(token) {
      if (token.lang === 'prompt') return `<span class="prompt">${esc(token.text)}</span>\n`;
      return false;
    }
  }
});

function renderMarkdown(md) {
  let html = marked.parse(String(md || ''));
  const toc = [];
  const used = new Set();
  html = html.replace(/<h2>(.*?)<\/h2>/g, (_, inner) => {
    const text = inner.replace(/<[^>]+>/g, '');
    let id = slugify(text) || 'section';
    while (used.has(id)) id += '-x';
    used.add(id);
    toc.push({ id, text: text.replace(/^Step \d+:\s*/, '') });
    return `<h2 id="${id}">${inner}</h2>`;
  });
  html = html.replace(/<blockquote>/g, '<div class="callout">').replace(/<\/blockquote>/g, '</div>');
  html = html.replace(/<table>/g, '<div class="table-scroll"><table class="compare">').replace(/<\/table>/g, '</table></div>');
  return { html, toc };
}

// ---------- shared blog chrome ----------
function nav(current) {
  const links = [['Examples', '/#examples'], ['Features', '/#features'], ['How it works', '/#how'], ['Pricing', '/#pricing'], ['Blog', '/blog']];
  return `<header class="nav">
  <div class="wrap">
    <a class="nav-logo" href="/" aria-label="SnapQut home"><img src="/assets/logo-light.png" alt="SnapQut" width="640" height="162"></a>
    <nav class="nav-links" aria-label="Site">
      ${links.map(([t, h]) => `<a href="${h}"${t === current ? ' aria-current="page"' : ''}>${t}</a>`).join('\n      ')}
    </nav>
    <a class="btn" href="/get">Get SnapQut</a>
  </div>
</header>`;
}

function footer(site) {
  return `<footer class="wrap">
  <div class="footer-box">
    <div class="footer-grid">
      <div><img src="/assets/logo-light.png" alt="SnapQut" width="640" height="162"><p>The video editing skill for Claude. Turn raw footage into finished videos with one sentence.</p></div>
      <div class="fcol"><b>Product</b><a href="/#features">Features</a><a href="/#how">How it works</a><a href="/#pricing">Pricing</a><a href="/blog">Blog</a><a href="/download">Download (buyers)</a></div>
      <div class="fcol"><b>Support</b><span>Email: <span class="sel">${esc(site.supportEmail)}</span></span><span>WhatsApp: <span class="sel">${esc(site.whatsapp)}</span></span><a href="/#faq">FAQ</a></div>
      <div class="fcol"><b>Legal</b><a href="/privacy">Privacy policy</a><a href="/terms">Terms of service</a><a href="/refund-policy">Refund &amp; cancellation</a><a href="/shipping-policy">Shipping &amp; delivery</a><a href="/contact">Contact us</a></div>
    </div>
    <div class="footer-bottom"><span>© ${new Date().getFullYear()} SnapQut. All rights reserved.</span><span>Made for creators who'd rather post than edit.</span></div>
  </div>
</footer>`;
}

function doc({ title, description, body, script = '', head = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="icon" type="image/png" href="/assets/favicon.png">
<link rel="stylesheet" href="/assets/blog.css">
${head}
</head>
<body>
${body}
${script}
</body>
</html>`;
}

const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const covers = (p) => { try { return JSON.parse(p.cover || '[]'); } catch { return []; } };

function coverHtml(p) {
  const imgs = covers(p).slice(0, 3).map((c) => `<img src="${esc(c)}" alt="" loading="lazy">`).join('');
  return `<div class="cover" aria-hidden="true">${imgs}</div>`;
}

function card(p, featured = false) {
  return `<a class="post-card${featured ? ' featured' : ''}" href="/blog/${esc(p.slug)}" data-cat="${esc(p.category)}">
  ${coverHtml(p)}
  <div class="post-body">
    <span class="pill">${esc(p.category)}</span>
    <h2>${esc(p.title)}</h2>
    <p>${esc(p.dek)}</p>
    <div class="meta"><span>SnapQut Team</span><span>${fmtDate(p.published_at)}</span><span>${p.read_mins} min read</span></div>
    <span class="read">Read ${featured ? 'the guide' : 'article'} →</span>
  </div>
</a>`;
}

function blogIndex(posts, site) {
  const featured = posts.find((p) => p.featured) || posts[0];
  const rest = posts.filter((p) => p !== featured);
  const order = ['Guides', 'Captions', 'Style', 'Ads'];
  const rank = (c) => (order.includes(c) ? order.indexOf(c) : order.length);
  const cats = ['All', ...[...new Set(posts.map((p) => p.category))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))];
  const body = `${nav('Blog')}
<main>
  <section class="blog-hero">
    <div class="wrap">
      <span class="eyebrow">✦ The SnapQut blog ✦</span>
      <h1>Guides for creators who'd rather <span class="violet">post than edit</span></h1>
      <p>How to brief Claude, get better captions, borrow a style and build ads that convert, one sentence at a time.</p>
      <div class="filters" role="group" aria-label="Filter by topic">${cats.map((c) => `<button class="filter" type="button" data-f="${esc(c)}" aria-pressed="${c === 'All'}">${esc(c)}</button>`).join('')}</div>
    </div>
  </section>
  <section class="wrap">
    ${featured ? card(featured, true) : '<p class="empty" style="display:block">No posts yet.</p>'}
    <div class="posts">
      ${rest.map((p) => card(p)).join('\n      ')}
    </div>
    <p class="empty" id="empty">No posts in this topic yet.</p>
    <div class="cta-band">
      <div><h2>Make your first video today</h2><p>One-time ${rupees(site.price)}. No subscription, no per-render charge.</p></div>
      <a class="btn btn-lg" href="/get"><span class="spark">✦</span> Get SnapQut</a>
    </div>
  </section>
</main>
${footer(site)}`;
  const script = `<script>
(function () {
  var btns = document.querySelectorAll('.filter'), cards = document.querySelectorAll('[data-cat]'), empty = document.getElementById('empty');
  btns.forEach(function (b) {
    b.addEventListener('click', function () {
      var f = b.getAttribute('data-f'), shown = 0;
      btns.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      cards.forEach(function (c) { var on = f === 'All' || c.getAttribute('data-cat') === f; c.hidden = !on; if (on) shown++; });
      empty.style.display = shown ? 'none' : 'block';
    });
  });
})();
</script>`;
  return doc({ title: 'SnapQut Blog', description: 'Guides for creators using SnapQut: briefing Claude, captions, styles and ad structures.', body, script });
}

function article(p, others, site, { preview = false } = {}) {
  const { html, toc } = renderMarkdown(p.body_md);
  const body = `${nav('Blog')}
<main>
  <header class="article-head">
    <div class="wrap">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/blog">Blog</a><span>/</span><span>${esc(p.category)}</span></nav>
      <h1>${esc(p.title)}</h1>
      <p class="dek">${esc(p.dek)}</p>
      <div class="meta"><span>SnapQut Team</span><span>${fmtDate(p.published_at) || 'Draft'}</span><span>${p.read_mins} min read</span></div>
    </div>
  </header>
  <div class="article-cover">${coverHtml(p)}</div>
  <div class="article-layout">
    <aside class="toc" aria-label="On this page">
      <b>On this page</b>
      ${toc.map((t) => `<a href="#${t.id}">${esc(t.text)}</a>`).join('\n      ')}
    </aside>
    <article class="prose">
${html}
      <div class="end-cta">
        <h2>Try it on your own footage</h2>
        <p>SnapQut is a one-time ${rupees(site.price)} purchase. Unlimited videos, no subscription.</p>
        <a class="btn btn-lg" href="/get"><span class="spark">✦</span> Get SnapQut for Claude</a>
      </div>
    </article>
  </div>
  ${others.length ? `<section class="more">
    <h2>More from the blog</h2>
    <div class="posts">
      ${others.map((o) => card(o)).join('\n      ')}
    </div>
  </section>` : ''}
</main>
${footer(site)}`;
  const script = `<script>
(function () {
  var links = Array.prototype.slice.call(document.querySelectorAll('.toc a'));
  if (!('IntersectionObserver' in window) || !links.length) return;
  var map = {};
  links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting || !map[e.target.id]) return;
      links.forEach(function (a) { a.classList.remove('on'); });
      map[e.target.id].classList.add('on');
    });
  }, { rootMargin: '-80px 0px -70% 0px' });
  document.querySelectorAll('.prose h2[id]').forEach(function (h) { io.observe(h); });
})();
</script>`;
  return doc({
    title: `${p.title} · SnapQut Blog`, description: p.dek, body, script,
    head: preview ? '<meta name="robots" content="noindex">' : ''
  });
}

// ---------- landing + checkout ----------
function landing(site) {
  const faqHtml = (site.faq || []).map((f, i) =>
    `<details${i === 0 ? ' open' : ''}><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n        ');
  const initials = (n) => String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const testimonialsHtml = (site.testimonials || []).map((t) =>
    `<div class="tile"><span class="ico">${esc(initials(t.name))}</span><div><h3>“${esc(t.quote)}”</h3><p><span class="stars">★★★★★</span>${esc(t.name)}</p></div></div>`).join('\n        ');
  return fill(tpl('index.html'), {
    heroTitle: site.heroTitle, heroHighlight: site.heroHighlight, heroLead: site.heroLead,
    price: rupees(site.price), comparePrice: rupees(site.comparePrice), priceNotice: site.priceNotice,
    supportEmail: site.supportEmail, whatsapp: site.whatsapp,
    faqHtml, testimonialsHtml
  });
}

function checkout(site, client) {
  return fill(tpl('checkout.html'), {
    price: rupees(site.price), comparePrice: rupees(site.comparePrice), priceNotice: site.priceNotice,
    supportEmail: site.supportEmail, whatsapp: site.whatsapp,
    razorpayScript: client.mode === 'razorpay' ? '<script src="https://checkout.razorpay.com/v1/checkout.js" defer></script>'
      : client.mode === 'cashfree' ? '<script src="https://sdk.cashfree.com/js/v3/cashfree.js" defer></script>' : '',
    clientConfig: JSON.stringify(client).replace(/</g, '\\u003c')
  });
}

const LEGAL_TITLES = { privacy: 'Privacy policy', terms: 'Terms of service', refund: 'Refund & cancellation policy', delivery: 'Shipping & delivery policy', contact: 'Contact us' };

function legal(kind, l, site, publicUrl) {
  const fillIn = (t) => String(t || '')
    .replace(/\{business\}/g, l.businessName || 'SnapQut').replace(/\{email\}/g, site.supportEmail || '')
    .replace(/\{whatsapp\}/g, site.whatsapp || '').replace(/\{address\}/g, l.address || '')
    .replace(/\{price\}/g, rupees(site.price)).replace(/\{site\}/g, String(publicUrl || '').replace(/^https?:\/\//, ''));
  let html;
  if (kind === 'contact') {
    html = `<p>We're happy to help with purchases, licence keys, downloads and refunds. We usually reply within one working day.</p>
<dl class="facts" style="grid-template-columns:repeat(2,minmax(0,1fr))">
<div><dt>Email</dt><dd><span class="sel">${esc(site.supportEmail)}</span></dd></div>
<div><dt>WhatsApp</dt><dd><span class="sel">${esc(site.whatsapp)}</span></dd></div>
<div><dt>Business</dt><dd>${esc(l.businessName || 'SnapQut')}</dd></div>
${l.address ? `<div><dt>Address</dt><dd>${esc(l.address).replace(/\n/g, '<br>')}</dd></div>` : ''}
</dl>
<p>Lost your licence key? Use <a href="/download">Resend my key</a> on the download page.</p>`;
  } else {
    html = renderMarkdown(fillIn(l[kind])).html;
  }
  const title = LEGAL_TITLES[kind];
  const body = `${nav('')}
<main>
  <header class="article-head">
    <div class="wrap">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span>/</span><span>Legal</span></nav>
      <h1>${esc(title)}</h1>
      ${kind === 'contact' ? '' : `<div class="meta"><span>Last updated ${fmtDate(l.updated)}</span></div>`}
    </div>
  </header>
  <div class="article-layout" style="grid-template-columns:minmax(0,1fr);max-width:820px">
    <article class="prose">
${html}
    </article>
  </div>
</main>
${footer(site)}`;
  return doc({ title: `${title} · SnapQut`, description: `${title} for SnapQut.`, body });
}

function download(site) {
  return fill(tpl('download.html'), { supportEmail: site.supportEmail, whatsapp: site.whatsapp });
}

module.exports = { landing, checkout, download, legal, blogIndex, article, renderMarkdown };
