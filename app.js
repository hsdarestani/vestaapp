const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const state = {
  onboardingDone: localStorage.getItem('vestaland:onboarding') === '1',
  currentQuiz: 0,
  quizAnswers: [],
  feed: 'vent',
  view: 'hangout',
  mood: Number(localStorage.getItem('vestaland:mood') || 3),
  marketCategory: 'all',
  marketStore: 'all',
  myPosts: JSON.parse(localStorage.getItem('vestaland:posts') || '[]'),
  subscription: localStorage.getItem('vestaland:plan') || 'trial'
};

const quizzes = [
  {
    visual: '💬',
    q: 'دوستت نصفه‌شب بگه «بیا بیرون»، اولین جوابت چیه؟',
    a: ['الان؟ لباس چی بپوشم؟ 💅', 'اول بگو کجا و کیا هستن 👀', 'باشه، ولی پنج دقیقه صبر کن آماده شم 💄', 'بستگی داره حوصله‌م چقدر باشه 😌']
  },
  {
    visual: '🛍️',
    q: 'برای یه خرید کوچیک رفتی بیرون. محتمل‌ترین پایان ماجرا؟',
    a: ['فقط همون یه چیز رو می‌خرم، قول 😇', 'سه تا چیز اضافه ولی «لازم» می‌خرم', 'هیچی نمی‌خرم و فقط نگاه می‌کنم', 'یه چیز برای خودم، یه چیز برای دوستم']
  },
  {
    visual: '📱',
    q: 'یه پیام دوپهلو گرفتی. اول چه کار می‌کنی؟',
    a: ['اسکرین می‌گیرم برای مشورت', 'سه بار می‌خونمش و تحلیل می‌کنم', 'سین می‌کنم، بعداً جواب می‌دم', 'همون چیزی که فکر می‌کنم رو می‌گم']
  },
  {
    visual: '✨',
    q: 'از بین اینا کدوم بیشتر شبیه یه حال خوب واقعیه؟',
    a: ['یه روز بدون عجله', 'یه قرار خوب با آدم موردعلاقه‌م', 'خریدی که مدت‌ها می‌خواستم', 'اینکه حس کنم خودمم و لازم نیست نقش بازی کنم']
  }
];

const basePosts = {
  vent: [
    {name:'نرگس', avatar:'ن', time:'۲ ساعت پیش', text:'گاهی حس می‌کنم هیچ‌کس واقعاً حال منو نمی‌فهمه… فقط دلم می‌خواد یکی بدون سؤال اضافه گوش بده.', reactions:{'🤍':42,'🥺':29,'🫂':36,'💜':58}},
    {name:'مینا', avatar:'م', time:'۴ ساعت پیش', text:'دلم خیلی گرفته ولی نمی‌دونم چرا… انگار یه سنگینی توی قلبمه که ول نمی‌کنه.', reactions:{'🤍':31,'🥺':24,'🫂':32,'💜':45}},
    {name:'ناشناس', avatar:'؟', time:'۶ ساعت پیش', text:'امروز یه اتفاق کوچیک باعث شد یه عالمه اشکم بریزه. چرا بعضی وقتا انقدر جمع می‌شیم؟', reactions:{'🤍':26,'🥺':18,'🫂':28,'💜':36}}
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

function init(){
  bindActions();
  buildCalendar();
  updateMood(state.mood, false);
  renderFeed();
  renderProducts();
  updateProfileStats();
  if(state.onboardingDone){
    $('#onboarding').classList.add('hidden');
    $('#mainApp').classList.remove('hidden');
  }
}

function bindActions(){
  document.addEventListener('click', e => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if(action) handleAction(action, e.target.closest('[data-action]'));

    const feedBtn = e.target.closest('[data-feed]');
    if(feedBtn){ state.feed = feedBtn.dataset.feed; $$('.segment').forEach(b=>b.classList.toggle('active', b===feedBtn)); updateComposer(); renderFeed(); }

    const viewBtn = e.target.closest('[data-view]');
    if(viewBtn) switchView(viewBtn.dataset.view);

    const moodBtn = e.target.closest('[data-mood]');
    if(moodBtn) updateMood(Number(moodBtn.dataset.mood), true);

    const reactionBtn = e.target.closest('[data-reaction]');
    if(reactionBtn) toggleReaction(reactionBtn);

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
    if(r.checked) cta.textContent = r.value==='trial' ? 'شروع ۷ روز رایگان' : 'انتخاب این اشتراک';
  }));

  $('#marketSearch').addEventListener('input', renderProducts);
}

