const CACHE='vestaland-v10';
const CORE=[
  '/',
  '/index.html',
  '/styles.css?v=20260901-1958',
  '/desktop-enhancements.css?v=20260901-1958',
  '/app.js?v=20260901-1958',
  '/assets/native.js?v=20260901-1958',
  '/assets/market-live.css?v=20260901-1958',
  '/assets/market-live-v2.js?v=20260901-1958',
  '/assets/market-native-checkout.js?v=20260901-1958',
  '/manifest.webmanifest',
  '/icon.svg'
];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k.startsWith('vestaland-')&&k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin) return;
  if(url.pathname.startsWith('/api/')){
    event.respondWith(fetch(event.request,{cache:'no-store'}));
    return;
  }
  if(event.request.method!=='GET') return;

  if(event.request.mode==='navigate'){
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
