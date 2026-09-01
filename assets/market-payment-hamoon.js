(() => {
  if (window.__vestalandHamoonMarketPayment) return;
  window.__vestalandHamoonMarketPayment = true;
  const $=(s,r=document)=>r.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const storeName=s=>s==='vesta'?'وستا':'کیوتلا';

  function readCart(){
    try{return JSON.parse(localStorage.getItem('vestaland:market-cart')||'{"vesta":[],"cutella":[]}')}catch(_){return {vesta:[],cutella:[]}}
  }
  function writeCart(cart){localStorage.setItem('vestaland:market-cart',JSON.stringify(cart));}
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
  function showForm(store){
    const cart=readCart(),rows=cart[store]||[];
    if(!rows.length){window.toast?.('سبد خرید خالیه.');return;}
    openModal(`<p class="kicker">پرداخت ${storeName(store)}</p><h2>آدرس تحویل</h2>
      <p class="muted">مبلغ کالاها دوباره از خود ${storeName(store)} بررسی می‌شه و پرداخت از درگاه امن هامون‌کلود/زیبال انجام می‌شه.</p>
      <form id="mHamoonCheckout" class="market-checkout-form" data-store="${esc(store)}">
        <div class="market-form-grid"><label>نام<input name="first_name" required autocomplete="given-name"></label><label>نام خانوادگی<input name="last_name" required autocomplete="family-name"></label></div>
        <div class="market-form-grid"><label>موبایل<input name="phone" required inputmode="tel" autocomplete="tel"></label><label>ایمیل<input name="email" type="email" placeholder="اختیاری" autocomplete="email"></label></div>
        <div class="market-form-grid"><label>شهر<input name="city" required autocomplete="address-level2"></label><label>استان<input name="state" required autocomplete="address-level1"></label></div>
        <label>آدرس کامل<input name="address_1" required autocomplete="street-address"></label>
        <label>کد پستی<input name="postcode" required inputmode="numeric" autocomplete="postal-code"></label>
        <p class="market-cart-note">هزینه ارسال، اگر فروشگاه برای این سفارش داشته باشه، جداگانه توسط فروشگاه هماهنگ می‌شه.</p>
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
  async function confirmReturn(){
    const p=new URLSearchParams(location.search),status=p.get('market_payment');if(!status)return;
    const receipt=p.get('receipt')||'',intent=p.get('intent')||'';
    if(status!=='success'){
      cleanPaymentQuery();setTimeout(()=>window.toast?.('پرداخت انجام نشد؛ سبد خریدت دست‌نخورده موند.'),300);return;
    }
    if(!receipt||!intent){cleanPaymentQuery();return;}
    try{
      const r=await fetch('/api/market-payment/confirm',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({receipt,intent})});
      const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'تأیید پرداخت انجام نشد.');
      const cart=readCart();cart[d.store]=[];writeCart(cart);sessionStorage.removeItem('vestaland:market-payment-store');cleanPaymentQuery();
      setTimeout(()=>{window.toast?.(`پرداخت ${storeName(d.store)} با موفقیت تأیید شد ✓`);location.reload()},350);
    }catch(e){
      cleanPaymentQuery();setTimeout(()=>window.toast?.('پرداخت انجام شده ولی تأیید سفارش کامل نشد؛ رسیدت محفوظ مونده.'),350);
    }
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest?.('[data-mcheckout]');if(!b)return;
    e.preventDefault();e.stopImmediatePropagation();showForm(b.dataset.mcheckout);
  },true);
  document.addEventListener('submit',e=>{
    const f=e.target.closest?.('#mHamoonCheckout');if(!f)return;
    e.preventDefault();e.stopImmediatePropagation();startPayment(f);
  },true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',confirmReturn,{once:true});else confirmReturn();
})();
