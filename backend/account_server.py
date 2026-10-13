#!/usr/bin/env python3
"""Vestaland account API. No third-party Python dependencies; dedicated SQLite volume.
No SMS, payments, or AI calls are made until environment secrets are provisioned.
All subscriptions and checkout access are decided server-side, not by browser state.
"""
import argparse
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from calendar import monthrange
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import bazaar_verify

DB_FILE = os.getenv("VESTALAND_DB_PATH", "/var/lib/vestaapp/accounts.db")
SMS_KEY = os.getenv("SMSIR_API_KEY", "")
SMS_TEMPLATE = os.getenv("SMSIR_TEMPLATE_ID", "")
ZIBAL_MERCHANT = os.getenv("ZIBAL_MERCHANT", "")
CF_WORKER_URL = os.getenv("CF_AI_WORKER_URL") or "https://vestaland-ai.hsdf7rb.workers.dev/"
CF_AI_SHARED_SECRET = os.getenv("CF_AI_SHARED_SECRET", "")
PUBLIC_BASE = "https://app.vesta-cosmetics.ir"
MARKET_URL = "http://vc-vestaapp-market:8766"
PLANS = {"monthly": (199000, 1), "quarterly": (499000, 3)}
MAX_BODY = 24000
TRIAL_SECONDS = 7 * 86400
SESSION_SECONDS = 30 * 86400
AI_GLOBAL_LIMIT = min(400, max(1, int(os.getenv("AI_GLOBAL_DAILY_LIMIT", "240"))))
AI_DAILY_PAID = min(4, max(1, int(os.getenv("AI_DAILY_PAID", "2"))))
AI_DAILY_TRIAL = 1
LOCK = threading.RLock()
LOG = logging.getLogger("vestaland-account")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

def now(): return int(time.time())

def add_months(timestamp,months):
    d=datetime.fromtimestamp(timestamp,timezone.utc)
    m=d.month-1+months
    year=d.year+m//12
    month=m%12+1
    return int(d.replace(year=year,month=month,day=min(d.day,monthrange(year,month)[1])).timestamp())

class Error(Exception):
    def __init__(self, message, status=400):
        super().__init__(message); self.status=status

def ensure_configs(*names):
    if not all(globals()[n] for n in names): raise Error("این قابلیت هنوز توسط مدیر فعال نشده است.", 503)

def conn():
    c=sqlite3.connect(DB_FILE,timeout=12,isolation_level=None)
    c.row_factory=sqlite3.Row
    c.execute("PRAGMA busy_timeout=12000")
    return c

def init_db():
    os.makedirs(os.path.dirname(DB_FILE),exist_ok=True)
    with conn() as c:
        c.executescript("""
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS users(
            id INTEGER PRIMARY KEY, phone TEXT UNIQUE NOT NULL,
            created_at INTEGER NOT NULL, trial_until INTEGER NOT NULL,
            paid_until INTEGER NOT NULL DEFAULT 0,
            bazaar_until INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS otp_codes(
            phone TEXT PRIMARY KEY, code_hash TEXT NOT NULL,
            created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
            tries INTEGER NOT NULL DEFAULT 0, last_sent INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS otp_rate(
            key TEXT PRIMARY KEY, window INTEGER NOT NULL,
            count INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions(
            token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
            expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE TABLE IF NOT EXISTS subscriptions(
            id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
            plan TEXT NOT NULL, amount_rial INTEGER NOT NULL,
            track_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'pending',
            created_at INTEGER NOT NULL, verified_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_subscription_user ON subscriptions(user_id,created_at);
        CREATE TABLE IF NOT EXISTS bazaar_receipts(
            token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
            sku TEXT NOT NULL, expires_at INTEGER NOT NULL,
            verified_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ai_usage(
            user_id INTEGER NOT NULL, day TEXT NOT NULL,
            count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(user_id,day)
        );
        CREATE TABLE IF NOT EXISTS ai_global(
            day TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS ai_scan_usage(
            user_id INTEGER NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(user_id,day)
        );
        CREATE TABLE IF NOT EXISTS ai_scan_total(
            day TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS app_orders(
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
            request_id TEXT NOT NULL, store TEXT NOT NULL, order_id INTEGER,
            order_key TEXT, payment_url TEXT, payment_status TEXT,
            created_at INTEGER NOT NULL, UNIQUE(user_id,request_id)
        );
        CREATE INDEX IF NOT EXISTS idx_app_orders_user ON app_orders(user_id,created_at);
        """)
def db_one(sql,params=()):
    with conn() as c: return c.execute(sql,params).fetchone()
