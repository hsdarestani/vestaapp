import importlib.util
import os
import sys
sys.path.insert(0,os.path.abspath('backend'))
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("account_server", "backend/account_server.py")
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)

class VestalandAccountTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        api.DB_FILE=os.path.join(self.tmp.name,"users.sqlite3")
        api.init_db()
        api.SMS_KEY="fake-sms-key"
        api.SMS_TEMPLATE="1234"
        api.ZIBAL_MERCHANT="fake-merchant"
        api.CF_WORKER_URL="https://example.workers.dev"
        api.CF_AI_SHARED_SECRET="x"*40
        api.AI_GLOBAL_LIMIT=240
        api.AI_DAILY_PAID=2
        self.environment=patch.dict(os.environ,{"VESTALAND_OTP_PEPPER":"test-fake-pepper-longer-than-thirty-two-characters","OTP_ENABLED":"1","SUBSCRIPTIONS_ENABLED":"1","AI_ENABLED":"1","IMAGE_SCAN_ENABLED":"1","BAZAAR_ENABLED":"1"})
        self.environment.start()
    def tearDown(self):
        self.environment.stop();self.tmp.cleanup()
    def create_user(self,phone="09123456789"):
        with api.conn() as c:
            c.execute("INSERT INTO users(phone,created_at,trial_until) VALUES(?,?,?)",(phone,api.now(),api.now()+7*86400))
            return c.execute("SELECT * FROM users WHERE phone=?",(phone,)).fetchone()

    def test_sms_can_be_restricted_to_one_test_phone_before_lockdown(self):
        with patch.dict(os.environ,{"OTP_TEST_PHONE":"09123456789","LOGIN_GATE_ENABLED":"1"}):
            self.assertFalse(api.plans()["features"]["login_required"])
            with patch.object(api,"json_http") as provider:
                with self.assertRaises(api.Error) as err:
                    api.send_otp("09123456780","127.0.0.1")
                self.assertEqual(err.exception.status,403)
                provider.assert_not_called()
        with patch.dict(os.environ,{"OTP_TEST_PHONE":"","LOGIN_GATE_ENABLED":"1"}):
            self.assertTrue(api.plans()["features"]["login_required"])

    def test_normalize_iran_phone(self):
        for phone in ["09123456789","+989123456789","989123456789","00989123456789","۹۱۲۳۴۵۶۷۸۹"]:
            self.assertEqual(api.normalize_phone(phone),"09123456789")
        for phone in ["01123456789","091","987654321"]:
            with self.assertRaises(api.Error):api.normalize_phone(phone)

    def test_wrong_otp_attempts_are_persisted(self):
        def sms(url,body=None,headers=None,timeout=20):
            self.code=body["parameters"][0]["value"];return {"status":1}
        with patch.object(api,"json_http",side_effect=sms):
            api.send_otp("09123456789","127.0.0.1")
        for _ in range(5):
            with self.assertRaises(api.Error):api.verify_otp("09123456789","000000","127.0.0.1")
        row=api.db_one("SELECT tries FROM otp_codes WHERE phone=?",("09123456789",))
        self.assertEqual(row["tries"],5)
        with self.assertRaises(api.Error):
            api.verify_otp("09123456789",self.code,"127.0.0.1")

    def test_free_trial_is_once_per_phone(self):
        def sms(url,body=None,headers=None,timeout=20):
            self.code=body["parameters"][0]["value"];return {"status":1}
        real_now=api.now()
        with patch.object(api,"json_http",side_effect=sms),patch.object(api,"now",return_value=real_now):
            api.send_otp("09123456789","127.0.0.1")
            user=api.verify_otp("09123456789",self.code,"127.0.0.1")
        self.assertEqual(user["user"]["plan"],"trial")
        first_expiration=user["user"]["trial_until"]
        with patch.object(api,"json_http",side_effect=sms),patch.object(api,"now",return_value=real_now+9*86400):
            api.send_otp("09123456789","127.0.0.1")
            next_login=api.verify_otp("09123456789",self.code,"127.0.0.1")
        self.assertEqual(next_login["user"]["id"],user["user"]["id"])
        self.assertEqual(next_login["user"]["trial_until"],first_expiration)
        self.assertFalse(next_login["user"]["active"])

    def test_bazaar_receipt_must_be_verified_server_side(self):
        user=self.create_user()
        with patch.object(api.bazaar_verify,"ready",return_value=True),patch.object(api.bazaar_verify,"validate",return_value={
            "expires_at":api.now()+30*86400,"sku":"vestaland_sub_1m"}):
            result=api.verify_bazaar_receipt(user,"monthly","valid-token-unique-to-user")
            self.assertTrue(result["user"]["active"])
            other=self.create_user("09123456780")
            with self.assertRaises(api.Error) as exc:
                api.verify_bazaar_receipt(other,"monthly","valid-token-unique-to-user")
            self.assertEqual(exc.exception.status,409)
        with patch.object(api.bazaar_verify,"ready",return_value=True),patch.object(api.bazaar_verify,"validate",
             side_effect=api.bazaar_verify.BazaarError("unverified")):
            with self.assertRaises(api.Error) as exc:
                api.verify_bazaar_receipt(user,"monthly","different-receipt-not-verified")
            self.assertEqual(exc.exception.status,422)

    def test_zibal_amount_and_double_callback(self):
        user=self.create_user()
        calls=[]
        def zibal(url,body=None,headers=None,timeout=20):
            calls.append((url,body))
            if url.endswith("/request"):return {"result":100,"trackId":9182736}
            return {"result":100,"amount":1990000}
        with patch.object(api,"json_http",side_effect=zibal):
            resp=api.subscribe(user,"monthly")
            self.assertTrue(resp["payment_url"].endswith("/9182736"))
            self.assertTrue(api.verify_subscription(resp["payment_id"],"9182736"))
            paid=api.db_one("SELECT * FROM users WHERE id=?",(user["id"],))
            self.assertGreater(paid["paid_until"],user["trial_until"])
            self.assertTrue(api.verify_subscription(resp["payment_id"],"9182736"))
            again=api.db_one("SELECT * FROM users WHERE id=?",(user["id"],))
            self.assertEqual(again["paid_until"],paid["paid_until"])
        self.assertEqual(len([a for a in calls if a[0].endswith("/verify")]),1)
        self.assertEqual(calls[0][1]["amount"],1990000)

    def test_payment_amount_mismatch_never_grants_subscription(self):
        user=self.create_user()
        def zibal(url,body=None,headers=None,timeout=20):
            return {"result":100,"trackId":44} if url.endswith("/request") else {"result":100,"amount":10}
        with patch.object(api,"json_http",side_effect=zibal):
            pay=api.subscribe(user,"quarterly")
            self.assertFalse(api.verify_subscription(pay["payment_id"],"44"))
        current=api.db_one("SELECT * FROM users WHERE id=?",(user["id"],))
        self.assertEqual(current["paid_until"],0)

    def test_quotas_and_failed_ai_refund(self):
        user=self.create_user()
        with patch.object(api,"json_http",return_value={"ok":True,"suggestion":"این ست صورتی رو با کفش سفید بپوش."}):
            r=api.ai_recommend(user,[{"name":"شومیز صورتی","group":"closet","category":"top","color":"pink"}],"یه ست بگو")
            self.assertTrue(r["ok"])
            with self.assertRaises(api.Error) as err:api.ai_recommend(user,[],"more")
            self.assertEqual(err.exception.status,429)
        second=self.create_user("09123456780")
        with patch.object(api,"json_http",side_effect=api.Error("CF unavailable",502)):
            with self.assertRaises(api.Error):api.ai_recommend(second,[],"help")
        with patch.object(api,"json_http",return_value={"ok":True,"suggestion":"کفش سفید."}):
            self.assertTrue(api.ai_recommend(second,[],"help")["ok"])
    def test_vision_scan_requires_real_user_and_obeys_daily_free_cap(self):
        user=self.create_user()
        mock_image="a"*120
        with patch.object(api,"json_http",return_value={
            "ok":True,"suggestion":{"name":"شومیز صورتی","category":"top","color":"pink","brand":"","confidence":"high"}}):
            result=api.vision_scan(user,"closet",mock_image)
            self.assertEqual(result["suggestion"]["category"],"top")
            with self.assertRaises(api.Error) as e:
                api.vision_scan(user,"closet",mock_image)
            self.assertEqual(e.exception.status,429)
        with self.assertRaises(api.Error):
            api.vision_scan(user,"beauty","invalid<>")

    def test_vision_quota_refunded_when_external_worker_fails(self):
        user=self.create_user()
        with patch.object(api,"json_http",side_effect=api.Error("temporary",502)):
            with self.assertRaises(api.Error):
                api.vision_scan(user,"closet","a"*120)
        with patch.object(api,"json_http",return_value={"ok":True,"suggestion":{"name":"کیف","category":"bag","color":"brown","brand":""}}):
            self.assertTrue(api.vision_scan(user,"closet","a"*120)["ok"])

    def test_image_and_sms_are_disabled_by_default_without_raising_trial(self):
        user=self.create_user()
        with patch.dict(os.environ,{"IMAGE_SCAN_ENABLED":"0","OTP_ENABLED":"0","AI_ENABLED":"0"}):
            self.assertFalse(api.plans()["features"]["otp_enabled"])
            self.assertFalse(api.plans()["features"]["image_scan_enabled"])
            with self.assertRaises(api.Error):
                api.vision_scan(user,"closet","a"*120)

    def test_live_payment_gateways_are_store_specific(self):
        old=os.environ.get("APP_CHECKOUT_ENABLED")
        os.environ["APP_CHECKOUT_ENABLED"]="1"
        calls=[]
        def internal(url,body=None,headers=None,timeout=20):
            calls.append((url,body))
            if url.endswith("/quote"):
                return {"ok":True,"payment_methods":["wc_zibal"] if body["store"]=="vesta" else ["WC_ZPal"],"totals":{"total":199000}}
            return {"ok":True,"order_id":9,"redirect_url":"https://cutellashop.ir/checkout/order-pay/9","status":"pending"}
        try:
            with patch.object(api,"json_http",side_effect=internal):
                for store,expected in (("vesta","wc_zibal"),("cutella","WC_ZPal")):
                    api.market_api("checkout",store,[{"id":12,"quantity":1}],{
                      "first_name":"Sara","last_name":"Test","phone":"09123456789","city":"Tehran",
                      "state":"THR","address_1":"Test address","postcode":"1234567890"})
                    self.assertEqual(calls[-1][1]["payment_method"],expected)
        finally:
            if old is None:os.environ.pop("APP_CHECKOUT_ENABLED",None)
            else:os.environ["APP_CHECKOUT_ENABLED"]=old

    def test_checkout_uses_own_wc_order_and_idempotency(self):
        user=self.create_user()
        call_count=0
        def shop(kind,store,items,address):
            nonlocal call_count
            call_count+=1
            return {"order_id":357,"redirect_url":"https://gateway.zibal.ir/start/1122","status":"pending"}
        with patch.object(api,"market_api",side_effect=shop):
            r=api.checkout(user,"vesta",[{"id":37,"quantity":1}],{"first_name":"سارا"},"client-unique-id-2026")
            self.assertEqual(r["order_id"],357)
            other=api.checkout(user,"vesta",[{"id":37,"quantity":1}],{"first_name":"سارا"},"client-unique-id-2026")
            self.assertTrue(other["existing"])
        self.assertEqual(call_count,1)

if __name__=="__main__":unittest.main()
