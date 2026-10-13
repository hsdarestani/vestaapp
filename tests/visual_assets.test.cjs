const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const read=p=>fs.readFileSync(p,'utf8');
const html=read('index.html'),app=read('app.js'),commerce=read('commerce.js'),css=read('styles.css'),commerceCss=read('commerce.css');
const assetLinks=[...new Set([html,app,commerce,css,commerceCss].flatMap(s=>[...s.matchAll(/\/assets\/illustrations\/[a-z0-9-]+\.svg/g)].map(m=>m[0])))];

test('photo form uses a short, friendly hint without infrastructure details',()=>{
  assert.ok(html.includes('یه عکس بگیر تا مشخصات وسیله سریع‌تر تکمیل بشه.'));
  assert.ok(!html.includes('Cloudflare'));
  assert.ok(!html.includes('عکس اصلی روی همین دستگاه'));
  assert.match(html,/id="aiScanButton"/);
  assert.match(html,/id="itemCamera"/);
  assert.match(html,/id="itemPhoto"/);
});
test('illustration links are all existing local project assets',()=>{
  assert.ok(assetLinks.length>=4,'relevant artwork expected');
  for(const url of assetLinks)assert.ok(fs.existsSync(path.join('.',url)), 'missing asset '+url);
});
test('bottom navigation uses restrained SVG icons instead of emojis',()=>{
  const nav=html.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(nav);
  assert.equal((nav.match(/class="nav-icon"/g)||[]).length,5);
  assert.ok(!/[🏡👗💄🛍🧸]/u.test(nav));
});
test('real store images and recorded user photos remain primary imagery',()=>{
  assert.match(app,/p\.image&&p\.image\.startsWith/);
  assert.match(app,/const src=imgUrl\(item\)/);
  assert.match(app,/sectionImage\('closet'/);
  assert.match(app,/sectionImage\('beauty'/);
  assert.match(css,/\.tile-media img/);
});