def json_http(url,body=None,headers=None,timeout=20):
    raw=None if body is None else json.dumps(body,ensure_ascii=False,separators=(",",":")).encode()
    hh={"Accept":"application/json","User-Agent":"VestalandAccount/1.0",**(headers or {})}
    if raw is not None: hh["Content-Type"]="application/json"
    req=urllib.request.Request(url,data=raw,headers=hh,method="POST" if raw is not None else "GET")
    try:
        with urllib.request.urlopen(req,timeout=timeout) as response:
            data=response.read(150000)
            return json.loads(data)
    except urllib.error.HTTPError as e:
        raise Error("ارتباط با سرویس انجام نشد؛ دوباره تلاش کن.",502) from e
    except (ValueError,OSError,TimeoutError) as e:
        raise Error("ارتباط با سرویس انجام نشد؛ دوباره تلاش کن.",502) from e

def normalize_phone(raw):
    numbers=str(raw or "").translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩","01234567890123456789"))
    numbers=re.sub(r"[\s()\-]","",numbers)
    if numbers.startswith("+98"):numbers="0"+numbers[3:]
    elif numbers.startswith("0098"):numbers="0"+numbers[4:]
    elif numbers.startswith("98") and len(numbers)==12:numbers="0"+numbers[2:]
    elif len(numbers)==10 and numbers.startswith("9"):numbers="0"+numbers
    if not re.fullmatch(r"09\d{9}",numbers):raise Error("شماره موبایل ایران رو درست وارد کن.")
    return numbers

def digest(token): return hashlib.sha256(token.encode()).hexdigest()
def otp_digest(phone,code):
    secret=os.getenv("VESTALAND_OTP_PEPPER","")
    ensure_configs("SMS_KEY","SMS_TEMPLATE")
    if len(secret)<32:raise Error("تنظیمات امنیت ورود هنوز تکمیل نشده است.",503)
    return hmac.new(secret.encode(),(phone+":"+code).encode(),hashlib.sha256).hexdigest()

def check_rate(c,key,limit,window):
    t=now()
    row=c.execute("SELECT window,count FROM otp_rate WHERE key=?",(key,)).fetchone()
    if not row or row["window"]+window<t:
        c.execute("INSERT INTO otp_rate(key,window,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window=excluded.window,count=1",(key,t))
    elif row["count"]>=limit:
        raise Error("تعداد درخواست‌ها زیاد بوده؛ کمی بعد دوباره تلاش کن.",429)
    else:
        c.execute("UPDATE otp_rate SET count=count+1 WHERE key=?",(key,))

def send_otp(phone,ip):
    if os.getenv('OTP_ENABLED','0')!='1':raise Error('ورود پیامکی هنوز فعال نشده است.',503)
    ensure_configs("SMS_KEY","SMS_TEMPLATE")
    if os.getenv('OTP_TEST_PHONE') and phone!=normalize_phone(os.getenv('OTP_TEST_PHONE')):
        raise Error('فعلاً فقط ورود آزمایشی فعال است.',403)
    code=str(secrets.randbelow(900000)+100000)
    hd=otp_digest(phone,code)
    with LOCK,conn() as c:
        c.execute("BEGIN IMMEDIATE")
        # Limit total SMS cost/abuse in addition to per-phone and IP rate limits.
        # 420 OTP/hour permits a 300-user launch burst, but prevents unbounded SMS bills.
        check_rate(c,"sms:all:hour",420,3600)
        check_rate(c,"sms:all:day",600,86400)
        check_rate(c,"sms:ip:"+digest(ip)[:24],15,3600)
        check_rate(c,"sms:phone:"+digest(phone)[:24],4,3600)
        old=c.execute("SELECT last_sent FROM otp_codes WHERE phone=?",(phone,)).fetchone()
        if old and old["last_sent"]+75>now():raise Error("برای دریافت کد جدید کمی صبر کن.",429)
        # Commit only once SMS provider confirms delivery acceptance.
        r=json_http("https://api.sms.ir/v1/send/verify",{
          "mobile":phone,"templateId":int(SMS_TEMPLATE),
          "parameters":[{"name":"Code","value":code}]
        },{"X-API-KEY":SMS_KEY},timeout=15)
        if int(r.get("status") or 0)!=1:raise Error("ارسال پیامک انجام نشد؛ دوباره تلاش کن.",502)
        c.execute("""INSERT INTO otp_codes(phone,code_hash,created_at,expires_at,tries,last_sent) VALUES(?,?,?,?,0,?)
          ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash,created_at=excluded.created_at,
          expires_at=excluded.expires_at,tries=0,last_sent=excluded.last_sent""",(phone,hd,now(),now()+300,now()))
    return {"ok":True,"message":"اگر شماره قابل دریافت باشد، کد ورود ارسال شده است.","expires_in":300}

