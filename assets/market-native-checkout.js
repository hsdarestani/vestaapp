(() => {
  if (window.__vestalandNativeMarketCheckout) return;
  window.__vestalandNativeMarketCheckout = true;

  if (!document.querySelector('link[data-vestaland-minimal-v5]')) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/assets/minimal-v5.css?v=20260901-2228';
    css.dataset.vestalandMinimalV5 = '1';
    document.head.appendChild(css);
  }

  if (!document.querySelector('link[data-vestaland-community-v2]')) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/assets/community-v2.css?v=20260903-1';
    css.dataset.vestalandCommunityV2 = '1';
    document.head.appendChild(css);
  }

  if (!document.querySelector('script[data-vestaland-community-v2]')) {
    const community = document.createElement('script');
    community.src = '/assets/community-v2.js?v=20260903-1';
    community.dataset.vestalandCommunityV2 = '1';
    document.body.appendChild(community);
  }

  if (document.querySelector('script[data-vestaland-hamoon-market-payment]')) return;
  const script = document.createElement('script');
  script.src = '/assets/market-payment-hamoon.js?v=20260901-2228';
  script.dataset.vestalandHamoonMarketPayment = '1';
  document.body.appendChild(script);
})();
