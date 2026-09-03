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

  if (!installRealFeedOnly()) {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (installRealFeedOnly() || attempts > 40) clearInterval(timer);
    }, 100);
  }
})();
