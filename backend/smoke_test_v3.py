#!/usr/bin/env python3
import json
import os
import tempfile
import threading
import urllib.error
import urllib.request

import core_server as core
import server as v2
import server_v3 as v3


def request(base, path, method='GET', body=None, token=None, user_agent='VestalandTest/1.0'):
    data = None if body is None else json.dumps(body).encode('utf-8')
    headers = {'Content-Type': 'application/json', 'User-Agent': user_agent}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            raw = res.read()
            return res.status, json.loads(raw.decode('utf-8')) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        return exc.code, json.loads(raw.decode('utf-8')) if raw else {}


def main():
    with tempfile.TemporaryDirectory() as tmp:
        db_path = os.path.join(tmp, 'test.db')
        v2.DB_PATH = db_path
        v2.MAX_BODY = v2.FEATURE_MAX_BODY
        v2.init_db()
        v3.init_v3()

        httpd = core.ThreadingHTTPServer(('127.0.0.1', 0), v3.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{httpd.server_port}'

        try:
            status, health = request(base, '/api/v3/health')
            assert status == 200 and health.get('ok') is True, health
            assert health.get('bazaar_server_activation') is True, health

            status, alice = request(base, '/api/register', 'POST', {
                'username': 'alice_v3', 'display_name': 'آلیس', 'password': 'test-pass-1234'
            })
            assert status == 201 and alice.get('token'), alice
            at = alice['token']

            status, bob = request(base, '/api/register', 'POST', {
                'username': 'bob_v3', 'display_name': 'بهار', 'password': 'test-pass-5678'
            })
            assert status == 201 and bob.get('token'), bob
            bt = bob['token']

            receipt = {
                'plan': '1m',
                'order_id': 'ORDER_TEST_V3_001',
                'purchase_token': 'TOKEN_TEST_V3_001_unique',
            }
            bazaar_ua = 'Mozilla/5.0 VestalandBazaar/1.6'

            status, claim = request(
                base, '/api/bazaar/subscription/legacy-claim', 'POST', receipt, at, bazaar_ua
            )
            assert status == 200 and claim.get('server_activated') is True, claim
            assert claim['user']['plan'] == '1m', claim
            assert claim['user']['subscription_active'] is True, claim

            status, me = request(base, '/api/me', token=at)
            assert status == 200 and me['user']['plan'] == '1m', me
            assert me['user']['subscription_active'] is True, me
            expiry_before = me['user']['plan_expires_at']

            status, replay = request(
                base, '/api/bazaar/subscription/legacy-claim', 'POST', receipt, at, bazaar_ua
            )
            assert status == 200 and replay.get('server_activated') is True, replay
            status, me_after = request(base, '/api/me', token=at)
            assert me_after['user']['plan_expires_at'] == expiry_before, me_after

            status, stolen = request(
                base, '/api/bazaar/subscription/legacy-claim', 'POST', receipt, bt, bazaar_ua
            )
            assert status == 409, stolen

            status, wrong_ua = request(
                base, '/api/bazaar/subscription/legacy-claim', 'POST', {
                    'plan': '1m', 'order_id': 'ORDER_TEST_V3_002', 'purchase_token': 'TOKEN_TEST_V3_002_unique'
                }, at, 'Mozilla/5.0'
            )
            assert status == 403, wrong_ua

            print('Vestaland Community V3 smoke test passed: server-backed Bazaar activation + idempotency + cross-account replay protection')
        finally:
            httpd.shutdown()
            httpd.server_close()


if __name__ == '__main__':
    main()
