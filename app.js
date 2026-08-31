const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const state = {
  onboardingDone: localStorage.getItem('vestaland:onboarding') === '1',
  token: localStorage.getItem('vestaland:token') || '',
  user: null,
  currentQuiz: 0,
  quizAnswers: [],
  feed: 'vent',
  view: 'hangout',
  mood: Number(localStorage.getItem('vestaland:mood') || 3),
  marketCategory: 'all',
  marketStore: 'all',
  subscription: localStorage.getItem('vestaland:plan') || 'trial',
  remotePosts: {vent:[], gossip:[], advice:[], challenge:[], flex:[]}
};

const quizzes = [
  {visual:'💬',q:'دوستت نصفه‌شب بگه «بیا بیرون»، اولین جوابت چیه؟',a:['الان؟ لباس چی بپوشم؟ 💅','اول بگو کجا و کیا هستن 👀','باشه، ولی پنج دقیقه صبر کن آماده شم 💄','بستگی داره حوصله‌م چقدر باشه 😌']},
  {visual:'🛍️',q:'برای یه خرید کوچیک رفتی بیرون. محتمل‌ترین پایان ماجرا؟',a:['فقط همون یه چیز رو می‌خرم، قول 😇','سه تا چیز اضافه ولی «لازم» می‌خرم','هیچی نمی‌خرم و فقط نگاه می‌کنم','یه چیز برای خودم، یه چیز برای دوستم']},
  {visual:'📱',q:'یه پیام دوپهلو گرفتی. اول چه کار می‌کنی؟',a:['اسکرین می‌گیرم برای مشورت','سه بار می‌خونمش و تحلیل می‌کنم','سین می‌کنم، بعداً جواب می‌دم','همون چیزی که فکر می‌کنم رو می‌گم']},
  {visual:'✨',q:'از بین اینا کدوم بیشتر شبیه یه حال خوب واقعیه؟',a:['یه روز بدون عجله','یه قرار خوب با آدم موردعلاقه‌م','خریدی که مدت‌ها می‌خواستم','اینکه حس کنم خودمم و لازم نیست نقش بازی کنم']}
];

