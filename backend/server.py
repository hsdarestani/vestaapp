#!/usr/bin/env python3
import argparse
import base64
import datetime as dt
import json
import re
import sqlite3
import sys
from urllib.parse import parse_qs, urlparse

import core_server as core

FEATURE_MAX_BODY = 4 * 1024 * 1024
MAX_IMAGE_BYTES = 1_200_000
MAX_POST_IMAGES = 3
IMAGE_RE = re.compile(r'^data:(image/(?:jpeg|jpg|png|webp));base64,(.+)$', re.I | re.S)

DB_PATH = ''
MAX_BODY = FEATURE_MAX_BODY
ThreadingHTTPServer = core.ThreadingHTTPServer


def iso_now():
    return core.iso_now()


def init_features():
    conn = core.connect()
    conn.executescript('''
    CREATE TABLE IF NOT EXISTS bookmarks (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY(user_id, post_id)
    );
    CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
        is_read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id DESC);

    CREATE TABLE IF NOT EXISTS user_settings (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        notifications_enabled INTEGER NOT NULL DEFAULT 1,
        profile_private INTEGER NOT NULL DEFAULT 0,
        allow_comments INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cycles (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        cycle_length INTEGER NOT NULL DEFAULT 28,
        period_length INTEGER NOT NULL DEFAULT 5,
        last_period_date TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS post_media (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        mime TEXT NOT NULL,
        bytes BLOB NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_post_media_post ON post_media(post_id, id);

    CREATE TABLE IF NOT EXISTS polls (
        post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
        question TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS poll_options (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        position INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_poll_options_post ON poll_options(post_id, position);
    CREATE TABLE IF NOT EXISTS poll_votes (
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        option_id INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY(post_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS profiles (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        avatar_mime TEXT,
        avatar_bytes BLOB,
        updated_at TEXT NOT NULL
    );
    ''')
    conn.commit()
    conn.close()


def init_db():
    core.DB_PATH = DB_PATH
    core.MAX_BODY = MAX_BODY
    core.init_db()
    init_features()


def ensure_settings(conn, user_id):
    row = conn.execute('SELECT * FROM user_settings WHERE user_id=?', (user_id,)).fetchone()
    if row:
        return row
    conn.execute(
        'INSERT INTO user_settings(user_id,notifications_enabled,profile_private,allow_comments,updated_at) VALUES(?,?,?,?,?)',
        (user_id, 1, 0, 1, iso_now()),
    )
    return conn.execute('SELECT * FROM user_settings WHERE user_id=?', (user_id,)).fetchone()


def active_subscription(user):
    return bool(core.row_user(user).get('subscription_active'))


def decode_image(data_url):
    if not data_url:
        return None
    match = IMAGE_RE.match(str(data_url))
    if not match:
        raise ValueError('فرمت عکس پشتیبانی نمی‌شود.')
    mime = match.group(1).lower().replace('image/jpg', 'image/jpeg')
    try:
        raw = base64.b64decode(match.group(2), validate=True)
    except Exception:
        raise ValueError('فایل عکس معتبر نیست.')
    if not raw or len(raw) > MAX_IMAGE_BYTES:
        raise ValueError('حجم هر عکس باید کمتر از حدود ۱ مگابایت باشد.')
    return mime, raw


def poll_payload(conn, post_id, viewer_id):
    poll = conn.execute('SELECT question FROM polls WHERE post_id=?', (post_id,)).fetchone()
    if not poll:
        return None
    mine = conn.execute('SELECT option_id FROM poll_votes WHERE post_id=? AND user_id=?', (post_id, viewer_id)).fetchone()
    rows = conn.execute('''
        SELECT o.id,o.label,o.position,COUNT(v.user_id) votes
        FROM poll_options o LEFT JOIN poll_votes v ON v.option_id=o.id
        WHERE o.post_id=? GROUP BY o.id,o.label,o.position ORDER BY o.position,o.id
    ''', (post_id,)).fetchall()
    total = sum(int(r['votes']) for r in rows)
    options = []
    for row in rows:
        votes = int(row['votes'])
        options.append({
            'id': row['id'], 'label': row['label'], 'votes': votes,
            'percent': round((votes * 100 / total), 1) if total else 0,
            'selected': bool(mine and mine['option_id'] == row['id']),
        })
    return {'question': poll['question'], 'total_votes': total, 'options': options}


