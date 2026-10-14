'use strict';
// Marketing captures of the real live UI using ONLY demo data in a temporary
// Playwright context. Never log in with real phone or use real customer records.
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');

const ORIGIN='https://app.vesta-cosmetics.ir';
const DEST=path.resolve('screenshots/bazaar');
const assets=[
  {id:'demo-top',group:'closet',category:'top',name:'شومیز سفید',color:'white',created:1770000000001,photo:null},
  {id:'demo-bottom',group:'closet',category:'bottom',name:'شلوار کرم',color:'cream',created:1770000000002,photo:null},
  {id:'demo-bag',group:'closet',category:'bag',name:'کیف صورتی',color:'pink',created:1770000000003,photo:null},
  {id:'demo-shoes',group:'closet',category:'shoes',name:'کتانی سفید',color:'white',created:1770000000004,photo:null},
  {id:'demo-lip',group:'beauty',category:'makeup',name:'رژ لب صورتی',color:'pink',routine:'none',created:1770000000005,opened:'2026-09-01',pao:12,photo:null},
  {id:'demo-care',group:'beauty',category:'skincare',name:'آبرسان صورت',color:'white',routine:'both',created:1770000000006,opened:'2026-09-15',pao:12,photo:null}
];
let activeBrowser=null;
(async()=>{
  fs.mkdirSync(DEST,{recursive:true});
  const browser=activeBrowser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const ctx=await browser.newContext({
    viewport:{width:432,height:768},deviceScaleFactor:2.5,
    isMobile:true,hasTouch:true,locale:'fa-IR',timezoneId:'Asia/Tehran',
    serviceWorkers:'block'
  });
  await ctx.addInitScript(()=>{
    localStorage.setItem('vestaland-session-v1','MARKETING_DEMO_NO_REAL_ACCOUNT');
    localStorage.setItem('vestaland-style-profile-v1',JSON.stringify({
      nickname:'',avatar:'🎀',style:'minimal',favoriteColors:['pink','white'],
      size:'M',shoeSize:'38',skin:'normal',makeup:'natural'
    }));
  });
  await ctx.route('**/api/account/**',async route=>{
    const u=new URL(route.request().url());const p=u.pathname;
    const now=Math.floor(Date.now()/1000);
    const json=x=>route.fulfill({status:200,contentType:'application/json; charset=utf-8',body:JSON.stringify(x),headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'}});
    if(p.endsWith('/config'))return json({ok:true,trial_days:7,
      plans:[{id:'monthly',price_toman:199000,duration_months:1},{id:'quarterly',price_toman:499000,duration_months:3}],
      features:{otp_enabled:true,login_required:false,subscriptions_enabled:true,
        ai_enabled:true,bazaar_enabled:false,store_checkout_enabled:true}});
    if(p.endsWith('/me'))return json({ok:true,user:{id:999,phone:'۰۹۱۲•••••••',active:true,plan:'trial',
      trial_until:now+7*86400,paid_until:0,expires_at:now+7*86400}});
    if(p.endsWith('/latest'))return json({ok:true,payment:null});
    if(p.endsWith('/orders'))return json({ok:true,orders:[]});
    return route.fulfill({status:404,contentType:'application/json',body:'{"ok":false}'});
  });
  const page=await ctx.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(ORIGIN+'/',{waitUntil:'domcontentloaded',timeout:50000});
  await page.waitForTimeout(1900);
  if(await page.locator('#entrySplash').count())await page.screenshot({path:path.join(DEST,'01-splash.png')});
  await page.waitForTimeout(5200);
  await page.evaluate((entries)=>new Promise((resolve,reject)=>{
    const req=indexedDB.open('vestaland-personal-v1',1);
    req.onupgradeneeded=()=>{
      if(!req.result.objectStoreNames.contains('items'))req.result.createObjectStore('items',{keyPath:'id'});
    };
    req.onerror=()=>reject(req.error);
    req.onsuccess=()=>{
      const db=req.result,tx=db.transaction('items','readwrite');
      for(const item of entries)tx.objectStore('items').put(item);
      tx.oncomplete=()=>{db.close();resolve()};
      tx.onerror=()=>reject(tx.error);
    };
  }),assets);
  await page.reload({waitUntil:'domcontentloaded',timeout:50000});
  await page.waitForTimeout(6500);
  await page.locator('#entrySplash[hidden],#entrySplash.entry-leaving').waitFor({timeout:19000});
  await page.addStyleTag({content:'.commerce-profile-status b{font-size:0!important}.commerce-profile-status b::after{content:"حساب نمونه";font-size:13px!important}'});
  const shot=async (file)=>{await page.waitForTimeout(420);await page.screenshot({path:path.join(DEST,file),animations:'disabled'})};
  await shot('02-home.png');
  for(const [route,name] of [['closet','03-wardrobe.png'],['beauty','04-beauty.png'],['shop','05-stores.png'],['me','06-profile.png']]){
    await page.locator('.bottom-nav button[data-route="'+route+'"]').click();
    await page.waitForTimeout(route==='shop'?2600:700);
    await shot(name);
  }
  const subscriptions=page.locator('button[data-commerce-open="plans"]').first();
  if(await subscriptions.count()){
    await subscriptions.click();
    await page.waitForTimeout(450);
    await shot('07-subscriptions.png');
  }
  const files=fs.readdirSync(DEST).filter(x=>x.endsWith('.png'));
  for(const file of files){
    const size=fs.statSync(path.join(DEST,file)).size;
    if(size<15000)throw Error('Unexpected small screenshot: '+file);
    console.log(file+' '+Math.round(size/1024)+' KiB');
  }
  console.log('Screens captured:',files.length);
  console.log('Browser page errors count:',errors.length);
  await browser.close();
  activeBrowser=null;
  if(files.length<6)throw Error('Expected six or more store screenshots');
})().catch(async e=>{console.error(e.stack||String(e));if(activeBrowser)await activeBrowser.close().catch(()=>{});process.exit(1)});