const basePosts = {
  vent: [
    {name:'نرگس',avatar:'ن',time:'۲ ساعت پیش',text:'گاهی حس می‌کنم هیچ‌کس واقعاً حال منو نمی‌فهمه… فقط دلم می‌خواد یکی بدون سؤال اضافه گوش بده.',reactions:{'🤍':42,'🥺':29,'🫂':36,'💜':58}},
    {name:'مینا',avatar:'م',time:'۴ ساعت پیش',text:'دلم خیلی گرفته ولی نمی‌دونم چرا… انگار یه سنگینی توی قلبمه که ول نمی‌کنه.',reactions:{'🤍':31,'🥺':24,'🫂':32,'💜':45}},
    {name:'ناشناس',avatar:'؟',time:'۶ ساعت پیش',text:'امروز یه اتفاق کوچیک باعث شد یه عالمه اشکم بریزه. چرا بعضی وقتا انقدر جمع می‌شیم؟',reactions:{'🤍':26,'🥺':18,'🫂':28,'💜':36}}
  ],
  gossip: [
    {name:'دختر آبی',avatar:'د',time:'۱ ساعت پیش',text:'یه سؤال جدی: وقتی یکی همیشه استوری‌هاتو می‌بینه ولی هیچ‌وقت جواب نمی‌ده، فضولیه یا علاقه؟ 😐',reactions:{'😂':61,'👀':77,'🤔':34},comments:48},
    {name:'سارا',avatar:'س',time:'۳ ساعت پیش',text:'همکارم هر بار می‌گه «من اهل حاشیه نیستم» و دقیقاً بعدش یه حاشیه جدید تعریف می‌کنه :))',reactions:{'😂':92,'👀':54,'🔥':28},comments:72}
  ],
  advice: [
    {name:'مینا',avatar:'م',time:'۳ ساعت پیش',text:'برای تولد دوست صمیمیم کدوم استایل بهتره؟',media:['استایل A','استایل B'],poll:['A — 65٪','B — 35٪'],reactions:{'😍':78,'💜':26},comments:78},
    {name:'سارا',avatar:'س',time:'۵ ساعت پیش',text:'به پیامش چی جواب بدم که محترمانه باشه ولی زیادی گرم هم نباشه؟',media:['اسکرین پیام'],reactions:{'🤔':52,'💬':41},comments:52},
    {name:'نرگس',avatar:'ن',time:'۶ ساعت پیش',text:'فردا می‌خوام برم ترمیم. کدوم مدل ناخن قشنگ‌تره؟',media:['مدل A','مدل B'],poll:['A — 57٪','B — 43٪'],reactions:{'💅':63,'😍':41},comments:63}
  ],
  challenge: [
    {name:'یاسی',avatar:'ی',time:'۴۰ دقیقه پیش',text:'به خود ۱۸ سالم می‌گفتم لازم نیست برای دوست‌داشتنی بودن این‌همه توضیح بدی.',reactions:{'💜':91,'🫂':63,'✨':44}},
    {name:'رها',avatar:'ر',time:'۱ ساعت پیش',text:'می‌گفتم هر چیزی که الان فکر می‌کنی آخر دنیاست، دو سال دیگه حتی یادت نمیاد.',reactions:{'💜':72,'🫂':49,'✨':58}}
  ],
  flex: [
    {name:'سحر',avatar:'س',time:'۳ ساعت پیش',text:'بالاخره پروژه‌ای که دو ماه روش کار می‌کردم تأیید شد 😭✨ خیلی به خودم افتخار می‌کنم.',reactions:{'👏':88,'😍':55,'💖':71,'✨':46}},
    {name:'ترانه',avatar:'ت',time:'۵ ساعت پیش',text:'امروز برای اولین بار تنهایی رفتم یه کاری که همیشه ازش می‌ترسیدم و انجامش دادم 🥹',reactions:{'👏':73,'😍':39,'💖':62,'✨':42}}
  ]
};

const products = [
  {id:1,name:'سرم نیاسینامید ۱۰٪',store:'cutella',category:'skin',price:1790000,icon:'🧴'},
  {id:2,name:'ماسک لب شب',store:'cutella',category:'skin',price:6450000,icon:'🫙'},
  {id:3,name:'عطر زنانه',store:'vesta',category:'accessory',price:8190000,icon:'🧪'},
  {id:4,name:'سشوار حرفه‌ای',store:'vesta',category:'hair',price:24900000,icon:'💨'},
  {id:5,name:'رژ لب مات',store:'cutella',category:'makeup',price:2250000,icon:'💄'},
  {id:6,name:'لاک ژلی',store:'cutella',category:'nail',price:1290000,icon:'💅'},
  {id:7,name:'لوسیون بدن',store:'vesta',category:'body',price:2890000,icon:'🧴'},
  {id:8,name:'گوشواره مینیمال',store:'vesta',category:'accessory',price:3950000,icon:'✨'}
];

const feedMeta = {
  vent:{label:'درددل',title:'هرچی تو دلت هست بنویس…',anonymous:true},
  gossip:{label:'غیبت',title:'خب، چی شده؟ تعریف کن 👀',anonymous:true},
  advice:{label:'مشورت',title:'از دخترا مشورت بگیر',anonymous:false},
  challenge:{label:'چالش روزانه',title:'جوابت به چالش امروز چیه؟',anonymous:false},
  flex:{label:'پز',title:'یه اتفاق خوب داری؟ پز بده ✨',anonymous:false}
};

