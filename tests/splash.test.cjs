const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

function harness({payment=false}={}){
  let now=0,nextId=1;
  const tasks=new Map();
  const el={
    hidden:false,
    attrs:{},
    classes:new Set(),
    classList:{add(name){el.classes.add(name)}},
    setAttribute(name,value){el.attrs[name]=value}
  };
  const status={textContent:''};
  const button={hidden:true,listener:null,addEventListener(event,fn){if(event==='click')this.listener=fn}};
  const doc={
    documentElement:{classList:{contains(name){return payment&&name==='skip-entry-splash'}}},
    getElementById(id){return {entrySplash:el,entrySplashStatus:status,entryContinue:button}[id]||null}
  };
  const setTimeoutFake=(callback,delay)=>{
    const id=nextId++;
    tasks.set(id,{at:now+Number(delay),callback});
    return id;
  };
  const clearTimeoutFake=(id)=>tasks.delete(id);
  const win={setTimeout:setTimeoutFake,clearTimeout:clearTimeoutFake,performance:{now:()=>now}};
  const ctx={window:win,document:doc,performance:win.performance,Date};
  vm.runInNewContext(fs.readFileSync('splash.js','utf8'),ctx,{filename:'splash.js',timeout:1000});
  function advance(duration){
    const end=now+duration;
    while(true){
      let eventId=null,at=Infinity;
      for(const [id,t] of tasks){
        if(t.at<=end&&t.at<at){eventId=id;at=t.at}
      }
      if(eventId==null)break;
      const t=tasks.get(eventId);
      tasks.delete(eventId);
      now=t.at;
      t.callback();
    }
    now=end;
  }
  return {el,status,button,api:win.VestalandSplash,advance,clock:()=>now};
}
test('splash waits at least 5.6 seconds even when all boot components are already ready',()=>{
  const s=harness();
  assert.equal(s.api.MIN_MS,5600);
  s.api.ready('inventory');
  s.api.ready('commerce');
  s.advance(5599);
  assert.equal(s.el.classes.has('entry-leaving'),false);
  s.advance(26);
  assert.equal(s.el.classes.has('entry-leaving'),true);
  assert.equal(s.el.attrs['aria-hidden'],'true');
  s.advance(700);
  assert.equal(s.el.hidden,true);
});
test('does not reveal unfinished app before both inventory and account are ready',()=>{
  const s=harness();
  s.api.ready('inventory');
  s.advance(7000);
  assert.equal(s.el.classes.has('entry-leaving'),false);
  s.api.ready('commerce');
  assert.equal(s.el.classes.has('entry-leaving'),true);
});
test('expired network loading never traps user behind entry screen',()=>{
  const s=harness();
  s.advance(9550);
  assert.equal(s.el.classes.has('entry-leaving'),false);
  assert.equal(s.button.hidden,false);
  assert.match(s.status.textContent,/اتصال/);
  s.button.listener();
  assert.equal(s.el.classes.has('entry-leaving'),true);
  const watchdog=harness();
  watchdog.advance(16010);
  assert.equal(watchdog.el.classes.has('entry-leaving'),true);
});
test('payment callback skips splash to show real payment receipt without delay',()=>{
  const s=harness({payment:true});
  assert.equal(s.el.hidden,true);
  s.advance(100);
  s.api.ready('inventory');
  s.api.ready('commerce');
  assert.equal(s.el.hidden,true);
});
test('HTML and worker assets match and boot stages signal readiness',()=>{
  const html=fs.readFileSync('index.html','utf8');
  const sw=fs.readFileSync('sw.js','utf8');
  const inventory=fs.readFileSync('app.js','utf8');
  const commerce=fs.readFileSync('commerce.js','utf8');
  assert.match(html,/id="entrySplash"/);
  assert.match(html,/\/splash\.js\?v=20261014-voice2/);
  assert.match(html,/\/splash\.css\?v=20261014-voice2/);
  assert.match(sw,/vestaland-clean-20261014-v3/);
  assert.match(sw,/\/splash\.css\?v=20261014-voice2/);
  assert.match(sw,/\/splash\.js\?v=20261014-voice2/);
  assert.match(inventory,/VestalandSplash\?\.ready\('inventory'\)/);
  assert.match(commerce,/VestalandSplash\?\.ready\('commerce'\)/);
  assert.match(html,/skip-entry-splash/);
});
