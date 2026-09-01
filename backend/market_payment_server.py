#!/usr/bin/env python3
import argparse
import json
import secrets
import sqlite3
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STORES = {
    'vesta': {'name': 'وستا', 'base': 'https://vesta-cosmetics.ir'},
    'cutella': {'name': 'کیوتلا', 'base': 'https://cutellashop.ir'},
}
HAMOON_BASE = 'https://pay.hamooncloud.ir/payments/vestaland-market'
UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131 Safari/537.36 VestalandMarketPayment/1.0'
SSL = ssl.create_default_context()
MAX_BODY = 128 * 1024
INTENT_TTL = 30 * 60
DB_PATH = '/var/lib/vestaland/market-payments.db'


def now_ts():
    return int(time.time())


def request_json(url, method='GET', body=None, timeout=18):
    raw = None if body is None else json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    headers = {'Accept': 'application/json', 'User-Agent': UA, 'Cache-Control': 'no-cache'}
    if raw is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=raw, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=SSL) as res:
            return json.loads(res.read().decode('utf-8')), res.status
    except urllib.error.HTTPError as exc:
        text = exc.read().decode('utf-8', errors='replace')[:1000]
        try:
            payload = json.loads(text)
            message = payload.get('error') or payload.get('message') or text
        except Exception:
            message = text
        raise ValueError(f'HTTP {exc.code}: {message}')
    except Exception as exc:
        raise ValueError(f'ارتباط برقرار نشد: {exc}')


def store_url(store, endpoint):
    if store not in STORES:
        raise ValueError('فروشگاه نامعتبر است.')
    return STORES[store]['base'].rstrip('/') + '/wp-json/wc/store/v1/' + endpoint.lstrip('/')


def price_toman(prices):
    prices = prices or {}
    raw = prices.get('price')
    if raw in (None, ''):
        return None
    try:
        value = int(raw)
    except Exception:
        return None
    minor = int(prices.get('currency_minor_unit') or 0)
    code = str(prices.get('currency_code') or '').upper()
    if minor:
        value = value / (10 ** minor)
    if code == 'IRR':
        value = value / 10
    return int(round(value))


def authoritative_item(store, raw):
    pid = int(raw.get('id') or 0)
    qty = max(1, min(20, int(raw.get('quantity') or 1)))
    if pid <= 0:
        raise ValueError('محصول نامعتبر است.')
    product, _ = request_json(store_url(store, f'products/{pid}'))
    price = price_toman(product.get('prices'))
    if price is None or price <= 0:
        raise ValueError('قیمت محصول معتبر نیست.')
    if not bool(product.get('is_in_stock')) or not bool(product.get('is_purchasable')):
        raise ValueError(f"محصول «{product.get('name') or pid}» قابل خرید نیست.")
    return {
        'id': pid,
        'parent_id': int(raw.get('parent_id') or 0) or None,
        'quantity': qty,
        'name': str(product.get('name') or ''),
        'variation': str(product.get('variation') or ''),
        'price_toman': price,
        'line_total_toman': price * qty,
    }


def clean_address(value):
    if not isinstance(value, dict):
        raise ValueError('آدرس تحویل معتبر نیست.')
    out = {}
    limits = {
        'first_name': 80, 'last_name': 80, 'phone': 32, 'email': 160,
        'city': 100, 'state': 100, 'address_1': 300, 'postcode': 32, 'country': 8,
    }
    for key, limit in limits.items():
        out[key] = str(value.get(key) or '').strip()[:limit]
    for key in ('first_name', 'last_name', 'phone', 'city', 'state', 'address_1', 'postcode'):
        if not out[key]:
            raise ValueError('اطلاعات آدرس کامل نیست.')
    out['country'] = 'IR'
    return out


def db():
    conn = sqlite3.connect(DB_PATH, timeout=20)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(path):
    global DB_PATH
    DB_PATH = path
    conn = db()
    conn.executescript('''
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS market_payment_intents(
      intent TEXT PRIMARY KEY,
      store TEXT NOT NULL,
      amount_toman INTEGER NOT NULL,
      items_json TEXT NOT NULL,
      address_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      receipt TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      paid_at INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_market_receipt ON market_payment_intents(receipt) WHERE receipt IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_market_status ON market_payment_intents(status, created_at);
    CREATE TABLE IF NOT EXISTS market_orders(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      intent TEXT NOT NULL UNIQUE,
      receipt TEXT NOT NULL UNIQUE,
      store TEXT NOT NULL,
      amount_toman INTEGER NOT NULL,
      items_json TEXT NOT NULL,
      address_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'paid',
      created_at INTEGER NOT NULL
    );
    ''')
    conn.commit()
    conn.close()


def create_intent(body):
    store = str(body.get('store') or '')
    if store not in STORES:
        raise ValueError('فروشگاه نامعتبر است.')
    raw_items = body.get('items') or []
    if not isinstance(raw_items, list) or not raw_items or len(raw_items) > 50:
        raise ValueError('سبد خرید معتبر نیست.')
    address = clean_address(body.get('billing_address') or body.get('shipping_address') or {})
    items = [authoritative_item(store, row if isinstance(row, dict) else {}) for row in raw_items]
    amount = sum(int(x['line_total_toman']) for x in items)
    if amount < 1000 or amount > 500_000_000:
        raise ValueError('مبلغ سفارش معتبر نیست.')
    intent = secrets.token_urlsafe(32)
    created = now_ts()
    expires = created + INTENT_TTL
    conn = db()
    conn.execute(
        'INSERT INTO market_payment_intents(intent,store,amount_toman,items_json,address_json,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)',
        (intent, store, amount, json.dumps(items, ensure_ascii=False, separators=(',', ':')),
         json.dumps(address, ensure_ascii=False, separators=(',', ':')), 'pending', created, expires)
    )
    conn.commit(); conn.close()
    return {
        'ok': True,
        'intent': intent,
        'store': store,
        'amount_toman': amount,
        'shipping_toman': 0,
        'url': f'{HAMOON_BASE}/start?intent={urllib.parse.quote(intent)}',
        'expires_at': expires,
    }


