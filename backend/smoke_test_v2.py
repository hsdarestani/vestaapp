#!/usr/bin/env python3
import base64
import json
import os
import tempfile
import threading
import urllib.error
import urllib.request

import server


def request(base, path, method='GET', body=None, token=None):
    data = None if body is None else json.dumps(body).encode('utf-8')
    headers = {'Content-Type': 'application/json'}
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
        server.DB_PATH = os.path.join(tmp, 'test.db')
        server.MAX_BODY = server.FEATURE_MAX_BODY
        server.init_db()
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{httpd.server_port}'
        png = 'data:image/png;base64,' + base64.b64encode(
            b'\x89PNG\r\n\x1a\n' + b'x' * 64
        ).decode('ascii')
        try:
            status, alice = request(base, '/api/register', 'POST', {
                'username': 'alice_test', 'display_name': 'آلیس', 'password': 'test-pass-1234'
            })
            assert status == 201 and alice.get('token'), alice
            at = alice['token']

            status, bob = request(base, '/api/register', 'POST', {
                'username': 'bob_test', 'display_name': 'بهار', 'password': 'test-pass-5678'
            })
            assert status == 201 and bob.get('token'), bob
            bt = bob['token']

            status, made = request(base, '/api/posts', 'POST', {
                'type': 'advice', 'text': 'کدوم انتخاب بهتره؟', 'anonymous': False,
                'media': [png],
                'poll': {'question': 'تو کدومو انتخاب می‌کنی؟', 'options': ['اولی', 'دومی']},
            }, at)
            assert status == 201 and made['post']['id'], made
            post_id = made['post']['id']
            assert len(made['post']['media_items']) == 1, made
            assert made['post']['poll']['options'][0]['label'] == 'اولی', made

            status, feed = request(base, '/api/posts?type=advice', token=bt)
            assert status == 200 and feed['posts'][0]['id'] == post_id, feed
            assert feed['posts'][0]['media_items'], feed

            status, extras = request(base, f'/api/post-extras?ids={post_id}', token=bt)
            option_id = extras['extras'][str(post_id)]['poll']['options'][0]['id']
            media_id = extras['extras'][str(post_id)]['media'][0]['id']
            assert media_id, extras

            status, reacted = request(base, f'/api/posts/{post_id}/react', 'POST', {'emoji': '😍'}, bt)
            assert status == 200 and reacted['active'] is True, reacted
            status, commented = request(base, f'/api/posts/{post_id}/comments', 'POST', {'text': 'من اولی رو دوست دارم'}, bt)
            assert status == 201 and commented['count'] == 1, commented
            status, voted = request(base, f'/api/posts/{post_id}/poll-vote', 'POST', {'option_id': option_id}, bt)
            assert status == 200 and voted['poll']['total_votes'] == 1, voted
            status, saved = request(base, f'/api/posts/{post_id}/bookmark', 'POST', {}, bt)
            assert status == 200 and saved['bookmarked'] is True, saved

            status, stats = request(base, '/api/profile/stats', token=bt)
            assert status == 200 and stats['saved'] == 1, stats
            status, notes = request(base, '/api/notifications', token=at)
            assert status == 200 and len(notes['notifications']) >= 3, notes

            status, cycle = request(base, '/api/cycle', 'POST', {
                'cycle_length': 28, 'period_length': 5, 'last_period_date': '2026-08-20'
            }, at)
            assert status == 200 and cycle['cycle']['cycle_length'] == 28, cycle
            status, wellbeing = request(base, '/api/wellbeing', token=at)
            assert status == 200 and wellbeing['cycle']['last_period_date'] == '2026-08-20', wellbeing

            status, settings = request(base, '/api/settings', 'POST', {
                'notifications_enabled': True, 'profile_private': True, 'allow_comments': False
            }, at)
            assert status == 200 and settings['settings']['profile_private'] is True, settings

            status, profile = request(base, '/api/profile', 'POST', {
                'display_name': 'آلیس جدید', 'username': 'alice_new'
            }, at)
            assert status == 200 and profile['profile']['username'] == 'alice_new', profile

            status, mine = request(base, '/api/my/posts', token=at)
            assert status == 200 and mine['posts'][0]['id'] == post_id, mine

            status, deleted = request(base, f'/api/posts/{post_id}', 'DELETE', token=at)
            assert status == 200 and deleted['ok'] is True, deleted
            status, mine = request(base, '/api/my/posts', token=at)
            assert status == 200 and not mine['posts'], mine

            print('Vestaland Community V2 smoke test passed: media + poll + saves + notifications + cycle + privacy + profile + delete')
        finally:
            httpd.shutdown(); httpd.server_close()


if __name__ == '__main__':
    main()
