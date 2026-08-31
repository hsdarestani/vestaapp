#!/usr/bin/env python3
import argparse
import datetime as dt
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

POST_TYPES = {'vent', 'gossip', 'advice', 'challenge', 'flex'}
COMMENTS_ALLOWED = {'gossip', 'advice', 'challenge'}
REACTIONS = {
    'vent': ['🤍', '🥺', '🫂', '💜'],
    'gossip': ['😂', '👀', '🤔', '🔥'],
    'advice': ['😍', '💜', '✨', '💅', '🤔'],
    'challenge': ['💜', '🫂', '✨'],
    'flex': ['👏', '😍', '💖', '✨'],
}
SESSION_DAYS = 90
PBKDF2_ROUNDS = 260_000
MAX_BODY = 256 * 1024

DB_PATH = ''


def utcnow():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def iso_now():
    return utcnow().isoformat().replace('+00:00', 'Z')


def connect():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = connect()
    conn.execute('PRAGMA journal_mode=WAL')
    conn.executescript('''
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        plan TEXT NOT NULL DEFAULT 'trial',
        trial_started_at TEXT NOT NULL,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        text TEXT NOT NULL,
        anonymous INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_posts_type_id ON posts(type, id DESC);

    CREATE TABLE IF NOT EXISTS reactions (
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        emoji TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(post_id, user_id, emoji)
    );

    CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id, id);

    CREATE TABLE IF NOT EXISTS moods (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        mood INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(user_id, day)
    );
    ''')
    conn.commit()
    conn.close()


def password_hash(password, salt_hex=None):
    salt = bytes.fromhex(salt_hex) if salt_hex else os.urandom(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, PBKDF2_ROUNDS)
    return salt.hex(), digest.hex()


def verify_password(password, salt_hex, expected_hex):
    _, actual = password_hash(password, salt_hex)
    return hmac.compare_digest(actual, expected_hex)


def clean_username(value):
    value = (value or '').strip().lower()
    if not (3 <= len(value) <= 24):
        raise ValueError('نام کاربری باید بین ۳ تا ۲۴ کاراکتر باشد.')
    allowed = set('abcdefghijklmnopqrstuvwxyz0123456789_.-')
    if any(ch not in allowed for ch in value):
        raise ValueError('نام کاربری فقط می‌تواند شامل حروف انگلیسی، عدد، نقطه، خط تیره و آندرلاین باشد.')
    return value


def clean_display_name(value):
    value = ' '.join((value or '').strip().split())
    if not (2 <= len(value) <= 32):
        raise ValueError('اسم نمایشی باید بین ۲ تا ۳۲ کاراکتر باشد.')
    return value


def make_session(conn, user_id):
    raw = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    now = utcnow()
    expires = now + dt.timedelta(days=SESSION_DAYS)
    conn.execute(
        'INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)',
        (token_hash, user_id, now.isoformat(), expires.isoformat()),
    )
    return raw


def row_user(row):
    return {
        'id': row['id'],
        'username': row['username'],
        'display_name': row['display_name'],
        'plan': row['plan'],
        'trial_started_at': row['trial_started_at'],
        'created_at': row['created_at'],
    }


def get_user_from_auth(headers):
    auth = headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return None
    raw = auth[7:].strip()
    if not raw:
        return None
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    conn = connect()
    row = conn.execute('''
        SELECT u.* FROM sessions s
        JOIN users u ON u.id=s.user_id
        WHERE s.token_hash=? AND s.expires_at>?
    ''', (token_hash, utcnow().isoformat())).fetchone()
    conn.close()
    return row