def verify_otp(phone,code,ip):
    if os.getenv('OTP_ENABLED','0')!='1':raise Error('ورود پیامکی هنوز فعال نشده است.',503)
    if os.getenv("OTP_TEST_PHONE") and phone!=normalize_phone(os.getenv("OTP_TEST_PHONE")):
        raise Error("فعلاً فقط ورود آزمایشی فعال است.",403)
    if not re.fullmatch(r"\d{6}",str(code or "")):raise Error("کد باید شش رقم باشد.")
    with LOCK,conn() as c:
        c.execute("BEGIN IMMEDIATE")
        check_rate(c,"verify:ip:"+digest(ip)[:24],50,3600)
        row=c.execute("SELECT * FROM otp_codes WHERE phone=?",(phone,)).fetchone()
        if not row or row["expires_at"]<now() or row["tries"]>=5:raise Error("کد منقضی شده؛ کد جدید بگیر.",401)
        c.execute("UPDATE otp_codes SET tries=tries+1 WHERE phone=?",(phone,))
        if not hmac.compare_digest(row["code_hash"],otp_digest(phone,code)):
            c.commit()  # Wrong code MUST consume an attempt even though request returns HTTP 401.
            raise Error("کد ورود درست نیست.",401)
        c.execute("DELETE FROM otp_codes WHERE phone=?",(phone,))
        user=c.execute("SELECT * FROM users WHERE phone=?",(phone,)).fetchone()
        if not user:
            t=now()
            c.execute("INSERT INTO users(phone,created_at,trial_until) VALUES(?,?,?)",(phone,t,t+TRIAL_SECONDS))
            user=c.execute("SELECT * FROM users WHERE phone=?",(phone,)).fetchone()
        token=secrets.token_urlsafe(42)
        c.execute("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",(digest(token),user["id"],now()+SESSION_SECONDS))
    return {"ok":True,"token":token,"user":public_user(user)}

def public_user(user):
    t=now()
    paid=max(user["paid_until"],user["bazaar_until"])>t
    trial=user["trial_until"]>t
    end=max(user["paid_until"],user["bazaar_until"]) if paid else user["trial_until"]
    return {"id":user["id"],"phone":user["phone"],"active":paid or trial,
            "plan":"paid" if paid else ("trial" if trial else "expired"),
            "trial_until":user["trial_until"],"paid_until":max(user["paid_until"],user["bazaar_until"]),"expires_at":end}

def authenticate(headers,active=False):
    auth=headers.get("Authorization","")
    if not auth.startswith("Bearer "):raise Error("ابتدا با شماره موبایل وارد شو.",401)
    token=auth[7:].strip()
    if not 32<=len(token)<=150:raise Error("نشست معتبر نیست.",401)
    row=db_one("""SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id
      WHERE sessions.token_hash=? AND sessions.expires_at>?""",(digest(token),now()))
    if not row:raise Error("لطفاً دوباره وارد حساب شو.",401)
    if active and not public_user(row)["active"]:raise Error("اشتراکت به پایان رسیده؛ یکی از پلن‌ها رو انتخاب کن.",402)
    return row

def logout(headers):
    auth=headers.get("Authorization","")
    if auth.startswith("Bearer "):
        with conn() as c:c.execute("DELETE FROM sessions WHERE token_hash=?",(digest(auth[7:].strip()),))
    return {"ok":True}

def plans():
    return {"ok":True,"trial_days":7,"plans":[{"id":k,"price_toman":v[0],"duration_months":v[1]} for k,v in PLANS.items()],
            "features":{"otp_enabled":os.getenv("OTP_ENABLED","0")=="1" and bool(SMS_KEY and SMS_TEMPLATE and len(os.getenv("VESTALAND_OTP_PEPPER",""))>=32),
                        "login_required":os.getenv("OTP_ENABLED","0")=="1" and os.getenv("LOGIN_GATE_ENABLED","0")=="1" and not bool(os.getenv("OTP_TEST_PHONE","")),
                        "subscriptions_enabled":os.getenv("SUBSCRIPTIONS_ENABLED","0")=="1" and bool(ZIBAL_MERCHANT),
                        "ai_enabled":os.getenv("AI_ENABLED","0")=="1" and bool(CF_WORKER_URL and CF_AI_SHARED_SECRET),
                        "image_scan_enabled":os.getenv("AI_ENABLED","0")=="1" and os.getenv("IMAGE_SCAN_ENABLED","0")=="1" and bool(CF_AI_SHARED_SECRET),
                        "store_checkout_enabled":os.getenv("APP_CHECKOUT_ENABLED","0")=="1",
                        "bazaar_enabled":os.getenv("BAZAAR_ENABLED","0")=="1" and bazaar_verify.ready()}}

