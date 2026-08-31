(() => {
  const iconMap = { 'سرم نیاسینامید ۱۰٪':'droplets','ماسک لب شب':'sparkles','عطر زنانه':'gem','سشوار حرفه‌ای':'wind','رژ لب مات':'sparkle','لاک ژلی':'hand','لوسیون بدن':'flower-2','گوشواره مینیمال':'gem' };
  const quizMap = {'💬':'message-circle-more','🛍️':'shopping-bag','📱':'smartphone','✨':'sparkles'};
  const feedMap = {'درددل':'heart','غیبت':'messages-square','مشورت':'message-circle-question','چالش روزانه':'sparkle','پز':'crown'};
  const avatarUrl = seed => `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(seed || 'vestaland')}&backgroundColor=f7e8ed,ead1da&radius=30`;
  function lucide(){ if(window.lucide) window.lucide.createIcons(); }
  function avatar(el, seed){ if(!el || el.querySelector('img')) return; el.innerHTML=`<img class="avatar-img" alt="" src="${avatarUrl(seed)}">`; }
  function upgradeAvatars(){
    document.querySelectorAll('.post-card').forEach(card=>{ const name=card.querySelector('.post-meta b')?.textContent?.trim()||'vestaland'; avatar(card.querySelector('.mini-avatar'),name); });
    const profileName=document.querySelector('.profile-card h2')?.textContent?.trim()||'vestaland'; avatar(document.querySelector('.profile-avatar'),profileName); avatar(document.querySelector('.avatar-btn span'),profileName);
  }
  function upgradeProducts(){ document.querySelectorAll('.product-card').forEach(card=>{ const title=card.querySelector('h3')?.textContent?.trim(); const box=card.querySelector('.product-image'); if(!box||box.dataset.upgraded) return; box.dataset.upgraded='1'; box.innerHTML=`<span class="product-icon-shell"><i data-lucide="${iconMap[title]||'shopping-bag'}"></i></span>`; }); }
  function upgradeMedia(){ document.querySelectorAll('.photo-placeholder').forEach(box=>{ if(box.dataset.upgraded) return; const label=box.textContent.trim(); box.dataset.upgraded='1'; box.innerHTML=`<span class="media-icon"><i data-lucide="image"></i></span><span class="media-label">تصویر مشورت</span><strong>${label}</strong>`; }); }
  function upgradeQuiz(){ const q=document.querySelector('#questionVisual'); if(!q||q.querySelector('svg')) return; const t=q.textContent.trim(); if(!quizMap[t]) return; q.innerHTML=`<i data-lucide="${quizMap[t]}"></i>`; }
  function upgradeFeedTags(){
    document.querySelectorAll('.post-tag').forEach(tag=>{ if(tag.querySelector('svg')) return; const label=tag.textContent.trim(); tag.innerHTML=`<i data-lucide="${feedMap[label]||'sparkles'}"></i><span>${label}</span>`; });
    const label=document.querySelector('#composerLabel'); if(label && !label.querySelector('svg')){ const txt=label.textContent.trim(); label.innerHTML=`<i data-lucide="${feedMap[txt]||'sparkles'}"></i><span>${txt}</span>`; }
  }
  function upgrade(){ upgradeAvatars(); upgradeProducts(); upgradeMedia(); upgradeQuiz(); upgradeFeedTags(); lucide(); }
  let queued=false; const schedule=()=>{ if(queued) return; queued=true; requestAnimationFrame(()=>{ queued=false; upgrade(); }); };
  document.addEventListener('DOMContentLoaded',()=>{ upgrade(); const obs=new MutationObserver(schedule); obs.observe(document.body,{subtree:true,childList:true,characterData:true}); });
})();
