"""Read-only CafeBazaar developer API subscription receipt validation."""
import json
import os
import re
import time
import urllib.parse
import urllib.request
import urllib.error

BASE="https://pardakht.cafebazaar.ir/devapi/v2"
PKG="ir.vestaland.app"
SKU={"monthly":"vestaland_sub_1m","quarterly":"vestaland_sub_3m"}

class BazaarError(Exception):pass

def ready():
    return all(os.environ.get(k) for k in ("BAZAAR_CLIENT_ID","BAZAAR_CLIENT_SECRET","BAZAAR_REFRESH_TOKEN"))

def get_access_token():
    if not ready():raise BazaarError("CafeBazaar verifier is not configured")
    body=urllib.parse.urlencode({"client_id":os.environ["BAZAAR_CLIENT_ID"],
         "client_secret":os.environ["BAZAAR_CLIENT_SECRET"],
         "refresh_token":os.environ["BAZAAR_REFRESH_TOKEN"],
         "grant_type":"refresh_token"}).encode()
    req=urllib.request.Request(BASE+"/auth/token/",data=body,headers={"Content-Type":"application/x-www-form-urlencoded","Accept":"application/json"})
    try:
        with urllib.request.urlopen(req,timeout=14) as r: data=json.loads(r.read(16000))
    except (urllib.error.URLError,ValueError) as e:raise BazaarError("CafeBazaar token refresh failed") from e
    token=data.get("access_token")
    if not token or not isinstance(token,str):raise BazaarError("No developer access token")
    return token

def validate(plan,purchase_token):
    if plan not in SKU:raise BazaarError("Invalid Bazaar plan")
    if not isinstance(purchase_token,str) or not re.fullmatch(r"[a-zA-Z0-9._~:-]{20,1024}",purchase_token):
        raise BazaarError("Invalid purchase token")
    access=get_access_token()
    path=("/api/applications/"+PKG+"/subscriptions/"+SKU[plan]+"/purchases/"+
          urllib.parse.quote(purchase_token,safe="")+"/")
    q=urllib.parse.urlencode({"access_token":access})
    req=urllib.request.Request(BASE+path+"?"+q,headers={"Accept":"application/json"})
    try:
        with urllib.request.urlopen(req,timeout=14) as r:data=json.loads(r.read(16000))
    except (urllib.error.URLError,ValueError) as e:raise BazaarError("Could not verify Bazaar subscription") from e
    if not isinstance(data,dict) or data.get("error") or data.get("error_description"):
        raise BazaarError("Invalid Bazaar receipt response")
    # Only server-verified, FUTURE-dated Bazaar expiry grants access.
    # Never accept a client-supplied expiration timestamp.
    expire=data.get("validUntilTimestampMsec",data.get("expiryTimeMillis"))
    if expire is None:raise BazaarError("Missing Bazaar subscription expiry")
    try:until=int(expire)//1000
    except (TypeError,ValueError):raise BazaarError("Malformed Bazaar expiry")
    if until<=int(time.time()) or until>int(time.time())+400*86400:
        raise BazaarError("Bazaar subscription is expired or exceeds expected duration")
    return {"expires_at":until,"auto_renewing":bool(data.get("autoRenewing")),"sku":SKU[plan]}
