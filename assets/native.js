(() => {
  const productIcons = {
    'سرم نیاسینامید ۱۰٪':'droplets','ماسک لب شب':'sparkles','عطر زنانه':'gem','سشوار حرفه‌ای':'wind',
    'رژ لب مات':'sparkle','لاک ژلی':'hand','لوسیون بدن':'flower-2','گوشواره مینیمال':'gem'
  };
  function icons(){ if(window.lucide) window.lucide.createIcons(); }
  function upgradeProducts(){
    document.querySelectorAll('.product-card').forEach(card => {
      const box = card.querySelector('.product-image');
      const title = card.querySelector('h3')?.textContent?.trim();
      if(!box || box.dataset.native === '1') return;
      box.dataset.native = '1';
      box.innerHTML = `<i data-lucide="${productIcons[title] || 'shopping-bag'}"></i>`;
    });
  }
  function upgradeMedia(){
    document.querySelectorAll('.photo-placeholder').forEach(box => {
      if(box.dataset.native === '1') return;
      box.dataset.native = '1';
      const label = box.textContent.trim();
      box.innerHTML = `<div><i data-lucide="image"></i><span>${label}</span></div>`;
    });
  }
  async function startPayment(plan, button){
    const token = localStorage.getItem('vestaland:token') || '';
    if(!token){
      if(typeof window.showAuthModal === 'function') window.showAuthModal('login');
      return;
    }
    const old = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span><b>در حال انتقال به درگاه…</b></span>';
    try{
      const res = await fetch('/api/payments/start', {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},
        body:JSON.stringify({plan})
      });
      const data = await res.json();
      if(!res.ok) throw new Error(data.error || 'شروع پرداخت انجام نشد.');
      location.href = data.url;
    }catch(err){
      button.disabled = false;
      button.innerHTML = old;
      if(typeof window.toast === 'function') window.toast(err.message);
      else alert(err.message);
    }
  }
  async function confirmPayment(){
    const p = new URLSearchParams(location.search);
    const status = p.get('payment');
    if(!status) return;
    const receipt = p.get('receipt') || '';
    const intent = p.get('intent') || '';
    if(status !== 'success'){
      history.replaceState({},'',location.pathname);
      setTimeout(() => window.toast?.('پرداخت انجام نشد. مبلغی از حسابت کم نشده.'), 350);
      return;
    }
    const token = localStorage.getItem('vestaland:token') || '';
    if(!token || !receipt || !intent){
      history.replaceState({},'',location.pathname);
      return;
    }
    try{
      const res = await fetch('/api/payments/confirm', {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},
        body:JSON.stringify({receipt,intent})
      });
      const data = await res.json();
      if(!res.ok) throw new Error(data.error || 'تأیید پرداخت انجام نشد.');
      localStorage.setItem('vestaland:plan', data.user.plan);
      location.replace('/?payment_done=1');
    }catch(err){
      history.replaceState({},'',location.pathname);
      setTimeout(() => window.toast?.(err.message), 350);
    }
  }
  function paymentDoneToast(){
    const p = new URLSearchParams(location.search);
    if(p.get('payment_done') === '1'){
      history.replaceState({},'',location.pathname);
      setTimeout(() => window.toast?.('پرداخت موفق بود؛ اشتراکت فعال شد ✓'), 450);
    }
  }
  document.addEventListener('click', e => {
    const pay = e.target.closest('[data-pay-plan]');
    if(pay){ e.preventDefault(); startPayment(pay.dataset.payPlan, pay); }
  });
  const observer = new MutationObserver(() => { upgradeProducts(); upgradeMedia(); icons(); });
  document.addEventListener('DOMContentLoaded', () => {
    upgradeProducts(); upgradeMedia(); icons(); confirmPayment(); paymentDoneToast();
    observer.observe(document.body,{subtree:true,childList:true});
  });
})();