def subscribe(user,plan):
    if os.getenv("SUBSCRIPTIONS_ENABLED","0")!="1":raise Error("پرداخت اشتراک هنوز فعال نشده است.",503)
    ensure_configs("ZIBAL_MERCHANT")
    if plan not in PLANS:raise Error("پلن نامعتبر است.")
    price,_=PLANS[plan]
    # Gateway accepts Iranian rial. Never take any price/amount from the client.
    amount_rial=price*10
    sub_id=secrets.token_urlsafe(20)
    cb=PUBLIC_BASE+"/api/account/subscription/callback?payment="+urllib.parse.quote(sub_id)
    data=json_http("https://gateway.zibal.ir/v1/request",{
        "merchant":ZIBAL_MERCHANT,"amount":amount_rial,"callbackUrl":cb,
        "description":"اشتراک وستالند "+("یک‌ماهه" if plan=="monthly" else "سه‌ماهه"),
        "mobile":user["phone"]},timeout=18)
    if int(data.get("result") or 0)!=100 or not str(data.get("trackId") or "").isdigit():
        raise Error("درگاه پرداخت فعلاً پاسخ نداد؛ کمی بعد تلاش کن.",502)
    track=str(data["trackId"])
    with conn() as c:
        c.execute("INSERT INTO subscriptions(id,user_id,plan,amount_rial,track_id,status,created_at) VALUES(?,?,?,?,?,'pending',?)",
                 (sub_id,user["id"],plan,amount_rial,track,now()))
    return {"ok":True,"payment_id":sub_id,"payment_url":"https://gateway.zibal.ir/start/"+track}

def verify_subscription(sub_id,returned_track=None):
    with LOCK,conn() as c:
        c.execute("BEGIN IMMEDIATE")
        row=c.execute("SELECT * FROM subscriptions WHERE id=?",(sub_id,)).fetchone()
        if not row:raise Error("پرداخت پیدا نشد.",404)
        if row["status"]=="paid":return True
        if row["status"] not in ("pending","verifying"):return False
        if returned_track is not None and not hmac.compare_digest(str(row["track_id"]),str(returned_track)):raise Error("شناسه تراکنش معتبر نیست.",400)
        info=json_http("https://gateway.zibal.ir/v1/verify",{"merchant":ZIBAL_MERCHANT,"trackId":int(row["track_id"])},timeout=18)
        if int(info.get("result") or 0)!=100:return False
        if int(info.get("amount") or -1)!=row["amount_rial"]:
            LOG.error("Payment amount mismatch for subscription %s",sub_id)
            c.execute("UPDATE subscriptions SET status='mismatch' WHERE id=?",(sub_id,))
            return False
        user=c.execute("SELECT paid_until,trial_until FROM users WHERE id=?",(row["user_id"],)).fetchone()
        base=max(now(),user["paid_until"],user["trial_until"])
        end=add_months(base,PLANS[row["plan"]][1])
        c.execute("UPDATE users SET paid_until=? WHERE id=?",(end,row["user_id"]))
        c.execute("UPDATE subscriptions SET status='paid',verified_at=? WHERE id=?",(now(),sub_id))
        return True

def verify_bazaar_receipt(user,plan,purchase_token):
    if os.getenv("BAZAAR_ENABLED","0")!="1":raise Error("پرداخت بازار هنوز فعال نشده است.",503)
    if not bazaar_verify.ready():raise Error("تأیید اشتراک کافه‌بازار هنوز فعال نشده است.",503)
    try:receipt=bazaar_verify.validate(plan,purchase_token)
    except bazaar_verify.BazaarError as e:
        LOG.warning("Bazaar purchase verification failed: %s",type(e).__name__)
        raise Error("تأیید اشتراک در بازار انجام نشد. کمی بعد دوباره تلاش کن.",422)
    token_hash=digest(purchase_token)
    with LOCK,conn() as c:
        c.execute("BEGIN IMMEDIATE")
        previous=c.execute("SELECT user_id FROM bazaar_receipts WHERE token_hash=?",(token_hash,)).fetchone()
        if previous and previous["user_id"]!=user["id"]:
            raise Error("این رسید قبلاً در حساب دیگری ثبت شده است.",409)
        c.execute("""INSERT INTO bazaar_receipts(token_hash,user_id,sku,expires_at,verified_at)
          VALUES(?,?,?,?,?) ON CONFLICT(token_hash) DO UPDATE SET expires_at=excluded.expires_at,
          verified_at=excluded.verified_at""",
          (token_hash,user["id"],receipt["sku"],receipt["expires_at"],now()))
        last=c.execute("SELECT bazaar_until FROM users WHERE id=?",(user["id"],)).fetchone()
        # Never shrink an existing separately paid Zibal subscription.
        expiry=max(receipt["expires_at"],last["bazaar_until"])
        c.execute("UPDATE users SET bazaar_until=? WHERE id=?",(expiry,user["id"]))
    fresh=db_one("SELECT * FROM users WHERE id=?",(user["id"],))
    return {"ok":True,"user":public_user(fresh),"bazaar_expires_at":receipt["expires_at"]}

