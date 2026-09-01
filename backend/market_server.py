#!/usr/bin/env python3
import argparse, gzip, hashlib, json, os, ssl, threading, time
import urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STORES={
 'vesta':{'name':'وستا','base':'https://vesta-cosmetics.ir'},
 'cutella':{'name':'کیوتلا','base':'https://cutellashop.ir'},
}
UA='Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131 Safari/537.36 VestalandMarket/2.1'
SSL=ssl.create_default_context(); MAX_BODY=128*1024; MAX_IMAGE=10*1024*1024
CACHE={}; LOCK=threading.RLock(); IMG_DIR='/var/lib/vestaland/market-images'
os.makedirs(IMG_DIR,exist_ok=True)
ALLOWED={urllib.parse.urlparse(v['base']).hostname for v in STORES.values()}

def cget(key,ttl,stale=1200):
 now=time.time()
 with LOCK: row=CACHE.get(key)
 if not row:return None,None
 age=now-row[0]
 return (row[1],'fresh') if age<=ttl else ((row[1],'stale') if age<=stale else (None,None))
def cached(key,ttl,fn,stale=1200):
 val,state=cget(key,ttl,stale)
 if state=='fresh':return val
 try:
  val=fn()
  with LOCK:
   CACHE[key]=(time.time(),val)
   if len(CACHE)>800:
    for k,_ in sorted(CACHE.items(),key=lambda x:x[1][0])[:150]:CACHE.pop(k,None)
  return val
 except Exception:
  if val is not None:return val
  raise

def request_json(url,method='GET',body=None,headers=None,timeout=14):
 raw=None if body is None else json.dumps(body,ensure_ascii=False,separators=(',',':')).encode()
 h={'Accept':'application/json','User-Agent':UA,'Accept-Encoding':'identity',**(headers or {})}
 if raw is not None:h['Content-Type']='application/json'
 req=urllib.request.Request(url,data=raw,headers=h,method=method)
 try:
  with urllib.request.urlopen(req,timeout=timeout,context=SSL) as r:
   return json.loads(r.read().decode()),dict(r.headers.items()),r.status
 except urllib.error.HTTPError as e:
  t=e.read().decode(errors='replace')[:1200]
  try:
   d=json.loads(t); msg=d.get('message') or d.get('error') or t
  except Exception:msg=t
  raise ValueError(f'فروشگاه HTTP {e.code}: {msg}')
 except Exception as e:raise ValueError(f'ارتباط با فروشگاه برقرار نشد: {e}')

def surl(store,endpoint,params=None):
 if store not in STORES:raise ValueError('فروشگاه نامعتبر است.')
 u=STORES[store]['base'].rstrip('/')+'/wp-json/wc/store/v1/'+endpoint.lstrip('/')
 if params:
  q={k:v for k,v in params.items() if v not in (None,'',[])}
  if q:u+='?'+urllib.parse.urlencode(q,doseq=True)
 return u

def money(p):
 p=p or {}; minor=int(p.get('currency_minor_unit') or 0); code=str(p.get('currency_code') or '').upper()
 def cv(v):
  if v in (None,''):return None
  try:n=int(v)
  except:return None
  if minor:n/=10**minor
  if code=='IRR':n/=10
  return int(round(n))
 return {'price':cv(p.get('price')),'regular_price':cv(p.get('regular_price')),'sale_price':cv(p.get('sale_price')),'currency_code':'IRT' if code=='IRR' else code,'currency_symbol':'تومان' if code in {'IRR','IRT'} else (p.get('currency_symbol') or code)}
def pimg(u):return '/api/market/image?url='+urllib.parse.quote(u,safe='') if u else ''
def nimg(x):
 src=x.get('src') or ''; thumb=x.get('thumbnail') or src
 return {'src':pimg(src),'thumb':pimg(thumb),'alt':x.get('alt') or x.get('name') or ''}
