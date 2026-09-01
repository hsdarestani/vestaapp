#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STORES = {
    'vesta': {'name': 'وستا', 'base': 'https://vesta-cosmetics.ir'},
    'cutella': {'name': 'کیوتلا', 'base': 'https://cutellashop.ir'},
}
MAX_BODY = 128 * 1024
MAX_IMAGE = 10 * 1024 * 1024
UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131 Safari/537.36 VestalandMarket/2.0'
SSL = ssl.create_default_context()
CACHE_LOCK = threading.RLock()
JSON_CACHE = {}
IMAGE_CACHE_DIR = os.environ.get('VESTALAND_MARKET_IMAGE_CACHE', '/var/lib/vestaland/market-images')
os.makedirs(IMAGE_CACHE_DIR, exist_ok=True)
ALLOWED_IMAGE_HOSTS = {urllib.parse.urlparse(x['base']).hostname for x in STORES.values()}


def cache_get(key, ttl, stale_ttl=900):
    now = time.time()
    with CACHE_LOCK:
        row = JSON_CACHE.get(key)
    if not row:
        return None, None
    age = now - row['ts']
    if age <= ttl:
        return row['value'], 'fresh'
    if age <= stale_ttl:
        return row['value'], 'stale'
    return None, None


def cache_set(key, value):
    with CACHE_LOCK:
        JSON_CACHE[key] = {'ts': time.time(), 'value': value}
        if len(JSON_CACHE) > 800:
            oldest = sorted(JSON_CACHE.items(), key=lambda kv: kv[1]['ts'])[:150]
            for k, _ in oldest:
                JSON_CACHE.pop(k, None)
    return value


def cached(key, ttl, loader, stale_ttl=900):
    value, state = cache_get(key, ttl, stale_ttl)
    if state == 'fresh':
        return value
    try:
        return cache_set(key, loader())
    except Exception:
        if value is not None:
            return value
        raise


def request_json(url, method='GET', body=None, headers=None, timeout=14):
    raw = None if body is None else json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    req_headers = {
        'Accept': 'application/json',
        'User-Agent': UA,
        'Accept-Encoding': 'identity',
        **(headers or {}),
    }
    if raw is not None:
        req_headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=raw, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=SSL) as res:
            data = json.loads(res.read().decode('utf-8'))
            return data, dict(res.headers.items()), res.status
    except urllib.error.HTTPError as exc:
        text = exc.read().decode('utf-8', errors='replace')[:1200]
        try:
            payload = json.loads(text)
            message = payload.get('message') or payload.get('error') or text
        except Exception:
            message = text
        raise ValueError(f'فروشگاه HTTP {exc.code}: {message}')
    except Exception as exc:
        raise ValueError(f'ارتباط با فروشگاه برقرار نشد: {exc}')


def store_url(store, endpoint, params=None):
    if store not in STORES:
        raise ValueError('فروشگاه نامعتبر است.')
    url = STORES[store]['base'].rstrip('/') + '/wp-json/wc/store/v1/' + endpoint.lstrip('/')
    if params:
        clean = {k: v for k, v in params.items() if v not in (None, '', [])}
        if clean:
            url += '?' + urllib.parse.urlencode(clean, doseq=True)
    return url


def money(prices):
    prices = prices or {}
    minor = int(prices.get('currency_minor_unit') or 0)
    code = str(prices.get('currency_code') or '').upper()
    def convert(value):
        if value in (None, ''):
            return None
        try:
            n = int(value)
        except Exception:
            return None
        if minor:
            n = n / (10 ** minor)
        if code == 'IRR':
            n = n / 10
        return int(round(n))
    return {
        'price': convert(prices.get('price')),
        'regular_price': convert(prices.get('regular_price')),
        'sale_price': convert(prices.get('sale_price')),
        'currency_code': 'IRT' if code == 'IRR' else code,
        'currency_symbol': 'تومان' if code in {'IRR', 'IRT'} else (prices.get('currency_symbol') or code),
    }


def image_proxy_url(url):
    if not url:
        return ''
    return '/api/market/image?url=' + urllib.parse.quote(url, safe='')


def normalize_image(x):
    src = x.get('src') or ''
    thumb = x.get('thumbnail') or src
    return {
        'src': image_proxy_url(src),
        'thumb': image_proxy_url(thumb),
        'alt': x.get('alt') or x.get('name') or '',
    }


