const CACHE='vestaland-v15';
const MARKET_CACHE='vestaland-market-data-v4';
const IMAGE_CACHE='vestaland-market-images-v4';
const CORE=[
  '/',
  '/index.html',
  '/styles.css?v=20260901-1958',
  '/desktop-enhancements.css?v=20260901-1958',
  '/app.js?v=20260901-1958',
  '/assets/native.js?v=20260901-1958',
  '/assets/market-live.css?v=20260901-1958',
  '/assets/market-live-v2.js?v=20260901-1958',
  '/assets/market-native-checkout.js?v=20260903-1',
  '/assets/market-payment.js?v=20260903-1',
  '/assets/minimal-v5.css?v=20260901-2228',
  '/manifest.webmanifest',
  '/icon.svg'
];
let lastMarketWarm=0;

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k.startsWith('vestaland-')&&!([CACHE,MARKET_CACHE,IMAGE_CACHE].includes(k))).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

async function cachedMarket(request){
  const cache=await caches.open(MARKET_CACHE);
  const cached=await cache.match(request);
  const refresh=fetch(request,{cache:'no-store'}).then(async response=>{
    if(response.ok) await cache.put(request,response.clone());
    return response;
  });
  if(cached){
    const date=Date.parse(cached.headers.get('date')||'')||0;
    const age=Date.now()-date;
    if(age<180000){
      refresh.catch(()=>{});
      return cached;
    }
    try{return await refresh}catch(_){return cached}
  }
  return refresh;
}

async function cachedImage(request){
  const cache=await caches.open(IMAGE_CACHE);
  const cached=await cache.match(request);
  if(cached) return cached;
  const response=await fetch(request,{cache:'no-store'});
  if(response.ok) await cache.put(request,response.clone());
  return response;
}

async function prewarmMarket(){
  if(Date.now()-lastMarketWarm<120000) return;
  lastMarketWarm=Date.now();
  try{
    const request=new Request('/api/market/products?store=all&per_page=30',{method:'GET'});
    const response=await fetch(request,{cache:'no-store'});
    if(!response.ok) return;
    const marketCache=await caches.open(MARKET_CACHE);
    await marketCache.put(request,response.clone());
    const data=await response.json();
    const urls=[...new Set((data.items||[]).slice(0,10).map(x=>x.image).filter(Boolean))];
    const imageCache=await caches.open(IMAGE_CACHE);
    await Promise.allSettled(urls.map(async url=>{
      const req=new Request(url,{method:'GET'});
      if(await imageCache.match(req)) return;
      const res=await fetch(req,{cache:'no-store'});
      if(res.ok) await imageCache.put(req,res.clone());
    }));
  }catch(_){ }
}

self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin) return;

  if(event.request.method==='GET'&&url.pathname==='/api/market/image'){
    event.respondWith(cachedImage(event.request));
    return;
  }

  if(event.request.method==='GET'&&[
    '/api/market/products','/api/market/categories','/api/market/product'
  ].includes(url.pathname)){
    event.respondWith(cachedMarket(event.request));
    return;
  }

  if(url.pathname.startsWith('/api/')){
    event.respondWith(fetch(event.request,{cache:'no-store'}));
    return;
  }
  if(event.request.method!=='GET') return;

  if(event.request.mode==='navigate'){
    event.waitUntil(prewarmMarket());
    event.respondWith(
      fetch(event.request,{cache:'no-store'})
        .then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(c=>c.put('/index.html',copy));}return response;})
        .catch(()=>caches.match('/index.html'))
    );
    return;
  }

  event.respondWith(
    fetch(event.request,{cache:'no-store'})
      .then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));}return response;})
      .catch(()=>caches.match(event.request))
  );
});