async function api(path, options={}){
  const headers = {'Content-Type':'application/json', ...(options.headers||{})};
  if(state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(path, {...options, headers});
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if(res.status === 401 && !['/api/login','/api/register'].includes(path)){
    state.token=''; state.user=null; localStorage.removeItem('vestaland:token');
  }
  if(!res.ok) throw new Error(data.error || 'یه خطا پیش اومد. دوباره امتحان کن.');
  return data;
}

async function init(){
  bindActions();
  buildCalendar();
  updateMood(state.mood, false);
  renderProducts();
  renderFeed();
  if(state.token){
    try{
      const data = await api('/api/me');
      state.user = data.user;
      state.subscription = data.user.plan || state.subscription;
      localStorage.setItem('vestaland:onboarding','1');
      state.onboardingDone = true;
      finalizeEntry(false);
      return;
    }catch(_){ /* session expired */ }
  }
  $('#onboarding').classList.remove('hidden');
  $('#mainApp').classList.add('hidden');
  if(state.onboardingDone) setTimeout(()=>showAuthModal('login'), 80);
}

function bindActions(){
  document.addEventListener('click', e => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if(action) handleAction(action);

    const feedBtn = e.target.closest('[data-feed]');
    if(feedBtn){
      state.feed = feedBtn.dataset.feed;
      $$('.segment').forEach(b=>b.classList.toggle('active', b===feedBtn));
      updateComposer(); renderFeed(); loadFeed();
    }

    const viewBtn = e.target.closest('[data-view]');
    if(viewBtn) switchView(viewBtn.dataset.view);

    const moodBtn = e.target.closest('[data-mood]');
    if(moodBtn) updateMood(Number(moodBtn.dataset.mood), true);

    const reactionBtn = e.target.closest('[data-reaction]');
    if(reactionBtn) toggleReaction(reactionBtn);

    const commentBtn = e.target.closest('[data-comments-post]');
    if(commentBtn) openComments(Number(commentBtn.dataset.commentsPost));

    const cat = e.target.closest('[data-category]');
    if(cat){ state.marketCategory=cat.dataset.category; $$('#marketCategories .category').forEach(b=>b.classList.toggle('active',b===cat)); renderProducts(); }

    const store = e.target.closest('[data-store]');
    if(store){ state.marketStore=store.dataset.store; $$('.store-switch button').forEach(b=>b.classList.toggle('active',b===store)); renderProducts(); }

    const addCart = e.target.closest('[data-product]');
    if(addCart) toast('به سبد خرید اضافه شد ✓');
  });

  $$('input[name="plan"]').forEach(r=>r.addEventListener('change',()=>{
    $$('.plan-row').forEach(row=>row.classList.toggle('selected',row.contains(r)&&r.checked));
    const cta=$('[data-action="enter-app"].primary-btn');
    if(r.checked) cta.textContent = r.value==='trial' ? 'شروع ۷ روز رایگان' : 'ادامه و ساخت حساب';
  }));
  $('#marketSearch').addEventListener('input', renderProducts);
}

function handleAction(action){
  const map={
    'start-quiz':startQuiz,
    'show-plans':showPlans,
    'enter-app':enterApp,
    'publish-post':publishPost,
    'answer-challenge':()=>{state.feed='challenge'; $$('.segment').forEach(b=>b.classList.toggle('active',b.dataset.feed==='challenge')); updateComposer(); renderFeed(); loadFeed(); $('#postText').focus();},
    'open-profile':()=>switchView('profile'),
    'show-subscription':openSubscription,
    'close-modal':closeModal,
    'edit-cycle':openCycleEditor,
    'logout':logout,
    'reset-demo':resetDemo
  };
  map[action]?.();
}

function startQuiz(){
  $('#quizIntro').classList.add('hidden'); $('#quizCard').classList.remove('hidden');
  state.currentQuiz=0; state.quizAnswers=[]; showQuestion();
}

function showQuestion(){
  const item=quizzes[state.currentQuiz];
  $('#quizCounter').textContent=`سؤال ${state.currentQuiz+1} از ${quizzes.length}`;
  $('#quizProgress').style.width=`${((state.currentQuiz+1)/quizzes.length)*100}%`;
  $('#questionVisual').textContent=item.visual; $('#quizQuestion').textContent=item.q;
  $('#quizOptions').innerHTML=item.a.map((x,i)=>`<button type="button" data-quiz-option="${i}">${x}</button>`).join('');
  $$('[data-quiz-option]').forEach(btn=>btn.addEventListener('click',()=>selectQuizAnswer(Number(btn.dataset.quizOption))));
}

