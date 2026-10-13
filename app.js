'use strict';
(function(){
const $=(s,r=document)=>r.querySelector(s);
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const clothes=[['top','بالاپوش','👚'],['bottom','شلوار و دامن','👖'],['dress','پیراهن و مانتو','👗'],['outer','کت و رویه','🧥'],['shoes','کفش','👟'],['bag','کیف','👜'],['jewel','اکسسوری','💍'],['other','سایر','🎀']];
const beauty=[['makeup','آرایشی','💄'],['skincare','مراقبت پوست','🧴'],['hair','مو','🪮'],['fragrance','عطر','🌸'],['tools','ابزار زیبایی','🪞'],['other','سایر','🎀']];
const colors={pink:['صورتی','#f4a0bd'],white:['سفید','#f6f4f5'],black:['مشکی','#3b3640'],cream:['کرم','#dfcaaa'],blue:['آبی','#9fc5e9'],green:['سبز','#b6d3b5'],red:['قرمز','#cf6572'],brown:['قهوه‌ای','#a27e68'],purple:['یاسی','#c8b0e7'],other:['متفرقه','#d5c3cc']};
const shopHosts={'vesta':'vesta-cosmetics.ir','cutella':'cutellashop.ir'};
let dbName='vestaland-personal-v1';
let db=null,photoUrls=[],pendingImage=null,marketSeq=0,toastTimeout=0;
const state={route:'home',items:[],type:'closet',filter:'all',store:'all',query:'',products:[],marketError:'',look:null};
let profileStoreKey='vestaland-style-profile-v1';
const styleChoices=[['casual','روزمره','☁️'],['minimal','مینیمال','🤍'],['girly','فانتزی','🎀'],['sport','اسپرت','👟'],['chic','شیک و رسمی','✨']];
const avatarChoices=['🎀','🐰','🌷','🧸','🦋','💗'];
const skinChoices=[['unknown','انتخاب نکردم'],['normal','معمولی'],['dry','خشک'],['oily','چرب'],['combo','مختلط'],['sensitive','حساس']];
const makeupChoices=[['natural','نچرال'],['soft','ملایم'],['glam','گلام'],['colorful','رنگی']];
const clothingSizes=['نامشخص','XS','S','M','L','XL','XXL'];
const shoeSizes=['نامشخص','35','36','37','38','39','40','41','42','43'];
const initialProfile=()=>({nickname:'',avatar:'🎀',style:'casual',favoriteColors:['pink'],size:'نامشخص',shoeSize:'نامشخص',skin:'unknown',makeup:'natural'});
function loadProfile(){
  const result=initialProfile();
  try {
    const p=JSON.parse(localStorage.getItem(profileStoreKey)||'{}');
    if(!p||typeof p!=='object'||Array.isArray(p))return result;
    if(typeof p.nickname==='string')result.nickname=p.nickname.slice(0,28);
    if(avatarChoices.includes(p.avatar))result.avatar=p.avatar;
    if(styleChoices.some(x=>x[0]===p.style))result.style=p.style;
    if(Array.isArray(p.favoriteColors))result.favoriteColors=p.favoriteColors.filter(x=>Object.hasOwn(colors,x));
    if(clothingSizes.includes(p.size))result.size=p.size;
    if(shoeSizes.includes(p.shoeSize))result.shoeSize=p.shoeSize;
    if(skinChoices.some(x=>x[0]===p.skin))result.skin=p.skin;
    if(makeupChoices.some(x=>x[0]===p.makeup))result.makeup=p.makeup;
  }catch(e){}
  return result;
}
let profile=loadProfile();
function saveProfile(next){
  try{localStorage.setItem(profileStoreKey,JSON.stringify(next));profile=next;return true}
  catch(e){toast('ذخیره تنظیمات ممکن نشد؛ فضای مرورگر رو بررسی کن.');return false}
}
const today=()=>new Date().toISOString().slice(0,10);
const faNum=n=>new Intl.NumberFormat('fa-IR').format(Number(n||0));
const category=x=>(x.group==='closet'?clothes:beauty).find(c=>c[0]===x.category)||['other','سایر','🎀'];
const nowMillis=()=>Date.now();
function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(dbName,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('items'))req.result.createObjectStore('items',{keyPath:'id'})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
function transact(mode,fn){return new Promise((resolve,reject)=>{const tx=db.transaction('items',mode),s=tx.objectStore('items');let request;try{request=fn(s)}catch(err){reject(err);return}request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);tx.onerror=()=>reject(tx.error)})}
async function loadItems(){state.items=(await transact('readonly',s=>s.getAll())).sort((a,b)=>b.created-a.created)}
async function storeItem(i){await transact('readwrite',s=>s.put(i));await loadItems()}
async function removeItem(id){await transact('readwrite',s=>s.delete(id));await loadItems()}
function imgUrl(item){if(!item||!item.photo)return '';const u=URL.createObjectURL(item.photo);photoUrls.push(u);return u}
function clearUrls(){photoUrls.forEach(u=>URL.revokeObjectURL(u));photoUrls=[]}
function photo(item){const src=imgUrl(item);return src?'<img src="'+esc(src)+'" alt="'+esc(item.name)+'" loading="lazy">':'<div class="photo-empty"><span>بدون عکس</span></div>'}
function sectionImage(group,fallback){
 const photoItem=state.items.find(x=>x.group===group&&x.photo);
 const src=photoItem?imgUrl(photoItem):fallback;
 return '<img src="'+esc(src)+'" alt="" loading="lazy" onerror="this.style.display=\'none\'">';
}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>t.classList.add('hidden'),3200)}
function hero(){return '<section class="hero"><div class="hero-photo" aria-hidden="true">'+sectionImage('closet','/assets/photos/hero-fashion.webp')+'</div><div class="hero-content"><span class="eyebrow">'+(profile.nickname?'سلام '+esc(profile.nickname)+'!':'دنیای کوچولوی خودت')+'</span><h1>هر روز خوشگل‌تر، با چیزایی که داری!</h1><p>لباس‌هات، وسایل آرایشت و ایده‌های قشنگ، همه یه جا.</p><button class="btn btn-white" data-route="closet">بریم سراغ کمدم</button></div></section>'}
function summary(){const c=state.items.filter(x=>x.group==='closet').length,b=state.items.filter(x=>x.group==='beauty').length,a=state.items.filter(x=>x.group==='beauty'&&expiryDays(x)!=null&&expiryDays(x)<=30).length;return '<div class="summary-row"><div class="summary"><b>'+faNum(c)+'</b><small>توی کمدم</small></div><div class="summary"><b>'+faNum(b)+'</b><small>میز آرایشم</small></div><div class="summary"><b>'+faNum(a)+'</b><small>نیازمند بررسی</small></div></div>'}
function expiryDays(x){if(!x.opened||!Number(x.pao))return null;const d=new Date(x.opened+'T12:00:00');if(Number.isNaN(d.getTime()))return null;d.setMonth(d.getMonth()+Number(x.pao));return Math.ceil((d.getTime()-Date.now())/86400000)}
function expiryNote(x){const d=expiryDays(x);return d==null?'':d<0?'مدت درج‌شده روی محصول گذشته':d<=30?'حدود '+faNum(d)+' روز تا پایان مدت مصرف':'تا '+faNum(d)+' روز طبق PAO'}
function home(){const few=state.items.slice(0,4);return '<div class="content-stack">'+hero()+'<div class="section-head"><h2>دنیای من</h2></div><div class="tile-grid"><button class="tile" data-route="closet"><span class="tile-media">'+sectionImage('closet','/assets/photos/wardrobe.webp')+'</span><strong>کمد لباس من</strong><small>لباس‌ها و ست‌های خوشگل</small></button><button class="tile lilac" data-route="beauty"><span class="tile-media">'+sectionImage('beauty','/assets/photos/beauty.webp')+'</span><strong>میز آرایشم</strong><small>آرایش و مراقبت از خودم</small></button><button class="tile peach" data-action="make-look"><span class="tile-media">'+sectionImage('closet','/assets/photos/outfit.webp')+'</span><strong>ست امروز</strong><small>با لباس‌های خودم</small></button><button class="tile ice" data-route="shop"><span class="tile-media"><img src="/assets/photos/shop-mixed.webp" alt="" loading="lazy"></span><strong>فروشگاه</strong><small>وستا و کیوتلا</small></button></div><div class="section-head"><h2>وسایل من در یک نگاه</h2></div>'+summary()+'<div class="section-head"><h2>تازه اضافه‌شده‌ها</h2><button class="see-all" data-route="closet">همه وسایل ←</button></div>'+(few.length?'<div class="collection">'+few.map(itemCard).join('')+'</div>':'<div class="empty"><img class="empty-art" src="/assets/photos/closet-blank.webp" alt="" loading="lazy"><h3>اینجا هنوز خالیه!</h3><p>اولین لباس یا وسیله آرایشت رو اضافه کن.</p><button class="btn btn-primary" data-add="closet">اولین وسیله رو اضافه کن</button></div>')+'</div>'}
function header(title,subtitle,group){return '<div class="page-header"><div><p class="kicker">MY LITTLE WORLD</p><h1 class="heading">'+title+'</h1><p class="sub">'+subtitle+'</p></div><button class="fab" data-add="'+group+'">＋ اضافه کن</button></div>'}
function itemCard(x){let note=x.group==='beauty'?expiryNote(x):category(x)[1];return '<article class="item"><div class="item-image">'+photo(x)+'</div><button class="delete" aria-label="حذف '+esc(x.name)+'" data-delete="'+esc(x.id)+'">×</button><h3>'+esc(x.name)+'</h3><small><i class="color-dot" style="background:'+colors[x.color||'other'][1]+'"></i>'+esc(note||category(x)[1])+'</small></article>'}
function chips(items){return '<div class="chips">'+items.map(x=>'<button class="chip '+(state.filter===x[0]?'active':'')+'" data-filter="'+x[0]+'">'+x[1]+'</button>').join('')+'</div>'}
function itemsPage(group){const isBeauty=group==='beauty';const tabs=isBeauty?beauty:clothes;let items=state.items.filter(x=>x.group===group);if(state.filter!=='all')items=items.filter(x=>x.category===state.filter);return header(isBeauty?'میز آرایشم':'کمد قشنگم',isBeauty?'همه خوشگلا و روتین‌های من یه جا':'از لباس‌هات ست‌های تازه بساز!',group)+chips([['all','همه'],...tabs.map(x=>[x[0],x[1]])])+(items.length?'<div class="collection">'+items.map(itemCard).join('')+'</div>':'<div class="empty"><img class="empty-art" src="'+(isBeauty?'/assets/photos/beauty-care.webp':'/assets/photos/closet-blank.webp')+'" alt="" loading="lazy"><h3>'+(state.filter==='all'?'فعلاً چیزی اضافه نکردی':'این دسته هنوز خالیه')+'</h3><p>با زدن دکمه اضافه کن می‌تونی عکس و اطلاعات وسیله‌ات رو ثبت کنی.</p><button class="btn btn-primary" data-add="'+group+'">＋ اضافه کردن</button></div>')+(isBeauty?routineBlock():'<div class="section-head"><h2>ایده برای امروز</h2></div><div class="tip"><strong>از لباس‌های موجودت شروع کنیم!</strong><p>چندتا لباس ثبت کن تا براساس نوع و رنگ، یه ترکیب پیشنهادی بسازیم.</p><button class="btn btn-outline" data-action="make-look">ساخت ست من</button></div>')}
function routineBlock(){const am=state.items.filter(x=>x.group==='beauty'&&['am','both'].includes(x.routine));const pm=state.items.filter(x=>x.group==='beauty'&&['pm','both'].includes(x.routine));const warnings=state.items.filter(x=>x.group==='beauty'&&expiryDays(x)!=null&&expiryDays(x)<=30);return '<div class="section-head"><h2>روتین‌های من</h2></div><div class="content-stack"><div class="card routine"><div><strong>روتین صبح</strong><p class="sub">'+(am.length?esc(am.map(x=>x.name).join('، ')):'هنوز محصولی برای صبح انتخاب نکردی')+'</p></div><span class="routine-accent">صبح</span></div><div class="card routine"><div><strong>روتین شب</strong><p class="sub">'+(pm.length?esc(pm.map(x=>x.name).join('، ')):'هنوز محصولی برای شب انتخاب نکردی')+'</p></div><span class="routine-accent">شب</span></div>'+(warnings.length?'<div class="tip"><strong>یادآوری مصرف</strong><p>'+esc(warnings.map(x=>x.name).join('، '))+' نیاز به بررسی تاریخ مصرف دارن. تاریخ درج‌شده روی بسته‌بندی رو ملاک قرار بده.</p></div>':'')+'</div>'}
const compatible=(a,b)=>a.color===b.color||['black','white','cream','brown'].includes(a.color)||['black','white','cream','brown'].includes(b.color);
function makeLook(){const clothesOnly=state.items.filter(x=>x.group==='closet');const grouped=c=>clothesOnly.filter(x=>x.category===c);const dress=grouped('dress'),tops=grouped('top'),bottoms=grouped('bottom'),outer=grouped('outer'),shoes=grouped('shoes'),bags=grouped('bag'),jewels=grouped('jewel');const seed=Math.floor(Date.now()/86400000),pick=a=>{if(!a.length)return null;const favorites=a.filter(x=>profile.favoriteColors.includes(x.color));const pool=favorites.length?favorites:a;return pool[seed%pool.length]};let outfit=[];if(profile.style==='girly'&&dress.length){outfit=[pick(dress)]}else if(tops.length&&bottoms.length){let top=pick(tops),bottom=bottoms.find(x=>compatible(top,x))||pick(bottoms);outfit.push(top,bottom)}else if(dress.length){outfit=[pick(dress)]}else if(clothesOnly.length){outfit=[clothesOnly[seed%clothesOnly.length]]}if(outer.length)outfit.push(pick(outer));if(shoes.length)outfit.push(pick(shoes));if(bags.length)outfit.push(pick(bags));if(jewels.length)outfit.push(pick(jewels));const unique=[...new Map(outfit.filter(Boolean).map(x=>[x.id,x])).values()];state.look=unique;route('look')}
function lookView(){const look=state.look||[];return '<div class="page-header"><div><p class="kicker">A LITTLE MAGIC</p><h1 class="heading">ست امروز من</h1><p class="sub">پیشنهاد ساده بر اساس دسته و رنگ لباس‌هات</p></div><button class="fab" data-action="make-look">↻ ست جدید</button></div>'+(look.length?'<div class="card"><div class="look-grid">'+look.map(x=>'<div class="look-tile">'+photo(x)+'<small>'+esc(x.name)+'</small></div>').join('')+'</div><p class="small-note">این ترکیب به‌صورت خودکار از وسایل ثبت‌شده انتخاب شده، نه پرو مجازی یا نتیجه یک مدل هوش مصنوعی.</p></div>':'<div class="empty"><img class="empty-art" src="/assets/photos/closet-blank.webp" alt="" loading="lazy"><h3>هنوز لباس کافی نداریم</h3><p>چندتا لباس اضافه کن تا بتونیم یه ست واقعی از کمد خودت بسازیم.</p><button class="btn btn-primary" data-add="closet">اضافه کردن لباس</button></div>')+'<div class="section-head"><h2>به یه چیز جدید احتیاج داری؟</h2></div><div class="tip"><p>اول با وسایل خودت ست بساز، بعد برای تکمیلش از کیوتلا یا وستا ایده بگیر.</p><button class="btn btn-outline" data-route="shop">دیدن فروشگاه</button></div>'}
function safeProductLink(p){try{const u=new URL(p.permalink);const valid=Object.values(shopHosts).some(h=>u.hostname===h||u.hostname==='www.'+h);return u.protocol==='https:'&&valid?u.toString():null}catch{return null}}
function productCard(p){const price=p.price!=null?faNum(p.price)+' تومان':'قیمت در فروشگاه';const link=safeProductLink(p);const image=p.image&&p.image.startsWith('/api/market/image?')?'<img loading="lazy" src="'+esc(p.image)+'" alt="'+esc(p.name)+'">':'<div class="photo-empty"><span>بدون عکس</span></div>';return '<article class="item product"><div class="item-image">'+image+'</div><h3 title="'+esc(p.name)+'">'+esc(p.name)+'</h3><small><span class="store-pill">'+(p.store==='vesta'?'وستا':'کیوتلا')+'</span> '+(p.is_in_stock?'موجود':'ناموجود')+'</small><div class="price">'+esc(price)+'</div>'+(link?'<a class="btn btn-outline action" href="'+esc(link)+'" target="_blank" rel="noopener noreferrer">جزئیات محصول ↗</a>':'<button class="btn btn-outline action" disabled>لینک موجود نیست</button>')+'<button class="btn btn-primary action" data-addcart="'+esc(p.store)+'" data-addcart-id="'+esc(p.id)+'" '+(!p.is_in_stock||!p.is_purchasable||p.has_options?'disabled':'')+'>'+(p.has_options?'انتخاب مدل در سایت':'＋ افزودن به سبد')+'</button></article>'}
function shopView(){let items=state.products.filter(p=>state.store==='all'||p.store===state.store);return '<div class="page-header"><div><p class="kicker">SHOP THE CUTENESS</p><h1 class="heading">خریدهای خوشگل</h1><p class="sub">انتخاب‌های واقعی از وستا و کیوتلا</p></div></div><div class="shop-banner"><a href="https://vesta-cosmetics.ir" target="_blank" rel="noopener noreferrer" class="shop-store"><img src="/assets/photos/shop-vesta.webp" alt="" loading="lazy"><b>وستا</b><small>آرایش و مراقبت</small></a><a href="https://cutellashop.ir" target="_blank" rel="noopener noreferrer" class="shop-store cutella"><img src="/assets/photos/shop-cutella.webp" alt="" loading="lazy"><b>کیوتلا</b><small>لباس و اکسسوری</small></a></div><input class="search" type="search" id="productSearch" placeholder="دنبال چی می‌گردی؟" value="'+esc(state.query)+'" aria-label="جستجوی محصول">'+ '<div class="chips">'+[['all','هر دو'],['vesta','وستا'],['cutella','کیوتلا']].map(x=>'<button class="chip '+(state.store===x[0]?'active':'')+'" data-store="'+x[0]+'">'+x[1]+'</button>').join('')+'</div>'+(state.marketError?'<div class="product-error">'+esc(state.marketError)+'<br><button class="btn btn-outline" data-action="refresh-shop">تلاش دوباره</button></div>':items.length?'<div class="collection">'+items.map(productCard).join('')+'</div>':'<div class="empty"><img class="empty-art" src="/assets/photos/shop-mixed.webp" alt="" loading="lazy"><h3>در حال پیدا کردن محصولات</h3><p>اگه چیزی نمی‌بینی، جستجو رو تغییر بده یا دوباره تلاش کن.</p><button class="btn btn-outline" data-action="refresh-shop">بارگذاری محصولات</button></div>')+'<p class="small-note">قیمت و موجودی از فروشگاه‌ها دریافت می‌شود و ممکن است تا مرحله خرید تغییر کند. پرداخت و ثبت سفارش در سایت همان فروشگاه انجام می‌شود.</p>'}
function profileRadios(field,choices,value){
 return '<div class="profile-chips">'+choices.map(x=>'<label class="profile-chip"><input type="radio" name="'+field+'" value="'+esc(x[0])+'" '+(value===x[0]?'checked':'')+'><span>'+x[1]+'</span></label>').join('')+'</div>';
}
function profileSelect(name,items,value){
 return '<select name="'+name+'" id="profile-'+name+'">'+items.map(x=>'<option value="'+esc(x)+'" '+(x===value?'selected':'')+'>'+esc(x)+'</option>').join('')+'</select>';
}
function meView(){
 const name=profile.nickname?esc(profile.nickname):'یه اسم خوشگل برای خودت بذار';
 const countClothes=state.items.filter(x=>x.group==='closet').length;
 const countBeauty=state.items.filter(x=>x.group==='beauty').length;
 const needsCheck=state.items.filter(x=>x.group==='beauty'&&expiryDays(x)!=null&&expiryDays(x)<=30).length;
 return '<div class="content-stack">'+
 '<section class="profile-banner"><div class="profile-decor" aria-hidden="true">✦</div><span class="profile-avatar-lg" aria-hidden="true">'+esc(profile.avatar)+'</span><div><p class="eyebrow">MY LITTLE WORLD</p><h1>'+name+'</h1><p>پروفایلت رو به سلیقه خودت بچین ♡</p></div></section>'+
 '<div class="profile-stats"><button type="button" data-route="closet"><b>'+faNum(countClothes)+'</b><span>توی کمد</span></button><button type="button" data-route="beauty"><b>'+faNum(countBeauty)+'</b><span>میز آرایش</span></button><button type="button" data-route="beauty"><b>'+faNum(needsCheck)+'</b><span>نیاز به بررسی</span></button></div>'+
 '<div class="section-head"><h2>تنظیمات من</h2></div>'+
 '<form id="profileForm" class="profile-form card">'+
 '<label class="profile-field"><strong>دوست داری چی صدات کنیم؟</strong><input name="nickname" maxlength="28" autocomplete="nickname" placeholder="مثلاً نیلی" value="'+esc(profile.nickname)+'"></label>'+
 '<fieldset class="profile-field profile-avatars"><legend>آواتار کوچولوی من</legend><div class="avatar-choices">'+avatarChoices.map(a=>'<label class="avatar-choice"><input type="radio" name="avatar" value="'+esc(a)+'" '+(a===profile.avatar?'checked':'')+'><span>'+a+'</span></label>').join('')+'</div></fieldset>'+
 '<fieldset class="profile-field"><legend>استایل مورد علاقه‌م</legend>'+profileRadios('style',styleChoices,profile.style)+'</fieldset>'+
 '<fieldset class="profile-field"><legend>رنگ‌هایی که دوست دارم</legend><div class="profile-colors">'+Object.entries(colors).filter(x=>x[0]!=='other').map(x=>'<label class="profile-color"><input type="checkbox" name="favoriteColors" value="'+x[0]+'" '+(profile.favoriteColors.includes(x[0])?'checked':'')+'><span class="profile-swatch" style="--swatch:'+x[1][1]+'"></span><small>'+x[1][0]+'</small></label>').join('')+'</div><small class="profile-hint">این رنگ‌ها در اولویت ست‌های پیشنهادی قرار می‌گیرن.</small></fieldset>'+
 '<div class="profile-form-grid"><label class="profile-field"><strong>سایز لباس</strong>'+profileSelect('size',clothingSizes,profile.size)+'</label><label class="profile-field"><strong>سایز کفش</strong>'+profileSelect('shoeSize',shoeSizes,profile.shoeSize)+'</label></div>'+
 '<div class="profile-form-grid"><label class="profile-field"><strong>نوع پوست من</strong><select name="skin">'+skinChoices.map(x=>'<option value="'+x[0]+'" '+(x[0]===profile.skin?'selected':'')+'>'+x[1]+'</option>').join('')+'</select></label><label class="profile-field"><strong>سبک آرایش من</strong><select name="makeup">'+makeupChoices.map(x=>'<option value="'+x[0]+'" '+(x[0]===profile.makeup?'selected':'')+'>'+x[1]+'</option>').join('')+'</select></label></div>'+
 '<button class="btn btn-primary btn-block profile-save" type="submit">ذخیره سلیقه‌هام</button></form>'+
 '<div class="section-head"><h2>دسترسی سریع</h2></div>'+
 '<div class="profile-actions"><button type="button" data-route="closet"><span class="action-thumb"><img src="/assets/photos/wardrobe.webp" alt=""></span><span><b>کمد لباس‌هام</b><small>مدیریت لباس و اکسسوری</small></span><i>‹</i></button><button type="button" data-action="make-look"><span class="action-thumb"><img src="/assets/photos/outfit.webp" alt=""></span><span><b>ست امروز من</b><small>با توجه به رنگ‌های محبوبم</small></span><i>‹</i></button><button type="button" data-route="beauty"><span class="action-thumb"><img src="/assets/photos/beauty.webp" alt=""></span><span><b>روتین و میز آرایش</b><small>محصولات صبح، شب و تاریخ مصرف</small></span><i>‹</i></button><button type="button" data-route="shop"><span class="action-thumb"><img src="/assets/photos/wardrobe.webp" alt=""></span><span><b>فروشگاه وستا و کیوتلا</b><small>یه سر به قشنگیا بزن</small></span><i>‹</i></button></div>'+
 '</div>';
}
function submitProfile(e){
 e.preventDefault();
 const fd=new FormData(e.target);
 const next={
   nickname:String(fd.get('nickname')||'').trim().slice(0,28),
   avatar:String(fd.get('avatar')||'🎀'),
   style:String(fd.get('style')||'casual'),
   favoriteColors:fd.getAll('favoriteColors').map(String).filter(x=>Object.hasOwn(colors,x)),
   size:String(fd.get('size')||'نامشخص'),
   shoeSize:String(fd.get('shoeSize')||'نامشخص'),
   skin:String(fd.get('skin')||'unknown'),
   makeup:String(fd.get('makeup')||'natural')
 };
 if(!avatarChoices.includes(next.avatar))next.avatar='🎀';
 if(!styleChoices.some(x=>x[0]===next.style))next.style='casual';
 if(!clothingSizes.includes(next.size))next.size='نامشخص';
 if(!shoeSizes.includes(next.shoeSize))next.shoeSize='نامشخص';
 if(!skinChoices.some(x=>x[0]===next.skin))next.skin='unknown';
 if(!makeupChoices.some(x=>x[0]===next.makeup))next.makeup='natural';
 if(saveProfile(next)){route('me');toast('سلیقه‌هات ذخیره شد!')}
}
function route(name){const previous=state.route;if((name==='closet'||name==='beauty')&&previous!==name)state.filter='all';state.route=name;clearUrls();const content={home,closet:()=>itemsPage('closet'),beauty:()=>itemsPage('beauty'),look:lookView,shop:shopView,me:meView};$('#appContent').innerHTML=(content[name]||home)();document.querySelectorAll('[data-route]') .forEach(x=>x.classList.toggle('active',x.dataset.route===name));window.scrollTo({top:0,behavior:'instant'});if(name==='shop'&&!state.products.length)refreshShop()}
function rerender(){const r=state.route;route(r)}
function openEditor(group){state.type=group;pendingImage=null;$('#itemForm').reset();$('#itemOpened').value=today();$('#itemCategory').innerHTML=(group==='beauty'?beauty:clothes).map(x=>'<option value="'+x[0]+'">'+x[1]+'</option>').join('');$('#beautyFields').classList.toggle('hidden',group!=='beauty');$('#dialogTitle').textContent=group==='beauty'?'وسیله جدید برای میز آرایش':'لباس جدید برای کمدم';$('#photoPreview').innerHTML='<span class="photo-upload-empty">عکس وسیله</span><small>عکس وسیله‌ات رو اضافه کن</small>';$('#aiScanButton').disabled=true;$('#editorDialog').classList.remove('hidden');document.body.style.overflow='hidden';$('#itemName').focus()}
function closeEditor(){$('#editorDialog').classList.add('hidden');document.body.style.overflow='';pendingImage=null}
async function compressImage(file){if(file.size>15*1024*1024)throw Error('عکس بزرگه؛ لطفاً عکس زیر ۱۵ مگابایت انتخاب کن.');if(!file.type.startsWith('image/'))throw Error('فقط عکس قابل انتخابه.');let bitmap;try{bitmap=await createImageBitmap(file)}catch{throw Error('این فرمت عکس روی دستگاه پشتیبانی نمی‌شه؛ عکس JPG یا PNG انتخاب کن.')}const scale=Math.min(1,1200/Math.max(bitmap.width,bitmap.height)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(bitmap.width*scale));c.height=Math.max(1,Math.round(bitmap.height*scale));c.getContext('2d').drawImage(bitmap,0,0,c.width,c.height);bitmap.close();return new Promise((res,rej)=>c.toBlob(x=>x?res(x):rej(Error('پردازش عکس انجام نشد.')),'image/jpeg',.78))}
async function photoChanged(file){if(!file)return;try{pendingImage=await compressImage(file);$('#aiScanButton').disabled=false;const u=URL.createObjectURL(pendingImage);$('#photoPreview').innerHTML='<img src="'+esc(u)+'" alt="پیش‌نمایش عکس انتخاب‌شده">';setTimeout(()=>URL.revokeObjectURL(u),15000)}catch(err){toast(err.message)}}
async function submitForm(e){e.preventDefault();const name=$('#itemName').value.trim();if(!name){toast('اسم وسیله رو بنویس.');return}const item={id:crypto.randomUUID?crypto.randomUUID():String(nowMillis()),group:state.type,name,category:$('#itemCategory').value,color:$('#itemColor').value,brand:$('#itemBrand').value.trim(),photo:pendingImage,opened:state.type==='beauty'?$('#itemOpened').value:'',pao:state.type==='beauty'?Number($('#itemPAO').value):0,routine:state.type==='beauty'?$('#itemRoutine').value:'none',created:nowMillis()};try{await storeItem(item);closeEditor();route(state.type);toast('به وسایلت اضافه شد')}catch(err){toast('ذخیره انجام نشد؛ حافظه دستگاه رو بررسی کن.')}}
async function deleteItem(id){const item=state.items.find(x=>x.id===id);if(!item||!confirm('«'+item.name+'» از وسایلت حذف بشه؟'))return;await removeItem(id);rerender();toast('حذف شد')}
async function refreshShop(){const seq=++marketSeq;state.marketError='';try{const q=new URLSearchParams({store:state.store,per_page:'30'});if(state.query.trim())q.set('search',state.query.trim());const resp=await fetch('/api/market/products?'+q.toString(),{cache:'no-store'});if(!resp.ok)throw Error('ارتباط با محصولات فروشگاه برقرار نشد.');const j=await resp.json();if(seq!==marketSeq)return;state.products=Array.isArray(j.items)?j.items:[];if(j.errors&&Object.keys(j.errors).length)state.marketError='یکی از فروشگاه‌ها موقتاً در دسترس نیست.'}catch(err){if(seq!==marketSeq)return;state.products=[];state.marketError=err.message+' می‌تونی مستقیماً از لینک فروشگاه‌ها استفاده کنی.'}if(state.route==='shop')rerenderShop()}
function rerenderShop(){const focused=document.activeElement&&document.activeElement.id==='productSearch',position=focused?document.activeElement.selectionStart:null;clearUrls();$('#appContent').innerHTML=shopView();if(focused){const s=$('#productSearch');s.focus();try{s.setSelectionRange(position,position)}catch(e){}}}
document.addEventListener('click',async e=>{const b=e.target.closest('button,a');if(!b)return;if(b.hasAttribute('data-close')){closeEditor();return}if(b.dataset.addcart){const p=state.products.find(x=>x.store===b.dataset.addcart&&String(x.id)===String(b.dataset.addcartId));if(p&&window.VestalandCommerce)window.VestalandCommerce.addToCart(p);return}if(b.dataset.route){e.preventDefault();route(b.dataset.route);return}if(b.dataset.add){openEditor(b.dataset.add);return}if(b.dataset.delete){await deleteItem(b.dataset.delete);return}if(b.dataset.filter){state.filter=b.dataset.filter;rerender();return}if(b.dataset.store){state.store=b.dataset.store;state.products=[];rerenderShop();refreshShop();return}if(b.dataset.action==='make-look'){makeLook();return}if(b.dataset.action==='refresh-shop'){refreshShop();return}});
$('#aboutBtn').addEventListener('click',()=>{route('me')});
$('#itemForm').addEventListener('submit',submitForm);
$('#itemPhoto').addEventListener('change',e=>photoChanged(e.target.files[0]));
$('#itemCamera').addEventListener('change',e=>photoChanged(e.target.files[0]));
document.addEventListener('submit',e=>{if(e.target.id==='profileForm')submitProfile(e)});
let searchTimer;document.addEventListener('input',e=>{if(e.target.id==='productSearch'){state.query=e.target.value;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.products=[];refreshShop()},450)}});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeEditor()});
async function bindUser(userId){
  if(!Number.isSafeInteger(Number(userId))||Number(userId)<=0)throw Error('حساب معتبر نیست.');
  const nextName='vestaland-personal-user-v1-'+Number(userId);
  if(dbName===nextName)return;
  const legacyItems=dbName==='vestaland-personal-v1'?state.items.slice():[];
  if(db)db.close();
  dbName=nextName;
  db=await openDb();
  await loadItems();
  const migrationFlag='vestaland-migration-choice-'+Number(userId);
  if(legacyItems.length&&!state.items.length&&!localStorage.getItem(migrationFlag)){
    if(confirm('چند وسیله از نسخه قبلی روی همین دستگاه پیدا شد. دوست داری یک نسخه از اون‌ها به حساب جدیدت منتقل بشه؟ نسخه قدیمی پاک نمی‌شه.')){
      for(const x of legacyItems)await storeItem(x);
    }
    localStorage.setItem(migrationFlag,'answered');
  }
  profileStoreKey='vestaland-style-profile-user-v1-'+Number(userId);
  profile=loadProfile();
  route('home');
}
function lockInventory(){
  state.items=[];
  state.look=null;
  clearUrls();
  if(db){db.close();db=null}
  dbName='vestaland-personal-v1';
  profileStoreKey='vestaland-style-profile-v1';
  profile=initialProfile();
  $('#appContent').innerHTML='';
}
window.VestalandInventory={
  photo:()=>pendingImage,
  group:()=>state.type,
  suggest(data){
    if(!data||typeof data!=='object')return;
    if(data.name&&typeof data.name==='string')$('#itemName').value=data.name.slice(0,90);
    const group=state.type==='beauty'?beauty:clothes;
    if(group.some(x=>x[0]===data.category))$('#itemCategory').value=data.category;
    if(Object.hasOwn(colors,data.color))$('#itemColor').value=data.color;
    if(typeof data.brand==='string')$('#itemBrand').value=data.brand.slice(0,55);
    toast('مشخصات پیشنهاد شد؛ قبل از ذخیره بررسی کن');
  },
  bindUser,
  lock:lockInventory
};
async function boot(){try{db=await openDb();await loadItems();route('home')}catch(err){$('#appContent').innerHTML='<div class="empty"><img class="empty-art" src="/assets/photos/closet-blank.webp" alt="" loading="lazy"><h3>حافظه دستگاه در دسترس نیست</h3><p>برای نگهداری امن وسایلت، اجازه ذخیره‌سازی مرورگر یا اپ رو فعال کن و دوباره بازش کن.</p></div>'}if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{})}
const bootPromise=boot();
window.VestalandInventory.ready=bootPromise;
})();