def subscription_status(user,pid,refresh=False):
    if not isinstance(pid,str) or not re.fullmatch(r"[A-Za-z0-9_-]{20,90}",pid):
        raise Error("شناسه پرداخت معتبر نیست.",400)
    payment=db_one("SELECT * FROM subscriptions WHERE id=? AND user_id=?",(pid,user["id"]))
    if not payment:raise Error("پرداخت پیدا نشد.",404)
    if refresh and payment["status"] in ("pending","verifying"):
        # Payment may have succeeded even when the browser was closed before
        # the Zibal callback. Authenticated, bounded manual reconciliation.
        if now()-payment["created_at"]>14*86400:
            raise Error("برای بررسی این پرداخت با پشتیبانی تماس بگیر.",409)
        with LOCK,conn() as c:
            c.execute("BEGIN IMMEDIATE")
            check_rate(c,"zibal:refresh:"+digest(pid)[:24],6,3600)
        try:verify_subscription(pid)
        except Error:
            LOG.warning("Zibal status refresh currently unavailable for payment %s",pid)
        payment=db_one("SELECT * FROM subscriptions WHERE id=? AND user_id=?",(pid,user["id"]))
    return {"ok":True,"payment_status":payment["status"],"plan":payment["plan"],
            "price_toman":payment["amount_rial"]//10,
            "verified_at":payment["verified_at"]}

def ai_recommend(user,items,question):
    if os.getenv("AI_ENABLED","0")!="1":raise Error("پیشنهاد AI هنوز برای عموم فعال نشده است.",503)
    ensure_configs("CF_WORKER_URL","CF_AI_SHARED_SECRET")
    if not CF_WORKER_URL.startswith("https://"):raise Error("اتصال هوش مصنوعی آماده نیست.",503)
    if not isinstance(items,list):raise Error("لیست وسایل معتبر نیست.")
    limited=[{"name":str(x.get("name") or "")[:55],"group":str(x.get("group") or "")[:20],
              "color":str(x.get("color") or "")[:20],"category":str(x.get("category") or "")[:30]}
             for x in items[:18] if isinstance(x,dict)]
    question=str(question or "")[:250]
    day=datetime.now(timezone.utc).strftime("%Y-%m-%d")
    cap=AI_DAILY_TRIAL if public_user(user)["plan"]=="trial" else AI_DAILY_PAID
    with LOCK,conn() as c:
        c.execute("BEGIN IMMEDIATE")
        u=c.execute("SELECT count FROM ai_usage WHERE user_id=? AND day=?",(user["id"],day)).fetchone()
        g=c.execute("SELECT count FROM ai_global WHERE day=?",(day,)).fetchone()
        if (u and u["count"]>=cap) or (g and g["count"]>=AI_GLOBAL_LIMIT):
            raise Error("سهمیه پیشنهاد هوشمند امروز تموم شده؛ فردا دوباره امتحان کن.",429)
        c.execute("INSERT INTO ai_usage(user_id,day,count) VALUES(?,?,1) ON CONFLICT(user_id,day) DO UPDATE SET count=count+1",(user["id"],day))
        c.execute("INSERT INTO ai_global(day,count) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET count=count+1",(day,))
    try:
        answer=json_http(CF_WORKER_URL,{"items":limited,"question":question},
               {"Authorization":"Bearer "+CF_AI_SHARED_SECRET,
                "User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"},timeout=23)
        if not answer.get("ok") or not str(answer.get("suggestion") or "").strip():raise Error("هوش مصنوعی پاسخ معتبری نداد.",502)
        return {"ok":True,"suggestion":str(answer["suggestion"])[:900],"limit":cap,
                "remaining":max(0,cap-((u["count"] if u else 0)+1))}
    except Exception:
        with LOCK,conn() as c:
            c.execute("BEGIN IMMEDIATE")
            c.execute("UPDATE ai_usage SET count=max(0,count-1) WHERE user_id=? AND day=?",(user["id"],day))
            c.execute("UPDATE ai_global SET count=max(0,count-1) WHERE day=?",(day,))
        raise

