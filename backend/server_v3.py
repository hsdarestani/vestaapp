#!/usr/bin/env python3
import argparse
import base64
import datetime as dt
import json
import os
import secrets
import sqlite3
import subprocess
import tempfile
from urllib.parse import urlparse

import core_server as core
import server as v2

BAZAAR_PACKAGE = 'ir.vestaland.app'
BAZAAR_PRODUCTS = {
    '1m': 'vestaland_sub_1m',
    '3m': 'vestaland_sub_3m',
    '6m': 'vestaland_sub_6m',
}
CLAIM_TTL_MINUTES = 30
RESTORE_GRACE_DAYS = 7


def utcnow():
    return core.utcnow()


def iso_at(value):
    return core.iso_at(value)


def init_v3():
    conn = core.connect()
    conn.executescript('''
    CREATE TABLE IF NOT EXISTS bazaar_purchase_intents (
        intent TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan TEXT NOT NULL,
        developer_payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bazaar_intents_user ON bazaar_purchase_intents(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS bazaar_subscription_claims (
        purchase_token TEXT PRIMARY KEY,
        order_id TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan TEXT NOT NULL,
        product_id TEXT NOT NULL,
        purchase_time INTEGER NOT NULL,
        verification TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bazaar_claims_user ON bazaar_subscription_claims(user_id, last_seen_at DESC);
    ''')
    conn.commit()
    conn.close()


def clean_public_key(value):
    raw = (value or '').strip()
    if raw.startswith('-----BEGIN'):
        lines = [x.strip() for x in raw.splitlines() if x and not x.startswith('-----')]
        return ''.join(lines)
    return ''.join(raw.split())


def verify_bazaar_signature(original_json, signature_b64):
    public_key = clean_public_key(os.environ.get('BAZAAR_RSA_PUBLIC_KEY', ''))
    if not public_key:
        return False, 'challenge-bound'
    try:
        der = base64.b64decode(public_key, validate=True)
        signature = base64.b64decode(signature_b64 or '', validate=True)
    except Exception:
        return False, 'invalid-signature-data'
    try:
        with tempfile.TemporaryDirectory() as tmp:
            der_path = os.path.join(tmp, 'public.der')
            pem_path = os.path.join(tmp, 'public.pem')
            sig_path = os.path.join(tmp, 'purchase.sig')
            data_path = os.path.join(tmp, 'purchase.json')
            with open(der_path, 'wb') as f:
                f.write(der)
            with open(sig_path, 'wb') as f:
                f.write(signature)
            with open(data_path, 'wb') as f:
                f.write((original_json or '').encode('utf-8'))
            subprocess.run(
                ['openssl', 'pkey', '-pubin', '-inform', 'DER', '-in', der_path, '-out', pem_path],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5,
            )
            result = subprocess.run(
                ['openssl', 'dgst', '-sha1', '-verify', pem_path, '-signature', sig_path, data_path],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5,
            )
            return result.returncode == 0, 'rsa-sha1'
    except Exception:
        return False, 'signature-check-failed'


def parse_purchase(original_json):
    try:
        data = json.loads(original_json or '{}')
    except Exception:
        raise ValueError('اطلاعات خرید کافه‌بازار معتبر نیست.')
    if not isinstance(data, dict):
        raise ValueError('اطلاعات خرید کافه‌بازار معتبر نیست.')
    return {
        'order_id': str(data.get('orderId') or '').strip(),
        'purchase_token': str(data.get('purchaseToken') or '').strip(),
        'developer_payload': str(data.get('developerPayload') or '').strip(),
        'package_name': str(data.get('packageName') or '').strip(),
        'purchase_state': int(data.get('purchaseState') if data.get('purchaseState') is not None else -1),
        'purchase_time': int(data.get('purchaseTime') or 0),
        'product_id': str(data.get('productId') or '').strip(),
    }


def plan_from_product(product_id):
    for plan, sku in BAZAAR_PRODUCTS.items():
        if sku == product_id:
            return plan
    return None


def activate_user(conn, user_id, plan, purchase_time_ms, restore=False):
    row = conn.execute('SELECT * FROM users WHERE id=?', (user_id,)).fetchone()
    if not row:
        raise ValueError('حساب کاربر پیدا نشد.')
    now = utcnow()
    current_expiry = core.parse_iso(row['plan_expires_at'])
    if restore:
        target = now + dt.timedelta(days=RESTORE_GRACE_DAYS)
    else:
        purchased_at = dt.datetime.fromtimestamp(max(0, purchase_time_ms) / 1000, tz=dt.timezone.utc) if purchase_time_ms else now
        if purchased_at > now + dt.timedelta(minutes=10):
            purchased_at = now
        target = purchased_at + dt.timedelta(days=core.PLAN_DAYS[plan])
    if current_expiry and current_expiry > target:
        target = current_expiry
    conn.execute('UPDATE users SET plan=?,plan_expires_at=? WHERE id=?', (plan, iso_at(target), user_id))
    return conn.execute('SELECT * FROM users WHERE id=?', (user_id,)).fetchone()


