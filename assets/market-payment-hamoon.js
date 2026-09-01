(() => {
  if (window.__vestalandHamoonMarketPayment) return;
  window.__vestalandHamoonMarketPayment = true;
  const $=(s,r=document)=>r.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const storeName=s=>s==='vesta'?'وستا':'کیوتلا';
  const PENDING_KEY='vestaland:pending-market-sync';

  function readCart(){
    try{return JSON.parse(localStorage.getItem('vestaland:market-cart')||'{"vesta":[],"cutella":[]}')}catch(_){return {vesta:[],cutella:[]}}
  }
  function writeCart(cart){localStorage.setItem('vestaland:market-cart',JSON.stringify(cart));}
  function savePending(value){
    if(!value){localStorage.removeItem(PENDING_KEY);return;}
    localStorage.setItem(PENDING_KEY,JSON.stringify(value));
  }
  function readPending(){
    try{return JSON.parse(localStorage.getItem(PENDING_KEY)||'null')}catch(_){return null}
  }
  function openModal(html){
    const m=$('#modal'),c=$('#modalContent');
    if(!m||!c) return false;
    c.innerHTML=html;m.classList.remove('hidden');document.body.style.overflow='hidden';return true;
  }
  function cleanPaymentQuery(){
    const u=new URL(location.href);
    ['market_payment','receipt','intent'].forEach(k=>u.searchParams.delete(k));
    history.replaceState({},'',u.pathname+(u.searchParams.toString()?'?'+u.searchParams.toString():'')+u.hash);
  }
  function clearStoreCart(store){
    const cart=readCart();
    if(store&&cart[store]) cart[store]=[];
    writeCart(cart);
  }
  function showForm(store){
    const cart=readCart(),rows=cart[store]||[];
    if(!rows.length){window.toast?.('سبد خرید خالیه.');return;}
    openModal(`<p class="kicker">پرداخت ${storeName(store)}</p><h2>آدرس تحویل</h2>
      <p class="muted">قیمت‌ها دوباره از خود ${storeName(store)} بررسی می‌شن. پرداخت با زیبال از دامنه امن هامون‌کلود انجام می‌شه و بعد سفارش مستقیم داخل ${storeName(store)} ثبت می‌شه.</p>
      <form id="mHamoonCheckout" class="market-checkout-form" data-store="${esc(store)}">
        <div class="market-form-grid"><label>نام<input name="first_name" required autocomplete="given-name"></label><label>نام خانوادگی<input name="last_name" required autocomplete="family-name"></label></div>
        <div class="market-form-grid"><label>موبایل<input name="phone" required inputmode="tel" autocomplete="tel"></label><label>ایمیل<input name="email" type="email" placeholder="اختیاری" autocomplete="email"></label></div>
        <div class="market-form-grid"><label>شهر<input name="city" required autocomplete="address-level2"></label><label>استان<input name="state" required autocomplete="address-level1"></label></div>
        <label>آدرس کامل<input name="address_1" required autocomplete="street-address"></label>
        <label>کد پستی<input name="postcode" required inputmode="numeric" autocomplete="postal-code"></label>
        <p class="market-cart-note">مبلغ کالاها قبل از ساخت لینک پرداخت روی سرور قفل می‌شه؛ اطلاعات مبلغ از مرورگر پذیرفته نمی‌شه.</p>
        <p id="mHamoonErr" class="form-error hidden"></p>
        <button class="primary-btn" type="submit">پرداخت امن با زیبال</button>
      </form>`);
  }
  async function startPayment(form){
    const store=form.dataset.store,cart=readCart(),rows=cart[store]||[];
    if(!rows.length) throw new Error('سبد خرید خالیه.');
    const button=form.querySelector('button[type=submit]'),err=$('#mHamoonErr');
    err?.classList.add('hidden');button.disabled=true;button.textContent='در حال اتصال به هامون‌کلود…';
    const fd=new FormData(form),address={country:'IR'};for(const[k,v]of fd.entries())address[k]=String(v).trim();
    try{
      const r=await fetch('/api/market-payment/start',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({store,items:rows.map(x=>({id:Number(x.id),parent_id:x.parent_id?Number(x.parent_id):null,quantity:Number(x.quantity||1)})),billing_address:address,shipping_address:address})});
      const d=await r.json().catch(()=>({}));if(!r.ok||!d.url)throw new Error(d.error||'شروع پرداخت انجام نشد.');
      sessionStorage.setItem('vestaland:market-payment-store',store);
      try{window.MarketBridge?.beginPayment?.()}catch(_){}
      location.href=d.url;
    }catch(e){
      button.disabled=false;button.textContent='پرداخت امن با زیبال';if(err){err.textContent=e.message;err.classList.remove('hidden')}else window.toast?.(e.message);
    }
  }
  async function confirmProof(receipt,intent,{silent=false}={}){
    const r=await fetch('/api/market-payment/confirm',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({receipt,intent})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.ok)throw new Error(d.error||'تأیید پرداخت انجام نشد.');
    if(d.payment_confirmed) clearStoreCart(d.store);
    if(d.sync_pending){
      savePending({receipt,intent,store:d.store,updated_at:Date.now()});
      if(!silent) window.toast?.('پرداخت تأیید شد؛ ثبت سفارش فروشگاه در حال تکمیل است.');
    }else{
      savePending(null);
      const order=d.woo_order_id?` #${d.woo_order_id}`:'';
      if(!silent) window.toast?.(`سفارش${order} در ${storeName(d.store)} ثبت شد ✓`);
    }
    return d;
  }
  async function confirmReturn(){
    const p=new URLSearchParams(location.search),status=p.get('market_payment');if(!status)return;
    const receipt=p.get('receipt')||'',intent=p.get('intent')||'';
    if(status!=='success'){
      cleanPaymentQuery();setTimeout(()=>window.toast?.('پرداخت انجام نشد؛ سبد خریدت دست‌نخورده موند.'),300);return;
    }
    if(!receipt||!intent){cleanPaymentQuery();return;}
    // Save proof before any network request so a reload cannot lose a paid order.
    savePending({receipt,intent,store:sessionStorage.getItem('vestaland:market-payment-store')||'',updated_at:Date.now()});
    cleanPaymentQuery();
    try{
      const d=await confirmProof(receipt,intent);
      sessionStorage.removeItem('vestaland:market-payment-store');
      if(!d.sync_pending) setTimeout(()=>location.reload(),650);
    }catch(e){
      setTimeout(()=>window.toast?.('پرداخت ثبت شده؛ تکمیل سفارش خودکار دوباره امتحان می‌شه.'),350);
    }
  }
  async function retryPendingSync(){
    const pending=readPending();
    if(!pending?.receipt||!pending?.intent)return;
    // Avoid hammering on repeated DOM/load events.
    if(pending.updated_at&&Date.now()-Number(pending.updated_at)<5000)return;
    pending.updated_at=Date.now();savePending(pending);
    try{
      const d=await confirmProof(pending.receipt,pending.intent,{silent:true});
      if(!d.sync_pending){
        window.toast?.(`سفارش #${d.woo_order_id} در ${storeName(d.store)} ثبت شد ✓`);
        setTimeout(()=>location.reload(),650);
      }
    }catch(_){/* receipt is preserved for the next retry */}
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest?.('[data-mcheckout]');if(!b)return;
    e.preventDefault();e.stopImmediatePropagation();showForm(b.dataset.mcheckout);
  },true);
  document.addEventListener('submit',e=>{
    const f=e.target.closest?.('#mHamoonCheckout');if(!f)return;
    e.preventDefault();e.stopImmediatePropagation();startPayment(f);
  },true);
  async function boot(){await confirmReturn();setTimeout(retryPendingSync,1300);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