function selectQuizAnswer(i){
  state.quizAnswers.push(i);
  if(state.currentQuiz<quizzes.length-1){state.currentQuiz++;showQuestion();}else showQuizResult();
}

function showQuizResult(){
  $('#quizCard').classList.add('hidden'); $('#quizResult').classList.remove('hidden');
  const variants=['نتیجه می‌گه احتمالاً قبل از جواب دادن، حداقل یه بار با خودت مشورت می‌کنی 😌','سیستم تشخیص داد برای دورهمی آماده‌ای. قضاوت کمتر، حرف واقعی بیشتر ✨','امتیازت خوبه؛ اجازه ورود صادر شد. فقط قانون درددل رو یادت نره: گوش بده، قضاوت نکن.'];
  $('#resultCopy').textContent=variants[state.quizAnswers.reduce((a,b)=>a+b,0)%variants.length];
}

function showPlans(){ $('#quizResult').classList.add('hidden'); $('#planCard').classList.remove('hidden'); }

function enterApp(){
  const plan=$('input[name="plan"]:checked')?.value||'trial';
  state.subscription=plan; localStorage.setItem('vestaland:plan',plan);
  if(state.user){ finalizeEntry(); return; }
  showAuthModal('register');
}

function showAuthModal(mode='register'){
  const isRegister=mode==='register';
  $('#modalContent').innerHTML=`
    <p class="eyebrow accent">${isRegister?'حساب وستالند':'خوش برگشتی'}</p>
    <h2>${isRegister?'یه اسم برای خودت انتخاب کن':'وارد حسابت شو'}</h2>
    <p class="lead">${isRegister?'اسم نمایشی می‌تونه مستعار باشه. نام کاربری فقط برای ورود به حسابته.':'همون نام کاربری و رمزی که ساختی رو وارد کن.'}</p>
    <form id="authForm" class="modal-form auth-form">
      ${isRegister?'<label>اسم نمایشی<input id="authDisplay" maxlength="32" autocomplete="nickname" placeholder="مثلاً نازی" required></label>':''}
      <label>نام کاربری<input id="authUsername" dir="ltr" minlength="3" maxlength="24" autocomplete="username" placeholder="nazi_73" required></label>
      <label>رمز عبور<input id="authPassword" dir="ltr" type="password" minlength="8" maxlength="128" autocomplete="${isRegister?'new-password':'current-password'}" placeholder="حداقل ۸ کاراکتر" required></label>
      <p id="authError" class="form-error hidden"></p>
      <button class="primary-btn" type="submit">${isRegister?'ساخت حساب و ورود':'ورود'}</button>
    </form>
    <button class="text-btn auth-switch" type="button" id="authSwitch">${isRegister?'قبلاً حساب ساختی؟ وارد شو':'حساب نداری؟ بساز'}</button>`;
  openModal();
  $('#authSwitch').addEventListener('click',()=>showAuthModal(isRegister?'login':'register'));
  $('#authForm').addEventListener('submit',e=>{e.preventDefault();submitAuth(isRegister?'register':'login');});
}

async function submitAuth(mode){
  const username=$('#authUsername').value.trim(); const password=$('#authPassword').value;
  const payload={username,password};
  if(mode==='register'){payload.display_name=$('#authDisplay').value.trim();payload.plan=state.subscription;}
  const error=$('#authError'); error.classList.add('hidden');
  const btn=$('#authForm button[type="submit"]'); btn.disabled=true; btn.textContent='یه لحظه…';
  try{
    const data=await api(`/api/${mode}`,{method:'POST',body:JSON.stringify(payload)});
    state.token=data.token; state.user=data.user; state.subscription=data.user.plan||state.subscription;
    localStorage.setItem('vestaland:token',state.token); localStorage.setItem('vestaland:onboarding','1'); localStorage.setItem('vestaland:plan',state.subscription);
    state.onboardingDone=true; closeModal(); finalizeEntry(); toast(mode==='register'?'حسابت ساخته شد؛ خوش اومدی 🤍':'خوش برگشتی 🤍');
  }catch(err){error.textContent=err.message;error.classList.remove('hidden');btn.disabled=false;btn.textContent=mode==='register'?'ساخت حساب و ورود':'ورود';}
}