def get_intent(intent):
    if len(intent) < 20:
        return None
    conn = db(); row = conn.execute('SELECT * FROM market_payment_intents WHERE intent=? LIMIT 1', (intent,)).fetchone(); conn.close()
    return dict(row) if row else None


def hamoon_status(receipt):
    data, _ = request_json(f'{HAMOON_BASE}/status?receipt={urllib.parse.quote(receipt)}')
    return data


def confirm_payment(body):
    receipt = str(body.get('receipt') or '').strip()
    intent = str(body.get('intent') or '').strip()
    if not receipt or not intent:
        raise ValueError('رسید پرداخت ناقص است.')
    row = get_intent(intent)
    if not row:
        raise ValueError('سفارش پرداخت پیدا نشد.')
    if row['status'] == 'paid' and row.get('receipt') == receipt:
        return {'ok': True, 'store': row['store'], 'amount_toman': int(row['amount_toman']), 'receipt': receipt, 'intent': intent, 'already_confirmed': True}
    status = hamoon_status(receipt)
    if not status.get('ok') or status.get('status') != 'paid':
        raise ValueError('پرداخت هنوز توسط هامون تأیید نشده است.')
    if str(status.get('intent') or '') != intent:
        raise ValueError('رسید با سفارش مطابقت ندارد.')
    if int(status.get('amount_toman') or 0) != int(row['amount_toman']):
        raise ValueError('مبلغ پرداخت با سفارش مطابقت ندارد.')
    paid = now_ts()
    conn = db()
    try:
        conn.execute('BEGIN IMMEDIATE')
        fresh = conn.execute('SELECT * FROM market_payment_intents WHERE intent=? LIMIT 1', (intent,)).fetchone()
        if not fresh:
            raise ValueError('سفارش پیدا نشد.')
        if fresh['status'] != 'paid':
            conn.execute('UPDATE market_payment_intents SET status=?,receipt=?,paid_at=? WHERE intent=?', ('paid', receipt, paid, intent))
            conn.execute(
                'INSERT OR IGNORE INTO market_orders(intent,receipt,store,amount_toman,items_json,address_json,status,created_at) VALUES(?,?,?,?,?,?,?,?)',
                (intent, receipt, fresh['store'], fresh['amount_toman'], fresh['items_json'], fresh['address_json'], 'paid', paid)
            )
        conn.commit()
    finally:
        conn.close()
    return {'ok': True, 'store': row['store'], 'amount_toman': int(row['amount_toman']), 'receipt': receipt, 'intent': intent}


class Handler(BaseHTTPRequestHandler):
    server_version = 'VestalandMarketPayment/1.0'
    def log_message(self, fmt, *args):
        print('%s - %s' % (self.address_string(), fmt % args), flush=True)
    def send_json(self, status, payload):
        raw = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers(); self.wfile.write(raw)
    def read_json(self):
        try: length = int(self.headers.get('Content-Length', '0'))
        except Exception: length = 0
        if length <= 0 or length > MAX_BODY:
            raise ValueError('درخواست نامعتبر است.')
        try: return json.loads(self.rfile.read(length).decode('utf-8'))
        except Exception: raise ValueError('JSON نامعتبر است.')
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip('/') or '/'
        qs = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items() if v}
        try:
            if path == '/api/market-payment/health':
                return self.send_json(200, {'ok': True, 'service': 'vestaland-market-payment', 'version': 1, 'gateway': 'pay.hamooncloud.ir'})
            if path == '/api/market-payment/intent':
                row = get_intent(str(qs.get('intent') or ''))
                if not row: return self.send_json(404, {'ok': False, 'error': 'NOT_FOUND'})
                if row['status'] != 'pending' or int(row['expires_at']) < now_ts():
                    return self.send_json(409, {'ok': False, 'error': 'INTENT_NOT_PAYABLE'})
                return self.send_json(200, {
                    'ok': True, 'intent': row['intent'], 'store': row['store'],
                    'store_name': STORES[row['store']]['name'], 'amount_toman': int(row['amount_toman']),
                    'status': row['status'], 'expires_at': int(row['expires_at']),
                    'label': f"خرید از {STORES[row['store']]['name']} در وستالند"
                })
            return self.send_json(404, {'ok': False, 'error': 'NOT_FOUND'})
        except ValueError as exc:
            return self.send_json(422, {'ok': False, 'error': str(exc)})
        except Exception as exc:
            return self.send_json(500, {'ok': False, 'error': str(exc)})
    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip('/') or '/'
        try:
            body = self.read_json()
            if path == '/api/market-payment/start':
                return self.send_json(200, create_intent(body))
            if path == '/api/market-payment/confirm':
                return self.send_json(200, confirm_payment(body))
            return self.send_json(404, {'ok': False, 'error': 'NOT_FOUND'})
        except ValueError as exc:
            return self.send_json(422, {'ok': False, 'error': str(exc)})
        except Exception as exc:
            return self.send_json(500, {'ok': False, 'error': str(exc)})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8767)
    parser.add_argument('--db', default=DB_PATH)
    args = parser.parse_args()
    init_db(args.db)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f'Vestaland market payment API listening on {args.host}:{args.port}', flush=True)
    server.serve_forever()

if __name__ == '__main__':
    main()
