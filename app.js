(function () {
  'use strict';

  var API = 'https://www.pepshop.co.za';
  var state = {
    products: [],
    filtered: [],
    cart: loadJson('xlabs_cart_v1', []),
    token: localStorage.getItem('xlabs_member_token_v1') || '',
    member: loadJson('xlabs_member_v1', null),
    loginChallenge: '',
    registerChallenge: '',
    activeProduct: null
  };

  function $(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function loadJson(key, fallback) {
    try { var value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; }
    catch (e) { return fallback; }
  }
  function saveCart() {
    localStorage.setItem('xlabs_cart_v1', JSON.stringify(state.cart));
    renderCart();
  }
  function money(value) {
    var n = Number(value || 0);
    return 'R' + n.toLocaleString('en-ZA', { maximumFractionDigits: 2 });
  }
  function imgUrl(image) {
    var value = String(image || '').trim();
    if (!value) return './xlabs-logo-v2.jpg';
    if (/^https?:\/\//i.test(value) || /^data:/i.test(value)) return value;
    return API + (value.charAt(0) === '/' ? value : '/' + value);
  }
  function isXlabs(product) {
    return String(product.supplier || '').trim().toLowerCase() === 'xlabs';
  }
  function codeFor(product) {
    var text = String(product.id || '') + ' ' + String(product.name || '');
    var match = text.match(/\bXL\s*-?\s*(\d{1,2}[A-C]?)\b/i) || text.match(/xlabs-xl(\d{1,2}[a-c]?)/i);
    if (!match) return 'X-LABS';
    var code = String(match[1]).toUpperCase();
    var number = code.match(/^\d+/);
    var suffix = code.replace(/^\d+/, '');
    return 'XL' + String(number ? number[0] : code).padStart(2, '0') + suffix;
  }
  function productPrice(product, optionId) {
    if (optionId && Array.isArray(product.specialOptions)) {
      var option = product.specialOptions.find(function (x) { return String(x.id) === String(optionId); });
      if (option) return Number(option.price || 0);
    }
    return Number(product.price || 0);
  }
  function productOptionName(product, optionId) {
    if (!optionId || !Array.isArray(product.specialOptions)) return '';
    var option = product.specialOptions.find(function (x) { return String(x.id) === String(optionId); });
    return option ? option.name : '';
  }

  function guideFor(product) {
    var guides = {
      XL01: 'https://www.xlabs.ltd/g/reta20/'
    };
    return guides[codeFor(product)] || '';
  }
  function showMessage(target, message, type) {
    if (!target) return;
    if (!message) { target.className = 'notice hidden'; target.textContent = ''; return; }
    target.className = 'notice ' + (type || '');
    target.textContent = message;
  }
  function showOverlay() { $('overlay').classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
  function hideOverlayIfClear() {
    var modalOpen = Array.from(document.querySelectorAll('.modal')).some(function (m) { return !m.classList.contains('hidden'); });
    var drawerOpen = $('cartDrawer').classList.contains('open');
    if (!modalOpen && !drawerOpen) { $('overlay').classList.add('hidden'); document.body.style.overflow = ''; }
  }
  function closeModals() {
    document.querySelectorAll('.modal').forEach(function (m) { m.classList.add('hidden'); });
    hideOverlayIfClear();
  }
  function openModal(id) { closeModals(); $(id).classList.remove('hidden'); showOverlay(); }

  async function api(path, options) {
    var opts = Object.assign({}, options || {});
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (state.token) opts.headers.Authorization = 'Bearer ' + state.token;
    var response = await fetch(API + path, opts);
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error || 'The secure X-Labs service could not complete this request.');
    return data;
  }

  async function loadCatalogue() {
    $('productGrid').innerHTML = new Array(8).fill('<div class="loading-card"></div>').join('');
    try {
      var response = await fetch(API + '/api/products?xlabs_store=' + Date.now(), { cache: 'no-store' });
      if (!response.ok) throw new Error('Live catalogue unavailable.');
      var payload = await response.json();
      state.products = (payload.products || []).filter(isXlabs).filter(function (p) { return p.active !== false; });
      if (!state.products.length) throw new Error('No active X-Labs listings are available right now.');
      $('catalogueStatus').textContent = state.products.length + ' live X-Labs listings · current retail pricing';
      showMessage($('catalogueError'), '');
      buildCategories();
      refreshCartPricing();
      filterProducts();
      return true;
    } catch (error) {
      $('productGrid').innerHTML = '';
      $('catalogueStatus').textContent = 'Catalogue temporarily unavailable';
      showMessage($('catalogueError'), error.message + ' Please try again shortly.', 'error');
      return false;
    }
  }

  function buildCategories() {
    var select = $('categoryFilter');
    var current = select.value;
    var categories = Array.from(new Set(state.products.map(function (p) { return p.category || 'Other'; }))).sort();
    select.innerHTML = '<option value="">All categories</option>' + categories.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
    }).join('');
    select.value = categories.indexOf(current) >= 0 ? current : '';
  }

  function filterProducts() {
    var q = $('searchInput').value.trim().toLowerCase();
    var category = $('categoryFilter').value;
    state.filtered = state.products.filter(function (p) {
      var hay = [p.name, p.category, p.brand, p.description, p.therapy, codeFor(p)].join(' ').toLowerCase();
      return (!q || hay.indexOf(q) >= 0) && (!category || String(p.category || '') === category);
    });
    renderProducts();
  }

  function renderProducts() {
    var grid = $('productGrid');
    if (!state.filtered.length) {
      grid.innerHTML = '<div class="empty">No X-Labs products match this search.</div>';
      return;
    }
    grid.innerHTML = state.filtered.map(function (p) {
      var price = productPrice(p);
      var canBuy = price > 0 && !p.priceLocked;
      var summary = String(p.description || '').replace(/\s+/g, ' ').trim();
      if (summary.length > 110) summary = summary.slice(0, 107) + '…';
      return '<article class="product-card">' +
        '<div class="product-image ' + (p.imageFit === 'cover' ? 'cover' : '') + '">' +
          '<img src="' + esc(imgUrl(p.image)) + '" alt="' + esc(p.name) + '" loading="lazy" onerror="this.src=\'./xlabs-logo-v2.jpg\'">' +
          '<div class="badges">' + (p.isNewProduct || p.newListing ? '<span class="badge cyan">NEW</span>' : '') + (p.researchOnly ? '<span class="badge">RESEARCH</span>' : '') + '</div>' +
        '</div>' +
        '<div class="product-body">' +
          '<div class="product-meta"><span>' + esc(codeFor(p)) + '</span><span>' + esc(p.category || 'X-Labs') + '</span></div>' +
          '<h3>' + esc(p.name) + '</h3>' +
          '<p>' + esc(summary || 'View the current X-Labs product information.') + '</p>' +
          '<div class="product-bottom">' +
            '<div class="price">' + (canBuy ? money(price) : 'Price pending') + '<small>LIVE RETAIL PRICE</small></div>' +
            '<div class="card-actions"><button type="button" data-info="' + esc(p.id) + '">More info</button>' +
            '<button class="add" type="button" data-add="' + esc(p.id) + '"' + (canBuy ? '' : ' disabled') + '>Add</button></div>' +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  function openProduct(id) {
    var p = state.products.find(function (x) { return String(x.id) === String(id); });
    if (!p) return;
    state.activeProduct = p;
    var options = Array.isArray(p.specialOptions) ? p.specialOptions.filter(function (o) { return Number(o.price || 0) > 0; }) : [];
    var optionHtml = options.length ? '<label class="stack-form">Option<select id="modalOption">' +
      options.map(function (o) { return '<option value="' + esc(o.id) + '">' + esc(o.name) + ' — ' + money(o.price) + '</option>'; }).join('') +
      '</select></label>' : '';
    var guideUrl = guideFor(p);
    var guideHtml = guideUrl ? '<a class="secondary-button full" href="' + esc(guideUrl) + '" target="_blank" rel="noopener">Reconstitution &amp; User Guide</a>' : '';
    $('productModalContent').innerHTML =
      '<div class="product-modal-grid">' +
        '<div class="modal-image"><img src="' + esc(imgUrl(p.image)) + '" alt="' + esc(p.name) + '" onerror="this.src=\'./xlabs-logo-v2.jpg\'"></div>' +
        '<div class="product-modal-copy">' +
          '<p class="eyebrow">' + esc(codeFor(p)) + ' · ' + esc(p.category || 'X-LABS') + '</p>' +
          '<h2 id="productModalTitle">' + esc(p.name) + '</h2>' +
          '<p>' + esc(p.description || 'Current X-Labs catalogue listing.') + '</p>' +
          '<div class="price">' + money(productPrice(p)) + '<small>LIVE RETAIL PRICE</small></div>' +
          optionHtml +
          '<div class="detail-list">' +
            (p.dosage ? '<div><span>Presentation</span><strong>' + esc(p.dosage) + '</strong></div>' : '') +
            (p.duration ? '<div><span>Catalogue note</span><strong>' + esc(p.duration) + '</strong></div>' : '') +
            '<div><span>Brand</span><strong>' + esc(p.brand || 'X-Labs') + '</strong></div>' +
            '<div><span>Supplier</span><strong>X-Labs</strong></div>' +
          '</div>' +
          (p.researchOnly ? '<p class="muted">For research use only. Refer to the live catalogue notice for this listing.</p>' : '') +
          guideHtml +
          (guideHtml ? '<div style="height:10px"></div>' : '') +
          '<button id="modalAddButton" class="primary-button full" type="button"' + (p.priceLocked || productPrice(p) <= 0 ? ' disabled' : '') + '>Add to Cart</button>' +
        '</div>' +
      '</div>';
    openModal('productModal');
  }

  function addProduct(id, optionId) {
    var p = state.products.find(function (x) { return String(x.id) === String(id); });
    if (!p) return;
    if (!optionId && Array.isArray(p.specialOptions) && p.specialOptions.length) optionId = p.specialOptions[0].id;
    var price = productPrice(p, optionId);
    if (price <= 0 || p.priceLocked) return;
    var key = p.id + '::' + (optionId || '');
    var existing = state.cart.find(function (x) { return x.key === key; });
    if (existing) existing.qty += 1;
    else state.cart.push({
      key: key, productId: p.id, optionId: optionId || '', qty: 1,
      name: p.name, optionName: productOptionName(p, optionId), unitPrice: price, image: p.image || ''
    });
    saveCart();
    closeModals();
    openCart();
  }

  function refreshCartPricing() {
    state.cart = state.cart.filter(function (item) {
      var p = state.products.find(function (x) { return String(x.id) === String(item.productId); });
      if (!p || p.priceLocked) return false;
      var price = productPrice(p, item.optionId);
      if (price <= 0) return false;
      item.name = p.name;
      item.unitPrice = price;
      item.image = p.image || item.image;
      item.optionName = productOptionName(p, item.optionId);
      return true;
    });
    saveCart();
  }

  function renderCart() {
    var count = state.cart.reduce(function (sum, x) { return sum + Number(x.qty || 0); }, 0);
    $('cartCount').textContent = String(count);
    var total = state.cart.reduce(function (sum, x) { return sum + x.unitPrice * x.qty; }, 0);
    $('cartSubtotal').textContent = money(total);
    $('checkoutButton').disabled = !state.cart.length;
    $('cartItems').innerHTML = state.cart.length ? state.cart.map(function (item) {
      return '<div class="cart-row">' +
        '<img src="' + esc(imgUrl(item.image)) + '" alt="" onerror="this.src=\'./xlabs-logo-v2.jpg\'">' +
        '<div><strong>' + esc(item.name) + '</strong>' +
          (item.optionName ? '<small>' + esc(item.optionName) + '</small>' : '') +
          '<div class="qty"><button data-qty="' + esc(item.key) + '" data-dir="-1">−</button><span>' + item.qty + '</span><button data-qty="' + esc(item.key) + '" data-dir="1">+</button><span>' + money(item.unitPrice * item.qty) + '</span></div>' +
        '</div>' +
        '<button class="remove" data-remove="' + esc(item.key) + '" type="button">Remove</button>' +
      '</div>';
    }).join('') : '<div class="empty">Your X-Labs cart is empty.</div>';
  }

  function openCart() {
    $('cartDrawer').classList.add('open');
    $('cartDrawer').setAttribute('aria-hidden', 'false');
    showOverlay();
  }
  function closeCart() {
    $('cartDrawer').classList.remove('open');
    $('cartDrawer').setAttribute('aria-hidden', 'true');
    hideOverlayIfClear();
  }

  function setAuthMode(mode) {
    var login = mode !== 'register';
    $('loginTab').classList.toggle('active', login);
    $('registerTab').classList.toggle('active', !login);
    $('loginPanel').classList.toggle('hidden', !login);
    $('registerPanel').classList.toggle('hidden', login);
    showMessage($('memberMessage'), '');
  }
  function resetAuthForms() {
    state.loginChallenge = ''; state.registerChallenge = '';
    $('loginRequestForm').classList.remove('hidden'); $('loginVerifyForm').classList.add('hidden');
    $('registerRequestForm').classList.remove('hidden'); $('registerVerifyForm').classList.add('hidden');
    showMessage($('memberMessage'), '');
  }
  function openMember(mode) { resetAuthForms(); setAuthMode(mode || 'login'); openModal('memberModal'); }

  function persistMember(member, token) {
    if (token) { state.token = token; localStorage.setItem('xlabs_member_token_v1', token); }
    state.member = member || null;
    if (state.member) localStorage.setItem('xlabs_member_v1', JSON.stringify(state.member));
    else localStorage.removeItem('xlabs_member_v1');
    syncMemberButton();
  }
  function syncMemberButton() {
    var label = state.member ? ((state.member.firstName || 'Member') + ' ✓') : 'Member';
    $('accountButton').textContent = label;
    $('heroAccountButton').textContent = state.member ? 'Verified member ✓' : 'Sign in / Register';
  }
  async function validateMember() {
    if (!state.token) { syncMemberButton(); return; }
    try {
      var data = await api('/api/member/session', { method: 'GET', headers: {} });
      persistMember(data.member, state.token);
    } catch (e) {
      state.token = ''; state.member = null;
      localStorage.removeItem('xlabs_member_token_v1'); localStorage.removeItem('xlabs_member_v1');
      syncMemberButton();
    }
  }

  async function requestAuth(kind, form) {
    var data = Object.fromEntries(new FormData(form).entries());
    var path = kind === 'login' ? '/api/member/login/request' : '/api/member/register/request';
    var result = await api(path, { method: 'POST', body: JSON.stringify(data) });
    if (kind === 'login') {
      state.loginChallenge = result.challengeId;
      $('loginRequestForm').classList.add('hidden'); $('loginVerifyForm').classList.remove('hidden');
    } else {
      state.registerChallenge = result.challengeId;
      $('registerRequestForm').classList.add('hidden'); $('registerVerifyForm').classList.remove('hidden');
    }
    showMessage($('memberMessage'), 'A 6-digit code was sent to ' + (result.maskedEmail || 'your email') + '.', 'success');
  }

  async function verifyAuth(kind, form) {
    var challenge = kind === 'login' ? state.loginChallenge : state.registerChallenge;
    var code = new FormData(form).get('code');
    var path = kind === 'login' ? '/api/member/login/verify' : '/api/member/register/verify';
    var result = await api(path, { method: 'POST', body: JSON.stringify({ challengeId: challenge, code: code }) });
    if (!result.accessToken) throw new Error('X-Labs secure checkout is temporarily unavailable. Please try again shortly.');
    persistMember(result.member, result.accessToken);
    closeModals();
    if (state.cart.length) openCheckout();
  }

  function fillCheckout() {
    var m = state.member || {};
    var f = $('checkoutForm').elements;
    f.firstName.value = m.firstName || '';
    f.surname.value = m.surname || '';
    f.phone.value = m.phone || '';
    f.email.value = m.email || '';
    f.gender.value = m.gender || '';
    f.streetAddress.value = m.streetAddress || '';
    f.city.value = m.city || '';
    f.postalCode.value = m.postalCode || '';
    f.province.value = m.province || '';
    f.country.value = m.country || 'South Africa';
    $('checkoutMember').textContent = 'Verified member: ' + ([m.firstName, m.surname].filter(Boolean).join(' ') || m.email || 'X-Labs member');
  }
  function openCheckout() {
    closeCart();
    if (!state.cart.length) return;
    if (!state.token || !state.member) { openMember('login'); return; }
    fillCheckout();
    showMessage($('checkoutMessage'), '');
    openModal('checkoutModal');
  }

  async function placeOrder(event) {
    event.preventDefault();
    if (!state.cart.length) return;
    var button = $('placeOrderButton');
    button.disabled = true; button.textContent = 'Preparing secure checkout…';
    try {
      var catalogueReady = await loadCatalogue();
      if (!catalogueReady) throw new Error('Could not refresh the live X-Labs catalogue. Your order has not been placed.');
      if (!state.cart.length) throw new Error('The items in your cart are no longer available at an active retail price.');
      var form = Object.fromEntries(new FormData(event.currentTarget).entries());
      var customer = {
        name: (String(form.firstName || '').trim() + ' ' + String(form.surname || '').trim()).trim(),
        phone: form.phone, email: form.email, gender: form.gender,
        streetAddress: form.streetAddress, city: form.city, postalCode: form.postalCode,
        province: form.province, country: form.country || 'South Africa'
      };
      var items = state.cart.map(function (item) {
        return { productId: item.productId, qty: item.qty, option: item.optionId || '' };
      });
      var result = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ customer: customer, items: items, notes: form.notes || '' })
      });
      if (!result.payfastReady || !result.paymentUrl) throw new Error('The order was received but secure PayFast checkout was not returned. Please contact X-Labs support before paying.');
      state.cart = []; saveCart();
      window.location.assign(/^https?:\/\//i.test(result.paymentUrl) ? result.paymentUrl : API + result.paymentUrl);
    } catch (error) {
      showMessage($('checkoutMessage'), error.message, 'error');
    } finally {
      button.disabled = false; button.textContent = 'Place Order & Open PayFast';
    }
  }

  document.addEventListener('click', function (event) {
    var info = event.target.closest('[data-info]');
    if (info) return openProduct(info.getAttribute('data-info'));
    var add = event.target.closest('[data-add]');
    if (add) return addProduct(add.getAttribute('data-add'), '');
    var qty = event.target.closest('[data-qty]');
    if (qty) {
      var key = qty.getAttribute('data-qty'), dir = Number(qty.getAttribute('data-dir'));
      var item = state.cart.find(function (x) { return x.key === key; });
      if (item) {
        item.qty = Math.max(0, item.qty + dir);
        if (!item.qty) state.cart = state.cart.filter(function (x) { return x.key !== key; });
        saveCart();
      }
      return;
    }
    var remove = event.target.closest('[data-remove]');
    if (remove) {
      var k = remove.getAttribute('data-remove');
      state.cart = state.cart.filter(function (x) { return x.key !== k; });
      saveCart(); return;
    }
    if (event.target.closest('[data-close-cart]')) return closeCart();
    if (event.target.closest('[data-close-modal]')) return closeModals();
    if (event.target.closest('[data-reset-auth]')) return resetAuthForms();
  });

  $('productModal').addEventListener('click', function (event) {
    if (event.target.id === 'modalAddButton' && state.activeProduct) {
      var option = $('modalOption');
      addProduct(state.activeProduct.id, option ? option.value : '');
    }
  });
  $('overlay').addEventListener('click', function () { closeCart(); closeModals(); });
  $('cartButton').addEventListener('click', openCart);
  $('checkoutButton').addEventListener('click', openCheckout);
  $('accountButton').addEventListener('click', function () { openMember('login'); });
  $('heroAccountButton').addEventListener('click', function () { openMember('login'); });
  $('loginTab').addEventListener('click', function () { setAuthMode('login'); });
  $('registerTab').addEventListener('click', function () { setAuthMode('register'); });
  $('searchInput').addEventListener('input', filterProducts);
  $('categoryFilter').addEventListener('change', filterProducts);
  $('checkoutForm').addEventListener('submit', placeOrder);

  $('loginRequestForm').addEventListener('submit', async function (event) {
    event.preventDefault(); showMessage($('memberMessage'), 'Sending your secure login code…');
    try { await requestAuth('login', event.currentTarget); } catch (e) { showMessage($('memberMessage'), e.message, 'error'); }
  });
  $('registerRequestForm').addEventListener('submit', async function (event) {
    event.preventDefault(); showMessage($('memberMessage'), 'Creating your verified membership…');
    try { await requestAuth('register', event.currentTarget); } catch (e) { showMessage($('memberMessage'), e.message, 'error'); }
  });
  $('loginVerifyForm').addEventListener('submit', async function (event) {
    event.preventDefault();
    try { await verifyAuth('login', event.currentTarget); } catch (e) { showMessage($('memberMessage'), e.message, 'error'); }
  });
  $('registerVerifyForm').addEventListener('submit', async function (event) {
    event.preventDefault();
    try { await verifyAuth('register', event.currentTarget); } catch (e) { showMessage($('memberMessage'), e.message, 'error'); }
  });

  renderCart();
  syncMemberButton();
  validateMember();
  loadCatalogue();
}());
