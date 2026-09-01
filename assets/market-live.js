(() => {
  const market = {
    products: [],
    categories: [],
    loading: false,
    cart: JSON.parse(localStorage.getItem('vestaland:market-cart') || '{"vesta":[],"cutella":[]}')
  };

  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => new Intl.NumberFormat('fa-IR').format(Number(n || 0));
  const storeName = s => s === 'vesta' ? 'وستا' : 'کیوتلا';
  let booted = false;

  function saveCart(){ localStorage.setItem('vestaland:market-cart', JSON.stringify(market.cart)); updateCartBar(); }
  function currentStore(){ return window.state?.marketStore || 'all'; }
  function currentSearch(){ return ($('#marketSearch')?.value || '').trim(); }

  async function api(path, options={}){
    const res = await fetch(path, {cache:'no-store', ...options, headers:{'Content-Type':'application/json', ...(options.headers||{})}});
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || 'ارتباط با فروشگاه انجام نشد.');
    return data;
  }

  function productCard(p){
    const sold = !p.is_in_stock || !p.is_purchasable;
    const hasSale = p.on_sale && p.regular_price && p.regular_price > p.price;
    const action = p.has_options
      ? `<button class="market-product-action secondary" data-market-open="${esc(p.permalink)}">انتخاب مدل</button>`
      : `<button class="market-product-action" data-market-add="${esc(p.store)}|${p.id}" ${sold?'disabled':''}>${sold?'ناموجود':'افزودن به سبد'}</button>`;
    return `<article class="product-card live-product-card" data-live-store="${esc(p.store)}">
      <button class="market-product-photo" data-market-open="${esc(p.permalink)}" aria-label="${esc(p.name)}">
        ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer">` : '<span class="market-no-image">بدون عکس</span>'}
        <span class="market-store-badge ${esc(p.store)}">${storeName(p.store)}</span>
        ${p.on_sale ? '<span class="market-sale-badge">تخفیف</span>' : ''}
      </button>
      <div class="product-info">
        <small>${esc((p.categories||[])[0]?.name || storeName(p.store))}</small>
        <button class="market-product-title" data-market-open="${esc(p.permalink)}">${esc(p.name)}</button>
        <div class="market-price-row">
          <strong>${p.price != null ? money(p.price)+' تومان' : 'برای قیمت وارد محصول شو'}</strong>
          ${hasSale ? `<del>${money(p.regular_price)} تومان</del>` : ''}
        </div>
        ${p.is_in_stock ? '' : '<span class="market-stock out">ناموجود</span>'}
        ${action}
      </div>
    </article>`;
  }

  function renderProducts(){
    const grid = $('#productGrid');
    if(!grid) return;
    if(market.loading){ grid.innerHTML = '<div class="market-loading"><span></span><span></span><span></span><span></span></div>'; return; }
    if(!market.products.length){ grid.innerHTML = '<div class="market-empty">محصولی پیدا نشد.</div>'; return; }
    grid.innerHTML = market.products.map(productCard).join('');
  }

  async function loadProducts(){
    const grid = $('#productGrid'); if(!grid) return;
    market.loading = true; renderProducts();
    const store = currentStore();
    const q = new URLSearchParams({store, per_page:'30'});
    const search = currentSearch(); if(search) q.set('search', search);
    const activeCat = $('#marketCategories [data-live-category].active');
    if(activeCat?.dataset.liveCategory) q.set('category', activeCat.dataset.liveCategory);
    try{
      const data = await api('/api/market/products?'+q.toString());
      market.products = data.items || data.products || [];
      if(data.errors && Object.keys(data.errors).length){
        const names = Object.keys(data.errors).map(storeName).join(' و ');
        window.toast?.(`اتصال ${names} موقتاً مشکل دارد؛ بقیه محصولات نمایش داده شدند.`);
      }
    }catch(err){ market.products=[]; window.toast?.(err.message); }
    market.loading=false; renderProducts();
  }

  async function loadCategories(){
    const wrap = $('#marketCategories'); if(!wrap) return;
    const store = currentStore();
    if(store === 'all'){
      wrap.innerHTML = '<button class="category active" data-live-category="">همه محصولات</button>';
      return;
    }
    try{
      const data = await api(`/api/market/categories?store=${encodeURIComponent(store)}`);
      market.categories = (data.categories || []).filter(x=>x.count>0).sort((a,b)=>b.count-a.count).slice(0,18);
      wrap.innerHTML = `<button class="category active" data-live-category="">همه</button>` + market.categories.map(c=>`<button class="category" data-live-category="${c.id}">${esc(c.name)}</button>`).join('');
    }catch(err){
      wrap.innerHTML = '<button class="category active" data-live-category="">همه</button>';
    }
  }

  function addToCart(store, id){
    const p = market.products.find(x=>x.store===store && Number(x.id)===Number(id));
    if(!p) return;
    if(p.has_options){ openInside(p.permalink); return; }
    const list = market.cart[store] || (market.cart[store]=[]);
    const row = list.find(x=>Number(x.id)===Number(id));
    if(row) row.quantity = Math.min(20, row.quantity+1);
    else list.push({id:p.id, name:p.name, price:p.price, image:p.image, quantity:1, permalink:p.permalink});
    saveCart(); window.toast?.('به سبد خرید اضافه شد ✓');
  }

  function updateQty(store,id,delta){
    const list=market.cart[store]||[]; const row=list.find(x=>Number(x.id)===Number(id)); if(!row)return;
    row.quantity += delta; if(row.quantity<=0) market.cart[store]=list.filter(x=>Number(x.id)!==Number(id));
    saveCart(); openCart(store);
  }

  function cartCount(store){ return (market.cart[store]||[]).reduce((n,x)=>n+x.quantity,0); }
  function cartTotal(store){ return (market.cart[store]||[]).reduce((n,x)=>n+(Number(x.price||0)*x.quantity),0); }

  function ensureCartBar(){
    if($('#marketCartBar')) return;
    const view=$('#marketView'); if(!view)return;
    view.insertAdjacentHTML('beforeend', `<div id="marketCartBar" class="market-cart-bar hidden"><button data-market-cart="vesta"><span><b>سبد وستا</b><small data-cart-count="vesta">۰ کالا</small></span><strong data-cart-total="vesta">۰ تومان</strong></button><button data-market-cart="cutella"><span><b>سبد کیوتلا</b><small data-cart-count="cutella">۰ کالا</small></span><strong data-cart-total="cutella">۰ تومان</strong></button></div>`);
  }

  function updateCartBar(){
    ensureCartBar(); const bar=$('#marketCartBar'); if(!bar)return;
    let any=false;
    ['vesta','cutella'].forEach(s=>{
      const count=cartCount(s); any ||= count>0;
      const btn=bar.querySelector(`[data-market-cart="${s}"]`); if(btn) btn.classList.toggle('hidden',!count);
      const c=bar.querySelector(`[data-cart-count="${s}"]`); if(c)c.textContent=`${money(count)} کالا`;
      const t=bar.querySelector(`[data-cart-total="${s}"]`); if(t)t.textContent=`${money(cartTotal(s))} تومان`;
    });
    bar.classList.toggle('hidden',!any);
  }

  function openModal(html){
    const modal=$('#modal'), content=$('#modalContent'); if(!modal||!content)return;
    content.innerHTML=html; modal.classList.remove('hidden'); document.body.style.overflow='hidden';
  }

  function openCart(store){
    const rows=market.cart[store]||[];
    if(!rows.length){ window.toast?.('سبد خرید خالیه.'); return; }
    const items=rows.map(x=>`<div class="market-cart-item">
      ${x.image?`<img src="${esc(x.image)}" alt="">`:''}
      <div><b>${esc(x.name)}</b><small>${money(x.price)} تومان</small></div>
      <div class="market-qty"><button data-market-qty="${store}|${x.id}|-1">−</button><span>${money(x.quantity)}</span><button data-market-qty="${store}|${x.id}|1">+</button></div>
    </div>`).join('');
    openModal(`<p class="kicker">${storeName(store)}</p><h2>سبد خرید</h2><div class="market-cart-list">${items}</div><div class="market-cart-total"><span>جمع کالاها</span><b>${money(cartTotal(store))} تومان</b></div><p class="market-cart-note">هزینه ارسال و مبلغ نهایی از خود ${storeName(store)} موقع ثبت سفارش محاسبه می‌شه.</p><button class="primary-btn" data-market-checkout="${store}">ادامه و پرداخت</button>`);
  }

  function checkoutForm(store){
    const rows=market.cart[store]||[]; if(!rows.length)return;
    openModal(`<p class="kicker">پرداخت ${storeName(store)}</p><h2>آدرس تحویل</h2><p class="muted">سفارش مستقیماً داخل ${storeName(store)} ثبت می‌شه و پرداخت با همون درگاه فروشگاه انجام می‌شه.</p>
      <form id="marketCheckoutForm" class="market-checkout-form">
        <div class="market-form-grid"><label>نام<input name="first_name" required></label><label>نام خانوادگی<input name="last_name" required></label></div>
        <div class="market-form-grid"><label>موبایل<input name="phone" inputmode="tel" required></label><label>ایمیل<input name="email" type="email" placeholder="اختیاری"></label></div>
        <div class="market-form-grid"><label>شهر<input name="city" required></label><label>استان<input name="state" placeholder="مثلاً تهران" required></label></div>
        <label>آدرس کامل<input name="address_1" required></label>
        <label>کد پستی<input name="postcode" inputmode="numeric" required></label>
        <p id="marketCheckoutError" class="form-error hidden"></p>
        <button class="primary-btn" type="submit">ثبت سفارش و رفتن به درگاه</button>
      </form>`);
    $('#marketCheckoutForm')?.addEventListener('submit', e=>submitCheckout(e,store));
  }

  async function submitCheckout(e,store){
    e.preventDefault(); const form=e.currentTarget; const btn=form.querySelector('button[type=submit]'); const err=$('#marketCheckoutError');
    err.classList.add('hidden'); btn.disabled=true; btn.textContent='در حال اتصال به فروشگاه…';
    const fd=new FormData(form); const address={country:'IR'}; for(const [k,v] of fd.entries()) address[k]=String(v).trim();
    const payload={store, items:(market.cart[store]||[]).map(x=>({id:x.id,quantity:x.quantity})), billing_address:address, shipping_address:address};
    try{
      const data=await api('/api/market/checkout',{method:'POST',body:JSON.stringify(payload)});
      if(!data.redirect_url) throw new Error('فروشگاه لینک درگاه برنگردوند.');
      try{ window.MarketBridge?.beginPayment(); }catch(_){ }
      location.href=data.redirect_url;
    }catch(ex){
      err.textContent=ex.message + ' اگر محصول انتخاب رنگ/مدل دارد، از صفحه خود محصول ادامه بده.'; err.classList.remove('hidden'); btn.disabled=false; btn.textContent='دوباره تلاش کن';
    }
  }

  function openInside(url){
    if(!url)return;
    try{ window.MarketBridge?.openStore(); }catch(_){ }
    location.href=url;
  }

  async function onStoreChanged(){ await loadCategories(); await loadProducts(); }

  function bind(){
    document.addEventListener('click', e=>{
      const storeBtn=e.target.closest('.store-switch [data-store]');
      if(storeBtn) setTimeout(onStoreChanged,0);
      const cat=e.target.closest('[data-live-category]');
      if(cat){ $$('#marketCategories [data-live-category]').forEach(x=>x.classList.toggle('active',x===cat)); loadProducts(); }
      const add=e.target.closest('[data-market-add]');
      if(add){ e.preventDefault(); const [s,id]=add.dataset.marketAdd.split('|'); addToCart(s,Number(id)); }
      const open=e.target.closest('[data-market-open]'); if(open){ e.preventDefault(); openInside(open.dataset.marketOpen); }
      const cart=e.target.closest('[data-market-cart]'); if(cart){e.preventDefault();openCart(cart.dataset.marketCart);}
      const qty=e.target.closest('[data-market-qty]'); if(qty){e.preventDefault();const [s,id,d]=qty.dataset.marketQty.split('|');updateQty(s,Number(id),Number(d));}
      const co=e.target.closest('[data-market-checkout]'); if(co){e.preventDefault();checkoutForm(co.dataset.marketCheckout);}
      const marketNav=e.target.closest('[data-view="market"]'); if(marketNav) setTimeout(()=>{if(!market.products.length)onStoreChanged();},60);
    });
    let timer; $('#marketSearch')?.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(loadProducts,350);});
  }

  function boot(){
    if(booted){
      const marketView=$('#marketView');
      if(marketView?.classList.contains('active-view') && !market.products.length && !market.loading) onStoreChanged();
      return;
    }
    booted = true;
    market.products=[];
    renderProducts();
    ensureCartBar();
    updateCartBar();
    bind();
    const marketView=$('#marketView');
    if(marketView?.classList.contains('active-view')) onStoreChanged();
    const done=new URLSearchParams(location.search).get('market_paid');
    if(done==='1'){
      localStorage.removeItem('vestaland:market-cart');
      market.cart={vesta:[],cutella:[]};
      history.replaceState({},'',location.pathname);
      setTimeout(()=>window.toast?.('پرداخت انجام شد؛ وضعیت نهایی سفارش رو فروشگاه ثبت می‌کنه ✓'),400);
    }
  }

  window.__vestalandMarketBoot = boot;
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();
})();
