(() => {
  if (window.__vestalandLiveMarketV3) return;
  window.__vestalandLiveMarketV3 = true;

  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=n=>new Intl.NumberFormat('fa-IR').format(Number(n||0));
  const sname=s=>s==='vesta'?'وستا':'کیوتلا';
  const plain=html=>{const d=document.createElement('div');d.innerHTML=html||'';return (d.textContent||'').replace(/\s+/g,' ').trim();};
  const M={items:[],cats:[],cart:JSON.parse(localStorage.getItem('vestaland:market-cart')||'{"vesta":[],"cutella":[]}'),loading:false,detail:null};
  const store=()=>window.state?.marketStore||$('.store-switch [data-store].active')?.dataset.store||'all';

  function ensureDetailCss(){
    if(document.querySelector('link[data-market-detail-css]')) return;
    const l=document.createElement('link');
    l.rel='stylesheet';l.href='/assets/market-detail.css?v=20260901-2118';l.dataset.marketDetailCss='1';document.head.appendChild(l);
  }

  async function api(path,opt={}){const r=await fetch(path,{cache:'no-store',...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'ارتباط با فروشگاه انجام نشد.');return d;}
  function save(){localStorage.setItem('vestaland:market-cart',JSON.stringify(M.cart));bar();}
  function count(s){return(M.cart[s]||[]).reduce((a,x)=>a+x.quantity,0)}
  function total(s){return(M.cart[s]||[]).reduce((a,x)=>a+Number(x.price||0)*x.quantity,0)}

  function card(p){
    const sale=p.on_sale&&p.regular_price&&p.regular_price>p.price, unavailable=!p.is_in_stock||!p.is_purchasable;
    return `<article class="product-card live-product-card" data-product-store="${p.store}" data-product-id="${p.id}">
      <button class="market-product-photo" data-mdetail="${p.store}|${p.id}">${p.image?`<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer">`:'<span class="market-no-image">بدون عکس</span>'}<span class="market-store-badge ${p.store}">${sname(p.store)}</span>${p.on_sale?'<span class="market-sale-badge">تخفیف</span>':''}</button>
      <div class="product-info"><small>${esc(p.categories?.[0]?.name||sname(p.store))}</small><button class="market-product-title" data-mdetail="${p.store}|${p.id}">${esc(p.name)}</button>
      <div class="market-price-row"><strong>${p.price!=null?fmt(p.price)+' تومان':'قیمت داخل محصول'}</strong>${sale?`<del>${fmt(p.regular_price)} تومان</del>`:''}</div>
      ${unavailable?'<span class="market-stock out">ناموجود</span>':''}
      ${p.has_options?`<button class="market-product-action secondary" data-mdetail="${p.store}|${p.id}">انتخاب مدل</button>`:`<button class="market-product-action" data-madd="${p.store}|${p.id}" ${unavailable?'disabled':''}>${unavailable?'ناموجود':'افزودن به سبد'}</button>`}</div></article>`;
  }
  function render(){const g=$('#productGrid');if(!g)return;if(M.loading){g.innerHTML='<div class="market-loading"><span></span><span></span><span></span><span></span></div>';return}g.innerHTML=M.items.length?M.items.map(card).join(''):'<div class="market-empty">محصولی پیدا نشد.</div>';}

  async function products(){M.loading=true;render();const q=new URLSearchParams({store:store(),per_page:'30'}),text=($('#marketSearch')?.value||'').trim(),cat=$('#marketCategories [data-live-category].active')?.dataset.liveCategory||'';if(text)q.set('search',text);if(cat)q.set('category',cat);try{const d=await api('/api/market/products?'+q);M.items=d.items||[];if(d.errors&&Object.keys(d.errors).length)window.toast?.('یکی از فروشگاه‌ها موقتاً جواب نداد؛ محصولات فروشگاه دیگر نمایش داده شد.');}catch(e){M.items=[];window.toast?.(e.message)}M.loading=false;render();}
  async function categories(){const w=$('#marketCategories');if(!w)return;if(store()==='all'){w.innerHTML='<button class="category active" data-live-category="">همه محصولات</button>';return}try{const d=await api('/api/market/categories?store='+encodeURIComponent(store()));M.cats=(d.categories||[]).filter(x=>x.count>0).sort((a,b)=>b.count-a.count).slice(0,20);w.innerHTML='<button class="category active" data-live-category="">همه</button>'+M.cats.map(c=>`<button class="category" data-live-category="${c.id}">${esc(c.name)}</button>`).join('');}catch(_){w.innerHTML='<button class="category active" data-live-category="">همه</button>';}}
  async function refresh(){await categories();await products();}

  function pushCartItem(s,p,parent){
    const list=M.cart[s]||(M.cart[s]=[]), row=list.find(x=>Number(x.id)===Number(p.id));
    if(row) row.quantity=Math.min(20,row.quantity+1);
    else list.push({id:p.id,parent_id:parent?.id||null,name:parent&&p.id!==parent.id?`${parent.name} - ${p.variation||p.name}`:p.name,price:p.price,image:p.image||parent?.image||'',quantity:1,permalink:parent?.permalink||p.permalink||''});
    save();
    window.toast?.('به سبد خرید اضافه شد ✓');
  }

  function add(s,id){const p=M.items.find(x=>x.store===s&&Number(x.id)===Number(id));if(!p)return;if(p.has_options)return detail(s,id);pushCartItem(s,p,p);}
  function qty(s,id,d){const list=M.cart[s]||[],r=list.find(x=>Number(x.id)===Number(id));if(!r)return;r.quantity+=d;if(r.quantity<=0)M.cart[s]=list.filter(x=>Number(x.id)!==Number(id));save();cart(s);}
  function ensureBar(){if($('#marketCartBar'))return;$('#marketView')?.insertAdjacentHTML('beforeend','<div id="marketCartBar" class="market-cart-bar hidden"><button data-mcart="vesta"><span><b>سبد وستا</b><small data-mcount="vesta"></small></span><strong data-mtotal="vesta"></strong></button><button data-mcart="cutella"><span><b>سبد کیوتلا</b><small data-mcount="cutella"></small></span><strong data-mtotal="cutella"></strong></button></div>');}
  function bar(){ensureBar();const b=$('#marketCartBar');if(!b)return;let any=false;['vesta','cutella'].forEach(s=>{const n=count(s),x=b.querySelector(`[data-mcart="${s}"]`);any=any||n>0;x?.classList.toggle('hidden',!n);const c=b.querySelector(`[data-mcount="${s}"]`),t=b.querySelector(`[data-mtotal="${s}"]`);if(c)c.textContent=`${fmt(n)} کالا`;if(t)t.textContent=`${fmt(total(s))} تومان`;});b.classList.toggle('hidden',!any);}
  function modal(html){const m=$('#modal'),c=$('#modalContent');if(!m||!c)return;c.innerHTML=html;m.classList.remove('hidden');document.body.style.overflow='hidden';}
  function closeModal(){const m=$('#modal');if(m)m.classList.add('hidden');document.body.style.overflow='';}

  function detailSkeleton(){modal('<div class="market-detail-loading"><div></div><span></span><span></span><span></span></div>');}
  async function detail(s,id){
    ensureDetailCss();detailSkeleton();
    try{
      const pd=await api(`/api/market/product?store=${encodeURIComponent(s)}&id=${encodeURIComponent(id)}`);
      const p=pd.product;
      let vars=[];
      if(p?.has_options){
        const vd=await api(`/api/market/products?store=${encodeURIComponent(s)}&type=variation&parent=${encodeURIComponent(id)}&per_page=100`);
        vars=(vd.items||[]).filter(v=>v.is_in_stock&&v.is_purchasable);
      }
      M.detail={store:s,product:p,variations:vars,selected:vars[0]?.id||null};
      renderDetail();
    }catch(e){modal(`<div class="market-detail-error"><b>جزئیات محصول باز نشد</b><p>${esc(e.message)}</p><button class="primary-btn" data-action="close-modal">بستن</button></div>`);}
  }

  function renderDetail(){
    const d=M.detail;if(!d?.product)return;
    const p=d.product, vars=d.variations||[], selected=vars.find(v=>Number(v.id)===Number(d.selected));
    const shown=selected||p, imgs=(shown.images?.length?shown.images:p.images)||[], desc=plain(p.description||p.summary).slice(0,900);
    const gallery=imgs.length?`<div class="market-detail-gallery">${imgs.slice(0,6).map((x,i)=>`<img src="${esc(x.src)}" alt="${esc(x.alt||p.name)}" loading="lazy" class="${i===0?'active':''}">`).join('')}</div>`:'';
    const options=vars.length?`<div class="market-variants"><p>مدل رو انتخاب کن</p><div class="market-variant-list">${vars.map(v=>`<button class="market-variant ${Number(v.id)===Number(d.selected)?'selected':''}" data-mvariation="${v.id}"><span>${esc(v.variation||v.name||'مدل')}</span><small>${v.price!=null?fmt(v.price)+' تومان':'قیمت نامشخص'}</small></button>`).join('')}</div></div>`:'';
    const unavailable=!shown?.is_in_stock||!shown?.is_purchasable;
    modal(`<div class="market-detail">
      <div class="market-detail-top"><span class="market-store-badge ${p.store}">${sname(p.store)}</span><button class="market-detail-close" data-action="close-modal" aria-label="بستن">×</button></div>
      ${gallery}
      <div class="market-detail-body"><p class="market-detail-category">${esc(p.categories?.[0]?.name||sname(p.store))}</p><h2>${esc(p.name)}</h2>
      <div class="market-detail-price"><strong>${shown.price!=null?fmt(shown.price)+' تومان':'قیمت داخل محصول'}</strong>${shown.regular_price&&shown.regular_price>shown.price?`<del>${fmt(shown.regular_price)} تومان</del>`:''}</div>
      ${options}
      ${desc?`<div class="market-detail-desc">${esc(desc)}</div>`:''}
      <button class="primary-btn market-detail-add" data-mdetailadd="1" ${unavailable?'disabled':''}>${unavailable?'ناموجود':'افزودن به سبد'}</button>
      </div></div>`);
  }

  function addFromDetail(){
    const d=M.detail;if(!d?.product)return;
    const p=d.variations?.length?d.variations.find(v=>Number(v.id)===Number(d.selected)):d.product;
    if(!p)return window.toast?.('اول مدل محصول رو انتخاب کن.');
    pushCartItem(d.store,p,d.product);closeModal();
  }

  function cart(s){const rows=M.cart[s]||[];if(!rows.length)return window.toast?.('سبد خرید خالیه.');modal(`<p class="kicker">${sname(s)}</p><h2>سبد خرید</h2><div class="market-cart-list">${rows.map(x=>`<div class="market-cart-item">${x.image?`<img src="${esc(x.image)}">`:''}<div><b>${esc(x.name)}</b><small>${fmt(x.price)} تومان</small></div><div class="market-qty"><button data-mqty="${s}|${x.id}|-1">−</button><span>${fmt(x.quantity)}</span><button data-mqty="${s}|${x.id}|1">+</button></div></div>`).join('')}</div><div class="market-cart-total"><span>جمع کالاها</span><b>${fmt(total(s))} تومان</b></div><p class="market-cart-note">ارسال و مبلغ نهایی مستقیماً توسط ${sname(s)} محاسبه می‌شه.</p><button class="primary-btn" data-mcheckout="${s}">ادامه و پرداخت</button>`);}

  function form(s){
    if(!count(s))return;
    if(window.MarketBridge?.checkoutStore){
      try{
        const payload=(M.cart[s]||[]).map(x=>({id:Number(x.id),quantity:Number(x.quantity||1),parent_id:x.parent_id||null}));
        window.MarketBridge.checkoutStore(s,JSON.stringify(payload));
        closeModal();
        return;
      }catch(_){ }
    }
    modal(`<p class="kicker">پرداخت ${sname(s)}</p><h2>آدرس تحویل</h2><p class="muted">سفارش داخل خود ${sname(s)} ثبت می‌شه و همون درگاه فروشگاه باز می‌شه.</p><form id="mCheckout" class="market-checkout-form"><div class="market-form-grid"><label>نام<input name="first_name" required></label><label>نام خانوادگی<input name="last_name" required></label></div><div class="market-form-grid"><label>موبایل<input name="phone" required inputmode="tel"></label><label>ایمیل<input name="email" type="email" placeholder="اختیاری"></label></div><div class="market-form-grid"><label>شهر<input name="city" required></label><label>استان<input name="state" required></label></div><label>آدرس کامل<input name="address_1" required></label><label>کد پستی<input name="postcode" required inputmode="numeric"></label><p id="mErr" class="form-error hidden"></p><button class="primary-btn" type="submit">ثبت سفارش و رفتن به درگاه</button></form>`);$('#mCheckout')?.addEventListener('submit',e=>checkout(e,s));
  }
  async function checkout(e,s){e.preventDefault();const f=e.currentTarget,b=f.querySelector('button[type=submit]'),er=$('#mErr'),fd=new FormData(f),addr={country:'IR'};for(const[k,v]of fd.entries())addr[k]=String(v).trim();er.classList.add('hidden');b.disabled=true;b.textContent='در حال اتصال…';try{const d=await api('/api/market/checkout',{method:'POST',body:JSON.stringify({store:s,items:M.cart[s].map(x=>({id:x.id,quantity:x.quantity})),billing_address:addr,shipping_address:addr})});if(!d.redirect_url)throw new Error('فروشگاه لینک درگاه برنگردوند.');try{window.MarketBridge?.beginPayment()}catch(_){}location.href=d.redirect_url;}catch(x){er.textContent=x.message;er.classList.remove('hidden');b.disabled=false;b.textContent='دوباره تلاش کن';}}

  function bind(){document.addEventListener('click',e=>{
    const sb=e.target.closest('.store-switch [data-store]');if(sb){window.state=window.state||{};window.state.marketStore=sb.dataset.store;setTimeout(refresh,0)}
    const c=e.target.closest('[data-live-category]');if(c){$$('#marketCategories [data-live-category]').forEach(x=>x.classList.toggle('active',x===c));products()}
    const a=e.target.closest('[data-madd]');if(a){e.preventDefault();const[s,id]=a.dataset.madd.split('|');add(s,Number(id))}
    const md=e.target.closest('[data-mdetail]');if(md){e.preventDefault();const[s,id]=md.dataset.mdetail.split('|');detail(s,Number(id))}
    const mv=e.target.closest('[data-mvariation]');if(mv){e.preventDefault();M.detail.selected=Number(mv.dataset.mvariation);renderDetail()}
    if(e.target.closest('[data-mdetailadd]')){e.preventDefault();addFromDetail()}
    const mc=e.target.closest('[data-mcart]');if(mc){e.preventDefault();cart(mc.dataset.mcart)}
    const q=e.target.closest('[data-mqty]');if(q){e.preventDefault();const[s,id,d]=q.dataset.mqty.split('|');qty(s,Number(id),Number(d))}
    const co=e.target.closest('[data-mcheckout]');if(co){e.preventDefault();form(co.dataset.mcheckout)}
    if(e.target.closest('[data-view="market"]'))setTimeout(()=>{if(!M.items.length)refresh()},80)
  });let tm;$('#marketSearch')?.addEventListener('input',()=>{clearTimeout(tm);tm=setTimeout(products,350)});}
  function boot(){ensureDetailCss();M.items=[];render();ensureBar();bar();bind();if($('#marketView')?.classList.contains('active-view'))refresh();if(new URLSearchParams(location.search).get('market_paid')==='1'){localStorage.removeItem('vestaland:market-cart');M.cart={vesta:[],cutella:[]};history.replaceState({},'',location.pathname);setTimeout(()=>window.toast?.('پرداخت انجام شد؛ سفارش داخل فروشگاه ثبت شده ✓'),400);}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