def product_payload(store, p):
    images = p.get('images') or []
    normalized = [normalize_image(x) for x in images[:10]]
    categories = p.get('categories') or []
    mp = money(p.get('prices'))
    add = p.get('add_to_cart') or {}
    return {
        'store': store,
        'store_name': STORES[store]['name'],
        'id': int(p.get('id') or 0),
        'name': p.get('name') or '',
        'slug': p.get('slug') or '',
        'type': p.get('type') or '',
        'variation': p.get('variation') or '',
        'permalink': p.get('permalink') or '',
        'sku': p.get('sku') or '',
        'summary': p.get('short_description') or '',
        'description': p.get('description') or '',
        'image': (normalized[0].get('thumb') or normalized[0].get('src')) if normalized else '',
        'images': normalized,
        'categories': [{'id': x.get('id'), 'name': x.get('name') or '', 'slug': x.get('slug') or ''} for x in categories],
        'on_sale': bool(p.get('on_sale')),
        'is_in_stock': bool(p.get('is_in_stock')),
        'is_purchasable': bool(p.get('is_purchasable')),
        'has_options': bool(p.get('has_options')) or (p.get('type') == 'variable'),
        'average_rating': p.get('average_rating') or '0',
        'review_count': int(p.get('review_count') or 0),
        'add_text': add.get('text') or '',
        **mp,
    }


def fetch_products_uncached(store, params):
    page = max(1, min(1000, int(params.get('page') or 1)))
    per_page = max(1, min(60, int(params.get('per_page') or 16)))
    q = {'page': page, 'per_page': per_page, 'orderby': 'date', 'order': 'desc'}
    for key in ('search', 'category', 'include', 'exclude', 'type', 'parent'):
        if params.get(key):
            q[key] = params[key]
    data, headers, _ = request_json(store_url(store, 'products', q))
    if not isinstance(data, list):
        raise ValueError('پاسخ محصولات فروشگاه معتبر نیست.')
    return {
        'store': store,
        'items': [product_payload(store, p) for p in data],
        'total': int(headers.get('X-WP-Total') or headers.get('x-wp-total') or len(data)),
        'pages': int(headers.get('X-WP-TotalPages') or headers.get('x-wp-totalpages') or 1),
        'page': page,
    }


def fetch_products(store, params):
    stable = tuple(sorted((k, str(v)) for k, v in params.items() if k in {'page','per_page','search','category','include','exclude','type','parent'}))
    key = ('products', store, stable)
    ttl = 45 if params.get('search') else 90
    return cached(key, ttl, lambda: fetch_products_uncached(store, params), stale_ttl=1200)


def fetch_categories_uncached(store):
    data, _, _ = request_json(store_url(store, 'products/categories', {'per_page': 100, 'hide_empty': 'true'}))
    if not isinstance(data, list):
        return []
    return [{
        'store': store,
        'id': int(x.get('id') or 0),
        'name': x.get('name') or '',
        'slug': x.get('slug') or '',
        'count': int(x.get('count') or 0),
        'image': image_proxy_url(((x.get('image') or {}).get('thumbnail') or (x.get('image') or {}).get('src') or '') if isinstance(x.get('image'), dict) else ''),
    } for x in data]


def fetch_categories(store):
    return cached(('categories', store), 600, lambda: fetch_categories_uncached(store), stale_ttl=3600)


def fetch_product_uncached(store, product_id):
    data, _, _ = request_json(store_url(store, f'products/{int(product_id)}'))
    return product_payload(store, data)


def fetch_product(store, product_id):
    return cached(('product', store, int(product_id)), 180, lambda: fetch_product_uncached(store, product_id), stale_ttl=1800)


def image_cache_paths(url):
    key = hashlib.sha256(url.encode('utf-8')).hexdigest()
    return key, os.path.join(IMAGE_CACHE_DIR, key + '.bin'), os.path.join(IMAGE_CACHE_DIR, key + '.json')