def post_json(conn, row, viewer_id):
    counts = {r['emoji']: r['n'] for r in conn.execute(
        'SELECT emoji, COUNT(*) n FROM reactions WHERE post_id=? GROUP BY emoji', (row['id'],)
    ).fetchall()}
    mine = [r['emoji'] for r in conn.execute(
        'SELECT emoji FROM reactions WHERE post_id=? AND user_id=?', (row['id'], viewer_id)
    ).fetchall()]
    comment_count = conn.execute(
        'SELECT COUNT(*) n FROM comments WHERE post_id=?', (row['id'],)
    ).fetchone()['n']
    anonymous = bool(row['anonymous'])
    name = 'ناشناس' if anonymous else row['display_name']
    avatar = '؟' if anonymous else (name[:1] or 'و')
    return {
        'id': row['id'],
        'type': row['type'],
        'name': name,
        'avatar': avatar,
        'text': row['text'],
        'anonymous': anonymous,
        'created_at': row['created_at'],
        'reactions': counts,
        'my_reactions': mine,
        'comments': comment_count,
        'comments_allowed': row['type'] in COMMENTS_ALLOWED,
        'is_mine': row['user_id'] == viewer_id,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = 'VestalandAPI/1.0'

    def log_message(self, fmt, *args):
        sys.stdout.write('%s - %s\n' % (self.address_string(), fmt % args))
        sys.stdout.flush()

    def send_json(self, status, payload):
        raw = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(raw)

    def read_json(self):
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            raise ValueError('درخواست نامعتبر است.')
        if length <= 0 or length > MAX_BODY:
            raise ValueError('حجم درخواست نامعتبر است.')
        try:
            return json.loads(self.rfile.read(length).decode('utf-8'))
        except Exception:
            raise ValueError('JSON نامعتبر است.')

    def require_user(self):
        user = get_user_from_auth(self.headers)
        if not user:
            self.send_json(401, {'error': 'برای ادامه وارد حساب شو.'})
        return user

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/') or '/'
        if path == '/api/health':
            return self.send_json(200, {'ok': True, 'service': 'vestaland-api'})
        if path == '/api/me':
            user = self.require_user()
            if user:
                return self.send_json(200, {'user': row_user(user)})
            return
        if path == '/api/posts':
            user = self.require_user()
            if not user:
                return
            qs = parse_qs(parsed.query)
            post_type = (qs.get('type') or ['vent'])[0]
            if post_type not in POST_TYPES:
                return self.send_json(400, {'error': 'بخش نامعتبر است.'})
            conn = connect()
            rows = conn.execute('''
                SELECT p.*, u.display_name FROM posts p
                JOIN users u ON u.id=p.user_id
                WHERE p.type=? ORDER BY p.id DESC LIMIT 50
            ''', (post_type,)).fetchall()
            payload = [post_json(conn, row, user['id']) for row in rows]
            conn.close()
            return self.send_json(200, {'posts': payload})
        if path.startswith('/api/posts/') and path.endswith('/comments'):
            user = self.require_user()
            if not user:
                return
            try:
                post_id = int(path.split('/')[3])
            except Exception:
                return self.send_json(404, {'error': 'پست پیدا نشد.'})
            conn = connect()
            post = conn.execute('SELECT type FROM posts WHERE id=?', (post_id,)).fetchone()
            if not post:
                conn.close()
                return self.send_json(404, {'error': 'پست پیدا نشد.'})
            if post['type'] not in COMMENTS_ALLOWED:
                conn.close()
                return self.send_json(403, {'error': 'این بخش کامنت ندارد.'})
            rows = conn.execute('''
                SELECT c.id,c.text,c.created_at,u.display_name
                FROM comments c JOIN users u ON u.id=c.user_id
                WHERE c.post_id=? ORDER BY c.id ASC LIMIT 100
            ''', (post_id,)).fetchall()
            conn.close()
            comments = [{
                'id': r['id'], 'text': r['text'], 'created_at': r['created_at'],
                'name': r['display_name'], 'avatar': (r['display_name'][:1] or 'و')
            } for r in rows]
            return self.send_json(200, {'comments': comments})
        return self.send_json(404, {'error': 'مسیر پیدا نشد.'})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/') or '/'
        try:
            body = self.read_json()
        except ValueError as exc:
            return self.send_json(400, {'error': str(exc)})

        if path == '/api/register':
            try:
                username = clean_username(body.get('username'))
                display_name = clean_display_name(body.get('display_name'))
                password = body.get('password') or ''
                if len(password) < 8 or len(password) > 128:
                    raise ValueError('رمز عبور باید حداقل ۸ کاراکتر باشد.')
                plan = body.get('plan') if body.get('plan') in {'trial','1m','3m','6m'} else 'trial'
            except ValueError as exc:
                return self.send_json(400, {'error': str(exc)})
            salt, digest = password_hash(password)
            conn = connect()
            try:
                cur = conn.execute('''
                    INSERT INTO users(username,display_name,password_hash,password_salt,plan,trial_started_at,created_at)
                    VALUES(?,?,?,?,?,?,?)
                ''', (username, display_name, digest, salt, plan, iso_now(), iso_now()))
                token = make_session(conn, cur.lastrowid)
                conn.commit()
                row = conn.execute('SELECT * FROM users WHERE id=?', (cur.lastrowid,)).fetchone()
            except sqlite3.IntegrityError:
                conn.close()
                return self.send_json(409, {'error': 'این نام کاربری قبلاً گرفته شده.'})
            conn.close()
            return self.send_json(201, {'token': token, 'user': row_user(row)})

        if path == '/api/login':
            try:
                username = clean_username(body.get('username'))
            except ValueError:
                return self.send_json(401, {'error': 'نام کاربری یا رمز عبور اشتباه است.'})
            password = body.get('password') or ''
            conn = connect()
            row = conn.execute('SELECT * FROM users WHERE username=? COLLATE NOCASE', (username,)).fetchone()
            if not row or not verify_password(password, row['password_salt'], row['password_hash']):
                conn.close()
                return self.send_json(401, {'error': 'نام کاربری یا رمز عبور اشتباه است.'})
            token = make_session(conn, row['id'])
            conn.commit()
            conn.close()
            return self.send_json(200, {'token': token, 'user': row_user(row)})

        user = self.require_user()
        if not user:
            return

        if path == '/api/logout':
            auth = self.headers.get('Authorization', '')
            if auth.startswith('Bearer '):
                token_hash = hashlib.sha256(auth[7:].strip().encode()).hexdigest()
                conn = connect()
                conn.execute('DELETE FROM sessions WHERE token_hash=?', (token_hash,))
                conn.commit()
                conn.close()
            return self.send_json(200, {'ok': True})

        if path == '/api/posts':
            post_type = body.get('type')
            text = ' '.join((body.get('text') or '').strip().split())
            if post_type not in POST_TYPES:
                return self.send_json(400, {'error': 'بخش نامعتبر است.'})
            if not (1 <= len(text) <= 2500):
                return self.send_json(400, {'error': 'متن پست باید بین ۱ تا ۲۵۰۰ کاراکتر باشد.'})
            anonymous = bool(body.get('anonymous')) and post_type in {'vent','gossip'}
            conn = connect()
            cur = conn.execute(
                'INSERT INTO posts(user_id,type,text,anonymous,created_at) VALUES(?,?,?,?,?)',
                (user['id'], post_type, text, 1 if anonymous else 0, iso_now())
            )
            conn.commit()
            row = conn.execute('''SELECT p.*,u.display_name FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=?''', (cur.lastrowid,)).fetchone()
            payload = post_json(conn, row, user['id'])
            conn.close()
            return self.send_json(201, {'post': payload})

        if path.startswith('/api/posts/') and path.endswith('/react'):
            try:
                post_id = int(path.split('/')[3])
            except Exception:
                return self.send_json(404, {'error': 'پست پیدا نشد.'})
            emoji = body.get('emoji') or ''
            conn = connect()
            post = conn.execute('SELECT type FROM posts WHERE id=?', (post_id,)).fetchone()
            if not post:
                conn.close()
                return self.send_json(404, {'error': 'پست پیدا نشد.'})
            if emoji not in REACTIONS[post['type']]:
                conn.close()
                return self.send_json(400, {'error': 'واکنش نامعتبر است.'})
            existing = conn.execute('SELECT 1 FROM reactions WHERE post_id=? AND user_id=? AND emoji=?', (post_id,user['id'],emoji)).fetchone()
            if existing:
                conn.execute('DELETE FROM reactions WHERE post_id=? AND user_id=? AND emoji=?', (post_id,user['id'],emoji))
                active = False
            else:
                conn.execute('INSERT INTO reactions(post_id,user_id,emoji,created_at) VALUES(?,?,?,?)', (post_id,user['id'],emoji,iso_now()))
                active = True
            conn.commit()
            count = conn.execute('SELECT COUNT(*) n FROM reactions WHERE post_id=? AND emoji=?', (post_id,emoji)).fetchone()['n']
            conn.close()
            return self.send_json(200, {'active': active, 'count': count})

        if path.startswith('/api/posts/') and path.endswith('/comments'):
            try:
                post_id = int(path.split('/')[3])
            except Exception:
                return self.send_json(404, {'error': 'پست پیدا نشد.'})
            text = ' '.join((body.get('text') or '').strip().split())
            if not (1 <= len(text) <= 1000):
                return self.send_json(400, {'error': 'کامنت باید بین ۱ تا ۱۰۰۰ کاراکتر باشد.'})
            conn = connect()
            post = conn.execute('SELECT type FROM posts WHERE id=?', (post_id,)).fetchone()
            if not post:
                conn.close()
                return self.send_json(404, {'error': 'پست پیدا نشد.'})
            if post['type'] not in COMMENTS_ALLOWED:
                conn.close()
                return self.send_json(403, {'error': 'این بخش کامنت ندارد.'})
            cur = conn.execute('INSERT INTO comments(post_id,user_id,text,created_at) VALUES(?,?,?,?)', (post_id,user['id'],text,iso_now()))
            conn.commit()
            count = conn.execute('SELECT COUNT(*) n FROM comments WHERE post_id=?', (post_id,)).fetchone()['n']
            conn.close()
            return self.send_json(201, {'comment': {'id': cur.lastrowid, 'text': text, 'name': user['display_name'], 'avatar': user['display_name'][:1], 'created_at': iso_now()}, 'count': count})

        if path == '/api/mood':
            try:
                mood = int(body.get('mood'))
            except Exception:
                mood = 0
            if mood not in {1,2,3,4,5}:
                return self.send_json(400, {'error': 'حال انتخاب‌شده نامعتبر است.'})
            day = utcnow().date().isoformat()
            conn = connect()
            conn.execute('''
                INSERT INTO moods(user_id,day,mood,updated_at) VALUES(?,?,?,?)
                ON CONFLICT(user_id,day) DO UPDATE SET mood=excluded.mood, updated_at=excluded.updated_at
            ''', (user['id'], day, mood, iso_now()))
            conn.commit()
            conn.close()
            return self.send_json(200, {'ok': True, 'mood': mood, 'day': day})

        return self.send_json(404, {'error': 'مسیر پیدا نشد.'})


def main():
    global DB_PATH
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--db', default='/var/lib/vestaland/vestaland.db')
    args = parser.parse_args()
    DB_PATH = os.path.abspath(args.db)
    init_db()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f'Vestaland API listening on {args.host}:{args.port} db={DB_PATH}', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