function handleAction(action){
  const map={
    'start-quiz':startQuiz,
    'show-plans':showPlans,
    'enter-app':enterApp,
    'publish-post':publishPost,
    'answer-challenge':()=>{state.feed='challenge'; $$('.segment').forEach(b=>b.classList.toggle('active',b.dataset.feed==='challenge')); updateComposer(); renderFeed(); $('#postText').focus();},
    'open-profile':()=>switchView('profile'),
    'show-subscription':openSubscription,
    'close-modal':closeModal,
    'edit-cycle':openCycleEditor,
    'reset-demo':resetDemo
  };
  map[action]?.();
}

function startQuiz(){
  $('#quizIntro').classList.add('hidden');
  $('#quizCard').classList.remove('hidden');
  state.currentQuiz=0; state.quizAnswers=[]; showQuestion();
}

function showQuestion(){
  const item=quizzes[state.currentQuiz];
  $('#quizCounter').textContent=`سؤال ${state.currentQuiz+1} از ${quizzes.length}`;
  $('#quizProgress').style.width=`${((state.currentQuiz+1)/quizzes.length)*100}%`;
  $('#questionVisual').textContent=item.visual;
  $('#quizQuestion').textContent=item.q;
  $('#quizOptions').innerHTML=item.a.map((x,i)=>`<button type="button" data-quiz-option="${i}">${x}</button>`).join('');
  $$('[data-quiz-option]').forEach(btn=>btn.addEventListener('click',()=>selectQuizAnswer(Number(btn.dataset.quizOption))));
}

function selectQuizAnswer(i){
  state.quizAnswers.push(i);
  if(state.currentQuiz<quizzes.length-1){ state.currentQuiz++; showQuestion(); }
  else showQuizResult();
}

function showQuizResult(){
  $('#quizCard').classList.add('hidden');
  $('#quizResult').classList.remove('hidden');
  const variants=[
    'نتیجه می‌گه احتمالاً قبل از جواب دادن، حداقل یه بار با خودت مشورت می‌کنی 😌',
    'سیستم تشخیص داد برای دورهمی آماده‌ای. قضاوت کمتر، حرف واقعی بیشتر ✨',
    'امتیازت خوبه؛ اجازه ورود صادر شد. فقط قانون درددل رو یادت نره: گوش بده، قضاوت نکن.'
  ];
  $('#resultCopy').textContent=variants[state.quizAnswers.reduce((a,b)=>a+b,0)%variants.length];
}

function showPlans(){ $('#quizResult').classList.add('hidden'); $('#planCard').classList.remove('hidden'); }

function enterApp(){
  const plan=$('input[name="plan"]:checked')?.value||'trial';
  localStorage.setItem('vestaland:onboarding','1');
  localStorage.setItem('vestaland:plan',plan);
  state.subscription=plan; state.onboardingDone=true;
  $('#onboarding').classList.add('hidden'); $('#mainApp').classList.remove('hidden');
  updateProfileStats(); toast('خوش اومدی به وستالند 🤍');
}

function updateComposer(){
  const meta=feedMeta[state.feed];
  $('#composerLabel').textContent=meta.label;
  $('#composerTitle').textContent=meta.title;
  $('#anonymousWrap').classList.toggle('hidden',!meta.anonymous);
  $('#dailyChallenge').classList.toggle('hidden',state.feed!=='challenge');
  $('#photoButton').classList.toggle('hidden',state.feed==='vent');
}

function renderFeed(){
  updateComposer();
  const own=state.myPosts.filter(p=>p.type===state.feed);
  const posts=[...own,...(basePosts[state.feed]||[])];
  $('#feed').innerHTML=posts.map((p,idx)=>postTemplate(p,idx)).join('');
}