def payload(store,p,full=False):
 rawimgs=p.get('images') or []; imgs=[nimg(x) for x in (rawimgs[:10] if full else rawimgs[:1])]
 cats=p.get('categories') or []; m=money(p.get('prices')); add=p.get('add_to_cart') or {}
 out={'store':store,'store_name':STORES[store]['name'],'id':int(p.get('id') or 0),'name':p.get('name') or '','type':p.get('type') or '','variation':p.get('variation') or '','permalink':p.get('permalink') or '','sku':p.get('sku') or '','image':(imgs[0].get('thumb') or imgs[0].get('src')) if imgs else '','images':imgs,'categories':[{'id':x.get('id'),'name':x.get('name') or ''} for x in cats[:3]],'on_sale':bool(p.get('on_sale')),'is_in_stock':bool(p.get('is_in_stock')),'is_purchasable':bool(p.get('is_purchasable')),'has_options':bool(p.get('has_options')) or p.get('type')=='variable','add_text':add.get('text') or '',**m}
 if full:out.update({'slug':p.get('slug') or '','summary':p.get('short_description') or '','description':p.get('description') or '','average_rating':p.get('average_rating') or '0','review_count':int(p.get('review_count') or 0),'images':[nimg(x) for x in rawimgs[:10]]})
 return out

def products_raw(store,params):
 page=max(1,min(1000,int(params.get('page') or 1))); pp=max(1,min(60,int(params.get('per_page') or 20)))
 q={'page':page,'per_page':pp,'orderby':'date','order':'desc'}
 for k in ('search','category','include','exclude','type','parent'):
  if params.get(k):q[k]=params[k]
 data,h,_=request_json(surl(store,'products',q))
 if not isinstance(data,list):raise ValueError('پاسخ محصولات فروشگاه معتبر نیست.')
 return {'store':store,'items':[payload(store,p,False) for p in data],'total':int(h.get('X-WP-Total') or h.get('x-wp-total') or len(data)),'pages':int(h.get('X-WP-TotalPages') or h.get('x-wp-totalpages') or 1),'page':page}
def products(store,params):
 stable=tuple(sorted((k,str(v)) for k,v in params.items() if k in {'page','per_page','search','category','include','exclude','type','parent'}))
 return cached(('products',store,stable),45 if params.get('search') else 90,lambda:products_raw(store,params))
def categories_raw(store):
 d,_,_=request_json(surl(store,'products/categories',{'per_page':100,'hide_empty':'true'}))
 if not isinstance(d,list):return []
 return [{'store':store,'id':int(x.get('id') or 0),'name':x.get('name') or '','slug':x.get('slug') or '','count':int(x.get('count') or 0)} for x in d]
def categories(store):return cached(('categories',store),600,lambda:categories_raw(store),3600)
def product(store,pid):return cached(('product',store,int(pid)),180,lambda:payload(store,request_json(surl(store,f'products/{int(pid)}'))[0],True),1800)

def image_file(url):
 key=hashlib.sha256(url.encode()).hexdigest(); return key,os.path.join(IMG_DIR,key+'.bin'),os.path.join(IMG_DIR,key+'.json')
def image(url):
 u=urllib.parse.urlparse(url)
 if u.scheme!='https' or u.hostname not in ALLOWED:raise ValueError('آدرس تصویر مجاز نیست.')
 key,bp,mp=image_file(url)
 if os.path.isfile(bp) and os.path.isfile(mp) and time.time()-os.path.getmtime(bp)<7*86400:
  try:
   meta=json.load(open(mp,encoding='utf-8')); return open(bp,'rb').read(),meta.get('content_type') or 'image/jpeg',key
  except:pass
 ref=next((v['base']+'/' for v in STORES.values() if urllib.parse.urlparse(v['base']).hostname==u.hostname),'')
 req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'image/avif,image/webp,image/apng,image/*,*/*;q=0.8','Referer':ref})
 try:
  with urllib.request.urlopen(req,timeout=18,context=SSL) as r:
   ct=(r.headers.get('Content-Type') or 'image/jpeg').split(';')[0].lower(); data=r.read(MAX_IMAGE+1)
   if not ct.startswith('image/') or len(data)>MAX_IMAGE:raise ValueError('تصویر معتبر نیست.')
 except Exception as e:
  if os.path.isfile(bp):return open(bp,'rb').read(),'image/jpeg',key
  raise ValueError(f'تصویر دریافت نشد: {e}')
 try:
  tmp=bp+'.tmp'; open(tmp,'wb').write(data); os.replace(tmp,bp); json.dump({'content_type':ct,'url':url},open(mp,'w',encoding='utf-8'))
 except:pass
 return data,ct,key

