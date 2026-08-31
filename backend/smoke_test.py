#!/usr/bin/env python3
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
    with urllib.request.urlopen(req, timeout=5) as res:
        return res.status, json.loads(res.read().decode('utf-8'))


def main():
    with tempfile.TemporaryDirectory() as tmp:
        server.DB_PATH = os.path.join(tmp, 'test.db')
        server.init_db()
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{httpd.server_port}'
        try:
            status, data = request(base, '/api/register', 'POST', {
                'username': 'qa_girl',
                'display_name': 'تست وستالند',
                'password': 'test-pass-1234',
                'plan': 'trial',
            })
            assert status == 201 and data.get('token'), data
            token = data['token']

            status, data = request(base, '/api/me', token=token)
            assert status == 200 and data['user']['username'] == 'qa_girl', data

            status, data = request(base, '/api/posts', 'POST', {
                'type': 'gossip',
                'text': 'این یک پست تست خودکار است.',
                'anonymous': False,
            }, token)
            assert status == 201 and data['post']['id'], data
            post_id = data['post']['id']

            status, data = request(base, f'/api/posts/{post_id}/react', 'POST', {'emoji': '👀'}, token)
            assert status == 200 and data['active'] is True and data['count'] == 1, data

            status, data = request(base, f'/api/posts/{post_id}/comments', 'POST', {'text': 'کامنت تست'}, token)
            assert status == 201 and data['count'] == 1, data

            status, data = request(base, '/api/posts?type=gossip', token=token)
            assert status == 200 and data['posts'][0]['id'] == post_id, data
            assert data['posts'][0]['reactions']['👀'] == 1, data
            assert data['posts'][0]['comments'] == 1, data

            status, data = request(base, f'/api/posts/{post_id}/comments', token=token)
            assert status == 200 and data['comments'][0]['text'] == 'کامنت تست', data

            print('Vestaland API smoke test passed: register -> post -> reaction -> comment')
        finally:
            httpd.shutdown()
            httpd.server_close()


if __name__ == '__main__':
    main()