def media_payload(conn, post_id):
    return [{'id': r['id'], 'mime': r['mime']} for r in conn.execute(
        'SELECT id,mime FROM post_media WHERE post_id=? ORDER BY id', (post_id,)
    ).fetchall()]


def comments_allowed_for(conn, post_row):
    if post_row['type'] not in core.COMMENTS_ALLOWED:
        return False
    settings = ensure_settings(conn, post_row['user_id'])
    return bool(settings['allow_comments'])


def post_payload(conn, row, viewer_id):
    payload = core.post_json(conn, row, viewer_id)
    payload['bookmarked'] = bool(conn.execute(
        'SELECT 1 FROM bookmarks WHERE user_id=? AND post_id=?', (viewer_id, row['id'])
    ).fetchone())
    payload['media_items'] = media_payload(conn, row['id'])
    payload['poll'] = poll_payload(conn, row['id'], viewer_id)
    payload['comments_allowed'] = comments_allowed_for(conn, row)
    return payload


def notify(conn, user_id, actor_user_id, kind, title, body, post_id=None):
    if not user_id or user_id == actor_user_id:
        return
    settings = ensure_settings(conn, user_id)
    if not settings['notifications_enabled']:
        return
    conn.execute('''
        INSERT INTO notifications(user_id,actor_user_id,type,title,body,post_id,is_read,created_at)
        VALUES(?,?,?,?,?,?,0,?)
    ''', (user_id, actor_user_id, kind, title, body, post_id, iso_now()))


def cycle_payload(row):
    if not row:
        return None
    try:
        last = dt.date.fromisoformat(row['last_period_date'])
    except Exception:
        return None
    today = dt.datetime.now().astimezone().date()
    cycle_len = int(row['cycle_length'])
    period_len = int(row['period_length'])
    next_start = last
    while next_start <= today:
        next_start += dt.timedelta(days=cycle_len)
    starts = []
    anchor = last
    while anchor > today - dt.timedelta(days=cycle_len * 3):
        anchor -= dt.timedelta(days=cycle_len)
    for _ in range(8):
        starts.append(anchor)
        anchor += dt.timedelta(days=cycle_len)
    ranges = []
    for start in starts:
        period_end = start + dt.timedelta(days=period_len - 1)
        ovulation = start + dt.timedelta(days=max(1, cycle_len - 14))
        fertile_start = ovulation - dt.timedelta(days=5)
        fertile_end = ovulation + dt.timedelta(days=1)
        ranges.append({
            'period_start': start.isoformat(), 'period_end': period_end.isoformat(),
            'fertile_start': fertile_start.isoformat(), 'fertile_end': fertile_end.isoformat(),
        })
    return {
        'cycle_length': cycle_len,
        'period_length': period_len,
        'last_period_date': last.isoformat(),
        'next_period_date': next_start.isoformat(),
        'days_until_next': max(0, (next_start - today).days),
        'ranges': ranges,
        'updated_at': row['updated_at'],
    }


