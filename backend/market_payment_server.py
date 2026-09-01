#!/usr/bin/env python3
import argparse
import hashlib
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
    'vesta': {
        'name': 'وستا',
        'base': 'https://vesta-cosmetics.ir',
        'sync': 'https://ordersvesta.smarbiz.sbs/vestaland-order-sync',
    },
    'cutella': {
        'name': 'کیوتلا',
        'base': 'https://cutellashop.ir',
        'sync': 'https://orderscutella.smarbiz.sbs/vestaland-order-sync',
    },
}
HAMOON_BASE = 'https://pay.hamooncloud.ir/payments/vestaland-market'
UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131 Safari/537.36 VestalandMarketPayment/1.1'
SSL = ssl.create_default_context()
MAX_BODY = 128 * 1024
INTENT_TTL = 30 * 60
DB_PATH = '/var/lib/vestaland/market-payments.db'
ADDRESS_KEYS = (
    'first_name', 'last_name', 'company', 'phone', 'email', 'city', 'state',
    'address_1', 'address_2', 'postcode', 'country',
)


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
        text = exc.read().decode('utf-8', errors='replace')[:1200]
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
    limits = {
        'first_name': 80, 'last_name': 80, 'company': 120, 'phone': 32,
        'email': 160, 'city': 100, 'state': 100, 'address_1': 300,
        'address_2': 300, 'postcode': 32, 'country': 8,
    }
    out = {key: str(value.get(key) or '').strip()[:limits[key]] for key in ADDRESS_KEYS}
    for key in ('first_name', 'last_name', 'phone', 'city', 'state', 'address_1', 'postcode'):
        if not out[key]:
            raise ValueError('اطلاعات آدرس کامل نیست.')
    out['country'] = 'IR'
    return out


def normalized_hash_items(items):
    result = []
    for raw in items:
        result.append({
            'id': int(raw.get('id') or 0),
            'parent_id': int(raw.get('parent_id') or 0) or None,
            'quantity': max(1, min(20, int(raw.get('quantity') or 1))),
            'price_toman': int(raw.get('price_toman') or 0),
            'line_total_toman': int(raw.get('line_total_toman') or 0),
        })
    return result


def payload_hash(store, amount_toman, items, address):
    canonical = {
        'store': str(store),
        'amount_toman': int(amount_toman),
        'items': normalized_hash_items(items),
        'address': {key: str((address or {}).get(key) or '').strip() for key in ADDRESS_KEYS},
    }
    canonical['address']['country'] = 'IR'
    raw = json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    return hashlib.sha256(raw).hexdigest()


def db():
    conn = sqlite3.connect(DB_PATH, timeout=20)
    conn.row_factory = sqlite3.Row
    return conn