def vision_scan(user, group, image):
    if os.getenv("AI_ENABLED","0")!="1" or os.getenv("IMAGE_SCAN_ENABLED","0")!="1":
        raise Error("تشخیص عکس هنوز فعال نشده است.",503)
    ensure_configs("CF_WORKER_URL","CF_AI_SHARED_SECRET")
    if group not in ("closet","beauty") or not isinstance(image,str) or not re.fullmatch(r"[a-zA-Z0-9+/]{100,170000}={0,2}",image):
        raise Error("تصویر معتبر نیست؛ فقط تصویر کوچک JPG ارسال کن.",400)
    # Never store uploaded photos, face data or content in the server database.
    # Conservatively reserve a globally limited number of vision inferences,
    # independent from lower-cost outfit text requests and SMS limits.
    day=datetime.now(timezone.utc).strftime("%Y-%m-%d")
    per_user=1 if public_user(user)["plan"]=="trial" else 2
    cap=min(60,max(1,int(os.getenv("AI_SCAN_DAILY_GLOBAL","30"))))
    with LOCK,conn() as c:
        c.execute("BEGIN IMMEDIATE")
        one=c.execute("SELECT count FROM ai_scan_usage WHERE user_id=? AND day=?",(user["id"],day)).fetchone()
        total=c.execute("SELECT count FROM ai_scan_total WHERE day=?",(day,)).fetchone()
        if (one and one["count"]>=per_user) or (total and total["count"]>=cap):
            raise Error("سهمیه تشخیص عکس امروز تمام شده؛ فردا دوباره امتحان کن.",429)
        c.execute("INSERT INTO ai_scan_usage(user_id,day,count) VALUES(?,?,1) ON CONFLICT(user_id,day) DO UPDATE SET count=count+1",(user["id"],day))
        c.execute("INSERT INTO ai_scan_total(day,count) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET count=count+1",(day,))
    try:
        result=json_http(CF_WORKER_URL.rstrip("/")+"/scan",{"image":image,"group":group},
              {"Authorization":"Bearer "+CF_AI_SHARED_SECRET,
               "User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36"},timeout=40)
        if not result.get("ok") or not isinstance(result.get("suggestion"),dict):
            raise Error("تشخیص تصویر انجام نشد.",502)
        obj=result["suggestion"]
        categories=("top","bottom","dress","outer","shoes","bag","jewel","other") if group=="closet" else ("makeup","skincare","hair","fragrance","tools","other")
        valid_colors=("pink","white","black","cream","blue","green","red","brown","purple","other")
        return {"ok":True,"suggestion":{
            "name":str(obj.get("name") or "").strip()[:55],
            "category":obj.get("category") if obj.get("category") in categories else "other",
            "color":obj.get("color") if obj.get("color") in valid_colors else "other",
            "brand":str(obj.get("brand") or "").strip()[:55],
            "confidence":obj.get("confidence") if obj.get("confidence") in ("high","medium","low") else "low"
        }}
    except Exception:
        with LOCK,conn() as c:
            c.execute("BEGIN IMMEDIATE")
            c.execute("UPDATE ai_scan_usage SET count=max(0,count-1) WHERE user_id=? AND day=?",(user["id"],day))
            c.execute("UPDATE ai_scan_total SET count=max(0,count-1) WHERE day=?",(day,))
        raise

def valid_store(st):
    if st not in ("vesta","cutella"):raise Error("فروشگاه نامعتبر است.")
    return st

def clean_items(items):
    if not isinstance(items,list) or not (1<=len(items)<=24):raise Error("سبد خرید معتبر نیست.")
    out=[]
    for x in items:
        if not isinstance(x,dict):raise Error("محصول نامعتبر است.")
        try: pid=int(x.get("id"));qty=int(x.get("quantity") or 1)
        except:raise Error("محصول نامعتبر است.")
        if pid<=0 or not 1<=qty<=10:raise Error("تعداد محصول معتبر نیست.")
        if x.get("variation"):raise Error("برای انتخاب سایز یا تنوع محصول، صفحه محصول فروشگاه را باز کن.")
        out.append({"id":pid,"quantity":qty})
    return out

def market_api(kind,store,items,address=None):
    if os.getenv("APP_CHECKOUT_ENABLED","0")!="1":raise Error("خرید داخل اپ هنوز فعال نشده است.",503)
    payload={"store":valid_store(store),"items":clean_items(items)}
    # Always ask the authoritative Woo Store API about current stock and payment methods.
    quote=json_http(MARKET_URL+"/api/market/quote",payload,timeout=30)
    if not isinstance(quote,dict) or not quote.get("ok"):
        raise Error("استعلام فروشگاه معتبر نبود.",502)
    gateways=[str(x) for x in (quote.get("payment_methods") or [])]
    # Actual live cart capabilities verified 2026-10-12:
    # Vesta uses wc_zibal, Cutella uses WC_ZPal. Keep each merchant's own gateway.
    allowed_methods={"vesta":("wc_zibal",),"cutella":("wc_zibal","wc_zpal")}
    method=next((g for g in gateways if g.lower() in allowed_methods[store]),None)
    if not method:raise Error("درگاه پرداخت این فروشگاه در خرید درون اپ پشتیبانی نمی‌شود.",503)
    if kind=="quote":return quote
    if kind!="checkout":raise Error("عملیات نامعتبر است.",400)
    if not isinstance(address,dict):raise Error("آدرس معتبر نیست.")
    needed=("first_name","last_name","phone","city","state","address_1","postcode")
    a={k:str(address.get(k) or "").strip()[:160] for k in ("first_name","last_name","phone","city","state","address_1","address_2","postcode","email")}
    if any(not a[k] for k in needed):raise Error("اطلاعات آدرس رو کامل وارد کن.")
    a["country"]="IR"
    payload["billing_address"]=a;payload["shipping_address"]=a
    payload["payment_method"]=method
    # WooCommerce creates its own order, Zibal payment and on-site callbacks;
    # never copy products into another table as the source of truth.
    return json_http(MARKET_URL+"/api/market/checkout",payload,timeout=35)

