const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function makeApp(){
  const store = new Map();
  const rendered = {};
  const elements = new Map();
  const element = name => {
    if(!elements.has(name))elements.set(name,{
      innerHTML:'',textContent:'',value:'',
      classList:{add(){},remove(){},toggle(){}},
      addEventListener(){},focus(){},setSelectionRange(){}
    });
    return elements.get(name);
  };
  const mockFormData = class {
    constructor(form){this.values=form.values;}
    get(k){return this.values[k] ?? null;}
    getAll(k){return this.values[k] || [];}
  };
  let source = fs.readFileSync('app.js','utf8');
  const needle="const bootPromise=boot();\nwindow.VestalandInventory.ready=bootPromise;\nbootPromise.finally(()=>window.VestalandSplash?.ready('inventory'));\n})();";
  assert.ok(source.includes(needle),'expected app boot marker');
  source=source.replace(needle,'globalThis.__profileTests={meView,submitProfile,makeLook,loadProfile,state,getProfile:()=>profile};\n})();');
  const sandbox={
    globalThis:null,
    document:{
      querySelector:element,
      querySelectorAll(){return []},
      addEventListener(){},
    },
    window:{scrollTo(){}},
    localStorage:{
      getItem(k){return store.get(k)||null},
      setItem(k,v){store.set(k,v)}
    },
    FormData:mockFormData,
    setTimeout(){return 1},clearTimeout(){},
    URL,crypto:globalThis.crypto,Intl,Date,JSON,Object,Map,Array,Math,Number,String,
  };
  sandbox.globalThis=sandbox;
  vm.runInNewContext(source,sandbox,{timeout:1000,filename:'app.js'});
  return {app:sandbox.__profileTests,store,element};
}

test('profile page hides old data section and offers practical preferences',()=>{
  const {app}=makeApp();
  const html=app.meView();
  assert.match(html,/id="profileForm"/);
  for(const value of ['سایز لباس','سایز کفش','نوع پوست من','سبک پوشش','رنگ‌های مورد علاقه','روتین و میز آرایش']){
    assert.ok(html.includes(value),value);
  }
  for(const old of ['حریم خصوصی و داده‌ها','پشتیبان‌گیری از وسایل','بازگردانی پشتیبان','حذف همه وسایل این دستگاه','همگام‌سازی ابری و تشخیص AI']){
    assert.ok(!html.includes(old),'old information remained: '+old);
  }
});

test('profile preferences save locally and are used for outfit color priority',()=>{
  const {app,store}=makeApp();
  app.state.items=[
    {id:'top-pink',name:'پیراهن صورتی',group:'closet',category:'top',color:'pink'},
    {id:'top-blue',name:'پیراهن آبی',group:'closet',category:'top',color:'blue'},
    {id:'bottom',name:'شلوار کرم',group:'closet',category:'bottom',color:'cream'}
  ];
  app.submitProfile({
    preventDefault(){},
    target:{values:{nickname:'نیلی',avatar:'🐰',style:'casual',favoriteColors:['pink'],size:'M',shoeSize:'38',skin:'dry',makeup:'natural'}}
  });
  const saved=JSON.parse(store.get('vestaland-style-profile-v1'));
  assert.equal(saved.nickname,'نیلی');
  assert.equal(saved.size,'M');
  assert.deepEqual(saved.favoriteColors,['pink']);
  const html=app.meView();
  assert.ok(html.includes('نیلی'));
  assert.ok(html.includes('🐰'));
  app.makeLook();
  assert.ok(app.state.look.some(x=>x.id==='top-pink'),'favorite palette did not affect outfit');
});

test('saved settings do not overwrite existing wardrobe or makeup entries',()=>{
  const {app}=makeApp();
  app.state.items=[{id:'test',name:'item',group:'beauty',category:'makeup',color:'pink'}];
  app.submitProfile({
    preventDefault(){},
    target:{values:{nickname:'',avatar:'🎀',style:'minimal',favoriteColors:[],size:'نامشخص',shoeSize:'نامشخص',skin:'unknown',makeup:'soft'}}
  });
  assert.equal(app.state.items.length,1);
  assert.equal(app.state.items[0].id,'test');
});