function finalizeEntry(load=true){
  $('#onboarding').classList.add('hidden'); $('#mainApp').classList.remove('hidden');
  updateProfileStats(); updateIdentity();
  if(load) loadFeed(); else loadFeed();
}

function updateIdentity(){
  const name=state.user?.display_name||'دختر وستالند'; const avatar=name.slice(0,1)||'و';
  const headerAvatar=$('.avatar-btn span'); if(headerAvatar) headerAvatar.textContent=avatar;
  const profileAvatar=$('.profile-avatar'); if(profileAvatar) profileAvatar.textContent=avatar;
  const profileName=$('.profile-card h2'); if(profileName) profileName.textContent=name;
  const profileSub=$('.profile-card .muted'); if(profileSub) profileSub.textContent=state.user?`@${state.user.username}`:'عضو جدید دورهمی';
}

function updateComposer(){
  const meta=feedMeta[state.feed];
  $('#composerLabel').textContent=meta.label; $('#composerTitle').textContent=meta.title;
  $('#anonymousWrap').classList.toggle('hidden',!meta.anonymous); $('#dailyChallenge').classList.toggle('hidden',state.feed!=='challenge'); $('#photoButton').classList.toggle('hidden',state.feed==='vent');
}

async function loadFeed(){
  if(!state.user){renderFeed();return;}
  const feed=state.feed;
  $('#feed').classList.add('loading-feed');
  try{
    const data=await api(`/api/posts?type=${encodeURIComponent(feed)}`);
    state.remotePosts[feed]=(data.posts||[]).map(p=>({...p,remote:true,time:relativeTime(p.created_at)}));
    if(state.feed===feed) renderFeed();
    updateProfileStats();
  }catch(err){ if(state.feed===feed) toast(err.message); }
  finally{$('#feed').classList.remove('loading-feed');}
}

function renderFeed(){
  updateComposer();
  const posts=[...(state.remotePosts[state.feed]||[]),...(basePosts[state.feed]||[])];
  $('#feed').innerHTML=posts.map((p,idx)=>postTemplate(p,idx)).join('');
}

function postTemplate(p,idx){
  const media=p.media?.length?`<div class="post-media">${p.media.map(x=>`<div class="photo-placeholder">${escapeHtml(x)}</div>`).join('')}</div>`:'';
  const poll=p.poll?.length?`<div class="poll-bars">${p.poll.map(x=>`<span class="soft-note" style="display:block;margin:6px 0">${escapeHtml(x)}</span>`).join('')}</div>`:'';
  const merged={...defaultReactions(state.feed),...(p.reactions||{})};
  const my=new Set(p.my_reactions||[]);
  const reactions=Object.entries(merged).map(([emoji,count])=>`<button class="reaction-btn ${my.has(emoji)?'active':''}" data-reaction="${p.remote?'r':'s'}|${p.remote?p.id:idx}|${emoji}">${emoji} <span>${count}</span></button>`).join('');
  let comments='';
  if(state.feed!=='vent'&&state.feed!=='flex'){
    comments=p.remote?`<button class="comment-summary comment-button" data-comments-post="${p.id}">${p.comments||0} نظر</button>`:`<span class="comment-summary">${p.comments||0} نظر</span>`;
  }
  const mine=p.is_mine?'<span class="mine-badge">پست من</span>':'';
  return `<article class="post-card">
    <div class="post-head"><div class="post-user"><div class="mini-avatar">${escapeHtml(p.avatar||'و')}</div><div class="post-meta"><b>${escapeHtml(p.name||'دختر وستالند')}</b><small>${escapeHtml(p.time||'همین الان')}</small></div></div><span class="post-tag">${feedMeta[state.feed].label}</span></div>
    <div class="post-body">${escapeHtml(p.text||'')}</div>${media}${poll}
    <div class="reaction-row">${reactions}${comments}${mine}</div>
  </article>`;
}

