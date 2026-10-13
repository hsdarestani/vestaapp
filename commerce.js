'use strict';
/* Auth, Zibal subscriptions, store-native cart/checkout and quota-limited AI.
   Do not turn on OTP or checkout until provisioned on the backend.
   No payment amount or subscription entitlement is trusted from localStorage. */
(function(){
const $=s=>document.querySelector(s);
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const toman=n=>new Intl.NumberFormat('fa-IR').format(Number(n)||0)+' تومان';
const sessionKey='vestaland-session-v1',cartKey='vestaland-cart-v1',paymentKey='vestaland-last-payment-v1';
const defaultCart=()=>({vesta:[],cutella:[]});
const S={config:null,user:null,token:localStorage.getItem(sessionKey)||'',phone:'',cart:defaultCart(),loading:false,store:'vesta',modal:null,aiResponse:'',error:'',otp:false,orderStatus:[],mounted:false};
try{
 const old=JSON.parse(localStorage.getItem(cartKey)||'{}');
 for(const st of ['vesta','cutella'])if(Array.isArray(old[st]))S.cart[st]=old[st].filter(x=>x&&Number(x.id)>0).slice(0,30).map(x=>({id:Number(x.id),name:String(x.name||'') .slice(0,100),quantity:Math.max(1,Math.min(10,Number(x.quantity)||1)),price:Number(x.price)||0}));
}catch{}
function persistCart(){try{localStorage.setItem(cartKey,JSON.stringify(S.cart))}catch{}}
const notify=message=>{const el=$('#toast');if(!el)return;el.textContent=message;el.classList.remove('hidden');setTimeout(()=>el.classList.add('hidden'),3600)};
async function api(path,opts={}){
 const headers={'Accept':'application/json'};
 if(opts.body)headers['Content-Type']='application/json';
 if(S.token)headers.Authorization='Bearer '+S.token;
 const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),35000);
 try{
  const response=await fetch('/api/account/'+path,{
    method:opts.body?'POST':'GET',headers,
    body:opts.body?JSON.stringify(opts.body):undefined,cache:'no-store',
    credentials:'same-origin',signal:ctrl.signal
  });
  const result=await response.json();
  if(!response.ok||result.ok===false){
   const err=new Error(result.error||'ارتباط با سرور برقرار نشد.');err.status=response.status;
   throw err;
  }
  return result;
 }catch(e){if(e.name==='AbortError')throw new Error('زمان پاسخ سرور طولانی شد؛ دوباره تلاش کن.');throw e}
 finally{clearTimeout(timeout)}
}
function allowed(){return !!(S.user&&S.user.active&&Number(S.user.expires_at)*1000>Date.now())}
function membershipPaymentEnabled(){return isEnabled('subscriptions_enabled')||(isBazaarAndroid()&&isEnabled('bazaar_enabled'))}
function signedInAccess(){return !!S.user&&(!membershipPaymentEnabled()||allowed())}
function authReady(){return Boolean(S.config?.features?.otp_enabled)}
function isEnabled(name){return Boolean(S.config?.features?.[name])}
function gateRequired(){
 if(S.config)return isEnabled("login_required");
 return localStorage.getItem('vestaland-requires-login-v1')==='1';
}
function updateGate(){
 if(isEnabled("login_required"))localStorage.setItem('vestaland-requires-login-v1','1');
 document.body.classList.remove('auth-pending');
 document.body.classList.toggle('auth-required',gateRequired()&&!signedInAccess());
}

const isBazaarAndroid=()=>/VestalandBazaar\//.test(navigator.userAgent)||Boolean(window.BazaarBridge);

