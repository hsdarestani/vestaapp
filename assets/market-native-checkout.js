(() => {
  if (window.__vestalandNativeMarketCheckout) return;
  window.__vestalandNativeMarketCheckout = true;

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-mcheckout]');
    if (!button) return;
    const bridge = window.MarketBridge;
    if (!bridge || typeof bridge.checkoutStore !== 'function') return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const store = button.dataset.mcheckout;
    let cart = {vesta: [], cutella: []};
    try { cart = JSON.parse(localStorage.getItem('vestaland:market-cart') || JSON.stringify(cart)); } catch (_) {}
    const items = (cart[store] || []).map(row => ({
      id: Number(row.id || 0),
      quantity: Math.max(1, Number(row.quantity || 1))
    })).filter(row => row.id > 0);

    if (!items.length) {
      window.toast?.('سبد خرید خالیه.');
      return;
    }

    button.disabled = true;
    button.textContent = 'در حال آماده‌کردن سبد فروشگاه…';
    try {
      bridge.checkoutStore(store, JSON.stringify(items));
    } catch (_) {
      button.disabled = false;
      button.textContent = 'ادامه و پرداخت';
      window.toast?.('اتصال به پرداخت فروشگاه انجام نشد.');
    }
  }, true);
})();