class Handler(core.Handler):
    server_version = 'VestalandAPI/2.0'

    def require_active(self):
        user = self.require_user()
        if not user:
            return None
        if not active_subscription(user):
            self.send_json(402, {
                'error': 'دوره عضویتت تموم شده. برای ادامه یکی از پلن‌ها رو فعال کن.',
                'code': 'subscription_required',
            })
            return None
        return user

    def send_bytes(self, status, mime, raw):
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'private, max-age=300')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/') or '/'

        if path == '/api/v2/health':
            return self.send_json(200, {'ok': True, 'service': 'vestaland-community-v2'})

        if path.startswith('/api/media/'):
            user = self.require_user()
            if not user:
                return
            try:
                media_id = int(path.split('/')[-1])
            except Exception:
                return self.send_json(404, {'error': 'عکس پیدا نشد.'})
            conn = core.connect()
            row = conn.execute('SELECT mime,bytes FROM post_media WHERE id=?', (media_id,)).fetchone()
            conn.close()
            if not row:
                return self.send_json(404, {'error': 'عکس پیدا نشد.'})
            return self.send_bytes(200, row['mime'], row['bytes'])

        if path.startswith('/api/avatar/'):
            user = self.require_user()
            if not user:
                return
            try:
                user_id = int(path.split('/')[-1])
            except Exception:
                return self.send_json(404, {'error': 'عکس پروفایل پیدا نشد.'})
            conn = core.connect()
            row = conn.execute('SELECT avatar_mime,avatar_bytes FROM profiles WHERE user_id=?', (user_id,)).fetchone()
            conn.close()
            if not row or not row['avatar_bytes']:
                return self.send_json(404, {'error': 'عکس پروفایل ثبت نشده.'})
            return self.send_bytes(200, row['avatar_mime'], row['avatar_bytes'])

        if path == '/api/posts':
            user = self.require_user()
            if not user:
                return
            qs = parse_qs(parsed.query)
            post_type = (qs.get('type') or ['vent'])[0]
            if post_type not in core.POST_TYPES:
                return self.send_json(400, {'error': 'بخش نامعتبر است.'})
            conn = core.connect()
            rows = conn.execute('''
                SELECT p.*,u.display_name FROM posts p
                JOIN users u ON u.id=p.user_id
                WHERE p.type=? ORDER BY p.id DESC LIMIT 50
            ''', (post_type,)).fetchall()
            payload = [post_payload(conn, row, user['id']) for row in rows]
            conn.commit()
            conn.close()
            return self.send_json(200, {'posts': payload})

        if path == '/api/post-extras':
            user = self.require_user()
            if not user:
                return
            qs = parse_qs(parsed.query)
            ids = []
            for piece in ','.join(qs.get('ids') or []).split(','):
                try:
                    ids.append(int(piece))
                except Exception:
                    pass
            ids = list(dict.fromkeys(ids))[:50]
            if not ids:
                return self.send_json(200, {'extras': {}})
            marks = ','.join('?' for _ in ids)
            conn = core.connect()
            rows = conn.execute(f'SELECT * FROM posts WHERE id IN ({marks})', ids).fetchall()
            extras = {}
            for row in rows:
                extras[str(row['id'])] = {
                    'media': media_payload(conn, row['id']),
                    'poll': poll_payload(conn, row['id'], user['id']),
                    'bookmarked': bool(conn.execute(
                        'SELECT 1 FROM bookmarks WHERE user_id=? AND post_id=?', (user['id'], row['id'])
                    ).fetchone()),
                    'is_mine': row['user_id'] == user['id'],
                    'comments_allowed': comments_allowed_for(conn, row),
                }
            conn.commit()
            conn.close()
            return self.send_json(200, {'extras': extras})

        if path == '/api/my/posts':
            user = self.require_user()
            if not user:
                return
            conn = core.connect()
            rows = conn.execute('''
                SELECT p.*,u.display_name FROM posts p JOIN users u ON u.id=p.user_id
                WHERE p.user_id=? ORDER BY p.id DESC LIMIT 100
            ''', (user['id'],)).fetchall()
            payload = [post_payload(conn, row, user['id']) for row in rows]
            conn.commit()
            conn.close()
            return self.send_json(200, {'posts': payload})

        if path == '/api/bookmarks':
            user = self.require_user()
            if not user:
                return
            conn = core.connect()
            rows = conn.execute('''
                SELECT p.*,u.display_name FROM bookmarks b
                JOIN posts p ON p.id=b.post_id JOIN users u ON u.id=p.user_id
                WHERE b.user_id=? ORDER BY b.created_at DESC LIMIT 100
            ''', (user['id'],)).fetchall()
            payload = [post_payload(conn, row, user['id']) for row in rows]
            conn.commit()
            conn.close()
            return self.send_json(200, {'posts': payload})

        if path == '/api/profile/stats':
            user = self.require_user()
            if not user:
                return
            conn = core.connect()
            posts = conn.execute('SELECT COUNT(*) n FROM posts WHERE user_id=?', (user['id'],)).fetchone()['n']
            saved = conn.execute('SELECT COUNT(*) n FROM bookmarks WHERE user_id=?', (user['id'],)).fetchone()['n']
            unread = conn.execute('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND is_read=0', (user['id'],)).fetchone()['n']
            conn.close()
            return self.send_json(200, {'posts': posts, 'saved': saved, 'unread_notifications': unread})

        if path == '/api/notifications':
            user = self.require_user()
            if not user:
                return
            conn = core.connect()
            rows = conn.execute('''
                SELECT n.*,p.type post_type FROM notifications n
                LEFT JOIN posts p ON p.id=n.post_id
                WHERE n.user_id=? ORDER BY n.id DESC LIMIT 60
            ''', (user['id'],)).fetchall()
            conn.close()
            items = [{
                'id': r['id'], 'type': r['type'], 'title': r['title'], 'body': r['body'],
                'post_id': r['post_id'], 'post_type': r['post_type'], 'is_read': bool(r['is_read']),
                'created_at': r['created_at'],
            } for r in rows]
            return self.send_json(200, {'notifications': items})

        if path == '/api/wellbeing':
            user = self.require_user()
            if not user:
                return
            conn = core.connect()
            day = core.utcnow().date().isoformat()
            mood = conn.execute('SELECT mood,updated_at FROM moods WHERE user_id=? AND day=?', (user['id'], day)).fetchone()
            cycle = conn.execute('SELECT * FROM cycles WHERE user_id=?', (user['id'],)).fetchone()
            conn.close()
            return self.send_json(200, {
                'mood': int(mood['mood']) if mood else None,
                'mood_updated_at': mood['updated_at'] if mood else None,
                'cycle': cycle_payload(cycle),
            })

        if path == '/api/settings':
            user = self.require_user()
            if not user:
                return
            conn = core.connect()
            row = ensure_settings(conn, user['id'])
            conn.commit()
            conn.close()
            return self.send_json(200, {'settings': {
                'notifications_enabled': bool(row['notifications_enabled']),
                'profile_private': bool(row['profile_private']),
                'allow_comments': bool(row['allow_comments']),
            }})

        if path == '/api/profile':
            user = self.require_user()
            if not user:
                return
            conn = core.connect()
            avatar = conn.execute('SELECT 1 FROM profiles WHERE user_id=? AND avatar_bytes IS NOT NULL', (user['id'],)).fetchone()
            settings = ensure_settings(conn, user['id'])
            conn.commit()
            conn.close()
            payload = core.row_user(user)
            payload['has_avatar'] = bool(avatar)
            payload['settings'] = {
                'notifications_enabled': bool(settings['notifications_enabled']),
                'profile_private': bool(settings['profile_private']),
                'allow_comments': bool(settings['allow_comments']),
            }
            return self.send_json(200, {'profile': payload})

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/') or '/'

        if path in {'/api/posts', '/api/v2/posts'}:
            user = self.require_active()
            if not user:
                return
            try:
                body = self.read_json()
            except ValueError as exc:
                return self.send_json(400, {'error': str(exc)})
            post_type = body.get('type')
            text = ' '.join((body.get('text') or '').strip().split())
            media_items = body.get('media') or []
            poll = body.get('poll') or None
            if post_type not in core.POST_TYPES:
                return self.send_json(400, {'error': 'بخش نامعتبر است.'})
            if len(text) > 2500 or (not text and not media_items):
                return self.send_json(400, {'error': 'یه متن یا عکس برای پست بذار.'})
            if not isinstance(media_items, list) or len(media_items) > MAX_POST_IMAGES:
                return self.send_json(400, {'error': 'برای هر پست حداکثر ۳ عکس می‌تونی بذاری.'})
            decoded = []
            try:
                for item in media_items:
                    decoded.append(decode_image(item))
            except ValueError as exc:
                return self.send_json(400, {'error': str(exc)})
            poll_question = ''
            poll_options = []
            if poll:
                poll_question = ' '.join(str(poll.get('question') or '').strip().split())[:200]
                options = poll.get('options') or []
                if not isinstance(options, list):
                    options = []
                poll_options = [' '.join(str(x).strip().split())[:80] for x in options]
                poll_options = [x for x in poll_options if x]
                if not (2 <= len(poll_options) <= 4) or len(set(poll_options)) != len(poll_options):
                    return self.send_json(400, {'error': 'نظرسنجی باید ۲ تا ۴ گزینه متفاوت داشته باشه.'})
            anonymous = bool(body.get('anonymous')) and post_type in {'vent', 'gossip'}
            conn = core.connect()
            try:
                conn.execute('BEGIN IMMEDIATE')
                cur = conn.execute(
                    'INSERT INTO posts(user_id,type,text,anonymous,created_at) VALUES(?,?,?,?,?)',
                    (user['id'], post_type, text, 1 if anonymous else 0, iso_now()),
                )
                post_id = cur.lastrowid
                for mime, raw in decoded:
                    conn.execute(
                        'INSERT INTO post_media(post_id,mime,bytes,created_at) VALUES(?,?,?,?)',
                        (post_id, mime, raw, iso_now()),
                    )
                if poll_options:
                    conn.execute('INSERT INTO polls(post_id,question,created_at) VALUES(?,?,?)',
                                 (post_id, poll_question or 'نظر تو چیه؟', iso_now()))
                    for position, label in enumerate(poll_options):
                        conn.execute('INSERT INTO poll_options(post_id,label,position) VALUES(?,?,?)',
                                     (post_id, label, position))
                conn.commit()
                row = conn.execute('''
                    SELECT p.*,u.display_name FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=?
                ''', (post_id,)).fetchone()
                payload = post_payload(conn, row, user['id'])
                conn.commit()
            except Exception:
                conn.rollback()
                conn.close()
                raise
            conn.close()
            return self.send_json(201, {'post': payload})

        if path.startswith('/api/posts/') and path.endswith('/react'):
            user = self.require_active()
            if not user:
                return
            try:
                body = self.read_json()
                post_id = int(path.split('/')[3])
            except ValueError as exc:
                return self.send_json(400, {'error': str(exc)})
            except Exception:
                return self.send_json(404, {'error': 'پست پیدا نشد.'})
            emoji = body.get('emoji') or ''
            conn = core.connect()
            post = conn.execute('SELECT p.*,u.display_name FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=?', (post_id,)).fetchone()
            if not post:
                conn.close()
                return self.send_json(404, {'error': 'پست پیدا نشد.'})
            if emoji not in core.REACTIONS[post['type']]:
                conn.close()
                return self.send_json(400, {'error': 'واکنش نامعتبر است.'})
            existing = conn.execute('SELECT 1 FROM reactions WHERE post_id=? AND user_id=? AND emoji=?',
                                    (post_id, user['id'], emoji)).fetchone()
            if existing:
                conn.execute('DELETE FROM reactions WHERE post_id=? AND user_id=? AND emoji=?',
                             (post_id, user['id'], emoji))
                active = False
            else:
                conn.execute('INSERT INTO reactions(post_id,user_id,emoji,created_at) VALUES(?,?,?,?)',
                             (post_id, user['id'], emoji, iso_now()))
                active = True
                actor = user['display_name']
                notify(conn, post['user_id'], user['id'], 'reaction', 'واکنش جدید',
                       f'{actor} به پستت واکنش {emoji} داد.', post_id)
            conn.commit()
            count = conn.execute('SELECT COUNT(*) n FROM reactions WHERE post_id=? AND emoji=?',
                                 (post_id, emoji)).fetchone()['n']
            conn.close()
            return self.send_json(200, {'active': active, 'count': count})

        if path.startswith('/api/posts/') and path.endswith('/comments'):
            user = self.require_active()
            if not user:
                return
            try:
                body = self.read_json()
                post_id = int(path.split('/')[3])
            except ValueError as exc:
                return self.send_json(400, {'error': str(exc)})
            except Exception:
                return self.send_json(404, {'error': 'پست پیدا نشد.'})
            text = ' '.join((body.get('text') or '').strip().split())
            if not (1 <= len(text) <= 1000):
                return self.send_json(400, {'error': 'کامنت باید بین ۱ تا ۱۰۰۰ کاراکتر باشد.'})
            conn = core.connect()
            post = conn.execute('SELECT * FROM posts WHERE id=?', (post_id,)).fetchone()
            if not post:
                conn.close()
                return self.send_json(404, {'error': 'پست پیدا نشد.'})
            if not comments_allowed_for(conn, post):
                conn.commit(); conn.close()
                return self.send_json(403, {'error': 'صاحب این پست نظرها رو بسته.'})
            cur = conn.execute('INSERT INTO comments(post_id,user_id,text,created_at) VALUES(?,?,?,?)',
                               (post_id, user['id'], text, iso_now()))
            count = conn.execute('SELECT COUNT(*) n FROM comments WHERE post_id=?', (post_id,)).fetchone()['n']
            notify(conn, post['user_id'], user['id'], 'comment', 'نظر جدید',
                   f"{user['display_name']} برای پستت نظر گذاشت: {text[:80]}", post_id)
            conn.commit(); conn.close()
            return self.send_json(201, {'comment': {
                'id': cur.lastrowid, 'text': text, 'name': user['display_name'],
                'avatar': user['display_name'][:1], 'created_at': iso_now(),
            }, 'count': count})

        if path.startswith('/api/posts/') and path.endswith('/bookmark'):
            user = self.require_user()
            if not user:
                return
            try:
                _ = self.read_json()
                post_id = int(path.split('/')[3])
            except ValueError as exc:
                return self.send_json(400, {'error': str(exc)})
            except Exception:
                return self.send_json(404, {'error': 'پست پیدا نشد.'})
            conn = core.connect()
            if not conn.execute('SELECT 1 FROM posts WHERE id=?', (post_id,)).fetchone():
                conn.close(); return self.send_json(404, {'error': 'پست پیدا نشد.'})
            existing = conn.execute('SELECT 1 FROM bookmarks WHERE user_id=? AND post_id=?',
                                    (user['id'], post_id)).fetchone()
            if existing:
                conn.execute('DELETE FROM bookmarks WHERE user_id=? AND post_id=?', (user['id'], post_id))
                active = False
            else:
                conn.execute('INSERT INTO bookmarks(user_id,post_id,created_at) VALUES(?,?,?)',
                             (user['id'], post_id, iso_now()))
                active = True
            conn.commit(); conn.close()
            return self.send_json(200, {'bookmarked': active})

        if path.startswith('/api/posts/') and path.endswith('/poll-vote'):
            user = self.require_active()
            if not user:
                return
            try:
                body = self.read_json()
                post_id = int(path.split('/')[3])
                option_id = int(body.get('option_id'))
            except ValueError as exc:
                return self.send_json(400, {'error': str(exc)})
            except Exception:
                return self.send_json(400, {'error': 'گزینه نظرسنجی معتبر نیست.'})
            conn = core.connect()
            post = conn.execute('SELECT * FROM posts WHERE id=?', (post_id,)).fetchone()
            option = conn.execute('SELECT 1 FROM poll_options WHERE id=? AND post_id=?', (option_id, post_id)).fetchone()
            if not post or not option:
                conn.close(); return self.send_json(404, {'error': 'نظرسنجی پیدا نشد.'})
            previous = conn.execute('SELECT option_id FROM poll_votes WHERE post_id=? AND user_id=?',
                                    (post_id, user['id'])).fetchone()
            conn.execute('''
                INSERT INTO poll_votes(post_id,user_id,option_id,created_at) VALUES(?,?,?,?)
                ON CONFLICT(post_id,user_id) DO UPDATE SET option_id=excluded.option_id, created_at=excluded.created_at
            ''', (post_id, user['id'], option_id, iso_now()))
            if not previous:
                notify(conn, post['user_id'], user['id'], 'poll', 'رأی جدید',
                       f"{user['display_name']} توی نظرسنجی پستت رأی داد.", post_id)
            conn.commit()
            poll = poll_payload(conn, post_id, user['id'])
            conn.close()
            return self.send_json(200, {'poll': poll})

        if path == '/api/notifications/read':
            user = self.require_user()
            if not user:
                return
            try:
                body = self.read_json()
            except ValueError as exc:
                return self.send_json(400, {'error': str(exc)})
            conn = core.connect()
            if body.get('all'):
                conn.execute('UPDATE notifications SET is_read=1 WHERE user_id=?', (user['id'],))
            else:
                try:
                    notification_id = int(body.get('id'))
                except Exception:
                    conn.close(); return self.send_json(400, {'error': 'اعلان معتبر نیست.'})
                conn.execute('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?',
                             (notification_id, user['id']))
            conn.commit(); conn.close()
            return self.send_json(200, {'ok': True})

        if path == '/api/cycle':
            user = self.require_active()
            if not user:
                return
            try:
                body = self.read_json()
                cycle_length = int(body.get('cycle_length'))
                period_length = int(body.get('period_length'))
                last_period_date = dt.date.fromisoformat(str(body.get('last_period_date') or ''))
            except ValueError:
                return self.send_json(400, {'error': 'اطلاعات چرخه معتبر نیست.'})
            if not (20 <= cycle_length <= 45 and 1 <= period_length <= 10):
                return self.send_json(400, {'error': 'طول چرخه یا پریود خارج از بازه معمول تنظیمات است.'})
            today = dt.datetime.now().astimezone().date()
            if last_period_date > today or last_period_date < today - dt.timedelta(days=120):
                return self.send_json(400, {'error': 'تاریخ شروع آخرین پریود معتبر نیست.'})
            conn = core.connect()
            conn.execute('''
                INSERT INTO cycles(user_id,cycle_length,period_length,last_period_date,updated_at) VALUES(?,?,?,?,?)
                ON CONFLICT(user_id) DO UPDATE SET cycle_length=excluded.cycle_length,period_length=excluded.period_length,
                  last_period_date=excluded.last_period_date,updated_at=excluded.updated_at
            ''', (user['id'], cycle_length, period_length, last_period_date.isoformat(), iso_now()))
            conn.commit()
            row = conn.execute('SELECT * FROM cycles WHERE user_id=?', (user['id'],)).fetchone()
            conn.close()
            return self.send_json(200, {'cycle': cycle_payload(row)})

        if path == '/api/settings':
            user = self.require_user()
            if not user:
                return
            try:
                body = self.read_json()
            except ValueError as exc:
                return self.send_json(400, {'error': str(exc)})
            values = {
                'notifications_enabled': 1 if body.get('notifications_enabled', True) else 0,
                'profile_private': 1 if body.get('profile_private', False) else 0,
                'allow_comments': 1 if body.get('allow_comments', True) else 0,
            }
            conn = core.connect()
            conn.execute('''
                INSERT INTO user_settings(user_id,notifications_enabled,profile_private,allow_comments,updated_at)
                VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
                  notifications_enabled=excluded.notifications_enabled,
                  profile_private=excluded.profile_private,
                  allow_comments=excluded.allow_comments,
                  updated_at=excluded.updated_at
            ''', (user['id'], values['notifications_enabled'], values['profile_private'], values['allow_comments'], iso_now()))
            conn.commit(); conn.close()
            return self.send_json(200, {'settings': {k: bool(v) for k, v in values.items()}})

        if path == '/api/profile':
            user = self.require_user()
            if not user:
                return
            try:
                body = self.read_json()
                display_name = core.clean_display_name(body.get('display_name', user['display_name']))
                username = core.clean_username(body.get('username', user['username']))
                avatar = decode_image(body.get('avatar_data')) if body.get('avatar_data') else None
            except ValueError as exc:
                return self.send_json(400, {'error': str(exc)})
            conn = core.connect()
            try:
                conn.execute('UPDATE users SET display_name=?,username=? WHERE id=?',
                             (display_name, username, user['id']))
                if avatar:
                    conn.execute('''
                        INSERT INTO profiles(user_id,avatar_mime,avatar_bytes,updated_at) VALUES(?,?,?,?)
                        ON CONFLICT(user_id) DO UPDATE SET avatar_mime=excluded.avatar_mime,
                          avatar_bytes=excluded.avatar_bytes,updated_at=excluded.updated_at
                    ''', (user['id'], avatar[0], avatar[1], iso_now()))
                conn.commit()
            except sqlite3.IntegrityError:
                conn.rollback(); conn.close()
                return self.send_json(409, {'error': 'این نام کاربری قبلاً گرفته شده.'})
            row = conn.execute('SELECT * FROM users WHERE id=?', (user['id'],)).fetchone()
            has_avatar = bool(conn.execute('SELECT 1 FROM profiles WHERE user_id=? AND avatar_bytes IS NOT NULL',
                                           (user['id'],)).fetchone())
            conn.close()
            payload = core.row_user(row); payload['has_avatar'] = has_avatar
            return self.send_json(200, {'profile': payload})

        if path == '/api/profile/password':
            user = self.require_user()
            if not user:
                return
            try:
                body = self.read_json()
            except ValueError as exc:
                return self.send_json(400, {'error': str(exc)})
            current = body.get('current_password') or ''
            new = body.get('new_password') or ''
            if not core.verify_password(current, user['password_salt'], user['password_hash']):
                return self.send_json(403, {'error': 'رمز فعلی درست نیست.'})
            if not (8 <= len(new) <= 128):
                return self.send_json(400, {'error': 'رمز جدید باید حداقل ۸ کاراکتر باشد.'})
            salt, digest = core.password_hash(new)
            conn = core.connect()
            conn.execute('UPDATE users SET password_salt=?,password_hash=? WHERE id=?', (salt, digest, user['id']))
            conn.commit(); conn.close()
            return self.send_json(200, {'ok': True})

        if path == '/api/profile/delete':
            user = self.require_user()
            if not user:
                return
            try:
                body = self.read_json()
            except ValueError as exc:
                return self.send_json(400, {'error': str(exc)})
            password = body.get('password') or ''
            if not core.verify_password(password, user['password_salt'], user['password_hash']):
                return self.send_json(403, {'error': 'رمز عبور درست نیست.'})
            conn = core.connect()
            conn.execute('DELETE FROM users WHERE id=?', (user['id'],))
            conn.commit(); conn.close()
            return self.send_json(200, {'ok': True, 'deleted': True})

        if path == '/api/mood':
            user = self.require_active()
            if not user:
                return
            return super().do_POST()

        return super().do_POST()

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/') or '/'
        if path.startswith('/api/posts/'):
            user = self.require_user()
            if not user:
                return
            try:
                post_id = int(path.split('/')[3])
            except Exception:
                return self.send_json(404, {'error': 'پست پیدا نشد.'})
            conn = core.connect()
            row = conn.execute('SELECT user_id FROM posts WHERE id=?', (post_id,)).fetchone()
            if not row:
                conn.close(); return self.send_json(404, {'error': 'پست پیدا نشد.'})
            if row['user_id'] != user['id']:
                conn.close(); return self.send_json(403, {'error': 'فقط پست خودت رو می‌تونی حذف کنی.'})
            conn.execute('DELETE FROM posts WHERE id=?', (post_id,))
            conn.commit(); conn.close()
            return self.send_json(200, {'ok': True})
        return self.send_json(404, {'error': 'مسیر پیدا نشد.'})


def main():
    global DB_PATH, MAX_BODY
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--db', default='/var/lib/vestaland/vestaland.db')
    args = parser.parse_args()
    DB_PATH = core.os.path.abspath(args.db)
    MAX_BODY = FEATURE_MAX_BODY
    init_db()
    server = core.ThreadingHTTPServer((args.host, args.port), Handler)
    print(f'Vestaland API v2 listening on {args.host}:{args.port} db={core.DB_PATH}', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
