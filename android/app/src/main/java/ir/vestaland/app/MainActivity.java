package ir.vestaland.app;

import android.app.Activity;
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

public class MainActivity extends Activity {
    private static final String APP_URL = "https://vestaland.smarbiz.sbs/";
    private WebView webView;
    private volatile boolean marketPaymentActive = false;

    private boolean isVestaland(String host) {
        return host.equals("vestaland.smarbiz.sbs") || host.endsWith(".vestaland.smarbiz.sbs");
    }

    private boolean isMarketStore(String host) {
        return host.equals("vesta-cosmetics.ir") || host.endsWith(".vesta-cosmetics.ir")
                || host.equals("cutellashop.ir") || host.endsWith(".cutellashop.ir");
    }

    private void enableMarketFlowFromVestaland() {
        Uri current = Uri.parse(webView.getUrl() == null ? "" : webView.getUrl());
        String host = current.getHost() == null ? "" : current.getHost();
        if (isVestaland(host)) marketPaymentActive = true;
    }

    private class MarketBridge {
        @JavascriptInterface
        public void beginPayment() {
            runOnUiThread(() -> enableMarketFlowFromVestaland());
        }

        @JavascriptInterface
        public void openStore() {
            // Variable products fall back to the real WooCommerce product page.
            // Mark the navigation as a market flow so its eventual banking gateway
            // remains inside this WebView instead of opening an external browser.
            runOnUiThread(() -> enableMarketFlowFromVestaland());
        }
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
        settings.setUserAgentString(settings.getUserAgentString() + " VestalandBazaar/1.2");

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.addJavascriptInterface(new MarketBridge(), "MarketBridge");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme();
                String host = uri.getHost() == null ? "" : uri.getHost();
                String path = uri.getPath() == null ? "" : uri.getPath();

                if (isVestaland(host)) return false;

                if (isMarketStore(host)) {
                    if (path.contains("order-received")) {
                        marketPaymentActive = false;
                        view.loadUrl(APP_URL + "?market_paid=1");
                        return true;
                    }
                    return false;
                }

                // Subscription payments are digital and remain disabled in the Bazaar build.
                // Physical Vesta/Cutella checkout can use its own HTTPS gateway in-app.
                if (host.equals("pay.hamooncloud.ir") && !marketPaymentActive) {
                    Toast.makeText(MainActivity.this,
                            "پرداخت اشتراک نسخه بازار از طریق پرداخت درون‌برنامه‌ای بازار فعال می‌شود.",
                            Toast.LENGTH_LONG).show();
                    return true;
                }

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
                    String js = "(() => {" +
                            "document.documentElement.classList.add('bazaar-app');" +
                            "document.querySelectorAll('[data-pay-plan]').forEach(b=>{b.disabled=true;b.style.opacity='.48';b.style.cursor='default';});" +
                            "const note=document.querySelector('.payment-note');" +
                            "if(note) note.textContent='اشتراک اپ از پرداخت درون‌برنامه‌ای بازار استفاده می‌کند؛ خرید محصولات وستا و کیوتلا با درگاه خود فروشگاه انجام می‌شود.';" +
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
        if (webView != null) { webView.stopLoading(); webView.destroy(); }
        super.onDestroy();
    }
}
