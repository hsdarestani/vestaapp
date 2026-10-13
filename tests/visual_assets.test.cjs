const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const read=p=>fs.readFileSync(p,'utf8');
const html=read('index.html'),app=read('app.js'),commerce=read('commerce.js'),css=read('styles.css'),commerceCss=read('commerce.css');
const photoLinks=[...new Set([html,app,commerce,css,commerceCss].flatMap(s=>[...s.matchAll(/\/assets\/photos\/[a-z0-9-]+\.webp/g)].map(m=>m[0])))];

test('photo form uses a short, friendly hint without infrastructure details',()=>{
  assert.ok(html.includes('یه عکس بگیر تا مشخصات وسیله سریع‌تر تکمیل بشه.'));
  assert.ok(!html.includes('Cloudflare'));
  assert.ok(!html.includes('عکس اصلی روی همین دستگاه'));
  assert.match(html,/id="aiScanButton"/);
  assert.match(html,/id="itemCamera"/);
  assert.match(html,/id="itemPhoto"/);
});
test('app uses real store photographs with reproducible source metadata',()=>{
  const producer=read('scripts/prepare-stock-photos.py');
  assert.ok(photoLinks.length>=7,'stock decoration photo links expected throughout UI');
  for(const url of photoLinks){
    const photo=path.basename(url,'.webp');
    assert.ok(producer.includes('"'+photo+'"'), 'unknown licensed stock photo: '+url);
  }
  assert.ok(read('scripts/prepare-stock-photos.py').includes('pexels.com/license/'));
  for(const page of [app,commerce,html])
    assert.ok(!page.includes('/assets/illustrations/'), 'no cartoon illustration references remain');
});
test('unphotographed personal wardrobe items are never falsely shown as store products',()=>{
  assert.match(app,/class="photo-empty"/);
  assert.match(app,/const src=imgUrl\(item\)/);
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
