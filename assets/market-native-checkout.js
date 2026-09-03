(() => {
  if (window.__vestalandNativeMarketCheckout) return;
  window.__vestalandNativeMarketCheckout = true;

  function keepPaymentNoteNeutral(root = document) {
    const note = root.querySelector?.('.payment-note');
    if (!note) return;
    const current = (note.textContent || '').replace(/\s+/g, ' ').trim();
    if (current === 'پرداخت امن') return;
    const icon = note.querySelector('svg')?.outerHTML || '';
    note.innerHTML = `${icon} پرداخت امن`;
  }

  // One-shot neutralization only. Do NOT observe the whole DOM here: the old
  // observer rewrote .payment-note from inside its own callback and could keep
  // the main thread busy indefinitely, making onboarding look frozen.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => keepPaymentNoteNeutral(), {once:true});
  } else {
    keepPaymentNoteNeutral();
  }

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

  if (!document.querySelector('script[data-vestaland-jalali-calendar]')) {
    const jalali = document.createElement('script');
    jalali.src = '/assets/jalali-calendar.js?v=20260903-1';
    jalali.dataset.vestalandJalaliCalendar = '1';
    document.body.appendChild(jalali);
  }

  if (!document.querySelector('script[data-vestaland-production-hardening]')) {
    const hardening = document.createElement('script');
    hardening.src = '/assets/production-hardening.js?v=20260903-1';
    hardening.dataset.vestalandProductionHardening = '1';
    document.body.appendChild(hardening);
  }

  if (!document.querySelector('script[data-vestaland-market-payment]')) {
    const script = document.createElement('script');
    script.src = '/assets/market-payment.js?v=20260903-1';
    script.dataset.vestalandMarketPayment = '1';
    document.body.appendChild(script);
  }
})();