function defaultReactions(type){
  if(type==='vent') return {'🤍':0,'🥺':0,'🫂':0,'💜':0};
  if(type==='gossip') return {'😂':0,'👀':0,'🤔':0,'🔥':0};
  if(type==='advice') return {'😍':0,'💜':0,'✨':0,'💅':0,'🤔':0};
  if(type==='challenge') return {'💜':0,'🫂':0,'✨':0};
  if(type==='flex') return {'👏':0,'😍':0,'💖':0,'✨':0};
  return {'💜':0};
}

async function publishPost(){
  if(!state.user){showAuthModal('login');return;}
  const text=$('#postText').value.trim(); if(!text){toast('اول یه چیزی بنویس :)');return;}
  const anonymous=$('#anonymousToggle').checked&&feedMeta[state.feed].anonymous;
  const btn=$('[data-action="publish-post"]'); btn.disabled=true;
  try{
    const data=await api('/api/posts',{method:'POST',body:JSON.stringify({type:state.feed,text,anonymous})});
    state.remotePosts[state.feed].unshift({...data.post,remote:true,time:'همین الان'});
    $('#postText').value=''; $('#anonymousToggle').checked=false; renderFeed(); updateProfileStats(); toast('پستت برای همه منتشر شد ✓');
  }catch(err){toast(err.message);}finally{btn.disabled=false;}
}

async function toggleReaction(btn){
  const [kind,id,emoji]=btn.dataset.reaction.split('|'); const span=$('span',btn);
  if(kind==='s'){
    const active=btn.classList.toggle('active'); span.textContent=Number(span.textContent)+(active?1:-1); return;
  }
  if(!state.user){showAuthModal('login');return;}
  btn.disabled=true;
  try{
    const data=await api(`/api/posts/${id}/react`,{method:'POST',body:JSON.stringify({emoji})});
    btn.classList.toggle('active',data.active); span.textContent=data.count;
    const post=state.remotePosts[state.feed].find(p=>String(p.id)===String(id));
    if(post){post.reactions[emoji]=data.count;post.my_reactions=data.active?[...new Set([...(post.my_reactions||[]),emoji])]:(post.my_reactions||[]).filter(x=>x!==emoji);}
  }catch(err){toast(err.message);}finally{btn.disabled=false;}
}

async function openComments(postId){
  $('#modalContent').innerHTML='<p class="eyebrow accent">گفت‌وگو</p><h2>نظرها</h2><p class="muted">دارم میارمشون…</p>'; openModal();
  try{
    const data=await api(`/api/posts/${postId}/comments`);
    renderCommentsModal(postId,data.comments||[]);
  }catch(err){$('#modalContent').innerHTML=`<h2>نظرها</h2><p class="form-error">${escapeHtml(err.message)}</p>`;}
}

function renderCommentsModal(postId,comments){
  const list=comments.length?comments.map(c=>`<div class="comment-item"><span class="mini-avatar">${escapeHtml(c.avatar||'و')}</span><div><b>${escapeHtml(c.name||'دختر وستالند')}</b><p>${escapeHtml(c.text)}</p><small>${escapeHtml(relativeTime(c.created_at))}</small></div></div>`).join(''):'<p class="muted empty-comments">هنوز کسی چیزی نگفته. اولین نفر باش :)</p>';
  $('#modalContent').innerHTML=`<p class="eyebrow accent">گفت‌وگو</p><h2>نظرها</h2><div class="comments-list">${list}</div><form id="commentForm" class="comment-form"><input id="commentText" maxlength="1000" placeholder="نظرت رو بنویس…" required><button class="primary-btn compact">ارسال</button></form><p id="commentError" class="form-error hidden"></p>`;
  $('#commentForm').addEventListener('submit',async e=>{
    e.preventDefault(); const text=$('#commentText').value.trim(); if(!text)return;
    const btn=$('#commentForm button'); btn.disabled=true;
    try{
      await api(`/api/posts/${postId}/comments`,{method:'POST',body:JSON.stringify({text})});
      const post=state.remotePosts[state.feed].find(p=>p.id===postId); if(post)post.comments=(post.comments||0)+1;
      renderFeed(); await openComments(postId);
    }catch(err){$('#commentError').textContent=err.message;$('#commentError').classList.remove('hidden');btn.disabled=false;}
  });
}

