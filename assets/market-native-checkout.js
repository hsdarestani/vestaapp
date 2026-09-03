(() => {
  if (window.__vestalandNativeMarketCheckout) return;
  window.__vestalandNativeMarketCheckout = true;

  function keepPaymentNoteNeutral(root = document) {
    const note = root.querySelector?.('.payment-note');
    if (!note) return;
    const icon = note.querySelector('svg')?.outerHTML || '';
    note.innerHTML = `${icon} پرداخت امن`;
  }

  keepPaymentNoteNeutral();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => keepPaymentNoteNeutral(), {once:true});
  }
  new MutationObserver(() => keepPaymentNoteNeutral()).observe(document.documentElement, {subtree:true, childList:true});

  // Onboarding must never depend only on the delegated click handler in app.js.
  // A stale cached core file or a missed DOMContentLoaded used to leave the first screen looking alive but unclickable.
  const onboardingActions = {
    'start-quiz': 'startQuiz',
    'show-plans': 'showPlans',
    'enter-app': 'enterApp',
  };
  let coreRepairPromise = null;

  function runOnboardingAction(action) {
    const fnName = onboardingActions[action];
    const fn = fnName && window[fnName];
    if (typeof fn !== 'function') return false;
    try {
      fn();
      return true;
    } catch (error) {
      console.error('[Vestaland] onboarding action failed', action, error);
      return false;
    }
  }

  function repairCoreApp() {
    if (coreRepairPromise) return coreRepairPromise;
    coreRepairPromise = new Promise((resolve, reject) => {
      if (typeof window.startQuiz === 'function') {
        resolve();
        return;
      }
      const oldRepair = document.querySelector('script[data-vestaland-core-repair]');
      if (oldRepair) {
        oldRepair.addEventListener('load', resolve, {once:true});
        oldRepair.addEventListener('error', reject, {once:true});
        return;
      }
      const script = document.createElement('script');
      script.src = '/app.js?v=20260903-onboarding-fix';
      script.dataset.vestalandCoreRepair = '1';
      script.onload = () => {
        try {
          if (typeof window.init === 'function' && !window.__vestalandRepairInitDone) {
            window.__vestalandRepairInitDone = true;
            window.init();
          }
        } catch (error) {
          console.error('[Vestaland] repaired core init failed', error);
        }
        resolve();
      };
      script.onerror = reject;
      document.body.appendChild(script);
    });
    return coreRepairPromise;
  }

  document.addEventListener('click', event => {
    const button = event.target?.closest?.('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (!onboardingActions[action]) return;

    // This capture listener is the single owner for onboarding CTA clicks.
    // It prevents a duplicate invocation from app.js while providing a recovery path when app.js did not boot.
    event.preventDefault();
    event.stopImmediatePropagation();

    if (runOnboardingAction(action)) return;
    repairCoreApp()
      .then(() => {
        if (!runOnboardingAction(action)) {
          window.toast?.('صفحه کامل لود نشد؛ یک‌بار دوباره تلاش کن.');
        }
      })
      .catch(error => {
        console.error('[Vestaland] core repair load failed', error);
        window.toast?.('اتصال کامل نشد؛ صفحه را دوباره باز کن.');
      });
  }, true);

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