def checkout(user,store,items,address,request_id):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{12,90}",str(request_id or "")):
        raise Error("شناسه سبد خرید معتبر نیست.")
    with LOCK:
        old=db_one("SELECT * FROM app_orders WHERE user_id=? AND request_id=?",(user["id"],request_id))
        if old:
            if old["store"]!=store:raise Error("سفارش قبلی به فروشگاه دیگری تعلق دارد.",409)
            return {"ok":True,"order_id":old["order_id"],"redirect_url":old["payment_url"],"status":old["payment_status"],"existing":True}
        response=market_api("checkout",store,items,address)
        oid=int(response.get("order_id") or 0)
        url=str(response.get("redirect_url") or "")
        if oid<=0 or not url.startswith("https://"):
            raise Error("ثبت سفارش در فروشگاه تأیید نشد؛ دوباره خرید نکن، وضعیت سفارش رو بررسی کن.",502)
        # Restrict redirect to the merchant or recognized Iranian payment gateway.
        host=urllib.parse.urlparse(url).hostname or ""
        allowed={"gateway.zibal.ir","vesta-cosmetics.ir","www.vesta-cosmetics.ir","cutellashop.ir","www.cutellashop.ir"}
        if store=="cutella":
            # WC_ZPal commonly returns direct ZarinPal pay URLs.
            allowed.update({"www.zarinpal.com","zarinpal.com","payment.zarinpal.com"})
        if host not in allowed:raise Error("لینک پرداخت فروشگاه معتبر نیست.",502)
        with conn() as c:c.execute("""INSERT INTO app_orders(user_id,request_id,store,order_id,order_key,payment_url,payment_status,created_at)
          VALUES(?,?,?,?,?,?,?,?)""",(user["id"],request_id,store,oid,str(response.get("order_key") or "")[:120],url,str(response.get("status") or "pending")[:32],now()))
    return {"ok":True,"order_id":oid,"redirect_url":url,"status":response.get("status") or "pending"}

def woo_order_status(store,order_id):
    base={"vesta":"https://vesta-cosmetics.ir","cutella":"https://cutellashop.ir"}[store]
    prefix="VESTA" if store=="vesta" else "CUTELLA"
    key=os.getenv(prefix+"_WC_CONSUMER_KEY","")
    secret=os.getenv(prefix+"_WC_CONSUMER_SECRET","")
    if not key or not secret:return None
    auth=base64.b64encode((key+":"+secret).encode()).decode()
    try:
        data=json_http(base+"/wp-json/wc/v3/orders/"+str(order_id),
          headers={"Authorization":"Basic "+auth},timeout=7)
    except Error:return None
    if not isinstance(data,dict) or int(data.get("id") or 0)!=int(order_id):return None
    return {"status":str(data.get("status") or "")[:35],"date_paid":bool(data.get("date_paid")),
            "total":str(data.get("total") or "")[:35]}

def orders(user):
    with conn() as c:
        rows=c.execute("SELECT id,store,order_id,payment_status,created_at FROM app_orders WHERE user_id=? ORDER BY id DESC LIMIT 30",(user["id"],)).fetchall()
    result=[]
    for i,row in enumerate(rows):
        out=dict(row)
        if i<8 and out.get("order_id"):
            fresh=woo_order_status(out["store"],out["order_id"])
            if fresh:
                out["payment_status"]=fresh["status"]
                out["date_paid"]=fresh["date_paid"]
                out["synced"]=True
                with conn() as c:
                    c.execute("UPDATE app_orders SET payment_status=? WHERE id=?",(fresh["status"],out["id"]))
            else:out["synced"]=False
        result.append(out)
    return {"ok":True,"orders":result,
            "note":"تغییر وضعیت پرداخت و ارسال از ووکامرس دریافت می‌شود اگر دسترسی خواندن فروشگاه فعال باشد."}

