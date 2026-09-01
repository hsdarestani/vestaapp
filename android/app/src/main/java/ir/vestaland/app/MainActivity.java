package ir.vestaland.app;

import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.ComponentActivity;

import org.json.JSONObject;

import ir.cafebazaar.poolakey.Connection;
import ir.cafebazaar.poolakey.ConnectionState;
import ir.cafebazaar.poolakey.Payment;
import ir.cafebazaar.poolakey.config.PaymentConfiguration;
import ir.cafebazaar.poolakey.config.SecurityCheck;
import ir.cafebazaar.poolakey.request.PurchaseRequest;
import kotlin.Unit;

public class MainActivity extends ComponentActivity {
    private static final String APP_URL = "https://vestaland.smarbiz.sbs/";
    private static final String SKU_1M = "vestaland_sub_1m";
    private static final String SKU_3M = "vestaland_sub_3m";
    private static final String SKU_6M = "vestaland_sub_6m";

    private WebView webView;
    private volatile boolean marketPaymentActive = false;
    private Payment bazaarPayment;
    private Connection bazaarConnection;

    private boolean isVestaland(String host) {
        return host.equals("vestaland.smarbiz.sbs") || host.endsWith(".vestaland.smarbiz.sbs");
    }

    private boolean isMarketStore(String host) {
        return host.equals("vesta-cosmetics.ir") || host.endsWith(".vesta-cosmetics.ir")
                || host.equals("cutellashop.ir") || host.endsWith(".cutellashop.ir");
    }

    private String skuForPlan(String plan) {
        if ("1m".equals(plan)) return SKU_1M;
        if ("3m".equals(plan)) return SKU_3M;
        if ("6m".equals(plan)) return SKU_6M;
        return null;
    }

    private class MarketBridge {
        @JavascriptInterface
        public void beginPayment() {
            runOnUiThread(() -> marketPaymentActive = true);
        }

        @JavascriptInterface
        public void openStore() {
            // Kept for compatibility with older web assets.
        }
    }

    private class BazaarBridge {
        @JavascriptInterface
        public void subscribe(String plan) {
            runOnUiThread(() -> startBazaarSubscription(plan));
        }
    }

    private void initBazaarBilling() {
        SecurityCheck securityCheck = SecurityCheck.Disable.INSTANCE;
        PaymentConfiguration paymentConfig = new PaymentConfiguration(securityCheck);
        bazaarPayment = new Payment(this, paymentConfig);
        bazaarConnection = bazaarPayment.connect(connectionCallback -> {
            connectionCallback.connectionSucceed(() -> Unit.INSTANCE);
            connectionCallback.connectionFailed(throwable -> {
                runOnUiThread(() -> Toast.makeText(
                        MainActivity.this,
                        "اتصال به پرداخت کافه‌بازار برقرار نشد.",
                        Toast.LENGTH_SHORT
                ).show());
                return Unit.INSTANCE;
            });
            connectionCallback.disconnected(() -> Unit.INSTANCE);
            return Unit.INSTANCE;
        });
    }