def fetch_image(url):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname not in ALLOWED_IMAGE_HOSTS:
        raise ValueError('آدرس تصویر مجاز نیست.')
    key, bin_path, meta_path = image_cache_paths(url)
    if os.path.isfile(bin_path) and os.path.isfile(meta_path):
        try:
            with open(meta_path, 'r', encoding='utf-8') as f:
                meta = json.load(f)
            if time.time() - os.path.getmtime(bin_path) < 7 * 86400:
                with open(bin_path, 'rb') as f:
                    return f.read(), meta.get('content_type') or 'image/jpeg', key
        except Exception:
            pass
    referer = next((v['base'] + '/' for v in STORES.values() if urllib.parse.urlparse(v['base']).hostname == parsed.hostname), '')
    req = urllib.request.Request(url, headers={
        'User-Agent': UA,
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Referer': referer,
    })
    try:
        with urllib.request.urlopen(req, timeout=18, context=SSL) as res:
            ctype = (res.headers.get('Content-Type') or 'image/jpeg').split(';')[0].strip().lower()
            if not ctype.startswith('image/'):
                raise ValueError('پاسخ تصویر معتبر نیست.')
            data = res.read(MAX_IMAGE + 1)
            if len(data) > MAX_IMAGE:
                raise ValueError('تصویر بیش از حد بزرگ است.')
    except Exception as exc:
        if os.path.isfile(bin_path):
            try:
                with open(bin_path, 'rb') as f:
                    return f.read(), 'image/jpeg', key
            except Exception:
                pass
        raise ValueError(f'تصویر دریافت نشد: {exc}')
    try:
        tmp = bin_path + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(data)
        os.replace(tmp, bin_path)
        with open(meta_path, 'w', encoding='utf-8') as f:
            json.dump({'content_type': ctype, 'url': url}, f)
    except Exception:
        pass
    return data, ctype, key


def create_cart(store, items):
    cart, headers, _ = request_json(store_url(store, 'cart'))
    token = headers.get('Cart-Token') or headers.get('cart-token')
    if not token:
        raise ValueError('فروشگاه Cart-Token نداد؛ checkout headless پشتیبانی نمی‌شود.')
    req_headers = {'Cart-Token': token}
    for raw in items:
        pid = int(raw.get('id') or 0)
        qty = max(1, min(20, int(raw.get('quantity') or 1)))
        if not pid:
            raise ValueError('محصول نامعتبر است.')
        payload = {'id': pid, 'quantity': qty}
        variation = raw.get('variation')
        if isinstance(variation, list) and variation:
            payload['variation'] = variation
        request_json(store_url(store, 'cart/add-item'), 'POST', payload, req_headers)
    cart, _, _ = request_json(store_url(store, 'cart'), headers=req_headers)
    return token, cart


def normalize_totals(totals):
    totals = totals or {}
    code = str(totals.get('currency_code') or '').upper()
    minor = int(totals.get('currency_minor_unit') or 0)
    def cv(v):
        try:
            n = int(v or 0)
        except Exception:
            n = 0
        if minor:
            n = n / (10 ** minor)
        if code == 'IRR':
            n = n / 10
        return int(round(n))
    return {
        'items': cv(totals.get('total_items')),
        'discount': cv(totals.get('total_discount')),
        'shipping': cv(totals.get('total_shipping')),
        'tax': cv(totals.get('total_tax')),
        'total': cv(totals.get('total_price')),
        'currency': 'تومان' if code in {'IRR','IRT'} else code,
    }


def quote(store, items):
    token, cart = create_cart(store, items)
    return {
        'cart_token': token,
        'payment_methods': cart.get('payment_methods') or [],
        'needs_shipping': bool(cart.get('needs_shipping')),
        'totals': normalize_totals(cart.get('totals')),
        'items_count': len(cart.get('items') or []),
    }


