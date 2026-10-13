// Cloudflare Workers Free: text-only, bounded inference. Never send identity,
// phone, payment info or private images. API key lives ONLY in Worker secret.
const MODEL = "@cf/meta/llama-3.2-1b-instruct";
const json = (status,value) => new Response(JSON.stringify(value),{
  status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}
});
export default {
  async fetch(request,env){
    if(request.method!=="POST")return json(405,{ok:false,error:"method"});
    if(!env.AI || !env.AI_SHARED_SECRET || env.AI_SHARED_SECRET.length<32) return json(503,{ok:false,error:"unconfigured"});
    const token=request.headers.get("Authorization")||"";
    if(token!=="Bearer "+env.AI_SHARED_SECRET)return json(401,{ok:false,error:"unauthorized"});
    if(Number(request.headers.get("content-length")||0)>12000)return json(413,{ok:false,error:"too_large"});
    let body;
    try {body=await request.json()}catch{return json(400,{ok:false,error:"invalid_json"})}
    if(!body || !Array.isArray(body.items))return json(400,{ok:false,error:"invalid_items"});
    const items=body.items.slice(0,18).filter(x=>x&&typeof x==="object").map(x=>({
      name:String(x.name||"").slice(0,55).replace(/[<>{}]/g,""),
      group:String(x.group||"").slice(0,20),
      color:String(x.color||"").slice(0,20),
      category:String(x.category||"").slice(0,30)
    }));
    const question=String(body.question||"برای امروز با وسایل خودم یک استایل کاربردی پیشنهاد بده.").slice(0,240).replace(/[<>{}]/g,"");
    const content=JSON.stringify({items,question});
    if(content.length>4500)return json(413,{ok:false,error:"too_large"});
    try{
      const result=await env.AI.run(MODEL,{
        messages:[
          {role:"system",content:"تو یک استایلیست فارسی‌زبان و مشاور زیبایی هستی. فقط بر اساس فهرست واقعی وسایل کاربر، ۲ تا ۴ جمله کوتاه و عملی بده. هرگز کالا، تاریخ مصرف یا موجودی خیالی ادعا نکن. جواب ساده، دوستانه، فارسی، حداکثر ۴۵۰ نویسه. توصیه پزشکی یا تشخیص پوست نده."},
          {role:"user",content}
        ],
        max_tokens:170,temperature:0.45,stream:false
      });
      const text=String(result.response||"").trim().slice(0,750);
      if(!text)return json(502,{ok:false,error:"empty_ai_answer"});
      return json(200,{ok:true,suggestion:text,model:MODEL});
    }catch(e){return json(503,{ok:false,error:"ai_temporarily_unavailable"})}
  }
};