function open(kind){
 S.modal=kind;S.error='';renderModal();
}
function close(){if(gateRequired()&&!signedInAccess()){S.modal=S.user?'plans':'login';renderModal();return}S.modal=null;S.error='';const dlg=$('#commerceLayer');if(dlg){dlg.hidden=true;dlg.innerHTML=''} }
function modalBase(title,content){
 let dlg=$('#commerceLayer');
 if(!dlg){dlg=document.createElement('section');dlg.id='commerceLayer';dlg.className='commerce-overlay';dlg.setAttribute('role','dialog');dlg.setAttribute('aria-modal','true');document.body.append(dlg)}
 dlg.hidden=false;
 dlg.innerHTML='<div class="commerce-shade" data-commerce-close></div><div class="commerce-panel"><div class="commerce-handle"></div><div class="commerce-head"><h2>'+title+'</h2><button aria-label="بستن" type="button" data-commerce-close>×</button></div>'+content+'</div>';
}
function statusText(){
 if(!S.user)return 'هنوز وارد حسابت نشدی.';
 if(S.user.plan==='trial')return 'دوره رایگان تا '+new Date(S.user.trial_until*1000).toLocaleDateString('fa-IR');
 if(S.user.plan==='paid')return 'اشتراکت فعاله تا '+new Date(S.user.paid_until*1000).toLocaleDateString('fa-IR');
 return 'دوره آزمایشی و اشتراکت تموم شده.';
}
function pricing(){
 const plans=S.config?.plans||[{id:'monthly',price_toman:199000,duration_days:30},{id:'quarterly',price_toman:499000,duration_days:90}];
 return '<div class="commerce-plans">'+plans.map(p=>'<div class="commerce-plan '+(p.id==='quarterly'?'featured':'')+'"><div><strong>'+(p.id==='monthly'?'ماهانه':'سه‌ماهه')+'</strong><small>'+(p.id==='monthly'?'۳۰ روز':'۹۰ روز')+'</small></div><b>'+toman(p.price_toman)+'</b><button class="btn btn-primary" data-payplan="'+p.id+'" '+(!S.token||!(isBazaarAndroid()?isEnabled('bazaar_enabled'):isEnabled('subscriptions_enabled'))||S.loading?'disabled':'')+'>انتخاب پلن</button></div>').join('')+'</div>';
}
function loginView(){
 return '<div class="commerce-intro"><img src="/assets/illustrations/gate-wow.svg" alt="" loading="lazy"></div><p class="commerce-lead">با شماره موبایلت وارد شو و ۷ روز اول رو رایگان از امکانات وستالند استفاده کن!</p>'+
 (S.error?'<p class="commerce-error">'+safe(S.error)+'</p>':'')+
 '<form id="commerceLoginForm"><label>شماره موبایل<input name="phone" inputmode="tel" autocomplete="tel" required placeholder="۰۹۱۲۱۲۳۴۵۶۷" value="'+safe(S.phone)+'"></label>'+
 (S.otp?'<label>کد پیامک‌شده<input name="code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9۰-۹]{6}" maxlength="6" placeholder="کد ۶ رقمی" required></label>':'')+
 '<button class="btn btn-primary btn-block" type="submit" '+(S.loading?'disabled':'')+'>'+(S.loading?'چند لحظه...':S.otp?'تأیید و ورود':'دریافت کد ورود')+'</button></form>'+
 (!authReady()?'<p class="commerce-warning">ارسال پیامک هنوز توسط مدیر اپ فعال نشده.</p>':'')+
 (S.otp?'<button class="btn btn-outline btn-block" data-commerce-back>اصلاح شماره موبایل</button>':'');
}
function plansView(){
 return '<p class="commerce-lead">'+safe(statusText())+'</p><p class="commerce-note">۷ روز اول رایگان برای هر شماره، فقط یک بار. هزینه اشتراک پس از انتخاب پلن دریافت می‌شود؛ تمدید خودکار فعال نیست.</p>'+
 pricing()+(S.error?'<p class="commerce-error">'+safe(S.error)+'</p>':'')+
 (!S.token?'<button class="btn btn-outline btn-block" data-commerce-open="login">اول وارد شو</button>':'')+
 (isBazaarAndroid()?'<p class="commerce-note">پرداخت اشتراک نسخه کافه‌بازار فقط از طریق پرداخت امن خود بازار و تأیید سمت سرور انجام می‌شود.</p>':'')+
 (!(isBazaarAndroid()?isEnabled('bazaar_enabled'):isEnabled('subscriptions_enabled'))?'<p class="commerce-warning">پرداخت اشتراک بعد از اتصال و تأیید درگاه فعال می‌شود.</p>':'');
}
function accountView(){
 return '<div class="commerce-account-card">'+safe(S.user?.phone||'')+'<p>'+safe(statusText())+'</p></div>'+
 (S.user&&!S.user.active?pricing():'')+
 '<button class="btn btn-outline btn-block" data-commerce-open="plans">مدیریت و تمدید اشتراک</button>'+
 '<button class="btn btn-outline btn-block" data-commerce-open="orders">سفارش‌های من</button>'+
 '<button class="btn btn-outline btn-block" data-logout>خروج از حساب</button>';
}
function cartView(){
 const st=S.store,items=S.cart[st],name=st==='vesta'?'وستا':'کیوتلا';
 const count=items.reduce((n,i)=>n+i.quantity,0);
 return '<p class="commerce-lead">سبد خرید وستا و کیوتلا جداست. هر سفارشت رو از همین‌جا پیگیری کن.</p>'+
 '<div class="commerce-tabs"><button data-cartstore="vesta" class="'+(st==='vesta'?'active':'')+'">وستا</button><button data-cartstore="cutella" class="'+(st==='cutella'?'active':'')+'">کیوتلا</button></div>'+
 (items.length?'<div class="commerce-cart-items">'+items.map(x=>'<div class="commerce-cart-line"><span>'+safe(x.name)+'</span><div><button data-qty="-1" data-productid="'+x.id+'" aria-label="کم کردن">−</button><b>'+new Intl.NumberFormat('fa-IR').format(x.quantity)+'</b><button data-qty="1" data-productid="'+x.id+'" aria-label="افزودن">＋</button></div></div>').join('')+'</div>':
 '<div class="commerce-empty"><img src="/assets/illustrations/market.svg" alt="" loading="lazy"><p>سبد '+name+' هنوز خالیه.</p></div>')+
 '<p class="commerce-note">قیمت و موجودی نهایی با استعلام زنده از سایت فروشگاه محاسبه می‌شه. ممکنه هزینه ارسال هم اضافه بشه.</p>'+
 (S.error?'<p class="commerce-error">'+safe(S.error)+'</p>':'')+
 '<button class="btn btn-primary btn-block" data-commerce-quote '+(count===0||S.loading||!isEnabled('store_checkout_enabled')?'disabled':'')+'>استعلام موجودی و ادامه خرید ('+count+')</button>'+
 (!isEnabled('store_checkout_enabled')?'<p class="commerce-warning">ثبت سفارش درون اپ پس از بررسی درگاه هر دو فروشگاه فعال می‌شه.</p>':'');
}
function checkoutView(){
 return '<p class="commerce-lead">سفارش '+(S.store==='vesta'?'وستا':'کیوتلا')+' رو همین‌جا تکمیل کن.</p>'+
 (S.quote?'<div class="commerce-quote"><strong>مبلغ برآوردی سبد:</strong> '+toman(S.quote.totals?.total||0)+'</div>':'')+
 '<form id="commerceCheckoutForm">'+[
 ['first_name','نام'],['last_name','نام خانوادگی'],['phone','شماره تماس'],['email','ایمیل (اختیاری)'],
 ['state','استان'],['city','شهر'],['address_1','آدرس کامل'],['postcode','کد پستی']
 ].map(([name,label])=>'<label>'+label+'<input name="'+name+'" maxlength="155" '+(name==='email'?'type="email"':'')+' '+(name==='email'?'':'required')+' '+(name==='phone'&&S.user?'value="'+safe(S.user.phone)+'"':'')+'></label>').join('')+
 '<p class="commerce-note">پس از ثبت سفارش، به صفحه امن پرداخت همان فروشگاه هدایت می‌شی. مبلغ نهایی را قبل از پرداخت بررسی کن.</p>'+
 (S.error?'<p class="commerce-error">'+safe(S.error)+'</p>':'')+
 '<button class="btn btn-primary btn-block" type="submit" '+(S.loading?'disabled':'')+'>ثبت سفارش در '+(S.store==='vesta'?'وستا':'کیوتلا')+'</button></form>';
}
function aiView(){
 return '<p class="commerce-lead">از لباس‌ها و وسایلت ایده‌های تازه بگیر.</p>'+
 '<form id="commerceAiForm"><label>دوست داری برای چی پیشنهاد بگیری؟<textarea name="question" rows="3" maxlength="240" placeholder="مثلاً برای مهمونی عصر امروز چی بپوشم؟"></textarea></label>'+
 '<button class="btn btn-primary btn-block" '+(S.loading||!isEnabled('ai_enabled')?'disabled':'')+' type="submit">پیشنهاد هوشمند</button></form>'+
 (!isEnabled('ai_enabled')?'<p class="commerce-warning">سرویس AI هنوز فعال نشده است؛ فعلاً از «ست امروز» استفاده کن.</p>':'')+
 (S.error?'<p class="commerce-error">'+safe(S.error)+'</p>':'')+
 (S.aiResponse?'<div class="commerce-ai-answer"><b>پیشنهاد من برای تو</b><p>'+safe(S.aiResponse)+'</p></div>':'');
}
function ordersView(){
 return '<p class="commerce-lead">سفارش‌های ثبت‌شده با همین حساب</p>'+
 (S.error?'<p class="commerce-error">'+safe(S.error)+'</p>':'')+
 (S.orderStatus.length?S.orderStatus.map(o=>'<div class="commerce-order">سفارش '+safe(o.store==='vesta'?'وستا':'کیوتلا')+' #'+safe(o.order_id||'')+' <small>وضعیت هنگام ثبت: '+safe(o.payment_status||'pending')+'</small></div>').join(''):'<div class="commerce-empty"><img src="/assets/illustrations/market-wow.svg" alt="" loading="lazy"><p>فعلاً سفارشی ثبت نشده.</p></div>')+
 '<p class="commerce-note">برای وضعیت پرداخت یا ارسال، رسید و حساب همان فروشگاه رو هم بررسی کن.</p>';
}
function renderModal(){
 if(!S.modal)return;
 const views={login:['ورود به وستالند',loginView],plans:['اشتراک‌های وستالند',plansView],account:['حساب من',accountView],cart:['سبد خرید من',cartView],checkout:['ثبت سفارش',checkoutView],ai:['استایلیست هوشمند',aiView],orders:['سفارش‌های من',ordersView]};
 const [title,render]=views[S.modal]||views.login;
 modalBase(title,render());
}
function refreshProfile(){
 const root=$('#appContent');
 if(!root||!root.querySelector('.profile-banner'))return;
 if(root.querySelector('#commerceProfileActions'))return;
 const box=document.createElement('div');box.id='commerceProfileActions';box.className='commerce-profile-card';
 box.innerHTML='<div class="commerce-profile-status"><img class="profile-inline-art" src="/assets/illustrations/gate-wow.svg" alt=""><div><b>'+(S.user?safe(S.user.phone):'حساب من')+'</b><small>'+safe(statusText())+'</small></div></div>'+
 '<div class="commerce-profile-buttons"><button data-commerce-open="'+(S.user?'account':'login')+'">'+(S.user?'مدیریت حساب':'ورود / ثبت نام')+'</button><button data-commerce-open="plans">اشتراک‌ها</button><button data-commerce-open="orders">سفارش‌ها</button><button data-commerce-open="cart">سبد خرید ('+cartTotal()+')</button></div>';
 const banner=root.querySelector('.profile-banner');
 banner.insertAdjacentElement('afterend',box);
}
function cartTotal(){return Object.values(S.cart).flat().reduce((n,item)=>n+item.quantity,0)}
function decorate(){
 const root=$('#appContent');if(!root)return;
 refreshProfile();
 // No repeated button insertion; cart/AI shortcuts are native interactive controls.
 const shop=root.querySelector('.shop-banner');
 if(shop&&!root.querySelector('.commerce-shop-tools')){
  const row=document.createElement('div');
  row.className='commerce-shop-tools';
  row.innerHTML='<button data-commerce-open="cart">سبد من ('+cartTotal()+')</button><button data-commerce-open="ai">پیشنهاد هوشمند</button>';
  shop.insertAdjacentElement('afterend',row);
 }
 const hero=root.querySelector('.hero');
 if(hero&&!root.querySelector('.commerce-home-tools')){
  const row=document.createElement('div');row.className='commerce-home-tools';
  row.innerHTML='<button data-commerce-open="ai">پیشنهاد شخصی</button><button data-commerce-open="cart">سبد خرید ('+cartTotal()+')</button>';
  hero.insertAdjacentElement('afterend',row);
 }
}
async function bootstrap(){
 try{
  S.config=await api('config');
  if(S.token){
   try{const u=await api('me');S.user=u.user}
   catch(e){if(e.status===401){S.token='';localStorage.removeItem(sessionKey)}}
  }
  if(new URLSearchParams(location.search).has('payment')){
   const q=new URLSearchParams(location.search);history.replaceState(null,'',location.pathname);
   const pid=localStorage.getItem(paymentKey);
   if(pid&&S.token){
    try{const status=await api('subscription/status?id='+encodeURIComponent(pid));if(status.payment_status==='paid'){notify('اشتراکت با موفقیت فعال شد');localStorage.removeItem(paymentKey);await refreshUser()}}
    catch{}
   }
  }
  if(S.user&&window.VestalandInventory){
   await window.VestalandInventory.ready;
   await window.VestalandInventory.bindUser(S.user.id);
  }
 }catch(e){S.error=e.message}
 updateGate();
 const root=$('#appContent');
 if(root){
  const observer=new MutationObserver(()=>decorate());
  observer.observe(root,{childList:true,subtree:false});
 }
 decorate();
 if(gateRequired()&&!signedInAccess())open(S.user?'plans':'login');
}
async function refreshUser(){if(!S.token)return;const result=await api('me');S.user=result.user;updateGate();decorate()}
async function loginSubmit(form){
 const fd=new FormData(form);S.phone=String(fd.get('phone')||'').trim();
 S.loading=true;S.error='';renderModal();
 try{
  if(!S.otp){await api('otp/request',{body:{phone:S.phone}});S.otp=true;notify('کد ورود ارسال شد')}
  else{
   const result=await api('otp/verify',{body:{phone:S.phone,code:String(fd.get('code')||'')}});S.token=result.token;S.user=result.user;
   localStorage.setItem(sessionKey,S.token);S.otp=false;
   if(window.VestalandInventory){
      await window.VestalandInventory.ready;
      await window.VestalandInventory.bindUser(S.user.id);
   }
   updateGate();notify('خوش اومدی به وستالند');
   if(!signedInAccess())S.modal='plans';else close();
  }
 }catch(e){S.error=e.message}finally{S.loading=false;renderModal();decorate()}
}
async function startPayment(plan){
 S.loading=true;S.error='';renderModal();
 try{
   if(isBazaarAndroid()){
     if(!isEnabled('bazaar_enabled')||!window.BazaarBridge)throw new Error('تأیید امن پرداخت کافه‌بازار هنوز فعال نشده.');
     window.BazaarBridge.subscribe(plan==='monthly'?'1m':'3m');
     S.loading=false;renderModal();return;
   }
   const x=await api('subscription/start',{body:{plan}});
   localStorage.setItem(paymentKey,x.payment_id);location.assign(x.payment_url);
 }catch(e){S.error=e.message;S.loading=false;renderModal()}
}
async function quote(){
 if(!allowed()){open(S.user?'plans':'login');return}
 S.loading=true;S.error='';renderModal();
 try{S.quote=await api('orders/quote',{body:{store:S.store,items:S.cart[S.store].map(x=>({id:x.id,quantity:x.quantity}))}});S.modal='checkout'}
 catch(e){S.error=e.message}finally{S.loading=false;renderModal()}
}
async function buy(form){
 const fd=new FormData(form),address=Object.fromEntries(fd.entries());
 S.loading=true;S.error='';renderModal();
 try{
  const key=S.checkoutRequestId||(S.checkoutRequestId=(crypto.randomUUID?crypto.randomUUID():String(Date.now())+'-'+Math.random().toString(36).slice(2)));
  const out=await api('orders/checkout',{body:{store:S.store,items:S.cart[S.store].map(x=>({id:x.id,quantity:x.quantity})),billing_address:address,request_id:key}});
  if(!out.redirect_url?.startsWith('https://'))throw Error('لینک پرداخت امن دریافت نشد.');
  S.cart[S.store]=[];persistCart();S.checkoutRequestId=null;if(window.MarketBridge)window.MarketBridge.beginPayment();location.assign(out.redirect_url);
 }catch(e){S.error=e.message;S.loading=false;renderModal()}
}
async function askAi(form){
 if(!allowed()){open(S.user?'plans':'login');return}
 S.loading=true;S.error='';renderModal();
 try{
  const fd=new FormData(form);
  const list=[];
  // Existing wardrobe is private to the browser. Only short text metadata leaves the device.
  const stored=indexedDB.open('vestaland-personal-v1',1);
  await new Promise((resolve,reject)=>{
   stored.onsuccess=()=>{
    const db=stored.result,tx=db.transaction('items','readonly'),get=tx.objectStore('items').getAll();
    get.onsuccess=()=>{list.push(...get.result.map(x=>({name:x.name,group:x.group,color:x.color,category:x.category})));db.close();resolve()};
    get.onerror=()=>reject(get.error);
   };stored.onerror=()=>reject(stored.error);
  });
  const x=await api('ai/recommend',{body:{items:list.slice(0,18),question:String(fd.get('question')||'').slice(0,240)}});
  S.aiResponse=x.suggestion;notify('پیشنهاد شخصی آماده‌ست');
 }catch(e){S.error=e.message}
 finally{S.loading=false;renderModal()}
}
function tinyJpeg(blob){
 return createImageBitmap(blob).then(bitmap=>{
   const canvas=document.createElement('canvas');
   const scale=Math.min(1,512/Math.max(bitmap.width,bitmap.height));
   canvas.width=Math.max(1,Math.round(bitmap.width*scale));
   canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
   bitmap.close();
   return new Promise((resolve,reject)=>{
     canvas.toBlob(f=>{
       if(!f)return reject(Error('امکان آماده کردن عکس وجود نداره.'));
       if(f.size>120000)return reject(Error('عکس بیش از حد پیچیده است؛ لطفاً نزدیک‌تر عکس بگیر.'));
       const reader=new FileReader();
       reader.onload=()=>resolve(String(reader.result).split(',')[1]);
       reader.onerror=()=>reject(Error('خواندن عکس انجام نشد.'));
       reader.readAsDataURL(f);
     },'image/jpeg',.58);
   });
 });
}
async function scanNewItem(){
 const inventory=window.VestalandInventory;
 const file=inventory?.photo();
 const button=$('#aiScanButton');
 if(!file){notify('اول از وسیله‌ات عکس بگیر.');return}
 if(!allowed()){open(S.user?'plans':'login');return}
 if(!isEnabled('image_scan_enabled')){notify('تشخیص هوشمند عکس هنوز در مرحله تست است؛ فعلاً فیلدها رو خودت وارد کن.');return}
 if(!button)return;
 const old=button.textContent;button.disabled=true;button.textContent='در حال بررسی عکس...';
 try{
   const image=await tinyJpeg(file);
   const result=await api('ai/scan',{body:{group:inventory.group(),image}});
   inventory.suggest(result.suggestion);
   if(result.suggestion.confidence==='low')notify('اطمینان تشخیص پایینه؛ همه فیلدها رو بررسی کن.');
 }catch(e){notify(e.message||'تشخیص عکس موقتاً در دسترس نیست.')}
 finally{button.disabled=false;button.textContent=old}
}
async function loadOrders(){
 S.error='';S.orderStatus=[];
 if(!S.user){open('login');return}
 open('orders');
 try{const result=await api('orders');S.orderStatus=result.orders||[]}catch(e){S.error=e.message}
 renderModal();
}
async function logout(){
 try{await api('logout',{body:{logout:true}})}catch{}
 S.user=null;S.token='';localStorage.removeItem(sessionKey);if(window.VestalandInventory)window.VestalandInventory.lock();updateGate();S.modal=null;notify('از حساب خارج شدی');if(!gateRequired()){location.reload();return}open('login');
}
// Trial and paid access enforced by the server for all protected endpoints;
// this capture-phase overlay also stops navigating protected UI before login.
document.addEventListener('click',event=>{
 if(!gateRequired()||signedInAccess()||event.target.closest('#commerceLayer'))return;
 const target=event.target.closest('button,a');if(!target)return;
 if(target.hasAttribute('data-commerce-open')||target.hasAttribute('data-commerce-close'))return;
 const path=target.dataset.route;
 const isAppArea=target.closest('#appContent,.bottom-nav');
 if(!isAppArea)return;
 if(path==='me')return;
 if(path==='home'&&!S.user)return;
 if(path||target.hasAttribute('data-add')||target.hasAttribute('data-addcart')||target.hasAttribute('data-filter')||target.hasAttribute('data-action')){
   event.preventDefault();event.stopImmediatePropagation();open(S.user?'plans':'login');
 }
},true);
async function confirmBazaarPurchase(plan,purchaseToken){
 if(!isBazaarAndroid()||!S.token||!['monthly','quarterly'].includes(plan))return;
 S.modal='plans';S.loading=true;S.error='';renderModal();
 try{
   const receipt=await api('bazaar/verify',{body:{plan,purchase_token:String(purchaseToken||'')}});
   if(!receipt.user?.active)throw new Error('رسید تأیید نشد.');
   S.user=receipt.user;S.loading=false;updateGate();notify('اشتراک بازار تأیید و فعال شد');close();decorate();
 }catch(e){S.error='خرید ثبت شد اما تأیید اشتراک انجام نشده: '+e.message;S.loading=false;renderModal()}
}
window.VestalandCommerce={
 confirmBazaarPurchase,
 addToCart(product){
  if(!product||!['vesta','cutella'].includes(product.store))return;
  if(product.has_options){notify('برای انتخاب رنگ یا سایز، صفحه محصول فروشگاه رو باز کن.');return}
  if(!product.is_in_stock||!product.is_purchasable){notify('این محصول فعلاً قابل سفارش نیست.');return}
  const arr=S.cart[product.store],existing=arr.find(x=>x.id===product.id);
  if(existing)existing.quantity=Math.min(10,existing.quantity+1);
  else arr.push({id:product.id,name:product.name,quantity:1,price:product.price});
  S.store=product.store;S.checkoutRequestId=null;persistCart();notify('به سبد خریدت اضافه شد');decorate();
 },
 open
};
document.addEventListener('click',event=>{
 const b=event.target.closest('button,a');if(!b)return;
 if(b.hasAttribute('data-commerce-close')){event.preventDefault();close();return}
 if(b.hasAttribute('data-commerce-back')){S.otp=false;renderModal();return}
 if(b.dataset.commerceOpen){event.preventDefault();if(b.dataset.commerceOpen==='orders')loadOrders();else open(b.dataset.commerceOpen);return}
 if(b.dataset.payplan){event.preventDefault();startPayment(b.dataset.payplan);return}
 if(b.dataset.cartstore){S.store=b.dataset.cartstore;S.checkoutRequestId=null;renderModal();return}
 if(b.dataset.qty){
  const row=S.cart[S.store].find(x=>x.id===Number(b.dataset.productid));
  if(row){row.quantity=Math.max(0,Math.min(10,row.quantity+Number(b.dataset.qty)));S.cart[S.store]=S.cart[S.store].filter(x=>x.quantity>0);S.checkoutRequestId=null;persistCart();renderModal()}
  return;
 }
 if(b.id==='aiScanButton'){event.preventDefault();scanNewItem();return}
 if(b.hasAttribute('data-commerce-quote')){quote();return}
 if(b.hasAttribute('data-logout')){logout();return}
});
document.addEventListener('submit',event=>{
 if(event.target.id==='commerceLoginForm'){event.preventDefault();loginSubmit(event.target)}
 if(event.target.id==='commerceCheckoutForm'){event.preventDefault();buy(event.target)}
 if(event.target.id==='commerceAiForm'){event.preventDefault();askAi(event.target)}
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&S.modal)close()});
bootstrap();
})();