def checkout(store, body):
    items = body.get('items') or []
    if not isinstance(items, list) or not items:
        raise ValueError('سبد خرید خالی است.')
    token, cart = create_cart(store, items)
    payment_methods = cart.get('payment_methods') or []
    method = str(body.get('payment_method') or '').strip()
    if not method:
        if not payment_methods:
            raise ValueError('هیچ روش پرداخت آنلاینی از فروشگاه دریافت نشد.')
        method = payment_methods[0]
    if payment_methods and method not in payment_methods:
        raise ValueError('روش پرداخت انتخاب‌شده در فروشگاه فعال نیست.')
    billing = body.get('billing_address') or {}
    shipping = body.get('shipping_address') or billing
    payload = {
        'billing_address': billing,
        'shipping_address': shipping,
        'payment_method': method,
        'payment_data': body.get('payment_data') or [],
        'customer_note': str(body.get('customer_note') or '')[:500],
        'create_account': False,
    }
    data, _, _ = request_json(store_url(store, 'checkout'), 'POST', payload, {'Cart-Token': token}, timeout=30)
    pr = data.get('payment_result') or {}
    redirect = pr.get('redirect_url') or pr.get('redirect') or ''
    if not redirect and data.get('order_id'):
        redirect = STORES[store]['base']
    return {
        'ok': True,
        'store': store,
        'order_id': data.get('order_id'),
        'status': data.get('status') or '',
        'payment_method': method,
        'payment_status': pr.get('payment_status') or '',
        'redirect_url': redirect,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = 'VestalandMarket/2.0'

    def log_message(self, fmt, *args):
        print('%s - %s' % (self.address_string(), fmt % args), flush=True)

    def send_json(self, status, payload, cache='no-store'):
        raw = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', cache)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(raw)

    def send_image(self, data, ctype, etag):
        tag = '"' + etag + '"'
        if self.headers.get('If-None-Match') == tag:
            self.send_response(304)
            self.send_header('ETag', tag)
            self.send_header('Cache-Control', 'public, max-age=604800, immutable')
            self.end_headers()
            return
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'public, max-age=604800, immutable')
        self.send_header('ETag', tag)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(data)

    def read_json(self):
        try:
            length = int(self.headers.get('Content-Length','0'))
        except Exception:
            length = 0
        if length <= 0 or length > MAX_BODY:
            raise ValueError('درخواست نامعتبر است.')
        try:
            return json.loads(self.rfile.read(length).decode('utf-8'))
        except Exception:
            raise ValueError('JSON نامعتبر است.')

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip('/') or '/'
        qs0 = urllib.parse.parse_qs(parsed.query)
        qs = {k: v[0] for k,v in qs0.items() if v}
        try:
            if path == '/api/market/health':
                return self.send_json(200, {'ok': True, 'service': 'vestaland-market', 'version': 3, 'stores': list(STORES)})
            if path == '/api/market/image':
                url = qs.get('url') or ''
                data, ctype, etag = fetch_image(url)
                return self.send_image(data, ctype, etag)
            if path == '/api/market/products':
                store = qs.get('store','all')
                if store == 'all':
                    with ThreadPoolExecutor(max_workers=2) as ex:
                        futures = {s: ex.submit(fetch_products, s, qs) for s in STORES}
                        results = []
                        errors = {}
                        for s,f in futures.items():
                            try:
                                results.append(f.result())
                            except Exception as exc:
                                errors[s] = str(exc)
                    items = []
                    for r in results:
                        items.extend(r['items'])
                    items.sort(key=lambda x: x.get('id',0), reverse=True)
                    max_pages = max([r.get('pages', 1) for r in results] or [1])
                    current = int(qs.get('page') or 1)
                    return self.send_json(200, {'items': items, 'stores': results, 'errors': errors, 'page': current, 'pages': max_pages, 'has_more': current < max_pages}, 'public, max-age=30, stale-while-revalidate=120')
                result = fetch_products(store, qs)
                result['has_more'] = result.get('page', 1) < result.get('pages', 1)
                return self.send_json(200, result, 'public, max-age=30, stale-while-revalidate=120')
            if path == '/api/market/categories':
                store = qs.get('store','all')
                if store == 'all':
                    with ThreadPoolExecutor(max_workers=2) as ex:
                        out = []
                        for s, rows in zip(STORES, ex.map(fetch_categories, STORES)):
                            out.extend(rows)
                    return self.send_json(200, {'categories': out}, 'public, max-age=300, stale-while-revalidate=900')
                return self.send_json(200, {'categories': fetch_categories(store)}, 'public, max-age=300, stale-while-revalidate=900')
            if path == '/api/market/product':
                store = qs.get('store','')
                pid = int(qs.get('id') or 0)
                return self.send_json(200, {'product': fetch_product(store,pid)}, 'public, max-age=60, stale-while-revalidate=300')
            return self.send_json(404, {'error':'مسیر پیدا نشد.'})
        except Exception as exc:
            return self.send_json(502 if isinstance(exc, ValueError) else 500, {'error': str(exc)})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip('/') or '/'
        try:
            body = self.read_json()
        except ValueError as exc:
            return self.send_json(400, {'error':str(exc)})
        try:
            store = str(body.get('store') or '')
            if store not in STORES:
                raise ValueError('فروشگاه نامعتبر است.')
            if path == '/api/market/quote':
                return self.send_json(200, {'ok':True,'store':store, **quote(store, body.get('items') or [])})
            if path == '/api/market/checkout':
                return self.send_json(200, checkout(store, body))
            return self.send_json(404, {'error':'مسیر پیدا نشد.'})
        except ValueError as exc:
            return self.send_json(422, {'error':str(exc)})
        except Exception as exc:
            return self.send_json(500, {'error':str(exc)})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8766)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host,args.port), Handler)
    print(f'Vestaland market API v2 listening on {args.host}:{args.port}', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
