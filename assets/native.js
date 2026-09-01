(() => {
  const paths = {
    heart:'<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"/>',
    'messages-square':'<path d="M7 8h10M7 12h6"/><path d="M5 18l-3 3v-4a7 7 0 0 1-1-3.5C1 9.36 4.58 6 9 6h6c4.42 0 8 3.36 8 7.5S19.42 21 15 21H9a8.9 8.9 0 0 1-4-.9"/>',
    'message-circle-question':'<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 1 1 5.83 1c0 2-3 2-3 4"/><path d="M12 18h.01"/>',
    sparkles:'<path d="m12 3-1.6 3.8L7 8.4l3.4 1.6L12 14l1.6-4 3.4-1.6-3.4-1.6Z"/><path d="m19 15-.8 1.9-1.7.8 1.7.8.8 2 .8-2 1.7-.8-1.7-.8Z"/>',
    sparkle:'<path d="m12 2-2.1 5.1L5 9.2l4.9 2.1L12 16l2.1-4.7L19 9.2l-4.9-2.1Z"/>',
    crown:'<path d="m3 6 4 4 5-7 5 7 4-4-2 13H5Z"/><path d="M5 19h14"/>',
    'chevron-left':'<path d="m15 18-6-6 6-6"/>',
    'image-plus':'<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/><path d="M19 8v6M16 11h6"/>',
    image:'<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    search:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    'badge-check':'<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.78 4.78 4 4 0 0 1-6.74 0 4 4 0 0 1-4.78-4.78 4 4 0 0 1 0-6.75Z"/><path d="m9 12 2 2 4-4"/>',
    'shield-check':'<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3Z"/><path d="m9 12 2 2 4-4"/>',
    home:'<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
    'heart-pulse':'<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 12 5a5.5 5.5 0 0 0-10 3.5c0 2.3 1.5 4 3 5.5l7 7Z"/><path d="M3.2 12H8l2-3 3 6 2-3h5.8"/>',
    'shopping-bag':'<path d="M6 8h12l1 13H5L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    'user-round':'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    droplets:'<path d="M7 16.3c2.2 0 4-1.8 4-4 0-2-2.7-5.4-4-6.8-1.3 1.4-4 4.8-4 6.8 0 2.2 1.8 4 4 4Z"/>',
    gem:'<path d="M6 3h12l4 6-10 12L2 9Z"/><path d="m2 9 10 3 10-3M12 21V12M6 3l6 9 6-9"/>',
    wind:'<path d="M3 8h10a3 3 0 1 0-3-3"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
    hand:'<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 11V5a2 2 0 0 0-4 0v9"/><path d="M6 13v-1a2 2 0 0 0-4 0v3c0 4 3 7 7 7h4c5 0 9-4 9-9v-2a2 2 0 0 0-4 0Z"/>',
    'flower-2':'<circle cx="12" cy="12" r="3"/><path d="M12 9a3 3 0 1 0-3-3c0 1.7 3 3 3 3ZM15 12a3 3 0 1 0 3-3c-1.7 0-3 3-3 3ZM12 15a3 3 0 1 0 3 3c0-1.7-3-3-3-3ZM9 12a3 3 0 1 0-3 3c1.7 0 3-3 3-3Z"/>'
  };
  const productIcons={'سرم نیاسینامید ۱۰٪':'droplets','ماسک لب شب':'sparkles','عطر زنانه':'gem','سشوار حرفه‌ای':'wind','رژ لب مات':'sparkle','لاک ژلی':'hand','لوسیون بدن':'flower-2','گوشواره مینیمال':'gem'};
  const svg=name=>`<svg class="v-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.sparkles}</svg>`;
  function renderIcons(root=document){root.querySelectorAll('i[data-lucide]').forEach(node=>{const box=document.createElement('span');box.innerHTML=svg(node.dataset.lucide);node.replaceWith(box.firstElementChild);});}
  function upgradeProducts(){document.querySelectorAll('.product-card').forEach(card=>{const box=card.querySelector('.product-image');const title=card.querySelector('h3')?.textContent?.trim();if(!box||box.dataset.native==='1')return;box.dataset.native='1';box.innerHTML=svg(productIcons[title]||'shopping-bag');});}
  function upgradeMedia(){document.querySelectorAll('.photo-placeholder').forEach(box=>{if(box.dataset.native==='1')return;box.dataset.native='1';const label=box.textContent.trim();box.innerHTML=`<div class="media-placeholder-inner">${svg('image')}<span>${label}</span></div>`;});}
  function loadMarketAssets(){
    if(!document.querySelector('link[data-vestaland-market]')){const l=document.createElement('link');l.rel='stylesheet';l.href='/assets/market-live.css?v=20260901-2';l.dataset.vestalandMarket='1';document.head.appendChild(l);}
    if(!document.querySelector('script[data-vestaland-market]')){const s=document.createElement('script');s.src='/assets/market-live-v2.js?v=20260901-2';s.dataset.vestalandMarket='1';document.body.appendChild(s);}
  }
  window.state=window.state||{marketStore:'all'};
  document.addEventListener('click',e=>{const b=e.target.closest('.store-switch [data-store]');if(b)window.state.marketStore=b.dataset.store;});
  async function startPayment(plan,button){const token=localStorage.getItem('vestaland:token')||'';if(!token){window.showAuthModal?.('login');return;}const old=button.innerHTML;button.disabled=true;button.innerHTML='<span><b>در حال انتقال به درگاه…</b></span>';try{const res=await fetch('/api/payments/start',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({plan})});const data=await res.json();if(!res.ok)throw new Error(data.error||'شروع پرداخت انجام نشد.');location.href=data.url;}catch(err){button.disabled=false;button.innerHTML=old;window.toast?.(err.message);}}
  async function confirmPayment(){const p=new URLSearchParams(location.search),status=p.get('payment');if(!status)return;const receipt=p.get('receipt')||'',intent=p.get('intent')||'';if(status!=='success'){history.replaceState({},'',location.pathname);setTimeout(()=>window.toast?.('پرداخت انجام نشد. مبلغی از حسابت کم نشده.'),350);return;}const token=localStorage.getItem('vestaland:token')||'';if(!token||!receipt||!intent){history.replaceState({},'',location.pathname);return;}try{const res=await fetch('/api/payments/confirm',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({receipt,intent})});const data=await res.json();if(!res.ok)throw new Error(data.error||'تأیید پرداخت انجام نشد.');localStorage.setItem('vestaland:plan',data.user.plan);location.replace('/?payment_done=1');}catch(err){history.replaceState({},'',location.pathname);setTimeout(()=>window.toast?.(err.message),350);}}
  function paymentDoneToast(){const p=new URLSearchParams(location.search);if(p.get('payment_done')==='1'){history.replaceState({},'',location.pathname);setTimeout(()=>window.toast?.('پرداخت موفق بود؛ اشتراکت فعال شد ✓'),450);}}
  document.addEventListener('click',e=>{const pay=e.target.closest('[data-pay-plan]');if(pay){e.preventDefault();startPayment(pay.dataset.payPlan,pay);}});
  const observer=new MutationObserver(()=>{upgradeProducts();upgradeMedia();renderIcons();});
  document.addEventListener('DOMContentLoaded',()=>{renderIcons();upgradeProducts();upgradeMedia();loadMarketAssets();confirmPayment();paymentDoneToast();observer.observe(document.body,{subtree:true,childList:true});});
})();