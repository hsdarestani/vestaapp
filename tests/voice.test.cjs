const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const files=['index.html','app.js','commerce.js','splash.js'];
test('core app wording avoids repetitive excessively cutesy adjectives',()=>{
  for(const file of files){
    const content=fs.readFileSync(file,'utf8');
    for(const word of ['خوشگل','قشنگ','کوچولو','یه عالمه','بریم به وستالند']){
      assert.ok(!content.includes(word),file+' contains overused term: '+word);
    }
  }
});
test('navigation and payment messaging remain clear and actionable',()=>{
  const html=fs.readFileSync('index.html','utf8');
  const app=fs.readFileSync('app.js','utf8');
  const shop=fs.readFileSync('commerce.js','utf8');
  assert.match(html,/استایل، کمد و میز آرایش تو در یک جا/);
  assert.match(app,/محصولات فروشگاه‌ها/);
  assert.match(app,/ذخیره تنظیمات/);
  assert.match(shop,/پرداخت با موفقیت تأیید شد!/);
  assert.match(shop,/بازگشت به وستالند/);
  assert.match(html,/splash.js\?v=20261014-voice2/);
});
