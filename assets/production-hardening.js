(() => {
  if (window.__vestalandProductionHardening) return;
  window.__vestalandProductionHardening = true;

  function emptyState(){
    return `<div class="feed-empty-state"><strong>هنوز چیزی اینجا نیست</strong><span>اولین پست این بخش رو تو بنویس ✨</span></div>`;
  }

  function installRealFeedOnly(){
    if (typeof state === 'undefined' || typeof postTemplate !== 'function') return false;
    renderFeed = function(){
      if (typeof updateComposer === 'function') updateComposer();
      const posts = [...((state.remotePosts && state.remotePosts[state.feed]) || [])];
      const feed = document.querySelector('#feed');
      if (!feed) return;
      feed.innerHTML = posts.length ? posts.map((p, idx) => postTemplate(p, idx)).join('') : emptyState();
      try { window.vestalandCommunityV2?.hydrateFeed?.(); } catch (_) {}
    };
    try { renderFeed(); } catch (_) {}
    return true;
  }

  async function syncBazaarPurchase(){
    if (!/VestalandBazaar\//.test(navigator.userAgent || '')) return;
    const authToken = localStorage.getItem('vestaland:token') || '';
    const purchaseToken = localStorage.getItem('vestaland:bazaar:last-token') || '';
    const orderId = localStorage.getItem('vestaland:bazaar:last-order') || '';
    const plan = localStorage.getItem('vestaland:plan') || '';
    if (!authToken || !purchaseToken || !orderId || !['1m','3m','6m'].includes(plan)) return;
    if (localStorage.getItem('vestaland:bazaar:synced-token') === purchaseToken) return;
    try {
      const response = await fetch('/api/bazaar/subscription/legacy-claim', {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({plan, order_id: orderId, purchase_token: purchaseToken}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.server_activated) throw new Error(data.error || 'فعال‌سازی اشتراک انجام نشد.');
      localStorage.setItem('vestaland:bazaar:synced-token', purchaseToken);
      if (data.user?.plan) localStorage.setItem('vestaland:plan', data.user.plan);
      const status = document.querySelector('#subscriptionStatus');
      if (status) status.textContent = 'اشتراک فعال';
      window.toast?.('اشتراکت روی حسابت فعال شد ✓');
    } catch (_) {
      // Keep the purchase token so the next foreground session can retry safely.
    }
  }

  if (!installRealFeedOnly()) {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (installRealFeedOnly() || attempts > 40) clearInterval(timer);
    }, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(syncBazaarPurchase, 900), {once:true});
  } else {
    setTimeout(syncBazaarPurchase, 900);
  }
  window.addEventListener('focus', () => setTimeout(syncBazaarPurchase, 250));
})();