class API(BaseHTTPRequestHandler):
    server_version="VestalandAccount/1.0"
    def log_message(self,fmt,*args):pass # Never log OTP codes or bearer tokens.
    def json(self,status,obj):
        raw=json.dumps(obj,ensure_ascii=False,separators=(",",":")).encode()
        self.send_response(status)
        for k,v in (("Content-Type","application/json; charset=utf-8"),("Cache-Control","no-store"),
                    ("X-Content-Type-Options","nosniff"),("Content-Length",str(len(raw)))):
            self.send_header(k,v)
        self.end_headers();self.wfile.write(raw)
    def body(self):
        try:size=int(self.headers.get("Content-Length",0))
        except:size=0
        limit=195000 if urllib.parse.urlsplit(self.path).path.rstrip("/")=="/api/account/ai/scan" else MAX_BODY
        if size<=0 or size>limit:raise Error("درخواست نامعتبر است.")
        try:
            value=json.loads(self.rfile.read(size).decode())
            if not isinstance(value,dict):raise ValueError()
            return value
        except (UnicodeError,ValueError):raise Error("JSON معتبر نیست.")
    def ip(self):
        # Two known internal proxies: shared ingress then app nginx. The final
        # X-Forwarded-For hop is vc-nginx, the preceding hop is the real client,
        # regardless of untrusted values prepended by clients themselves.
        chain=[x.strip() for x in str(self.headers.get("X-Forwarded-For") or "").split(",") if x.strip()]
        return (chain[-2] if len(chain)>=2 else str(self.headers.get("X-Real-IP") or self.client_address[0]))[:70]
    def guard_origin(self):
        origin=self.headers.get("Origin","")
        if origin and origin!=PUBLIC_BASE:raise Error("مبدأ درخواست معتبر نیست.",403)
    def handle_error(self,fn):
        try:fn()
        except Error as e:self.json(e.status,{"ok":False,"error":str(e)})
        except Exception:
            LOG.exception("Account API failure")
            self.json(500,{"ok":False,"error":"خطای موقت سرور؛ دوباره تلاش کن."})
    def do_GET(self):self.handle_error(self.get)
    def do_POST(self):self.handle_error(self.post)
    def get(self):
        p=urllib.parse.urlsplit(self.path);path=p.path.rstrip("/")
        q=urllib.parse.parse_qs(p.query)
        if path=="/api/account/health":return self.json(200,{"ok":True,"service":"vestaland-account"})
        if path=="/api/account/config":return self.json(200,plans())
        if path=="/api/account/subscription/callback":
            subid=(q.get("payment") or [""])[0]
            track=(q.get("trackId") or [None])[0]
            try:paid=verify_subscription(subid,track)
            except Exception:
                LOG.warning("Subscription callback verification failed for %s",subid)
                paid=False
            self.send_response(302)
            self.send_header("Location",PUBLIC_BASE+"/?payment="+("success" if paid else "pending"))
            self.send_header("Cache-Control","no-store")
            self.end_headers();return
        if path=="/api/account/me":return self.json(200,{"ok":True,"user":public_user(authenticate(self.headers))})
        if path=="/api/account/orders":return self.json(200,orders(authenticate(self.headers,active=True)))
        if path=="/api/account/subscription/status":
            user=authenticate(self.headers)
            return self.json(200,subscription_status(user,(q.get("id") or [""])[0],
                refresh=(q.get("refresh") or ["0"])[0]=="1"))
        raise Error("مسیر پیدا نشد.",404)
    def post(self):
        self.guard_origin()
        path=urllib.parse.urlsplit(self.path).path.rstrip("/")
        data=self.body()
        if path=="/api/account/otp/request":
            return self.json(200,send_otp(normalize_phone(data.get("phone")),self.ip()))
        if path=="/api/account/otp/verify":
            return self.json(200,verify_otp(normalize_phone(data.get("phone")),str(data.get("code") or ""),self.ip()))
        if path=="/api/account/logout":return self.json(200,logout(self.headers))
        if path=="/api/account/bazaar/verify":
            user=authenticate(self.headers)
            return self.json(200,verify_bazaar_receipt(user,str(data.get("plan") or ""),str(data.get("purchase_token") or "")))
        if path=="/api/account/subscription/start":
            return self.json(200,subscribe(authenticate(self.headers),str(data.get("plan") or "")))
        if path=="/api/account/ai/scan":
            user=authenticate(self.headers,active=True)
            return self.json(200,vision_scan(user,data.get("group"),data.get("image")))
        if path=="/api/account/ai/recommend":
            return self.json(200,ai_recommend(authenticate(self.headers,active=True),data.get("items"),data.get("question")))
        if path=="/api/account/orders/quote":
            user=authenticate(self.headers,active=True)
            return self.json(200,market_api("quote",data.get("store"),data.get("items")))
        if path=="/api/account/orders/checkout":
            user=authenticate(self.headers,active=True)
            return self.json(200,checkout(user,data.get("store"),data.get("items"),data.get("billing_address"),data.get("request_id")))
        raise Error("مسیر پیدا نشد.",404)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--host",default="127.0.0.1")
    parser.add_argument("--port",type=int,default=8777)
    a=parser.parse_args()
    init_db()
    ThreadingHTTPServer((a.host,a.port),API).serve_forever()

if __name__=="__main__":main()
