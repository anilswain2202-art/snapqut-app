(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var inr = function (paise) { return '₹' + (Number(paise || 0) / 100).toLocaleString('en-IN'); };
  var when = function (iso) { if (!iso) return '—'; var d = new Date(iso); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };

  function api(method, url, body) {
    return fetch('/admin/api' + url, {
      method: method, credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        if (r.status === 401 && url !== '/login') { showLogin(); }
        if (!r.ok) throw new Error(b.error || 'Something went wrong.');
        return b;
      });
    });
  }

  var toastTimer;
  function toast(msg, bad) {
    var t = $('#toast'); t.textContent = msg; t.className = 'toast on' + (bad ? ' bad' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = 'toast'; }, 2800);
  }
  function copy(text) {
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast('Copied ' + text); }, function () {});
  }

  // ---------- auth ----------
  function showLogin(note) {
    $('#appView').hidden = true; $('#loginView').hidden = false;
    if (note) $('#loginNote').textContent = note;
  }
  function showApp(me) {
    $('#loginView').hidden = true; $('#appView').hidden = false;
    var m = me.modes || {};
    var label = { cashfree: ['Cashfree live', 'ok'], 'cashfree-test': ['Cashfree sandbox', 'warn'], razorpay: ['Razorpay live', 'ok'], 'razorpay-test': ['Razorpay test keys', 'warn'], test: ['Test mode', 'warn'], off: ['Off', 'bad'], resend: ['Resend', 'ok'], log: ['Not connected', 'warn'] };
    var row = function (name, v) { var l = label[v] || [v, 'dim']; return '<div>' + name + ' <span class="chip ' + l[1] + '">' + esc(l[0]) + '</span></div>'; };
    $('#modes').innerHTML = row('Payments', m.payments) + row('Email', m.email) +
      '<div>Webhook <span class="chip ' + (m.webhook ? 'ok' : 'warn') + '">' + (m.webhook ? 'On' : 'Off') + '</span></div>' +
      '<div>Kit file <span class="chip ' + (m.kit ? 'ok' : 'bad') + '">' + (m.kit ? 'Uploaded' : 'Missing') + '</span></div>' +
      '<div>Storage <span class="chip ' + (m.storage === 'r2' ? 'ok' : 'dim') + '">' + (m.storage === 'r2' ? 'Cloudflare R2' : 'Server') + '</span></div>';
    go(location.hash.slice(1) || 'dashboard');
  }
  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault(); $('#loginErr').textContent = '';
    api('POST', '/login', { email: $('#loginEmail').value, password: $('#loginPassword').value })
      .then(function () { return api('GET', '/me'); }).then(showApp)
      .catch(function (err) { $('#loginErr').textContent = err.message; });
  });
  $('#logoutBtn').addEventListener('click', function () { api('POST', '/logout', {}).then(function () { showLogin('You signed out.'); }); });

  // ---------- tabs ----------
  var loaders = {};
  function go(tab) {
    if (!loaders[tab]) tab = 'dashboard';
    $$('.tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    $$('[data-view]').forEach(function (v) { v.hidden = v.dataset.view !== tab; });
    if (location.hash.slice(1) !== tab) history.replaceState(null, '', '#' + tab);
    loaders[tab]();
  }
  $$('.tabs button').forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.tab); }); });
  window.addEventListener('hashchange', function () { if (!$('#appView').hidden) go(location.hash.slice(1)); });
  document.addEventListener('click', function (e) { var g = e.target.closest('[data-goto]'); if (g) go(g.dataset.goto); });

  function statusChip(o) {
    if (o.status === 'paid') return '<span class="chip ok">Paid</span>';
    if (o.status === 'failed') return '<span class="chip bad">Failed</span>';
    return '<span class="chip dim">Not paid</span>';
  }
  function emailChip(o) {
    if (o.status !== 'paid') return '<span class="muted">—</span>';
    return { sent: '<span class="chip ok">Sent</span>', logged: '<span class="chip warn">Not sent (test)</span>', failed: '<span class="chip bad" title="' + esc(o.email_error) + '">Failed</span>', pending: '<span class="chip dim">Pending</span>', skipped: '<span class="chip dim">Not emailed</span>' }[o.email_status] || esc(o.email_status);
  }
  function sourceChip(s) { return s === 'website' ? '' : ' <span class="chip ' + (s === 'test' ? 'warn' : 'info') + '">' + esc(s) + '</span>'; }

  // ---------- dashboard ----------
  loaders.dashboard = function () {
    api('GET', '/stats').then(function (s) {
      var others = s.other.map(function (o) { return o.n + ' ' + o.source; }).join(' · ') || 'none';
      $('#dashBanner').innerHTML = s.kitReady ? '' : '<div class="banner"><span><b>No kit uploaded yet.</b> Buyers get a key but can\u2019t download anything until you upload the kit .zip.</span><button class="btn ghost small" type="button" data-goto="kit">Upload kit →</button></div>';
      $('#kpis').innerHTML =
        '<div class="kpi"><span>Revenue</span><b>' + inr(s.totals.paise) + '</b><small>all time, website sales</small></div>' +
        '<div class="kpi"><span>Buyers</span><b>' + s.totals.orders + '</b><small>other keys: ' + esc(others) + '</small></div>' +
        '<div class="kpi"><span>Today</span><b>' + s.today.n + '</b><small>' + inr(s.today.paise) + ' · ' + s.downloads + ' kit downloads all time</small></div>' +
        '<div class="kpi' + (s.pendingEmails ? ' alert' : '') + '"><span>Emails that failed</span><b>' + s.pendingEmails + '</b><small>' + (s.pendingEmails ? 'resend from Orders' : 'all delivered') + '</small></div>';
      var map = {}; s.days.forEach(function (d) { map[d.day] = d; });
      var days = [], max = 1;
      for (var i = 13; i >= 0; i--) {
        var d = new Date(); d.setDate(d.getDate() - i);
        var key = d.toISOString().slice(0, 10), v = map[key] ? map[key].n : 0;
        days.push({ key: key, n: v, label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) }); if (v > max) max = v;
      }
      $('#chart').innerHTML = days.map(function (d, i) {
        return '<div class="bar-col" title="' + d.n + ' sales on ' + d.label + '">' + (d.n ? '<em>' + d.n + '</em>' : '') +
          '<div class="bar' + (d.n ? '' : ' zero') + '" style="height:' + (d.n / max * 100) + '%"></div>' + (i % 2 === 0 || i === 13 ? '<small>' + d.label + '</small>' : '') + '</div>';
      }).join('');
      $('#chart').parentNode.classList.add('chart-wrap');
      $('#recentTable').innerHTML = '<thead><tr><th>Buyer</th><th>Key</th><th class="num">Amount</th><th>Email</th><th>Paid</th></tr></thead><tbody>' +
        (s.recent.length ? s.recent.map(function (o) {
          return '<tr><td class="who"><b>' + esc(o.name || '—') + sourceChip(o.source) + '</b><span>' + esc(o.email) + '</span></td><td><span class="key" data-copy="' + esc(o.licence_key) + '">' + esc(o.licence_key) + '</span></td><td class="num">' + inr(o.amount_paise) + '</td><td>' + emailChip(o) + '</td><td class="nowrap">' + when(o.paid_at) + '</td></tr>';
        }).join('') : '<tr><td class="empty-row" colspan="5">No sales yet. They’ll appear here as soon as someone buys.</td></tr>') + '</tbody>';
    }).catch(function (e) { toast(e.message, true); });
  };

  // ---------- orders ----------
  var page = { offset: 0, limit: 50, total: 0 };
  function orderParams() {
    return 'q=' + encodeURIComponent($('#orderSearch').value.trim()) + '&status=' + $('#orderStatus').value + '&source=' + $('#orderSource').value;
  }
  loaders.orders = function () {
    api('GET', '/orders?' + orderParams() + '&limit=' + page.limit + '&offset=' + page.offset).then(function (r) {
      page.total = r.total;
      $('#ordersCount').textContent = r.total ? 'Showing ' + (page.offset + 1) + '–' + (page.offset + r.rows.length) + ' of ' + r.total : '';
      $('#prevPage').disabled = page.offset === 0; $('#nextPage').disabled = page.offset + page.limit >= r.total;
      $('#ordersTable').innerHTML = '<thead><tr><th>Buyer</th><th>Status</th><th>Key</th><th class="num">Amount</th><th>Email</th><th class="num">Downloads</th><th>Date</th><th></th></tr></thead><tbody>' +
        (r.rows.length ? r.rows.map(function (o) {
          var keyCell = o.licence_key ? '<span class="key' + (o.licence_status === 'revoked' ? ' revoked' : '') + '" data-copy="' + esc(o.licence_key) + '" title="' + (o.verify_count ? 'Checked ' + o.verify_count + '× · last ' + when(o.last_verified_at) : 'Not checked by the tool yet') + '">' + esc(o.licence_key) + '</span>' : '<span class="muted">—</span>';
          var acts = '<button class="btn ghost small" data-order="' + o.id + '">Details</button>' + (o.status === 'paid' && o.licence_key ?
            '<button class="btn ghost small" data-resend="' + o.id + '">Resend</button>' +
            (o.download_count ? '<button class="btn ghost small" data-resetdl="' + o.licence_id + '" title="Lets this buyer download again if they hit the limit">Reset downloads</button>' : '') +
            '<button class="btn ghost small' + (o.licence_status === 'revoked' ? '' : ' danger') + '" data-lic="' + o.licence_id + '" data-to="' + (o.licence_status === 'revoked' ? 'active' : 'revoked') + '">' + (o.licence_status === 'revoked' ? 'Restore' : 'Revoke') + '</button>' : '');
          return '<tr><td class="who"><button class="row-link" type="button" data-order="' + o.id + '" title="Open order details"><b>' + esc(o.name || '—') + sourceChip(o.source) + '</b></button><span>' + esc(o.email) + '</span></td><td>' + statusChip(o) + '</td><td>' + keyCell + '</td><td class="num">' + inr(o.amount_paise) + (o.coupon_code ? '<br><span class="chip info" title="Saved ' + inr(o.discount_paise) + '">' + esc(o.coupon_code) + '</span>' : '') + '</td><td>' + emailChip(o) + '</td><td class="num" title="' + (o.last_download_at ? 'Last: ' + when(o.last_download_at) : 'Not downloaded yet') + '">' + (o.licence_key ? (o.download_count || 0) : '—') + '</td><td class="nowrap">' + when(o.paid_at || o.created_at) + '<br><span class="muted small">' + esc(o.razorpay_payment_id || o.public_id) + '</span></td><td><div class="row-actions">' + acts + '</div></td></tr>';
        }).join('') : '<tr><td class="empty-row" colspan="8">No orders match.</td></tr>') + '</tbody>';
    }).catch(function (e) { toast(e.message, true); });
  };
  var searchTimer;
  $('#orderSearch').addEventListener('input', function () { clearTimeout(searchTimer); searchTimer = setTimeout(function () { page.offset = 0; loaders.orders(); }, 250); });
  ['#orderStatus', '#orderSource'].forEach(function (s) { $(s).addEventListener('change', function () { page.offset = 0; loaders.orders(); }); });
  $('#prevPage').addEventListener('click', function () { page.offset = Math.max(0, page.offset - page.limit); loaders.orders(); });
  $('#nextPage').addEventListener('click', function () { page.offset += page.limit; loaders.orders(); });
  $('#deleteTestBtn').addEventListener('click', function () {
    if (!window.confirm('Delete every test order, with its key, downloads and emails? Real orders are not touched. This can\u2019t be undone.')) return;
    api('POST', '/orders/delete-test', {}).then(function (r) { toast(r.deleted ? 'Deleted ' + r.deleted + ' test order' + (r.deleted === 1 ? '' : 's') + '.' : 'There were no test orders.'); page.offset = 0; loaders.orders(); })
      .catch(function (err) { toast(err.message, true); });
  });
  $('#csvBtn').addEventListener('click', function () { location.href = '/admin/api/orders.csv?' + orderParams(); });

  document.addEventListener('click', function (e) {
    var k = e.target.closest('[data-copy]'); if (k && k.dataset.copy) copy(k.dataset.copy);
    var rs = e.target.closest('[data-resend]');
    if (rs) {
      rs.disabled = true;
      api('POST', '/orders/' + rs.dataset.resend + '/resend', {}).then(function (r) {
        toast(r.status === 'sent' ? 'Key emailed again.' : r.status === 'logged' ? 'Saved to the outbox (email service not connected).' : 'Email failed: ' + (r.error || ''), r.status === 'failed');
        loaders.orders();
      }).catch(function (err) { toast(err.message, true); rs.disabled = false; });
    }
    var rd = e.target.closest('[data-resetdl]');
    if (rd && window.confirm('Reset this buyer\u2019s download count to 0?')) {
      api('POST', '/licences/' + rd.dataset.resetdl + '/reset-downloads', {}).then(function () { toast('Downloads reset. They can download again.'); loaders.orders(); }).catch(function (err) { toast(err.message, true); });
    }
    var lc = e.target.closest('[data-lic]');
    if (lc) {
      var to = lc.dataset.to;
      if (to === 'revoked' && !window.confirm('Revoke this key? The SnapQut tool will stop accepting it.')) return;
      api('POST', '/licences/' + lc.dataset.lic + '/status', { status: to }).then(function () { toast(to === 'revoked' ? 'Key revoked.' : 'Key restored.'); loaders.orders(); }).catch(function (err) { toast(err.message, true); });
    }
  });

  // Manual key
  $('#manualBtn').addEventListener('click', function () { $('#manualErr').textContent = ''; $('#manualForm').reset(); $('#mSend').checked = true; $('#manualModal').showModal(); });
  $('#manualCancel').addEventListener('click', function () { $('#manualModal').close(); });
  $('#manualForm').addEventListener('submit', function (e) {
    e.preventDefault();
    api('POST', '/orders/manual', { name: $('#mName').value, email: $('#mEmail').value, amount: $('#mAmount').value, note: $('#mNote').value, sendEmail: $('#mSend').checked })
      .then(function (r) { $('#manualModal').close(); toast('Key ' + r.key + ' issued' + (r.emailStatus === 'sent' ? ' and emailed.' : '.')); loaders.orders(); })
      .catch(function (err) { $('#manualErr').textContent = err.message; });
  });

  // ---------- blog ----------
  var posts = [], editing = null, media = [], chosen = [];
  loaders.blog = function () {
    $('#postEditor').hidden = true; $('#blogList').hidden = false;
    api('GET', '/posts').then(function (rows) {
      posts = rows;
      $('#postsTable').innerHTML = '<thead><tr><th>Title</th><th>Topic</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>' +
        (rows.length ? rows.map(function (p) {
          return '<tr><td class="who"><b>' + esc(p.title) + (p.featured ? ' <span class="chip info">Featured</span>' : '') + '</b><span>/blog/' + esc(p.slug) + '</span></td><td>' + esc(p.category) + '</td><td>' + (p.published ? '<span class="chip ok">Published</span>' : '<span class="chip dim">Draft</span>') + '</td><td class="nowrap">' + when(p.updated_at) + '</td><td><div class="row-actions"><button class="btn ghost small" data-edit="' + p.id + '">Edit</button></div></td></tr>';
        }).join('') : '<tr><td class="empty-row" colspan="5">No posts yet. Write your first one.</td></tr>') + '</tbody>';
    }).catch(function (e) { toast(e.message, true); });
  };
  function loadMedia() {
    return api('GET', '/media').then(function (list) { media = list; renderMedia(); });
  }
  function renderMedia() {
    $('#mediaGrid').innerHTML = media.map(function (m) { return '<button type="button" class="' + (chosen.indexOf(m) > -1 ? 'on' : '') + '" data-media="' + esc(m) + '" title="' + esc(m) + '"><img src="' + esc(m) + '" alt="" loading="lazy"></button>'; }).join('');
    $('#coverChosen').innerHTML = chosen.length ? chosen.map(function (c) { return '<img src="' + esc(c) + '" alt="">'; }).join('') : '<span class="muted">None picked. The first one is the front image.</span>';
  }
  $('#mediaGrid').addEventListener('click', function (e) {
    var b = e.target.closest('[data-media]'); if (!b) return;
    var m = b.dataset.media, i = chosen.indexOf(m);
    if (i > -1) chosen.splice(i, 1); else if (chosen.length < 3) chosen.push(m); else toast('Pick up to 3 images. Remove one first.', true);
    renderMedia();
  });
  $('#mediaUpload').addEventListener('change', function () {
    var f = this.files[0]; if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast('Images must be 5 MB or smaller.', true); return; }
    var rd = new FileReader();
    rd.onload = function () {
      api('POST', '/media', { name: f.name, data: rd.result }).then(function (r) {
        media.unshift(r.url); if (chosen.length < 3) chosen.push(r.url); renderMedia(); toast('Image uploaded.');
      }).catch(function (err) { toast(err.message, true); });
    };
    rd.readAsDataURL(f); this.value = '';
  });

  function openEditor(p) {
    editing = p || null;
    $('#blogList').hidden = true; $('#postEditor').hidden = false; $('#postErr').textContent = '';
    $('#editorTitle').textContent = p ? 'Edit post' : 'New post';
    $('#pTitle').value = p ? p.title : ''; $('#pDek').value = p ? p.dek : ''; $('#pBody').value = p ? p.body_md : '## First heading\n\nStart writing here.\n\n```prompt\nAn example prompt your readers can copy\n```\n';
    $('#pSlug').value = p ? p.slug : ''; $('#pCategory').value = p ? p.category : 'Guides'; $('#pMins').value = p ? p.read_mins : '';
    $('#pPublished').checked = p ? !!p.published : false; $('#pFeatured').checked = p ? !!p.featured : false;
    chosen = p ? JSON.parse(p.cover || '[]') : [];
    $('#deletePostBtn').hidden = !p; $('#viewPostLink').hidden = !p; if (p) $('#viewPostLink').href = '/blog/' + p.slug;
    setPreview(false);
    (media.length ? Promise.resolve() : loadMedia()).then(renderMedia);
    window.scrollTo(0, 0);
  }
  $('#newPostBtn').addEventListener('click', function () { openEditor(null); });
  $('#backToPosts').addEventListener('click', loaders.blog);
  document.addEventListener('click', function (e) { var b = e.target.closest('[data-edit]'); if (b) openEditor(posts.filter(function (p) { return p.id === Number(b.dataset.edit); })[0]); });
  $('#pTitle').addEventListener('input', function () { if (!editing && !$('#pSlug').dataset.touched) $('#pSlug').value = this.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80); });
  $('#pSlug').addEventListener('input', function () { this.dataset.touched = '1'; });

  function setPreview(on) {
    $('#writeTab').classList.toggle('on', !on); $('#previewTab').classList.toggle('on', on);
    $('#pBody').hidden = on; $('#pPreview').hidden = !on;
    if (on) api('POST', '/preview', { body_md: $('#pBody').value }).then(function (r) { $('#pPreview').innerHTML = r.html; });
  }
  $('#writeTab').addEventListener('click', function () { setPreview(false); });
  $('#previewTab').addEventListener('click', function () { setPreview(true); });

  $('#postEditor').addEventListener('submit', function (e) {
    e.preventDefault(); $('#postErr').textContent = '';
    var body = { title: $('#pTitle').value, dek: $('#pDek').value, body_md: $('#pBody').value, slug: $('#pSlug').value, category: $('#pCategory').value, read_mins: $('#pMins').value, published: $('#pPublished').checked, featured: $('#pFeatured').checked, cover: chosen };
    (editing ? api('PUT', '/posts/' + editing.id, body) : api('POST', '/posts', body)).then(function (p) {
      editing = p; $('#editorTitle').textContent = 'Edit post'; $('#deletePostBtn').hidden = false; $('#viewPostLink').hidden = false; $('#viewPostLink').href = '/blog/' + p.slug; $('#pSlug').value = p.slug; $('#pMins').value = p.read_mins;
      toast(p.published ? 'Saved and live on the blog.' : 'Saved as a draft.');
    }).catch(function (err) { $('#postErr').textContent = err.message; toast(err.message, true); });
  });
  $('#deletePostBtn').addEventListener('click', function () {
    if (!editing || !window.confirm('Delete “' + editing.title + '”? This can’t be undone.')) return;
    api('DELETE', '/posts/' + editing.id).then(function () { toast('Post deleted.'); loaders.blog(); }).catch(function (err) { toast(err.message, true); });
  });

  // ---------- site content ----------
  function repItem(kind, a, b) {
    var div = document.createElement('div'); div.className = 'rep-item';
    div.innerHTML = kind === 'faq'
      ? '<div class="fields"><input class="r1" placeholder="Question" maxlength="300"><textarea class="r2" rows="2" placeholder="Answer" maxlength="2000"></textarea></div>'
      : '<div class="fields"><input class="r2" placeholder="Short quote, e.g. Saved me hours" maxlength="200"><input class="r1" placeholder="Name" maxlength="80"></div>';
    div.insertAdjacentHTML('beforeend', '<div class="tools"><button type="button" data-up title="Move up">↑</button><button type="button" data-down title="Move down">↓</button><button type="button" data-del title="Remove">✕</button></div>');
    $('.r1', div).value = a || ''; $('.r2', div).value = b || '';
    return div;
  }
  document.addEventListener('click', function (e) {
    var it = e.target.closest('.rep-item'); if (!it) return;
    if (e.target.closest('[data-del]')) it.remove();
    if (e.target.closest('[data-up]') && it.previousElementSibling) it.parentNode.insertBefore(it, it.previousElementSibling);
    if (e.target.closest('[data-down]') && it.nextElementSibling) it.parentNode.insertBefore(it.nextElementSibling, it);
  });
  $('#addFaq').addEventListener('click', function () { $('#faqList').appendChild(repItem('faq')); });
  $('#addReview').addEventListener('click', function () { $('#reviewList').appendChild(repItem('review')); });

  loaders.site = function () {
    api('GET', '/settings').then(function (s) {
      var x = s.site;
      $('#sHeroTitle').value = x.heroTitle; $('#sHeroHighlight').value = x.heroHighlight; $('#sHeroLead').value = x.heroLead;
      $('#sPrice').value = x.price; $('#sCompare').value = x.comparePrice; $('#sNotice').value = x.priceNotice;
      $('#sSupport').value = x.supportEmail; $('#sWhatsapp').value = x.whatsapp;
      $('#faqList').innerHTML = ''; x.faq.forEach(function (f) { $('#faqList').appendChild(repItem('faq', f.q, f.a)); });
      $('#reviewList').innerHTML = ''; x.testimonials.forEach(function (t) { $('#reviewList').appendChild(repItem('review', t.name, t.quote)); });
    }).catch(function (e) { toast(e.message, true); });
  };
  $('#siteForm').addEventListener('submit', function (e) {
    e.preventDefault(); $('#siteErr').textContent = '';
    var site = {
      heroTitle: $('#sHeroTitle').value, heroHighlight: $('#sHeroHighlight').value, heroLead: $('#sHeroLead').value,
      price: $('#sPrice').value, comparePrice: $('#sCompare').value, priceNotice: $('#sNotice').value,
      supportEmail: $('#sSupport').value, whatsapp: $('#sWhatsapp').value,
      faq: $$('#faqList .rep-item').map(function (d) { return { q: $('.r1', d).value, a: $('.r2', d).value }; }),
      testimonials: $$('#reviewList .rep-item').map(function (d) { return { name: $('.r1', d).value, quote: $('.r2', d).value }; })
    };
    api('PUT', '/settings', { site: site }).then(function () { toast('Site updated.'); }).catch(function (err) { $('#siteErr').textContent = err.message; toast(err.message, true); });
  });

  // ---------- email ----------
  function loadPreview() { api('GET', '/email/preview').then(function (m) { $('#mailPreview').srcdoc = m.html; }); }
  loaders.email = function () {
    api('GET', '/settings').then(function (s) {
      var e = s.email;
      $('#eFromName').value = e.fromName; $('#eFrom').value = e.fromEmail; $('#eReply').value = e.replyTo; $('#eSubject').value = e.subject;
      $('#eSteps').value = e.setupSteps;
    });
    loadPreview();
    api('GET', '/emails').then(function (rows) {
      $('#emailLog').innerHTML = '<thead><tr><th>To</th><th>Subject</th><th>Status</th><th>When</th><th></th></tr></thead><tbody>' +
        (rows.length ? rows.map(function (r) {
          var chip = { sent: '<span class="chip ok">Sent</span>', logged: '<span class="chip warn">Not sent (test)</span>', failed: '<span class="chip bad" title="' + esc(r.error) + '">Failed</span>' }[r.status];
          return '<tr><td>' + esc(r.to_email) + '</td><td>' + esc(r.subject) + (r.error ? '<br><span class="muted small">' + esc(r.error) + '</span>' : '') + '</td><td>' + chip + '</td><td class="nowrap">' + when(r.created_at) + '</td><td><div class="row-actions"><button class="btn ghost small" data-mail="' + r.id + '">View</button></div></td></tr>';
        }).join('') : '<tr><td class="empty-row" colspan="5">No emails yet.</td></tr>') + '</tbody>';
    });
  };
  $('#refreshPreview').addEventListener('click', loadPreview);
  $('#emailForm').addEventListener('submit', function (e) {
    e.preventDefault(); $('#emailErr').textContent = '';
    api('PUT', '/settings', { email: { fromName: $('#eFromName').value, fromEmail: $('#eFrom').value, replyTo: $('#eReply').value, subject: $('#eSubject').value, setupSteps: $('#eSteps').value } })
      .then(function () { toast('Email saved.'); loadPreview(); })
      .catch(function (err) { $('#emailErr').textContent = err.message; });
  });
  $('#sendTest').addEventListener('click', function () {
    var b = this; b.disabled = true; $('#testResult').textContent = '';
    api('POST', '/email/test', { to: $('#testTo').value }).then(function (r) {
      $('#testResult').textContent = r.status === 'sent' ? 'Sent. Check the inbox.' : r.status === 'logged' ? 'The email service isn’t connected (no RESEND_API_KEY), so it was saved to the log below instead.' : 'Failed: ' + r.error;
      loaders.email();
    }).catch(function (err) { $('#testResult').textContent = err.message; }).then(function () { b.disabled = false; });
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-mail]'); if (!b) return;
    api('GET', '/emails/' + b.dataset.mail).then(function (r) { $('#mailModalFrame').srcdoc = r.html || '<p>No preview saved.</p>'; $('#mailModal').showModal(); });
  });
  $('#mailClose').addEventListener('click', function () { $('#mailModal').close(); });

  // ---------- kit ----------
  function fmtSize(n) { return n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB'; }
  var kitR2 = false;
  loaders.kit = function () {
    api('GET', '/kit').then(function (k) {
      kitR2 = !!k.r2Enabled;
      $('#r2Existing').hidden = !kitR2;
      $('#kitWhere').innerHTML = (k.present ? 'Stored on <b>' + (k.storage === 'r2' ? 'Cloudflare R2' : 'this server') + '</b>' + (k.storage === 'r2' ? ' (<code>' + esc(k.objectKey) + '</code>)' : '') + '. ' : '') +
        (kitR2 ? 'New uploads go straight to your private Cloudflare R2 bucket <code>' + esc(k.r2Bucket) + '</code>.' : 'Cloudflare R2 isn\u2019t connected, so uploads are stored on this server. Add the R2 settings to .env to deliver from Cloudflare.');
      $('#kitState').innerHTML = k.present ? '<span class="chip ok">Live</span>' : '<span class="chip bad">Missing</span>';
      $('#kitFile').innerHTML = k.present
        ? '<span class="ico"><svg viewBox="0 0 24 24"><path d="M21 8v13H3V3h12l6 5z"/></svg></span><div><b>' + esc(k.fileName || 'SnapQut.zip') + '</b><span>Version ' + esc(k.version) + ' · ' + fmtSize(k.size) + ' · uploaded ' + when(k.uploadedAt) + '</span></div>'
        : '<div class="kit-empty">No kit uploaded yet. Buyers can buy and get a key, but the download page will say the download isn’t ready.</div>';
      $('#kitMax').value = k.maxDownloads; $('#kitName').value = k.fileName; $('#kitVersion').value = k.version;
      if (!$('#kitUpVersion').value) $('#kitUpVersion').placeholder = 'e.g. ' + k.version;
      $('#dlTotal').textContent = k.totalDownloads + ' downloads all time';
      $('#dlTable').innerHTML = '<thead><tr><th>Buyer</th><th>Key</th><th>Version</th><th>IP</th><th>When</th></tr></thead><tbody>' +
        (k.recent.length ? k.recent.map(function (d) {
          return '<tr><td class="who"><b>' + esc(d.name || '—') + '</b><span>' + esc(d.email) + '</span></td><td><span class="key" data-copy="' + esc(d.key) + '">' + esc(d.key) + '</span></td><td>' + esc(d.kit_version) + '</td><td class="muted small">' + esc(d.ip) + '</td><td class="nowrap">' + when(d.created_at) + '</td></tr>';
        }).join('') : '<tr><td class="empty-row" colspan="5">No downloads yet.</td></tr>') + '</tbody>';
    }).catch(function (e) { toast(e.message, true); });
  };
  $('#kitSettings').addEventListener('submit', function (e) {
    e.preventDefault();
    api('PUT', '/kit', { maxDownloads: $('#kitMax').value, fileName: $('#kitName').value, version: $('#kitVersion').value })
      .then(function () { toast('Download rules saved.'); loaders.kit(); }).catch(function (err) { toast(err.message, true); });
  });
  $('#kitUploadBtn').addEventListener('click', function () {
    var f = $('#kitUpload').files[0], err = $('#kitErr'), btn = this;
    err.textContent = '';
    if (!f) { err.textContent = 'Choose the kit .zip file first.'; return; }
    if (!/\.zip$/i.test(f.name)) { err.textContent = 'The kit must be a .zip file.'; return; }
    var version = $('#kitUpVersion').value.trim();
    var bar = $('#kitProgress');
    bar.hidden = false; btn.disabled = true; $('i', bar).style.width = '0%'; $('span', bar).textContent = 'Starting…';
    if (kitR2) { uploadToR2(f, version, btn, bar, err); return; }
    var xhr = new XMLHttpRequest();
    xhr.open('PUT', '/admin/api/kit/file?name=' + encodeURIComponent(f.name) + '&version=' + encodeURIComponent(version));
    xhr.setRequestHeader('Content-Type', 'application/zip');
    xhr.upload.onprogress = function (ev) {
      if (!ev.lengthComputable) return;
      var pct = Math.round(ev.loaded / ev.total * 100);
      $('i', bar).style.width = pct + '%'; $('span', bar).textContent = pct + '% · ' + fmtSize(ev.loaded) + ' of ' + fmtSize(ev.total);
    };
    xhr.onload = function () {
      btn.disabled = false; bar.hidden = true;
      var b = {}; try { b = JSON.parse(xhr.responseText); } catch (x) {}
      if (xhr.status >= 200 && xhr.status < 300) kitDone(b);
      else err.textContent = b.error || 'Upload failed (' + xhr.status + ').';
    };
    xhr.onerror = function () { btn.disabled = false; bar.hidden = true; err.textContent = 'Upload failed. Check your connection and try again.'; };
    xhr.send(f);
  });
  function kitDone(b) {
    toast('Kit uploaded. Buyers now get version ' + b.version + '.');
    $('#kitUpload').value = ''; $('#kitUpVersion').value = ''; loaders.kit(); api('GET', '/me').then(showModesOnly);
  }
  // Cloudflare R2: get a signed upload link, send the file straight to the bucket, then make it live
  function uploadToR2(f, version, btn, bar, err) {
    function fail(msg) { btn.disabled = false; bar.hidden = true; err.textContent = msg; }
    api('POST', '/kit/r2-upload-url', { fileName: f.name }).then(function (u) {
      var xhr = new XMLHttpRequest();
      xhr.open('PUT', u.url);
      xhr.setRequestHeader('Content-Type', 'application/zip');
      xhr.upload.onprogress = function (ev) {
        if (!ev.lengthComputable) return;
        var pct = Math.round(ev.loaded / ev.total * 100);
        $('i', bar).style.width = pct + '%'; $('span', bar).textContent = pct + '% · ' + fmtSize(ev.loaded) + ' of ' + fmtSize(ev.total) + ' to Cloudflare';
      };
      xhr.onload = function () {
        if (xhr.status < 200 || xhr.status >= 300) return fail('Cloudflare refused the upload (' + xhr.status + '). Check the bucket\u2019s CORS settings and the R2 keys.');
        $('span', bar).textContent = 'Checking the file on Cloudflare…';
        api('POST', '/kit/r2-activate', { objectKey: u.objectKey, fileName: f.name, version: version })
          .then(function (b) { btn.disabled = false; bar.hidden = true; kitDone(b); })
          .catch(function (x) { fail(x.message); });
      };
      xhr.onerror = function () { fail('The upload to Cloudflare was blocked. Usually this means the bucket\u2019s CORS policy doesn\u2019t include this site\u2019s address (see README, step “CORS”).'); };
      xhr.send(f);
    }).catch(function (x) { fail(x.message); });
  }
  $('#r2UseBtn').addEventListener('click', function () {
    var b = this, key = $('#r2Key').value.trim(); $('#kitErr').textContent = '';
    if (!key) { $('#kitErr').textContent = 'Enter the file\u2019s path in the bucket first.'; return; }
    b.disabled = true;
    api('POST', '/kit/r2-activate', { objectKey: key, version: $('#kitUpVersion').value.trim() })
      .then(function (r) { $('#r2Key').value = ''; kitDone(r); })
      .catch(function (x) { $('#kitErr').textContent = x.message; })
      .then(function () { b.disabled = false; });
  });
  function showModesOnly(me) {
    var k = me.modes && me.modes.kit;
    var row = $$('#modes div').filter(function (d) { return /Kit file/.test(d.textContent); })[0];
    if (row) row.innerHTML = 'Kit file <span class="chip ' + (k ? 'ok' : 'bad') + '">' + (k ? 'Uploaded' : 'Missing') + '</span>';
  }

  // ---------- order detail ----------
  function openOrder(id) {
    api('GET', '/orders/' + id).then(function (d) {
      var o = d.order, l = d.licence;
      var row = function (k, v) { return '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>'; };
      $('#odTitle').textContent = (o.name || o.email) + ' · ' + o.public_id;
      $('#odBody').innerHTML =
        '<div class="od-grid">' +
          row('Status', statusChip(o) + sourceChip(o.source)) + row('Amount paid', inr(o.amount_paise) + (o.coupon_code ? ' <span class="chip info">' + esc(o.coupon_code) + ' −' + inr(o.discount_paise) + '</span>' : '')) +
          row('Name', esc(o.name || '—')) + row('Email', esc(o.email)) +
          row('Phone', esc(o.phone || '—')) + row('Created', when(o.created_at)) +
          row('Paid', when(o.paid_at)) + row('Payment ID', '<span class="key">' + esc(o.razorpay_payment_id || '—') + '</span>') +
          row('Gateway order', '<span class="key">' + esc(o.razorpay_order_id || '—') + '</span>') + row('Note', esc(o.note || '—')) +
        '</div>' +
        (l ? '<h3>Licence key</h3><div class="od-grid">' +
          row('Key', '<span class="key' + (l.status === 'revoked' ? ' revoked' : '') + '" data-copy="' + esc(l.key) + '">' + esc(l.key) + '</span>') +
          row('Status', l.status === 'active' ? '<span class="chip ok">Active</span>' : '<span class="chip bad">Revoked</span>') +
          row('Downloads', d.downloads.length + (d.maxDownloads ? ' of ' + d.maxDownloads : ' (no limit)')) +
          row('Checked by the tool', l.verify_count ? l.verify_count + '×, last ' + when(l.last_verified_at) : 'Never') +
          '</div><div class="actions">' +
            '<button class="btn ghost small" data-resend="' + o.id + '">Resend key email</button>' +
            (d.downloads.length ? '<button class="btn ghost small" data-resetdl="' + l.id + '">Reset downloads</button>' : '') +
            '<button class="btn ghost small' + (l.status === 'revoked' ? '' : ' danger') + '" data-lic="' + l.id + '" data-to="' + (l.status === 'revoked' ? 'active' : 'revoked') + '">' + (l.status === 'revoked' ? 'Restore key' : 'Revoke key') + '</button>' +
          '</div>' : '<p class="muted">No key yet: this order wasn’t paid.</p>') +
        '<h3>Downloads</h3>' + (d.downloads.length ? '<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Version</th><th>IP</th></tr></thead><tbody>' +
          d.downloads.map(function (x) { return '<tr><td>' + when(x.created_at) + '</td><td>' + esc(x.kit_version) + '</td><td class="muted small">' + esc(x.ip) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted small">Not downloaded yet.</p>') +
        '<h3>Emails</h3>' + (d.emails.length ? '<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Subject</th><th>Status</th><th></th></tr></thead><tbody>' +
          d.emails.map(function (x) { return '<tr><td class="nowrap">' + when(x.created_at) + '</td><td>' + esc(x.subject) + (x.error ? '<br><span class="muted small">' + esc(x.error) + '</span>' : '') + '</td><td>' + ({ sent: '<span class="chip ok">Sent</span>', logged: '<span class="chip warn">Not sent (test)</span>', failed: '<span class="chip bad">Failed</span>' }[x.status] || esc(x.status)) + '</td><td><button class="btn ghost small" data-mail="' + x.id + '">View</button></td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted small">No emails sent.</p>');
      if (!$('#orderModal').open) $('#orderModal').showModal();
      $('#orderModal').dataset.id = id;
    }).catch(function (e) { toast(e.message, true); });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-order]'); if (b) openOrder(b.dataset.order);
  });
  $('#odClose').addEventListener('click', function () { $('#orderModal').close(); });
  // Keep the panel fresh after resend / revoke / reset done from inside it
  document.addEventListener('click', function (e) {
    if (!$('#orderModal').open || !e.target.closest('#odBody [data-resend], #odBody [data-lic], #odBody [data-resetdl]')) return;
    setTimeout(function () { openOrder($('#orderModal').dataset.id); }, 900);
  });

  // ---------- discounts ----------
  function couponPreview() {
    var kind = $('#cKind').value, v = Number($('#cValue').value), price = window.__price || 0;
    $('#cValueHint').textContent = kind === 'percent' ? 'percent, 1–100' : 'rupees off';
    if (!v || !price) { $('#cPreview').textContent = ''; return; }
    var off = kind === 'percent' ? Math.round(price * Math.min(v, 100) / 100) : Math.min(v, price);
    $('#cPreview').textContent = 'Buyers would pay ₹' + (price - off).toLocaleString('en-IN') + ' instead of ₹' + price.toLocaleString('en-IN') + (price - off === 0 ? ' (free key, no payment).' : '.');
  }
  ['#cKind', '#cValue'].forEach(function (s) { $(s).addEventListener('input', couponPreview); });
  loaders.coupons = function () {
    api('GET', '/settings').then(function (s) { window.__price = Number(s.site.price); couponPreview(); });
    api('GET', '/coupons').then(function (rows) {
      $('#couponsTable').innerHTML = '<thead><tr><th>Code</th><th>Discount</th><th class="num">Used</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>' +
        (rows.length ? rows.map(function (c) {
          var st = !c.active ? '<span class="chip dim">Off</span>' : c.expired ? '<span class="chip warn">Expired</span>' : (c.max_uses && c.uses >= c.max_uses) ? '<span class="chip warn">Used up</span>' : '<span class="chip ok">Live</span>';
          return '<tr><td class="who"><b class="key" data-copy="' + esc(c.code) + '">' + esc(c.code) + '</b><span>' + esc(c.note || '') + '</span></td><td>' + esc(c.label) + '</td><td class="num">' + c.uses + (c.max_uses ? ' / ' + c.max_uses : '') + '</td><td class="nowrap">' + (c.expires_at ? esc(c.expires_at) : '—') + '</td><td>' + st + '</td><td><div class="row-actions">' +
            '<button class="btn ghost small" data-ctoggle="' + esc(c.code) + '" data-on="' + (c.active ? 0 : 1) + '">' + (c.active ? 'Turn off' : 'Turn on') + '</button>' +
            '<button class="btn ghost small danger" data-cdel="' + esc(c.code) + '">Delete</button></div></td></tr>';
        }).join('') : '<tr><td class="empty-row" colspan="6">No discount codes yet.</td></tr>') + '</tbody>';
    }).catch(function (e) { toast(e.message, true); });
  };
  $('#couponForm').addEventListener('submit', function (e) {
    e.preventDefault(); $('#couponErr').textContent = '';
    api('POST', '/coupons', { code: $('#cCode').value, kind: $('#cKind').value, value: $('#cValue').value, max_uses: $('#cMax').value, expires_at: $('#cExpires').value, note: $('#cNote').value })
      .then(function (c) { toast('Code ' + c.code + ' is live.'); $('#couponForm').reset(); $('#cMax').value = 0; couponPreview(); loaders.coupons(); })
      .catch(function (x) { $('#couponErr').textContent = x.message; });
  });
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-ctoggle]');
    if (t) api('PUT', '/coupons/' + encodeURIComponent(t.dataset.ctoggle), { active: t.dataset.on === '1' }).then(function () { toast(t.dataset.on === '1' ? 'Code turned on.' : 'Code turned off.'); loaders.coupons(); }).catch(function (x) { toast(x.message, true); });
    var d = e.target.closest('[data-cdel]');
    if (d && window.confirm('Delete code ' + d.dataset.cdel + '? Past orders keep their discount record.')) api('DELETE', '/coupons/' + encodeURIComponent(d.dataset.cdel)).then(function () { toast('Code deleted.'); loaders.coupons(); }).catch(function (x) { toast(x.message, true); });
  });

  // ---------- legal pages ----------
  loaders.legal = function () {
    api('GET', '/settings').then(function (s) {
      var l = s.legal;
      $('#lBusiness').value = l.businessName || ''; $('#lAddress').value = l.address || '';
      $('#lPrivacy').value = l.privacy || ''; $('#lTerms').value = l.terms || ''; $('#lRefund').value = l.refund || ''; $('#lDelivery').value = l.delivery || '';
    }).catch(function (e) { toast(e.message, true); });
  };
  $('#legalForm').addEventListener('submit', function (e) {
    e.preventDefault(); $('#legalErr').textContent = '';
    api('PUT', '/settings', { legal: { businessName: $('#lBusiness').value, address: $('#lAddress').value, privacy: $('#lPrivacy').value, terms: $('#lTerms').value, refund: $('#lRefund').value, delivery: $('#lDelivery').value } })
      .then(function () { toast('Legal pages saved and live.'); })
      .catch(function (x) { $('#legalErr').textContent = x.message; });
  });

  // ---------- boot ----------
  api('GET', '/me').then(function (me) {
    if (!me.configured) { showLogin('Admin isn’t set up yet. Add ADMIN_EMAIL and ADMIN_PASSWORD (10+ characters) to the .env file and restart the server.'); return; }
    me.authed ? showApp(me) : showLogin();
  }).catch(function () { showLogin('Can’t reach the server.'); });
})();