function postTemplate(p,idx){
  const media=p.media?.length?`<div class="post-media">${p.media.map(x=>`<div class="photo-placeholder">${x}</div>`).join('')}</div>`:'';
  const poll=p.poll?.length?`<div class="poll-bars">${p.poll.map(x=>`<span class="soft-note" style="display:block;margin:6px 0">${x}</span>`).join('')}</div>`:'';
  const reactions=Object.entries(p.reactions||defaultReactions(state.feed)).map(([emoji,count])=>`<button class="reaction-btn" data-reaction="${idx}-${emoji}">${emoji} <span>${count}</span></button>`).join('');
  const comments=(state.feed==='vent'||state.feed==='flex')?'':`<span class="comment-summary">${p.comments||0} نظر</span>`;
  return `<article class="post-card">
    <div class="post-head"><div class="post-user"><div class="mini-avatar">${p.avatar||'و'}</div><div class="post-meta"><b>${p.name||'دختر وستالند'}</b><small>${p.time||'همین الان'}</small></div></div><span class="post-tag">${feedMeta[state.feed].label}</span></div>
    <div class="post-body">${escapeHtml(p.text)}</div>${media}${poll}
    <div class="reaction-row">${reactions}${comments}</div>
  </article>`;
}

function defaultReactions(type){
  if(type==='vent') return {'🤍':0,'🥺':0,'🫂':0,'💜':0};
  if(type==='flex') return {'👏':0,'😍':0,'💖':0,'✨':0};
  return {'😍':0,'💜':0,'✨':0};
}

function publishPost(){
  const text=$('#postText').value.trim();
  if(!text){ toast('اول یه چیزی بنویس :)'); return; }
  const anonymous=$('#anonymousToggle').checked && feedMeta[state.feed].anonymous;
  const p={type:state.feed,name:anonymous?'ناشناس':'من',avatar:anonymous?'؟':'و',time:'همین الان',text,reactions:defaultReactions(state.feed),comments:0};
  state.myPosts.unshift(p); localStorage.setItem('vestaland:posts',JSON.stringify(state.myPosts));
  $('#postText').value=''; $('#anonymousToggle').checked=false; renderFeed(); updateProfileStats(); toast('پستت منتشر شد ✓');
}

function toggleReaction(btn){
  const span=$('span',btn); const active=btn.classList.toggle('active');
  span.textContent=Number(span.textContent)+(active?1:-1);
}

