(() => {
  if (window.__vestalandCommunityV2) return;
  window.__vestalandCommunityV2 = true;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = n => new Intl.NumberFormat('fa-IR').format(Number(n || 0));
  const token = () => localStorage.getItem('vestaland:token') || '';
  const types = {vent:'درددل', gossip:'غیبت', advice:'مشورت', challenge:'چالش', flex:'پز'};
  const extrasCache = new Map();
  const blobCache = new Map();
  let draftMedia = [];
  let draftPoll = null;
  let hydrateTimer = null;
  let statsTimer = null;
  let profileCache = null;

  function toast(text){
    if (window.toast) return window.toast(text);
    const el = $('#toast');
    if (!el) return;
    el.textContent = text; el.classList.remove('hidden');
    clearTimeout(window.__vxToast); window.__vxToast = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  function modal(html){
    const m = $('#modal'), c = $('#modalContent');
    if (!m || !c) return;
    c.innerHTML = html; m.classList.remove('hidden'); document.body.style.overflow = 'hidden';
  }
  function closeModal(){
    if (window.closeModal) return window.closeModal();
    $('#modal')?.classList.add('hidden'); document.body.style.overflow = '';
  }

  async function api(path, options = {}){
    const headers = {'Content-Type':'application/json', ...(options.headers || {})};
    if (token()) headers.Authorization = `Bearer ${token()}`;
    const res = await fetch(path, {...options, headers, cache:'no-store'});
    const data = await res.json().catch(() => ({}));
    if (res.status === 401){
      localStorage.removeItem('vestaland:token');
      window.showAuthModal?.('login');
      throw new Error(data.error || 'برای ادامه وارد حسابت شو.');
    }
    if (res.status === 402){
      toast(data.error || 'برای ادامه اشتراکت رو فعال کن.');
      setTimeout(() => $('[data-view="profile"]')?.click(), 250);
      const err = new Error(data.error || 'اشتراک لازم است.'); err.code = 'subscription_required'; throw err;
    }
    if (!res.ok) throw new Error(data.error || 'یه خطا پیش اومد. دوباره امتحان کن.');
    return data;
  }

  async function authedBlob(path){
    if (blobCache.has(path)) return blobCache.get(path);
    const res = await fetch(path, {headers:{Authorization:`Bearer ${token()}`}, cache:'force-cache'});
    if (!res.ok) throw new Error('عکس باز نشد.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob); blobCache.set(path, url); return url;
  }

  function enhanceProfileMenu(){
    const buttons = $$('.profile-menu button');
    const actions = ['my-posts','saved','notifications','privacy','rules'];
    buttons.forEach((b, i) => { if (actions[i]) b.dataset.vx = actions[i]; });
    if (buttons[1]){
      let count = $('b', buttons[1]);
      if (!count){ count = document.createElement('b'); count.textContent = '۰'; buttons[1].appendChild(count); }
      count.id = 'vxSavedCount';
    }
    if (buttons[2] && !$('#vxNotifCount')){
      const b = document.createElement('b'); b.id = 'vxNotifCount'; b.className = 'vx-count hidden'; b.textContent = '۰';
      buttons[2].appendChild(b);
    }
  }

  async function refreshStats(){
    if (!token()) return;
    try{
      const data = await api('/api/profile/stats');
      if ($('#myPostCount')) $('#myPostCount').textContent = fmt(data.posts);
      if ($('#vxSavedCount')) $('#vxSavedCount').textContent = fmt(data.saved);
      const n = $('#vxNotifCount');
      if (n){ n.textContent = fmt(data.unread_notifications); n.classList.toggle('hidden', !data.unread_notifications); }
    }catch(_){ }
  }
  function scheduleStats(){ clearTimeout(statsTimer); statsTimer = setTimeout(refreshStats, 120); }

  function injectComposerTools(){
    const wrap = $('.composer-buttons');
    if (!wrap || $('#vxPollButton')) return;
    const btn = document.createElement('button');
    btn.id = 'vxPollButton'; btn.type = 'button'; btn.className = 'text-icon-btn'; btn.dataset.vx = 'poll-draft';
    btn.innerHTML = '<span class="vx-mini-icon">▤</span><span>نظرسنجی</span>';
    const photo = $('#photoButton');
    if (photo) wrap.insertBefore(btn, photo.nextSibling); else wrap.prepend(btn);
    const textarea = $('#postText');
    if (textarea && !$('#vxComposerDraft')){
      const d = document.createElement('div'); d.id = 'vxComposerDraft'; d.className = 'vx-composer-draft hidden';
      textarea.insertAdjacentElement('afterend', d);
    }
    updateComposerTools();
  }

  function currentFeed(){
    return $('.segment.active[data-feed]')?.dataset.feed || 'vent';
  }
  function updateComposerTools(){
    const feed = currentFeed();
    const poll = $('#vxPollButton');
    if (poll) poll.classList.toggle('hidden', !['advice','gossip'].includes(feed));
    renderDraft();
  }
  function renderDraft(){
    const box = $('#vxComposerDraft'); if (!box) return;
    if (!draftMedia.length && !draftPoll){ box.classList.add('hidden'); box.innerHTML = ''; return; }
    const pics = draftMedia.map((src, i) => `<div class="vx-draft-photo"><img src="${src}" alt="عکس انتخاب‌شده"><button type="button" data-vx-remove-photo="${i}" aria-label="حذف">×</button></div>`).join('');
    const poll = draftPoll ? `<div class="vx-draft-poll"><b>${esc(draftPoll.question || 'نظرسنجی')}</b><span>${draftPoll.options.map(esc).join(' · ')}</span><button type="button" data-vx="poll-draft">ویرایش</button><button type="button" data-vx="poll-clear">حذف</button></div>` : '';
    box.innerHTML = `<div class="vx-draft-photos">${pics}</div>${poll}`;
    box.classList.remove('hidden');
  }

  function pickPostPhotos(){
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
    input.addEventListener('change', async () => {
      const files = [...input.files].slice(0, Math.max(0, 3 - draftMedia.length));
      if (!files.length) return;
      toast('دارم عکس‌ها رو آماده می‌کنم…');
      try{
        for (const f of files) draftMedia.push(await imageToData(f, 1280, .78));
        renderDraft(); toast('عکس آماده‌ست ✓');
      }catch(e){ toast(e.message); }
    });
    input.click();
  }

  async function imageToData(file, maxSide = 1280, quality = .78){
    if (!file?.type?.startsWith('image/')) throw new Error('فقط فایل عکس انتخاب کن.');
    if (file.size > 12 * 1024 * 1024) throw new Error('این عکس خیلی حجیمه.');
    const url = URL.createObjectURL(file);
    try{
      const img = await new Promise((resolve, reject) => {
        const el = new Image(); el.onload = () => resolve(el); el.onerror = () => reject(new Error('عکس باز نشد.')); el.src = url;
      });
      let w = img.naturalWidth, h = img.naturalHeight;
      const scale = Math.min(1, maxSide / Math.max(w, h)); w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,w,h); ctx.drawImage(img,0,0,w,h);
      let data = canvas.toDataURL('image/jpeg', quality);
      if (data.length > 1_550_000) data = canvas.toDataURL('image/jpeg', .62);
      if (data.length > 1_650_000) throw new Error('عکس بعد از فشرده‌سازی هنوز خیلی حجیمه.');
      return data;
    }finally{ URL.revokeObjectURL(url); }
  }

  function openPollDraft(){
    if (!['advice','gossip'].includes(currentFeed())) return toast('نظرسنجی برای مشورت و غیبت فعاله.');
    const p = draftPoll || {question:'', options:['','']};
    modal(`<p class="kicker">نظرسنجی</p><h2>از بقیه رأی بگیر</h2><form id="vxPollForm" class="modal-form">
      <label>سؤال <input name="question" maxlength="200" value="${esc(p.question)}" placeholder="مثلاً کدوم بهتره؟"></label>
      <label>گزینه ۱ <input name="o1" maxlength="80" required value="${esc(p.options[0] || '')}"></label>
      <label>گزینه ۲ <input name="o2" maxlength="80" required value="${esc(p.options[1] || '')}"></label>
      <label>گزینه ۳ <input name="o3" maxlength="80" value="${esc(p.options[2] || '')}" placeholder="اختیاری"></label>
      <label>گزینه ۴ <input name="o4" maxlength="80" value="${esc(p.options[3] || '')}" placeholder="اختیاری"></label>
      <button class="primary-btn" type="submit">اضافه به پست</button></form>`);
    $('#vxPollForm')?.addEventListener('submit', e => {
      e.preventDefault(); const fd = new FormData(e.currentTarget);
      const options = ['o1','o2','o3','o4'].map(k => String(fd.get(k)||'').trim()).filter(Boolean);
      if (new Set(options).size !== options.length) return toast('گزینه‌ها باید متفاوت باشن.');
      draftPoll = {question:String(fd.get('question')||'').trim(), options}; closeModal(); renderDraft();
    });
  }

  async function publishPost(){
    if (!token()) return window.showAuthModal?.('login');
    const text = ($('#postText')?.value || '').trim();
    if (!text && !draftMedia.length) return toast('یه متن یا عکس برای پست بذار :)');
    const button = $('[data-action="publish-post"]'); const old = button?.textContent;
    if (button){ button.disabled = true; button.textContent = 'در حال انتشار…'; }
    try{
      const feed = currentFeed();
      await api('/api/posts', {method:'POST', body:JSON.stringify({
        type: feed, text, anonymous: !!$('#anonymousToggle')?.checked,
        media: draftMedia, poll: draftPoll,
      })});
      if ($('#postText')) $('#postText').value = '';
      if ($('#anonymousToggle')) $('#anonymousToggle').checked = false;
      draftMedia = []; draftPoll = null; renderDraft();
      extrasCache.clear();
      await window.loadFeed?.(); scheduleStats(); toast('پستت منتشر شد ✓');
    }catch(e){ if (e.code !== 'subscription_required') toast(e.message); }
    finally{ if (button){ button.disabled = false; button.textContent = old || 'انتشار'; } }
  }

  function postIdFromCard(card){
    const raw = card.querySelector('[data-reaction^="r|"]')?.dataset.reaction || '';
    const bits = raw.split('|'); return bits[0] === 'r' ? Number(bits[1]) : 0;
  }

  function scheduleHydrate(){ clearTimeout(hydrateTimer); hydrateTimer = setTimeout(hydrateCards, 80); }
  async function hydrateCards(){
    const cards = $$('.post-card');
    const ids = cards.map(postIdFromCard).filter(Boolean);
    const missing = [...new Set(ids.filter(id => !extrasCache.has(id)))];
    if (missing.length && token()){
      try{
        const data = await api('/api/post-extras?ids=' + missing.slice(0,50).join(','));
        Object.entries(data.extras || {}).forEach(([id, x]) => extrasCache.set(Number(id), x));
      }catch(_){ }
    }
    cards.forEach(card => {
      const id = postIdFromCard(card); if (!id) return;
      card.dataset.vxPostId = String(id); decorateCard(card, id, extrasCache.get(id));
    });
    scheduleStats();
  }

  function decorateCard(card, id, extra){
    if (!extra) return;
    const row = $('.reaction-row', card);
    if (row){
      let save = $('[data-vx-bookmark]', row);
      if (!save){
        save = document.createElement('button'); save.type = 'button'; save.className = 'vx-bookmark'; save.dataset.vxBookmark = String(id); row.appendChild(save);
      }
      save.classList.toggle('active', !!extra.bookmarked); save.textContent = extra.bookmarked ? '♥ ذخیره شد' : '♡ ذخیره';
      let del = $('[data-vx-delete]', row);
      if (extra.is_mine && !del){ del = document.createElement('button'); del.type='button'; del.className='vx-delete-post'; del.dataset.vxDelete=String(id); del.textContent='حذف'; row.appendChild(del); }
      const comments = $('[data-comments-post]', row);
      if (comments && extra.comments_allowed === false){ comments.classList.add('hidden'); if (!$('.vx-comments-closed', row)){ const s=document.createElement('span');s.className='vx-comments-closed';s.textContent='نظرها بسته‌ست';row.appendChild(s); } }
    }
    renderPostMedia(card, extra.media || []);
    renderPoll(card, id, extra.poll);
  }

  function renderPostMedia(card, media){
    let box = $('.vx-post-media', card);
    if (!media.length){ box?.remove(); return; }
    if (!box){ box = document.createElement('div'); box.className = `vx-post-media vx-cols-${Math.min(3, media.length)}`; $('.post-body', card)?.insertAdjacentElement('afterend', box); }
    const current = box.dataset.ids || '';
    const wanted = media.map(x => x.id).join(','); if (current === wanted) return;
    box.dataset.ids = wanted; box.innerHTML = media.map(x => `<button type="button" class="vx-media-tile" data-vx-media="${x.id}"><span>عکس</span></button>`).join('');
    media.forEach(async m => {
      const tile = $(`[data-vx-media="${m.id}"]`, box); if (!tile) return;
      try{ const src = await authedBlob(`/api/media/${m.id}`); tile.innerHTML = `<img src="${src}" alt="عکس پست" loading="lazy">`; }
      catch(_){ tile.innerHTML = '<span>عکس باز نشد</span>'; }
    });
  }

  function renderPoll(card, postId, poll){
    let box = $('.vx-poll', card);
    if (!poll){ box?.remove(); return; }
    if (!box){ box = document.createElement('div'); box.className = 'vx-poll'; const media = $('.vx-post-media',card); (media || $('.post-body',card))?.insertAdjacentElement('afterend', box); }
    box.innerHTML = `<b>${esc(poll.question)}</b><div class="vx-poll-options">${(poll.options||[]).map(o => `
      <button type="button" class="vx-poll-option ${o.selected?'selected':''}" data-vx-vote="${postId}|${o.id}">
        <span>${esc(o.label)}</span><em>${fmt(o.percent)}٪</em><i style="width:${Math.max(0,Math.min(100,o.percent||0))}%"></i>
      </button>`).join('')}</div><small>${fmt(poll.total_votes)} رأی</small>`;
  }

  async function toggleBookmark(postId, button){
    button.disabled = true;
    try{
      const data = await api(`/api/posts/${postId}/bookmark`, {method:'POST', body:'{}'});
      const extra = extrasCache.get(postId) || {}; extra.bookmarked = !!data.bookmarked; extrasCache.set(postId, extra);
      button.classList.toggle('active', !!data.bookmarked); button.textContent = data.bookmarked ? '♥ ذخیره شد' : '♡ ذخیره';
      scheduleStats(); toast(data.bookmarked ? 'ذخیره شد ✓' : 'از ذخیره‌ها برداشته شد');
    }catch(e){ toast(e.message); } finally{ button.disabled = false; }
  }

  async function votePoll(postId, optionId){
    try{
      const data = await api(`/api/posts/${postId}/poll-vote`, {method:'POST', body:JSON.stringify({option_id:optionId})});
      const extra = extrasCache.get(postId) || {}; extra.poll = data.poll; extrasCache.set(postId, extra);
      const card = $(`[data-vx-post-id="${postId}"]`); if (card) renderPoll(card, postId, data.poll);
      toast('رأیت ثبت شد ✓');
    }catch(e){ toast(e.message); }
  }

  async function deletePost(postId, fromList = false){
    if (!confirm('این پست حذف بشه؟')) return;
    try{
      await api(`/api/posts/${postId}`, {method:'DELETE'}); extrasCache.delete(postId); scheduleStats(); toast('پست حذف شد.');
      if (fromList) openMyPosts(); else window.loadFeed?.();
    }catch(e){ toast(e.message); }
  }

  function listPost(p, saved = false){
    const mediaCount = (p.media_items || []).length;
    return `<article class="vx-list-post" data-vx-list-post="${p.id}">
      <div class="vx-list-head"><span>${types[p.type] || p.type}</span><small>${relative(p.created_at)}</small></div>
      <p>${esc(p.text || (mediaCount ? 'پست تصویری' : ''))}</p>
      <div class="vx-list-meta">${mediaCount?`<span>${fmt(mediaCount)} عکس</span>`:''}${p.poll?'<span>نظرسنجی</span>':''}<span>${fmt(Object.values(p.reactions||{}).reduce((a,b)=>a+Number(b||0),0))} واکنش</span><span>${fmt(p.comments||0)} نظر</span></div>
      <div class="vx-list-actions"><button type="button" data-vx-goto="${p.type}|${p.id}">دیدن پست</button>${saved?`<button type="button" data-vx-unsave="${p.id}">حذف از ذخیره‌ها</button>`:`<button class="danger" type="button" data-vx-delete-list="${p.id}">حذف پست</button>`}</div>
    </article>`;
  }

  async function openMyPosts(){
    modal('<p class="kicker">حساب من</p><h2>پست‌های من</h2><div class="vx-loading">دارم میارمشون…</div>');
    try{
      const d = await api('/api/my/posts');
      $('#modalContent').innerHTML = `<p class="kicker">حساب من</p><div class="vx-modal-title"><h2>پست‌های من</h2><b>${fmt((d.posts||[]).length)}</b></div><div class="vx-list">${d.posts?.length?d.posts.map(p=>listPost(p,false)).join(''):'<p class="vx-empty">هنوز پستی منتشر نکردی.</p>'}</div>`;
    }catch(e){ $('#modalContent').innerHTML = `<h2>پست‌های من</h2><p class="form-error">${esc(e.message)}</p>`; }
  }

  async function openSaved(){
    modal('<p class="kicker">برای بعد</p><h2>ذخیره‌شده‌ها</h2><div class="vx-loading">دارم میارمشون…</div>');
    try{
      const d = await api('/api/bookmarks');
      $('#modalContent').innerHTML = `<p class="kicker">برای بعد</p><div class="vx-modal-title"><h2>ذخیره‌شده‌ها</h2><b>${fmt((d.posts||[]).length)}</b></div><div class="vx-list">${d.posts?.length?d.posts.map(p=>listPost(p,true)).join(''):'<p class="vx-empty">هنوز چیزی ذخیره نکردی.</p>'}</div>`;
    }catch(e){ $('#modalContent').innerHTML = `<h2>ذخیره‌شده‌ها</h2><p class="form-error">${esc(e.message)}</p>`; }
  }

  async function gotoPost(type, id){
    closeModal();
    const btn = $(`[data-feed="${CSS.escape(type)}"]`); btn?.click();
    setTimeout(() => { const card = $(`[data-vx-post-id="${id}"]`); card?.scrollIntoView({behavior:'smooth',block:'center'}); card?.classList.add('vx-highlight'); setTimeout(()=>card?.classList.remove('vx-highlight'),1800); }, 550);
  }

  function relative(value){
    const d = new Date(value); if (!value || Number.isNaN(d.getTime())) return 'همین الان';
    const sec = Math.max(0, Math.floor((Date.now()-d.getTime())/1000));
    if (sec < 60) return 'همین الان'; const m=Math.floor(sec/60); if(m<60)return `${fmt(m)} دقیقه پیش`; const h=Math.floor(m/60); if(h<24)return `${fmt(h)} ساعت پیش`; return `${fmt(Math.floor(h/24))} روز پیش`;
  }

  async function openNotifications(){
    modal('<p class="kicker">اعلان‌ها</p><h2>چه خبر شده؟</h2><div class="vx-loading">دارم میارمشون…</div>');
    try{
      const d = await api('/api/notifications'); const rows = d.notifications || [];
      const device = ('Notification' in window) ? `<button type="button" class="secondary-btn vx-device-notify" data-vx="device-notify">${Notification.permission==='granted'?'اعلان دستگاه فعاله ✓':'فعال‌کردن اعلان روی دستگاه'}</button>` : '';
      $('#modalContent').innerHTML = `<p class="kicker">اعلان‌ها</p><div class="vx-modal-title"><h2>چه خبر شده؟</h2><button type="button" class="link-btn" data-vx="read-all">همه خوانده شد</button></div>${device}<p class="vx-help">اعلان دستگاه وقتی وستالند بازه، خبرهای جدید رو همون لحظه نشون می‌ده.</p><div class="vx-notifications">${rows.length?rows.map(n=>`<button type="button" class="vx-notification ${n.is_read?'':'unread'}" data-vx-notification="${n.id}|${n.post_type||''}|${n.post_id||''}"><span></span><div><b>${esc(n.title)}</b><p>${esc(n.body)}</p><small>${relative(n.created_at)}</small></div></button>`).join(''):'<p class="vx-empty">فعلاً خبری نیست :)</p>'}</div>`;
    }catch(e){ $('#modalContent').innerHTML = `<h2>اعلان‌ها</h2><p class="form-error">${esc(e.message)}</p>`; }
  }

  async function markAllRead(){
    try{ await api('/api/notifications/read',{method:'POST',body:JSON.stringify({all:true})}); $$('.vx-notification').forEach(x=>x.classList.remove('unread')); scheduleStats(); }catch(e){ toast(e.message); }
  }

  async function openPrivacy(){
    modal('<p class="kicker">حساب من</p><h2>حریم خصوصی و امنیت</h2><div class="vx-loading">دارم تنظیمات رو میارم…</div>');
    try{
      const [p,s] = await Promise.all([api('/api/profile'), api('/api/settings')]); profileCache = p.profile; const x=s.settings;
      $('#modalContent').innerHTML = `<p class="kicker">حساب من</p><h2>حریم خصوصی و امنیت</h2>
      <form id="vxProfileForm" class="modal-form vx-section-form"><h3>پروفایل</h3>
        <label>اسم نمایشی<input name="display_name" maxlength="32" required value="${esc(p.profile.display_name)}"></label>
        <label>نام کاربری<input name="username" dir="ltr" maxlength="24" required value="${esc(p.profile.username)}"></label>
        <label class="vx-file-label">عکس پروفایل<input id="vxAvatarFile" type="file" accept="image/*"><span>انتخاب عکس</span></label>
        <button class="primary-btn" type="submit">ذخیره پروفایل</button></form>
      <form id="vxSettingsForm" class="vx-settings-form"><h3>حریم خصوصی</h3>
        ${settingRow('notifications_enabled','اعلان‌های داخل اپ','واکنش‌ها و نظرهای جدید',x.notifications_enabled)}
        ${settingRow('profile_private','پروفایل خصوصی','اطلاعات پروفایلت عمومی نباشه',x.profile_private)}
        ${settingRow('allow_comments','اجازه نظر روی پست‌ها','بقیه بتونن زیر پست‌های قابل‌نظر کامنت بذارن',x.allow_comments)}
        <button class="secondary-btn" type="submit">ذخیره تنظیمات</button></form>
      <form id="vxPasswordForm" class="modal-form vx-section-form"><h3>تغییر رمز</h3>
        <label>رمز فعلی<input type="password" name="current_password" required minlength="8"></label>
        <label>رمز جدید<input type="password" name="new_password" required minlength="8"></label>
        <button class="secondary-btn" type="submit">تغییر رمز</button></form>
      <div class="vx-danger-zone"><h3>حذف حساب</h3><p>با حذف حساب، پست‌ها، ذخیره‌ها و اطلاعات شخصی‌ات پاک می‌شن.</p><button type="button" class="danger-link" data-vx="delete-account">حذف کامل حساب</button></div>`;
      bindPrivacyForms();
    }catch(e){ $('#modalContent').innerHTML = `<h2>حریم خصوصی و امنیت</h2><p class="form-error">${esc(e.message)}</p>`; }
  }

  function settingRow(name,title,sub,checked){
    return `<label class="vx-setting-row"><div><b>${title}</b><small>${sub}</small></div><input type="checkbox" name="${name}" ${checked?'checked':''}><span></span></label>`;
  }

  function bindPrivacyForms(){
    $('#vxProfileForm')?.addEventListener('submit', async e => {
      e.preventDefault(); const fd=new FormData(e.currentTarget), file=$('#vxAvatarFile')?.files?.[0];
      const body={display_name:String(fd.get('display_name')||'').trim(),username:String(fd.get('username')||'').trim()};
      const btn=$('button[type="submit"]',e.currentTarget); btn.disabled=true;
      try{ if(file) body.avatar_data=await imageToData(file,360,.8); const d=await api('/api/profile',{method:'POST',body:JSON.stringify(body)}); profileCache=d.profile; await hydrateProfile(); toast('پروفایل ذخیره شد ✓'); }
      catch(x){toast(x.message);}finally{btn.disabled=false;}
    });
    $('#vxSettingsForm')?.addEventListener('submit', async e => {
      e.preventDefault(); const body={}; ['notifications_enabled','profile_private','allow_comments'].forEach(k=>body[k]=!!e.currentTarget.elements[k].checked);
      try{await api('/api/settings',{method:'POST',body:JSON.stringify(body)});toast('تنظیمات ذخیره شد ✓');}catch(x){toast(x.message);}
    });
    $('#vxPasswordForm')?.addEventListener('submit', async e => {
      e.preventDefault(); const fd=new FormData(e.currentTarget);
      try{await api('/api/profile/password',{method:'POST',body:JSON.stringify({current_password:fd.get('current_password'),new_password:fd.get('new_password')})});e.currentTarget.reset();toast('رمزت عوض شد ✓');}catch(x){toast(x.message);}
    });
  }

  async function deleteAccount(){
    const password = prompt('برای حذف کامل حساب، رمز عبورت رو وارد کن:'); if (!password) return;
    if (!confirm('مطمئنی؟ این کار قابل برگشت نیست.')) return;
    try{await api('/api/profile/delete',{method:'POST',body:JSON.stringify({password})});Object.keys(localStorage).filter(k=>k.startsWith('vestaland:')).forEach(k=>localStorage.removeItem(k));location.reload();}catch(e){toast(e.message);}
  }

  function openRules(){
    modal(`<p class="kicker">دورهمی</p><h2>قوانین وستالند</h2><div class="vx-rules">
      <div><b>۱. امن باش</b><p>اطلاعات خصوصی خودت یا بقیه، شماره، آدرس و چیزهایی که می‌تونه کسی رو شناسایی کنه منتشر نکن.</p></div>
      <div><b>۲. تحقیر و آزار ممنوع</b><p>اختلاف‌نظر اوکیه؛ توهین، تهدید، آزار و حمله به آدم‌ها نه.</p></div>
      <div><b>۳. درددل جای قضاوت نیست</b><p>اگر کسی فقط می‌خواد شنیده بشه، نصیحت ناخواسته و سرزنش نکن.</p></div>
      <div><b>۴. غیبت بدون افشای هویت</b><p>اسم کامل، عکس بدون رضایت یا اطلاعاتی که فرد رو قابل‌شناسایی کنه نذار.</p></div>
      <div><b>۵. محتوای غیرقانونی و خطرناک نه</b><p>فروش یا آموزش کارهای غیرقانونی، تهدید و محتوای آسیب‌زا حذف می‌شه.</p></div>
      <div><b>۶. تبلیغ و اسپم نکن</b><p>دورهمی برای گفت‌وگوئه؛ تبلیغات تکراری و مزاحمت حذف می‌شن.</p></div>
    </div><p class="vx-help">با استفاده از دورهمی، این قواعد رو می‌پذیری.</p>`);
  }

  async function hydrateProfile(){
    if (!token()) return;
    try{
      const d = await api('/api/profile'); profileCache = d.profile;
      const name=d.profile.display_name, letter=(name||'و').slice(0,1);
      $('.profile-card h2') && ($('.profile-card h2').textContent=name);
      $('.profile-card .muted') && ($('.profile-card .muted').textContent='@'+d.profile.username);
      $('.profile-avatar') && ($('.profile-avatar').textContent=letter);
      $('.avatar-btn span') && ($('.avatar-btn span').textContent=letter);
      const labels={trial:'۷ روز آزمایشی','1m':'۱ ماهه','3m':'۳ ماهه','6m':'۶ ماهه'};
      if ($('#subscriptionStatus')) $('#subscriptionStatus').textContent = d.profile.subscription_active ? (labels[d.profile.plan]||'فعال') : 'عضویت منقضی شده';
      if (d.profile.has_avatar){
        try{
          const src = await authedBlob(`/api/avatar/${d.profile.id}`);
          const a=$('.profile-avatar'), h=$('.avatar-btn');
          if(a){a.style.backgroundImage=`url("${src}")`;a.classList.add('vx-has-avatar');}
          if(h){h.style.backgroundImage=`url("${src}")`;h.classList.add('vx-has-avatar');}
        }catch(_){ }
      }
    }catch(_){ }
  }

  async function hydrateWellbeing(){
    if (!token()) return;
    try{
      const d = await api('/api/wellbeing');
      if (d.mood && window.updateMood) window.updateMood(Number(d.mood), false);
      if (d.cycle) renderCycle(d.cycle); else { if($('#nextPeriod'))$('#nextPeriod').textContent='ثبت نشده'; if($('#cycleLength'))$('#cycleLength').textContent='—'; }
    }catch(_){ }
  }

  function dateISO(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function inRange(key, a, b){ return key >= a && key <= b; }
  function renderCycle(c){
    if ($('#nextPeriod')) $('#nextPeriod').textContent = c.days_until_next === 0 ? 'امروز' : `${fmt(c.days_until_next)} روز دیگه`;
    if ($('#cycleLength')) $('#cycleLength').textContent = `${fmt(c.cycle_length)} روز`;
    const cal=$('#calendar'); if(!cal)return;
    const now=new Date(), y=now.getFullYear(), m=now.getMonth(), days=new Date(y,m+1,0).getDate(), offset=(new Date(y,m,1).getDay()+1)%7;
    const weekdays=['ش','ی','د','س','چ','پ','ج']; let html=weekdays.map(x=>`<div class="cal-cell head">${x}</div>`).join('');
    for(let i=0;i<offset;i++)html+='<div class="cal-cell"></div>';
    for(let day=1;day<=days;day++){
      const d=new Date(y,m,day), key=dateISO(d), cls=[];
      if((c.ranges||[]).some(r=>inRange(key,r.period_start,r.period_end)))cls.push('period-day');
      if((c.ranges||[]).some(r=>inRange(key,r.fertile_start,r.fertile_end)))cls.push('fertile-day');
      if(key===dateISO(now))cls.push('today-day');
      html+=`<div class="cal-cell ${cls.join(' ')}">${fmt(day)}</div>`;
    }
    cal.innerHTML=html;
  }

  async function openCycleEditor(){
    let cycle=null; try{cycle=(await api('/api/wellbeing')).cycle;}catch(_){ }
    const today=dateISO(new Date());
    modal(`<p class="kicker">چرخه من</p><h2>تنظیم چرخه</h2><form id="vxCycleForm" class="modal-form">
      <label>شروع آخرین پریود<input type="date" name="last_period_date" max="${today}" required value="${esc(cycle?.last_period_date||'')}"></label>
      <label>طول معمول چرخه<input type="number" name="cycle_length" min="20" max="45" required value="${cycle?.cycle_length||28}"></label>
      <label>مدت معمول پریود<input type="number" name="period_length" min="1" max="10" required value="${cycle?.period_length||5}"></label>
      <p class="vx-help">روزهای باروری و پریود بعدی تخمینی‌ان و برای تصمیم پزشکی یا جلوگیری از بارداری مناسب نیستن.</p>
      <button class="primary-btn" type="submit">ذخیره چرخه</button></form>`);
    $('#vxCycleForm')?.addEventListener('submit', async e=>{
      e.preventDefault();const fd=new FormData(e.currentTarget),btn=$('button',e.currentTarget);btn.disabled=true;
      try{const d=await api('/api/cycle',{method:'POST',body:JSON.stringify({last_period_date:fd.get('last_period_date'),cycle_length:Number(fd.get('cycle_length')),period_length:Number(fd.get('period_length'))})});renderCycle(d.cycle);closeModal();toast('چرخه ذخیره شد ✓');}catch(x){toast(x.message);}finally{btn.disabled=false;}
    });
  }

  async function enableDeviceNotifications(button){
    if (!('Notification' in window)) return toast('مرورگرت اعلان دستگاه رو پشتیبانی نمی‌کنه.');
    const p=await Notification.requestPermission(); if(p==='granted'){button.textContent='اعلان دستگاه فعاله ✓';toast('اعلان دستگاه فعال شد.');}else toast('اجازه اعلان داده نشد.');
  }

  async function checkForegroundNotifications(){
    if (!token()) return;
    try{
      const d=await api('/api/notifications'), rows=d.notifications||[]; scheduleStats();
      if (!('Notification' in window) || Notification.permission!=='granted') return;
      const last=Number(localStorage.getItem('vestaland:last-notification')||0), fresh=rows.filter(x=>!x.is_read&&x.id>last).sort((a,b)=>a.id-b.id);
      if(fresh.length){const n=fresh[fresh.length-1];new Notification(n.title,{body:n.body,tag:`vestaland-${n.id}`});localStorage.setItem('vestaland:last-notification',String(n.id));}
    }catch(_){ }
  }

  function bindGlobalEvents(){
    document.addEventListener('click', e => {
      const publish=e.target.closest('[data-action="publish-post"]');
      if(publish){e.preventDefault();e.stopImmediatePropagation();publishPost();return;}
      const cycle=e.target.closest('[data-action="edit-cycle"]');
      if(cycle){e.preventDefault();e.stopImmediatePropagation();openCycleEditor();return;}
      const photo=e.target.closest('#photoButton'); if(photo){e.preventDefault();e.stopImmediatePropagation();pickPostPhotos();return;}
      const vx=e.target.closest('[data-vx]')?.dataset.vx;
      if(vx==='my-posts'){e.preventDefault();openMyPosts();return;}
      if(vx==='saved'){e.preventDefault();openSaved();return;}
      if(vx==='notifications'){e.preventDefault();openNotifications();return;}
      if(vx==='privacy'){e.preventDefault();openPrivacy();return;}
      if(vx==='rules'){e.preventDefault();openRules();return;}
      if(vx==='poll-draft'){e.preventDefault();openPollDraft();return;}
      if(vx==='poll-clear'){draftPoll=null;renderDraft();return;}
      if(vx==='read-all'){markAllRead();return;}
      if(vx==='delete-account'){deleteAccount();return;}
      if(vx==='device-notify'){enableDeviceNotifications(e.target.closest('button'));return;}
      const remove=e.target.closest('[data-vx-remove-photo]'); if(remove){draftMedia.splice(Number(remove.dataset.vxRemovePhoto),1);renderDraft();return;}
      const save=e.target.closest('[data-vx-bookmark]'); if(save){toggleBookmark(Number(save.dataset.vxBookmark),save);return;}
      const vote=e.target.closest('[data-vx-vote]'); if(vote){const [p,o]=vote.dataset.vxVote.split('|').map(Number);votePoll(p,o);return;}
      const del=e.target.closest('[data-vx-delete]'); if(del){deletePost(Number(del.dataset.vxDelete));return;}
      const delList=e.target.closest('[data-vx-delete-list]'); if(delList){deletePost(Number(delList.dataset.vxDeleteList),true);return;}
      const unsave=e.target.closest('[data-vx-unsave]'); if(unsave){toggleBookmark(Number(unsave.dataset.vxUnsave),unsave).then(openSaved);return;}
      const go=e.target.closest('[data-vx-goto]'); if(go){const [t,id]=go.dataset.vxGoto.split('|');gotoPost(t,Number(id));return;}
      const note=e.target.closest('[data-vx-notification]'); if(note){const [id,type,post]=note.dataset.vxNotification.split('|');api('/api/notifications/read',{method:'POST',body:JSON.stringify({id:Number(id)})}).catch(()=>{});scheduleStats();if(type&&post)gotoPost(type,Number(post));else note.classList.remove('unread');return;}
      const feed=e.target.closest('[data-feed]'); if(feed)setTimeout(updateComposerTools,0);
    }, true);
  }

  function start(){
    enhanceProfileMenu(); injectComposerTools(); bindGlobalEvents();
    const observer=new MutationObserver(()=>{enhanceProfileMenu();injectComposerTools();scheduleHydrate();});
    observer.observe(document.body,{subtree:true,childList:true});
    scheduleHydrate();refreshStats();hydrateProfile();hydrateWellbeing();checkForegroundNotifications();
    setInterval(checkForegroundNotifications, 60000);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