def user_agent_is_bazaar(headers):
    return 'VestalandBazaar/' in str(headers.get('User-Agent', ''))


class Handler(v2.Handler):
    server_version = 'VestalandAPI/3.1'

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/') or '/'
        if path == '/api/v3/health':
            return self.send_json(200, {
                'ok': True,
                'service': 'vestaland-community-v3',
                'bazaar_server_activation': True,
                'bazaar_signature_verification': bool(clean_public_key(os.environ.get('BAZAAR_RSA_PUBLIC_KEY', ''))),
                'closed_app_notification_api': True,
            })
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/') or '/'

        if path == '/api/bazaar/purchase-intent':
            user = self.require_user()
            if not user:
                return
            try:
                body = self.read_json()
            except ValueError as exc:
                return self.send_json(400, {'error': str(exc)})
            plan = str(body.get('plan') or '')
            if plan not in BAZAAR_PRODUCTS:
                return self.send_json(400, {'error': 'پلن انتخاب‌شده معتبر نیست.'})
            intent = secrets.token_urlsafe(30)
            developer_payload = f'vestaland:{user["id"]}:{intent}'
            now = utcnow()
            expires = now + dt.timedelta(minutes=CLAIM_TTL_MINUTES)
            conn = core.connect()
            conn.execute(
                'INSERT INTO bazaar_purchase_intents(intent,user_id,plan,developer_payload,created_at,expires_at) VALUES(?,?,?,?,?,?)',
                (intent, user['id'], plan, developer_payload, iso_at(now), iso_at(expires)),
            )
            conn.commit(); conn.close()
            return self.send_json(201, {
                'ok': True,
                'intent': intent,
                'plan': plan,
                'product_id': BAZAAR_PRODUCTS[plan],
                'developer_payload': developer_payload,
                'expires_at': iso_at(expires),
            })

        if path == '/api/bazaar/subscription/legacy-claim':
            user = self.require_user()
            if not user:
                return
            if not user_agent_is_bazaar(self.headers):
                return self.send_json(403, {'error': 'این مسیر فقط برای نسخه کافه‌بازار اپ فعال است.'})
            try:
                body = self.read_json()
            except ValueError as exc:
                return self.send_json(400, {'error': str(exc)})
            plan = str(body.get('plan') or '')
            order_id = str(body.get('order_id') or '').strip()
            purchase_token = str(body.get('purchase_token') or '').strip()
            if plan not in BAZAAR_PRODUCTS:
                return self.send_json(400, {'error': 'پلن خرید معتبر نیست.'})
            if len(order_id) < 4 or len(purchase_token) < 8:
                return self.send_json(400, {'error': 'رسید خرید ناقص است.'})
            conn = core.connect()
            existing = conn.execute(
                'SELECT * FROM bazaar_subscription_claims WHERE purchase_token=? OR order_id=? LIMIT 1',
                (purchase_token, order_id),
            ).fetchone()
            if existing and int(existing['user_id']) != int(user['id']):
                conn.close()
                return self.send_json(409, {'error': 'این خرید قبلاً برای حساب دیگری ثبت شده است.'})
            now_iso = iso_at(utcnow())
            try:
                conn.execute('BEGIN IMMEDIATE')
                if existing:
                    updated = conn.execute('SELECT * FROM users WHERE id=?', (user['id'],)).fetchone()
                    conn.execute('UPDATE bazaar_subscription_claims SET last_seen_at=? WHERE purchase_token=?', (now_iso, purchase_token))
                else:
                    conn.execute('''
                        INSERT INTO bazaar_subscription_claims(
                            purchase_token,order_id,user_id,plan,product_id,purchase_time,verification,first_seen_at,last_seen_at
                        ) VALUES(?,?,?,?,?,?,?,?,?)
                    ''', (purchase_token, order_id, user['id'], plan, BAZAAR_PRODUCTS[plan], 0, 'native-token-legacy', now_iso, now_iso))
                    updated = activate_user(conn, user['id'], plan, 0, restore=False)
                conn.commit()
            except sqlite3.IntegrityError:
                conn.rollback(); conn.close()
                return self.send_json(409, {'error': 'این رسید قبلاً ثبت شده است.'})
            except Exception:
                conn.rollback(); conn.close(); raise
            conn.close()
            return self.send_json(200, {
                'ok': True,
                'server_activated': True,
                'verification': 'native-token-legacy',
                'user': core.row_user(updated),
            })

        if path == '/api/bazaar/subscription/confirm':
            user = self.require_user()
            if not user:
                return
            try:
                body = self.read_json()
            except ValueError as exc:
                return self.send_json(400, {'error': str(exc)})
            original_json = str(body.get('original_json') or '')
            signature = str(body.get('data_signature') or '')
            restore = bool(body.get('restore'))
            try:
                purchase = parse_purchase(original_json)
            except ValueError as exc:
                return self.send_json(400, {'error': str(exc)})
            plan = plan_from_product(purchase['product_id'])
            if not plan:
                return self.send_json(400, {'error': 'محصول اشتراک معتبر نیست.'})
            if purchase['package_name'] != BAZAAR_PACKAGE:
                return self.send_json(409, {'error': 'این خرید برای اپ وستالند نیست.'})
            if purchase['purchase_state'] != 0:
                return self.send_json(409, {'error': 'این اشتراک فعال نیست.'})
            if not purchase['purchase_token'] or len(purchase['purchase_token']) < 8 or not purchase['order_id']:
                return self.send_json(400, {'error': 'رسید خرید ناقص است.'})

            verified, verification = verify_bazaar_signature(original_json, signature)
            conn = core.connect()
            intent_row = conn.execute(
                'SELECT * FROM bazaar_purchase_intents WHERE developer_payload=? AND user_id=? LIMIT 1',
                (purchase['developer_payload'], user['id']),
            ).fetchone()
            if not intent_row:
                conn.close()
                return self.send_json(409, {'error': 'این خرید به حساب فعلی متصل نیست.'})
            if intent_row['plan'] != plan:
                conn.close()
                return self.send_json(409, {'error': 'پلن خرید با درخواست اولیه مطابقت ندارد.'})
            if not restore:
                expiry = core.parse_iso(intent_row['expires_at'])
                if not expiry or expiry < utcnow():
                    conn.close()
                    return self.send_json(409, {'error': 'درخواست خرید منقضی شده. دوباره از داخل اپ شروع کن.'})

            strict = str(os.environ.get('REQUIRE_BAZAAR_SIGNATURE', '0')).strip().lower() in {'1', 'true', 'yes'}
            if strict and not verified:
                conn.close()
                return self.send_json(503, {'error': 'تأیید امن خرید کافه‌بازار هنوز تنظیم نشده.', 'code': 'bazaar_signature_required'})

            existing = conn.execute(
                'SELECT * FROM bazaar_subscription_claims WHERE purchase_token=? OR order_id=? LIMIT 1',
                (purchase['purchase_token'], purchase['order_id']),
            ).fetchone()
            if existing and int(existing['user_id']) != int(user['id']):
                conn.close()
                return self.send_json(409, {'error': 'این خرید قبلاً برای حساب دیگری ثبت شده است.'})

            try:
                conn.execute('BEGIN IMMEDIATE')
                now_iso = iso_at(utcnow())
                if existing:
                    conn.execute(
                        'UPDATE bazaar_subscription_claims SET last_seen_at=?,verification=? WHERE purchase_token=?',
                        (now_iso, verification if verified else existing['verification'], purchase['purchase_token']),
                    )
                    updated = conn.execute('SELECT * FROM users WHERE id=?', (user['id'],)).fetchone()
                else:
                    conn.execute('''
                        INSERT INTO bazaar_subscription_claims(
                            purchase_token,order_id,user_id,plan,product_id,purchase_time,verification,first_seen_at,last_seen_at
                        ) VALUES(?,?,?,?,?,?,?,?,?)
                    ''', (
                        purchase['purchase_token'], purchase['order_id'], user['id'], plan, purchase['product_id'],
                        purchase['purchase_time'], verification, now_iso, now_iso,
                    ))
                    updated = activate_user(conn, user['id'], plan, purchase['purchase_time'], restore=restore)
                conn.execute('UPDATE bazaar_purchase_intents SET used_at=? WHERE intent=?', (now_iso, intent_row['intent']))
                conn.commit()
            except sqlite3.IntegrityError:
                conn.rollback(); conn.close()
                return self.send_json(409, {'error': 'این رسید قبلاً ثبت شده است.'})
            except Exception:
                conn.rollback(); conn.close(); raise
            conn.close()
            return self.send_json(200, {
                'ok': True,
                'server_activated': True,
                'verification': verification,
                'signature_verified': bool(verified),
                'user': core.row_user(updated),
            })

        return super().do_POST()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--db', default='/var/lib/vestaland/vestaland.db')
    args = parser.parse_args()
    v2.DB_PATH = os.path.abspath(args.db)
    v2.MAX_BODY = v2.FEATURE_MAX_BODY
    v2.init_db()
    init_v3()
    httpd = core.ThreadingHTTPServer((args.host, args.port), Handler)
    print(f'Vestaland API v3 listening on {args.host}:{args.port} db={core.DB_PATH}', flush=True)
    httpd.serve_forever()


if __name__ == '__main__':
    main()