def add_column(conn, table, definition):
    try:
        conn.execute(f'ALTER TABLE {table} ADD COLUMN {definition}')
    except sqlite3.OperationalError as exc:
        if 'duplicate column name' not in str(exc).lower():
            raise


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
      payload_hash TEXT,
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
      payload_hash TEXT,
      status TEXT NOT NULL DEFAULT 'paid',
      woo_order_id INTEGER,
      woo_status TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      sync_error TEXT,
      created_at INTEGER NOT NULL,
      synced_at INTEGER
    );
    ''')
    add_column(conn, 'market_payment_intents', 'payload_hash TEXT')
    add_column(conn, 'market_orders', 'payload_hash TEXT')
    add_column(conn, 'market_orders', 'woo_order_id INTEGER')
    add_column(conn, 'market_orders', 'woo_status TEXT')
    add_column(conn, 'market_orders', "sync_status TEXT NOT NULL DEFAULT 'pending'")
    add_column(conn, 'market_orders', 'sync_error TEXT')
    add_column(conn, 'market_orders', 'synced_at INTEGER')
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
    digest = payload_hash(store, amount, items, address)
    intent = secrets.token_urlsafe(32)
    created = now_ts()
    expires = created + INTENT_TTL
    conn = db()
    conn.execute(
        'INSERT INTO market_payment_intents(intent,store,amount_toman,items_json,address_json,payload_hash,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)',
        (intent, store, amount, json.dumps(items, ensure_ascii=False, separators=(',', ':')),
         json.dumps(address, ensure_ascii=False, separators=(',', ':')), digest, 'pending', created, expires)
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
    conn = db()
    row = conn.execute('SELECT * FROM market_payment_intents WHERE intent=? LIMIT 1', (intent,)).fetchone()
    conn.close()
    if not row:
        return None
    result = dict(row)
    if not result.get('payload_hash'):
        items = json.loads(result['items_json'])
        address = json.loads(result['address_json'])
        result['payload_hash'] = payload_hash(result['store'], result['amount_toman'], items, address)
        conn = db()
        conn.execute('UPDATE market_payment_intents SET payload_hash=? WHERE intent=?', (result['payload_hash'], intent))
        conn.commit(); conn.close()
    return result


def hamoon_status(receipt):
    data, _ = request_json(f'{HAMOON_BASE}/status?receipt={urllib.parse.quote(receipt)}')
    return data


def get_market_order(intent):
    conn = db()
    row = conn.execute('SELECT * FROM market_orders WHERE intent=? LIMIT 1', (intent,)).fetchone()
    conn.close()
    return dict(row) if row else None


def sync_paid_order(row, receipt):
    intent = str(row['intent'])
    order = get_market_order(intent)
    if order and order.get('sync_status') == 'synced' and int(order.get('woo_order_id') or 0) > 0:
        return order

    items = json.loads(row['items_json'])
    address = json.loads(row['address_json'])
    digest = row.get('payload_hash') or payload_hash(row['store'], row['amount_toman'], items, address)
    body = {
        'store': row['store'],
        'receipt': receipt,
        'intent': intent,
        'amount_toman': int(row['amount_toman']),
        'payload_hash': digest,
        'items': normalized_hash_items(items),
        'address': {key: str(address.get(key) or '').strip() for key in ADDRESS_KEYS},
    }
    body['address']['country'] = 'IR'

    try:
        result, _ = request_json(STORES[row['store']]['sync'], method='POST', body=body, timeout=28)
        if not result.get('ok') or int(result.get('order_id') or 0) <= 0:
            raise ValueError(str(result.get('error') or 'فروشگاه شماره سفارش برنگرداند.'))
        synced = now_ts()
        conn = db()
        conn.execute(
            "UPDATE market_orders SET sync_status='synced',sync_error=NULL,woo_order_id=?,woo_status=?,synced_at=? WHERE intent=?",
            (int(result['order_id']), str(result.get('status') or ''), synced, intent)
        )
        conn.commit(); conn.close()
        return get_market_order(intent)
    except Exception as exc:
        error = str(exc)[:900]
        conn = db()
        conn.execute(
            "UPDATE market_orders SET sync_status='pending',sync_error=? WHERE intent=?",
            (error, intent)
        )
        conn.commit(); conn.close()
        return get_market_order(intent)


def confirm_payment(body):
    receipt = str(body.get('receipt') or '').strip().lower()
    intent = str(body.get('intent') or '').strip()
    if not receipt or not intent:
        raise ValueError('رسید پرداخت ناقص است.')
    row = get_intent(intent)
    if not row:
        raise ValueError('سفارش پرداخت پیدا نشد.')

    status = hamoon_status(receipt)
    if not status.get('ok') or status.get('status') != 'paid':
        raise ValueError('پرداخت هنوز توسط هامون تأیید نشده است.')
    if str(status.get('intent') or '') != intent:
        raise ValueError('رسید با سفارش مطابقت ندارد.')
    if str(status.get('plan') or '') != row['store']:
        raise ValueError('فروشگاه رسید با سفارش مطابقت ندارد.')
    if int(status.get('amount_toman') or 0) != int(row['amount_toman']):
        raise ValueError('مبلغ پرداخت با سفارش مطابقت ندارد.')
    digest = row.get('payload_hash') or payload_hash(row['store'], row['amount_toman'], json.loads(row['items_json']), json.loads(row['address_json']))
    if str(status.get('metadata_hash') or '').lower() != digest.lower():
        raise ValueError('سبد پرداخت‌شده با سفارش فعلی مطابقت ندارد.')

    paid = int(row.get('paid_at') or 0) or now_ts()
    conn = db()
    try:
        conn.execute('BEGIN IMMEDIATE')
        fresh = conn.execute('SELECT * FROM market_payment_intents WHERE intent=? LIMIT 1', (intent,)).fetchone()
        if not fresh:
            raise ValueError('سفارش پیدا نشد.')
        if fresh['status'] != 'paid' or str(fresh['receipt'] or '') != receipt:
            if fresh['status'] == 'paid' and fresh['receipt'] and str(fresh['receipt']) != receipt:
                raise ValueError('این سفارش قبلاً با رسید دیگری تأیید شده است.')
            conn.execute(
                'UPDATE market_payment_intents SET status=?,receipt=?,paid_at=?,payload_hash=? WHERE intent=?',
                ('paid', receipt, paid, digest, intent)
            )
        conn.execute(
            '''INSERT OR IGNORE INTO market_orders(
                 intent,receipt,store,amount_toman,items_json,address_json,payload_hash,status,sync_status,created_at
               ) VALUES(?,?,?,?,?,?,?,?,?,?)''',
            (intent, receipt, row['store'], row['amount_toman'], row['items_json'], row['address_json'], digest, 'paid', 'pending', paid)
        )
        conn.commit()
    finally:
        conn.close()

    fresh_row = get_intent(intent)
    synced = sync_paid_order(fresh_row, receipt)
    woo_id = int((synced or {}).get('woo_order_id') or 0)
    sync_status = str((synced or {}).get('sync_status') or 'pending')
    response = {
        'ok': True,
        'store': row['store'],
        'amount_toman': int(row['amount_toman']),
        'receipt': receipt,
        'intent': intent,
        'payment_confirmed': True,
        'woo_order_id': woo_id or None,
        'woo_status': (synced or {}).get('woo_status') or None,
        'sync_pending': sync_status != 'synced',
    }
    if response['sync_pending']:
        response['sync_error'] = (synced or {}).get('sync_error') or 'STORE_SYNC_PENDING'
    return response


class Handler(BaseHTTPRequestHandler):
    server_version = 'VestalandMarketPayment/1.1'
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
                return self.send_json(200, {'ok': True, 'service': 'vestaland-market-payment', 'version': 2, 'gateway': 'pay.hamooncloud.ir', 'woo_sync': True})
            if path == '/api/market-payment/intent':
                row = get_intent(str(qs.get('intent') or ''))
                if not row: return self.send_json(404, {'ok': False, 'error': 'NOT_FOUND'})
                if row['status'] != 'pending' or int(row['expires_at']) < now_ts():
                    return self.send_json(409, {'ok': False, 'error': 'INTENT_NOT_PAYABLE'})
                return self.send_json(200, {
                    'ok': True, 'intent': row['intent'], 'store': row['store'],
                    'store_name': STORES[row['store']]['name'], 'amount_toman': int(row['amount_toman']),
                    'payload_hash': row['payload_hash'],
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
