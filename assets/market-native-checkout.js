(() => {
  if (window.__vestalandNativeMarketCheckout) return;
  window.__vestalandNativeMarketCheckout = true;
  if (document.querySelector('script[data-vestaland-hamoon-market-payment]')) return;
  const script = document.createElement('script');
  script.src = '/assets/market-payment-hamoon.js?v=20260901-2205';
  script.dataset.vestalandHamoonMarketPayment = '1';
  document.body.appendChild(script);
})();