def create_cart(store,items):
 cart,h,_=request_json(surl(store,'cart')); token=h.get('Cart-Token') or h.get('cart-token')
 if not token:raise ValueError('فروشگاه Cart-Token نداد؛ checkout headless پشتیبانی نمی‌شود.')
 hh={'Cart-Token':token}
 for x in items:
  pid=int(x.get('id') or 0); qty=max(1,min(20,int(x.get('quantity') or 1)))
  if not pid:raise ValueError('محصول نامعتبر است.')
  b={'id':pid,'quantity':qty}
  if isinstance(x.get('variation'),list) and x['variation']:b['variation']=x['variation']
  request_json(surl(store,'cart/add-item'),'POST',b,hh)
 return token,request_json(surl(store,'cart'),headers=hh)[0]
def totals(t):
 t=t or {}; code=str(t.get('currency_code') or '').upper(); minor=int(t.get('currency_minor_unit') or 0)
 def cv(v):
  try:n=int(v or 0)
  except:n=0
  if minor:n/=10**minor
  if code=='IRR':n/=10
  return int(round(n))
 return {'items':cv(t.get('total_items')),'discount':cv(t.get('total_discount')),'shipping':cv(t.get('total_shipping')),'tax':cv(t.get('total_tax')),'total':cv(t.get('total_price')),'currency':'تومان' if code in {'IRR','IRT'} else code}
def quote(store,items):
 token,c=create_cart(store,items); return {'cart_token':token,'payment_methods':c.get('payment_methods') or [],'needs_shipping':bool(c.get('needs_shipping')),'totals':totals(c.get('totals')),'items_count':len(c.get('items') or [])}
def checkout(store,b):
 items=b.get('items') or []
 if not isinstance(items,list) or not items:raise ValueError('سبد خرید خالی است.')
 token,c=create_cart(store,items); methods=c.get('payment_methods') or []; method=str(b.get('payment_method') or '').strip()
 if not method:
  if not methods:raise ValueError('هیچ روش پرداخت آنلاینی از فروشگاه دریافت نشد.')
  method=methods[0]
 if methods and method not in methods:raise ValueError('روش پرداخت انتخاب‌شده در فروشگاه فعال نیست.')
 bill=b.get('billing_address') or {}; ship=b.get('shipping_address') or bill
 d,_,_=request_json(surl(store,'checkout'),'POST',{'billing_address':bill,'shipping_address':ship,'payment_method':method,'payment_data':b.get('payment_data') or [],'customer_note':str(b.get('customer_note') or '')[:500],'create_account':False},{'Cart-Token':token},30)
 pr=d.get('payment_result') or {}; red=pr.get('redirect_url') or pr.get('redirect') or (STORES[store]['base'] if d.get('order_id') else '')
 return {'ok':True,'store':store,'order_id':d.get('order_id'),'status':d.get('status') or '','payment_method':method,'payment_status':pr.get('payment_status') or '','redirect_url':red}

