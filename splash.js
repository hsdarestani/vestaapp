'use strict';
/* Magical cold-start splash for browser, PWA and CafeBazaar WebView.
   Always >= 5.6 seconds, never hides account/payment UI permanently.
   Startup runs during local inventory and account bootstrap, not afterwards. */
(function(){
  const splash=document.getElementById('entrySplash');
  if(!splash)return;
  const MIN_MS=5600;
  const isPaymentReturn=document.documentElement.classList.contains('skip-entry-splash');
  if(isPaymentReturn){
    splash.hidden=true;
    window.VestalandSplash={ready(){}};
    return;
  }
  const started=(window.performance&&performance.now)?performance.now():Date.now();
  const ready=new Set();
  const required=['inventory','commerce'];
  let finished=false;
  const status=document.getElementById('entrySplashStatus');
  const continueButton=document.getElementById('entryContinue');
  function elapsed(){
    return ((window.performance&&performance.now)?performance.now():Date.now())-started;
  }
  function finish(){
    if(finished||elapsed()<MIN_MS)return;
    finished=true;
    window.clearTimeout(minimumTimer);
    window.clearTimeout(slowTimer);
    window.clearTimeout(fallbackTimer);
    splash.classList.add('entry-leaving');
    splash.setAttribute('aria-hidden','true');
    window.setTimeout(()=>{splash.hidden=true},700);
  }
  function check(){
    if(required.every(x=>ready.has(x))&&elapsed()>=MIN_MS)finish();
  }
  window.VestalandSplash={
    MIN_MS,
    ready(name){
      if(!required.includes(name)||finished)return;
      ready.add(name);
      check();
    }
  };
  if(continueButton){
    continueButton.addEventListener('click',()=>finish());
  }
  // 5.6s minimum (including reduced-motion users); readiness never shortens it.
  const minimumTimer=window.setTimeout(()=>{
    check();
    if(!finished&&status)status.textContent='چند لحظه دیگه، اپ آماده می‌شه.';
  },MIN_MS+25);
  // Service worker/offline/slow networks must not trap people under the splash.
  const slowTimer=window.setTimeout(()=>{
    if(finished)return;
    if(status)status.textContent='اتصال کمی طولانی شده؛ می‌تونی وارد اپ بشی.';
    if(continueButton)continueButton.hidden=false;
  },9500);
  const fallbackTimer=window.setTimeout(()=>finish(),16000);
})();