    private void startBazaarSubscription(String plan) {
        String sku = skuForPlan(plan);
        if (sku == null) {
            Toast.makeText(this, "پلن انتخاب‌شده معتبر نیست.", Toast.LENGTH_SHORT).show();
            return;
        }
        if (bazaarPayment == null || bazaarConnection == null
                || bazaarConnection.getState() != ConnectionState.Connected.INSTANCE) {
            Toast.makeText(this, "کافه‌بازار در دسترس نیست. دوباره امتحان کن.", Toast.LENGTH_SHORT).show();
            return;
        }

        PurchaseRequest request = new PurchaseRequest(sku, "vestaland:" + plan, null);
        bazaarPayment.subscribeProduct(getActivityResultRegistry(), request, purchaseCallback -> {
            purchaseCallback.purchaseFlowBegan(() -> Unit.INSTANCE);
            purchaseCallback.failedToBeginFlow(throwable -> {
                runOnUiThread(() -> Toast.makeText(
                        MainActivity.this,
                        "شروع خرید انجام نشد: " + throwable.getMessage(),
                        Toast.LENGTH_LONG
                ).show());
                return Unit.INSTANCE;
            });
            purchaseCallback.purchaseSucceed(purchase -> {
                runOnUiThread(() -> {
                    String js = "(() => {" +
                            "localStorage.setItem('vestaland:plan'," + JSONObject.quote(plan) + ");" +
                            "localStorage.setItem('vestaland:bazaar:last-order'," + JSONObject.quote(purchase.getOrderId()) + ");" +
                            "localStorage.setItem('vestaland:bazaar:last-token'," + JSONObject.quote(purchase.getPurchaseToken()) + ");" +
                            "const s=document.getElementById('subscriptionStatus');" +
                            "if(s)s.textContent='اشتراک فعال';" +
                            "window.toast&&window.toast('خرید اشتراک با موفقیت ثبت شد ✓');" +
                            "})();";
                    webView.evaluateJavascript(js, null);
                });
                return Unit.INSTANCE;
            });
            purchaseCallback.purchaseCanceled(() -> {
                runOnUiThread(() -> Toast.makeText(
                        MainActivity.this,
                        "خرید لغو شد.",
                        Toast.LENGTH_SHORT
                ).show());
                return Unit.INSTANCE;
            });
            purchaseCallback.purchaseFailed(throwable -> {
                runOnUiThread(() -> Toast.makeText(
                        MainActivity.this,
                        "خرید انجام نشد: " + throwable.getMessage(),
                        Toast.LENGTH_LONG
                ).show());
                return Unit.INSTANCE;
            });
            return Unit.INSTANCE;
        });
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(247, 247, 248));
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadsImagesAutomatically(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " VestalandBazaar/1.5");

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.addJavascriptInterface(new MarketBridge(), "MarketBridge");
        webView.addJavascriptInterface(new BazaarBridge(), "BazaarBridge");
        initBazaarBilling();

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme();
                String host = uri.getHost() == null ? "" : uri.getHost();

                if (isVestaland(host)) {
                    if (uri.getQueryParameter("market_payment") != null) marketPaymentActive = false;
                    return false;
                }

                if (isMarketStore(host)) return false;

                // Old web assets may still attempt the web subscription route. The Bazaar build
                // always handles subscriptions natively instead.
                if (host.equals("pay.hamooncloud.ir") && !marketPaymentActive) {
                    Toast.makeText(MainActivity.this,
                            "برای خرید اشتراک یکی از پلن‌ها را داخل اپ انتخاب کن.",
                            Toast.LENGTH_LONG).show();
                    return true;
                }

                // Physical-product checkout stays inside this WebView while active.
                if (marketPaymentActive && scheme.equals("https")) return false;

                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    Toast.makeText(MainActivity.this, "امکان باز کردن این لینک نیست.", Toast.LENGTH_SHORT).show();
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                Uri uri = Uri.parse(url == null ? "" : url);
                String host = uri.getHost() == null ? "" : uri.getHost();
                if (isVestaland(host)) {
                    if (uri.getQueryParameter("market_payment") != null) marketPaymentActive = false;
                    String js = "(() => {" +
                            "document.documentElement.classList.add('bazaar-app');" +
                            "document.querySelectorAll('[data-pay-plan]').forEach(b=>{b.disabled=false;b.style.opacity='1';b.style.cursor='pointer';});" +
                            "const note=document.querySelector('.payment-note');" +
                            "if(note) note.textContent='پرداخت اشتراک از طریق کافه‌بازار انجام می‌شود.';" +
                            "if(!window.__vestalandBazaarPlansBound){" +
                              "window.__vestalandBazaarPlansBound=true;" +
                              "document.addEventListener('click',function(e){" +
                                "const b=e.target.closest&&e.target.closest('[data-pay-plan]');" +
                                "if(!b)return;" +
                                "e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();" +
                                "document.querySelectorAll('[data-pay-plan]').forEach(x=>{x.classList.remove('selected');x.style.outline='';});" +
                                "b.classList.add('selected');b.style.outline='2px solid #222';b.style.outlineOffset='-2px';" +
                                "if(window.BazaarBridge)window.BazaarBridge.subscribe(b.dataset.payPlan);" +
                              "},true);" +
                            "}" +
                            "})();";
                    view.evaluateJavascript(js, null);
                }
            }
        });

        webView.setOnLongClickListener(v -> true);
        webView.setLongClickable(false);
        webView.setLayerType(android.view.View.LAYER_TYPE_HARDWARE, null);
        webView.loadUrl(APP_URL);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (bazaarConnection != null) bazaarConnection.disconnect();
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}