function switchView(view){
  state.view=view; $$('.view').forEach(v=>v.classList.remove('active-view')); $(`#${view}View`)?.classList.add('active-view'); $$('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  const titles={hangout:['سلام دختر','خوش اومدی به دنیای خودمون'],self:['خودم','اینجا فقط برای خودته'],market:['بازار','از وستا و کیوتلا'],profile:['پروفایل','تنظیمات و عضویت']};
  $('#sectionTitle').textContent=titles[view][0]; $('#sectionSubtitle').textContent=titles[view][1]; window.scrollTo({top:0,behavior:'smooth'});
}

function updateMood(mood,persist){
  state.mood=mood;
  const names={1:'داغونم',2:'یکم خرابم',3:'معمولی',4:'خوبم',5:'عالی‌ام'};
  const tips={1:'امروز فقط از خودت انتظار حداقل‌ها رو داشته باش. آب، غذا، استراحت؛ همین.',2:'یه کار کوچیک انتخاب کن که فشار امروز رو کمتر کنه، نه اینکه همه‌چیز رو حل کنه.',3:'امروز لازم نیست فوق‌العاده باشی؛ یه کار کوچیک برای خودت کافیه.',4:'حالت خوبه؛ یه تیک کوچیک از کاری که عقب انداختی می‌تونه روزتو بهتر هم بکنه.',5:'این انرژی رو برای یه چیز دوست‌داشتنی خرج کن؛ حتی یه کار خیلی کوچیک ✨'};
  $$('#moodOptions button').forEach(b=>b.classList.toggle('selected',Number(b.dataset.mood)===mood)); $('#plant').className=`plant mood-${mood}`; $('#moodTip').textContent=tips[mood]; $('#savedMood').textContent=names[mood];
  if(persist){localStorage.setItem('vestaland:mood',String(mood)); if(state.user)api('/api/mood',{method:'POST',body:JSON.stringify({mood})}).catch(()=>{}); toast('حال امروزت ثبت شد 🤍');}
}

function buildCalendar(){
  const weekdays=['ش','ی','د','س','چ','پ','ج']; let html=weekdays.map(d=>`<div class="cal-cell head">${d}</div>`).join('');
  for(let i=1;i<=35;i++){const day=i<=31?i:'';const cls=[];if([10,11,12,13,14].includes(i))cls.push('period-day');if([19,20,21,22,23,24].includes(i))cls.push('fertile-day');if(i===26)cls.push('today-day');html+=`<div class="cal-cell ${cls.join(' ')}">${day}</div>`;}
  $('#calendar').innerHTML=html;
}

function renderProducts(){
  const q=$('#marketSearch').value.trim().toLowerCase(); const list=products.filter(p=>(state.marketCategory==='all'||p.category===state.marketCategory)&&(state.marketStore==='all'||p.store===state.marketStore)&&(!q||p.name.toLowerCase().includes(q)));
  $('#productGrid').innerHTML=list.length?list.map(p=>`<article class="product-card"><div class="product-image">${p.icon}</div><div class="product-info"><small>${p.store==='cutella'?'کیوتلا':'وستا'}</small><h3>${p.name}</h3><div class="product-price">${formatPrice(p.price)} تومان</div><button data-product="${p.id}">افزودن به سبد</button></div></article>`).join(''):'<p class="muted">محصولی پیدا نشد.</p>';
}
function formatPrice(n){return new Intl.NumberFormat('fa-IR').format(n)}

function updateProfileStats(){
  const seen=new Map(); Object.values(state.remotePosts).flat().forEach(p=>{if(p.remote)seen.set(p.id,p);});
  $('#myPostCount').textContent=String([...seen.values()].filter(p=>p.is_mine).length);
  const labels={trial:'۷ روز آزمایشی','1m':'۱ ماهه','3m':'۳ ماهه','6m':'۶ ماهه'}; $('#subscriptionStatus').textContent=labels[state.subscription]||labels.trial;
}

function openSubscription(){
  const prices=[['۷ روز آزمایشی','رایگان','trial'],['۱ ماهه','۳۴۹٬۰۰۰ تومان','1m'],['۳ ماهه','۸۹۹٬۰۰۰ تومان','3m'],['۶ ماهه','۱٬۵۹۰٬۰۰۰ تومان','6m']];
  $('#modalContent').innerHTML=`<p class="eyebrow accent">VIP</p><h2>اشتراک وستالند</h2><p class="lead">انتخاب پلن فعلاً آزمایشی است؛ اتصال پرداخت در مرحله بعد فعال می‌شود.</p><div class="plan-list">${prices.map(([n,p,v])=>`<button class="plan-row ${state.subscription===v?'selected':''}" data-modal-plan="${v}" style="width:100%;text-align:right"><span><b>${n}</b><small>${v==='trial'?'شروع بدون پرداخت':'پرداخت هنوز فعال نیست'}</small></span><strong>${p}</strong></button>`).join('')}</div>`; openModal();
  $$('[data-modal-plan]').forEach(b=>b.addEventListener('click',()=>{state.subscription=b.dataset.modalPlan;localStorage.setItem('vestaland:plan',state.subscription);updateProfileStats();closeModal();toast('پلن برای دمو انتخاب شد ✓')}));
}

function openCycleEditor(){
  $('#modalContent').innerHTML=`<p class="eyebrow accent">چرخه پریودی</p><h2>تنظیم چرخه</h2><div class="modal-form"><label>طول معمول چرخه<input id="cycleInput" type="number" min="20" max="45" value="28"></label><label>چند روز تا پریود بعدی؟<input id="periodInput" type="number" min="0" max="45" value="5"></label><button class="primary-btn" id="saveCycle">ذخیره</button></div>`; openModal();
  $('#saveCycle').addEventListener('click',()=>{const cycle=$('#cycleInput').value||28;const next=$('#periodInput').value||5;$('#cycleLength').textContent=`${cycle} روز`;$('#nextPeriod').textContent=`${next} روز دیگه`;closeModal();toast('چرخه ذخیره شد ✓')});
}

async function logout(){
  try{await api('/api/logout',{method:'POST',body:'{}'});}catch(_){}
  state.token='';state.user=null;localStorage.removeItem('vestaland:token'); closeModal(); location.reload();
}

function openModal(){ $('#modal').classList.remove('hidden'); document.body.style.overflow='hidden'; }
function closeModal(){ $('#modal').classList.add('hidden'); document.body.style.overflow=''; }
function toast(text){const el=$('#toast');el.textContent=text;el.classList.remove('hidden');clearTimeout(window.__toast);window.__toast=setTimeout(()=>el.classList.add('hidden'),2400);}
function resetDemo(){if(!confirm('دمو از اول شروع بشه؟ ورود و تنظیمات این دستگاه پاک می‌شن، ولی پست‌های منتشرشده روی سرور باقی می‌مونن.'))return;Object.keys(localStorage).filter(k=>k.startsWith('vestaland:')).forEach(k=>localStorage.removeItem(k));location.reload();}
function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))}
function relativeTime(value){
  if(!value)return 'همین الان'; const d=new Date(value); if(Number.isNaN(d.getTime()))return 'همین الان'; const sec=Math.max(0,Math.floor((Date.now()-d.getTime())/1000));
  if(sec<60)return 'همین الان'; const min=Math.floor(sec/60); if(min<60)return `${new Intl.NumberFormat('fa-IR').format(min)} دقیقه پیش`; const hr=Math.floor(min/60); if(hr<24)return `${new Intl.NumberFormat('fa-IR').format(hr)} ساعت پیش`; const day=Math.floor(hr/24);return `${new Intl.NumberFormat('fa-IR').format(day)} روز پیش`;
}

if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));}
document.addEventListener('DOMContentLoaded',init);