function switchView(view){
  state.view=view;
  $$('.view').forEach(v=>v.classList.remove('active-view'));
  $(`#${view}View`)?.classList.add('active-view');
  $$('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  const titles={hangout:['سلام دختر','خوش اومدی به دنیای خودمون'],self:['خودم','اینجا فقط برای خودته'],market:['بازار','از وستا و کیوتلا'],profile:['پروفایل','تنظیمات و عضویت']};
  $('#sectionTitle').textContent=titles[view][0]; $('#sectionSubtitle').textContent=titles[view][1];
  window.scrollTo({top:0,behavior:'smooth'});
}

function updateMood(mood,persist){
  state.mood=mood;
  const names={1:'داغونم',2:'یکم خرابم',3:'معمولی',4:'خوبم',5:'عالی‌ام'};
  const tips={1:'امروز فقط از خودت انتظار حداقل‌ها رو داشته باش. آب، غذا، استراحت؛ همین.',2:'یه کار کوچیک انتخاب کن که فشار امروز رو کمتر کنه، نه اینکه همه‌چیز رو حل کنه.',3:'امروز لازم نیست فوق‌العاده باشی؛ یه کار کوچیک برای خودت کافیه.',4:'حالت خوبه؛ یه تیک کوچیک از کاری که عقب انداختی می‌تونه روزتو بهتر هم بکنه.',5:'این انرژی رو برای یه چیز دوست‌داشتنی خرج کن؛ حتی یه کار خیلی کوچیک ✨'};
  $$('#moodOptions button').forEach(b=>b.classList.toggle('selected',Number(b.dataset.mood)===mood));
  $('#plant').className=`plant mood-${mood}`; $('#moodTip').textContent=tips[mood]; $('#savedMood').textContent=names[mood];
  if(persist){localStorage.setItem('vestaland:mood',String(mood));toast('حال امروزت ثبت شد 🤍');}
}

function buildCalendar(){
  const weekdays=['ش','ی','د','س','چ','پ','ج'];
  let html=weekdays.map(d=>`<div class="cal-cell head">${d}</div>`).join('');
  for(let i=1;i<=35;i++){
    const day=i<=31?i:''; const cls=[];
    if([10,11,12,13,14].includes(i)) cls.push('period-day');
    if([19,20,21,22,23,24].includes(i)) cls.push('fertile-day');
    if(i===26) cls.push('today-day');
    html+=`<div class="cal-cell ${cls.join(' ')}">${day}</div>`;
  }
  $('#calendar').innerHTML=html;
}

function renderProducts(){
  const q=$('#marketSearch').value.trim().toLowerCase();
  const list=products.filter(p=>(state.marketCategory==='all'||p.category===state.marketCategory)&&(state.marketStore==='all'||p.store===state.marketStore)&&(!q||p.name.toLowerCase().includes(q)));
  $('#productGrid').innerHTML=list.length?list.map(p=>`<article class="product-card"><div class="product-image">${p.icon}</div><div class="product-info"><small>${p.store==='cutella'?'کیوتلا':'وستا'}</small><h3>${p.name}</h3><div class="product-price">${formatPrice(p.price)} تومان</div><button data-product="${p.id}">افزودن به سبد</button></div></article>`).join(''):'<p class="muted">محصولی پیدا نشد.</p>';
}

function formatPrice(n){return new Intl.NumberFormat('fa-IR').format(n)}

function updateProfileStats(){
  $('#myPostCount').textContent=String(state.myPosts.length);
  const labels={trial:'۷ روز آزمایشی','1m':'۱ ماهه','3m':'۳ ماهه','6m':'۶ ماهه'};
  $('#subscriptionStatus').textContent=labels[state.subscription]||labels.trial;
}

function openSubscription(){
  const prices=[['۷ روز آزمایشی','رایگان','trial'],['۱ ماهه','۳۴۹٬۰۰۰ تومان','1m'],['۳ ماهه','۸۹۹٬۰۰۰ تومان','3m'],['۶ ماهه','۱٬۵۹۰٬۰۰۰ تومان','6m']];
  $('#modalContent').innerHTML=`<p class="eyebrow accent">VIP</p><h2>اشتراک وستالند</h2><p class="lead">به امکانات کامل خودم، قابلیت‌های بیشتر دورهمی و تخفیف‌های بازار دسترسی داشته باش.</p><div class="plan-list">${prices.map(([n,p,v])=>`<button class="plan-row ${state.subscription===v?'selected':''}" data-modal-plan="${v}" style="width:100%;text-align:right"><span><b>${n}</b><small>${v==='trial'?'شروع بدون پرداخت':'تمدید از داخل حساب'}</small></span><strong>${p}</strong></button>`).join('')}</div>`;
  openModal();
  $$('[data-modal-plan]').forEach(b=>b.addEventListener('click',()=>{state.subscription=b.dataset.modalPlan;localStorage.setItem('vestaland:plan',state.subscription);updateProfileStats();closeModal();toast('اشتراک انتخاب شد ✓')}));
}

function openCycleEditor(){
  $('#modalContent').innerHTML=`<p class="eyebrow accent">چرخه پریودی</p><h2>تنظیم چرخه</h2><div class="modal-form"><label>طول معمول چرخه<input id="cycleInput" type="number" min="20" max="45" value="28"></label><label>چند روز تا پریود بعدی؟<input id="periodInput" type="number" min="0" max="45" value="5"></label><button class="primary-btn" id="saveCycle">ذخیره</button></div>`;
  openModal();
  $('#saveCycle').addEventListener('click',()=>{const cycle=$('#cycleInput').value||28;const next=$('#periodInput').value||5;$('#cycleLength').textContent=`${cycle} روز`;$('#nextPeriod').textContent=`${next} روز دیگه`;closeModal();toast('چرخه ذخیره شد ✓')});
}

function openModal(){ $('#modal').classList.remove('hidden'); document.body.style.overflow='hidden'; }
function closeModal(){ $('#modal').classList.add('hidden'); document.body.style.overflow=''; }
function toast(text){ const el=$('#toast'); el.textContent=text; el.classList.remove('hidden'); clearTimeout(window.__toast); window.__toast=setTimeout(()=>el.classList.add('hidden'),2200); }
function resetDemo(){ if(!confirm('دمو از اول شروع بشه؟ اطلاعات محلی پاک می‌شن.')) return; Object.keys(localStorage).filter(k=>k.startsWith('vestaland:')).forEach(k=>localStorage.removeItem(k)); location.reload(); }
function escapeHtml(value){return value.replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))}

if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{})); }
document.addEventListener('DOMContentLoaded',init);