class Handler(BaseHTTPRequestHandler):
 server_version='VestalandMarket/2.1'
 def log_message(self,fmt,*a):print('%s - %s'%(self.address_string(),fmt%a),flush=True)
 def send_json(self,status,obj,cache='no-store'):
  raw=json.dumps(obj,ensure_ascii=False,separators=(',',':')).encode(); use_gzip='gzip' in (self.headers.get('Accept-Encoding') or '') and len(raw)>1024
  if use_gzip:raw=gzip.compress(raw,compresslevel=5)
  self.send_response(status); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Content-Length',str(len(raw))); self.send_header('Cache-Control',cache); self.send_header('X-Content-Type-Options','nosniff')
  if use_gzip:self.send_header('Content-Encoding','gzip');self.send_header('Vary','Accept-Encoding')
  self.end_headers();self.wfile.write(raw)
 def send_img(self,data,ct,etag):
  tag='"'+etag+'"'
  if self.headers.get('If-None-Match')==tag:self.send_response(304);self.send_header('ETag',tag);self.send_header('Cache-Control','public, max-age=604800, immutable');self.end_headers();return
  self.send_response(200);self.send_header('Content-Type',ct);self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','public, max-age=604800, immutable');self.send_header('ETag',tag);self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.wfile.write(data)
 def body(self):
  try:n=int(self.headers.get('Content-Length','0'))
  except:n=0
  if n<=0 or n>MAX_BODY:raise ValueError('درخواست نامعتبر است.')
  try:return json.loads(self.rfile.read(n).decode())
  except:raise ValueError('JSON نامعتبر است.')
 def do_GET(self):
  p=urllib.parse.urlparse(self.path); path=p.path.rstrip('/') or '/'; q0=urllib.parse.parse_qs(p.query); q={k:v[0] for k,v in q0.items() if v}
  try:
   if path=='/api/market/health':return self.send_json(200,{'ok':True,'service':'vestaland-market','version':4,'stores':list(STORES)})
   if path=='/api/market/image':
    d,ct,e=image(q.get('url') or '');return self.send_img(d,ct,e)
   if path=='/api/market/products':
    st=q.get('store','all')
    if st=='all':
     with ThreadPoolExecutor(max_workers=2) as ex:
      fs={s:ex.submit(products,s,q) for s in STORES}; rs=[]; errs={}
      for s,f in fs.items():
       try:rs.append(f.result())
       except Exception as e:errs[s]=str(e)
     items=[]
     for r in rs:items.extend(r['items'])
     items.sort(key=lambda x:x.get('id',0),reverse=True); page=int(q.get('page') or 1); pages=max([r.get('pages',1) for r in rs] or [1])
     return self.send_json(200,{'items':items,'stores':rs,'errors':errs,'page':page,'pages':pages,'has_more':page<pages},'public, max-age=30, stale-while-revalidate=120')
    r=products(st,q);r['has_more']=r.get('page',1)<r.get('pages',1);return self.send_json(200,r,'public, max-age=30, stale-while-revalidate=120')
   if path=='/api/market/categories':
    st=q.get('store','all')
    if st=='all':
     with ThreadPoolExecutor(max_workers=2) as ex:
      out=[]
      for rows in ex.map(categories,STORES):out.extend(rows)
     return self.send_json(200,{'categories':out},'public, max-age=300, stale-while-revalidate=900')
    return self.send_json(200,{'categories':categories(st)},'public, max-age=300, stale-while-revalidate=900')
   if path=='/api/market/product':return self.send_json(200,{'product':product(q.get('store',''),int(q.get('id') or 0))},'public, max-age=60, stale-while-revalidate=300')
   return self.send_json(404,{'error':'مسیر پیدا نشد.'})
  except Exception as e:return self.send_json(502 if isinstance(e,ValueError) else 500,{'error':str(e)})
 def do_POST(self):
  p=urllib.parse.urlparse(self.path); path=p.path.rstrip('/') or '/'
  try:b=self.body()
  except ValueError as e:return self.send_json(400,{'error':str(e)})
  try:
   st=str(b.get('store') or '')
   if st not in STORES:raise ValueError('فروشگاه نامعتبر است.')
   if path=='/api/market/quote':return self.send_json(200,{'ok':True,'store':st,**quote(st,b.get('items') or [])})
   if path=='/api/market/checkout':return self.send_json(200,checkout(st,b))
   return self.send_json(404,{'error':'مسیر پیدا نشد.'})
  except ValueError as e:return self.send_json(422,{'error':str(e)})
  except Exception as e:return self.send_json(500,{'error':str(e)})

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--host',default='127.0.0.1');ap.add_argument('--port',type=int,default=8766);a=ap.parse_args();s=ThreadingHTTPServer((a.host,a.port),Handler);print(f'Vestaland market API listening on {a.host}:{a.port}',flush=True);s.serve_forever()
if __name__=='__main__':main()
