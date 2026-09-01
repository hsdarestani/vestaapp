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

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private static final String APP_URL = "https://vestaland.smarbiz.sbs/";
    private WebView webView;
    private volatile boolean marketPaymentActive = false;
    private final List<String> marketCartQueue = new ArrayList<>();
    private int marketCartQueueIndex = 0;
    private String marketCartHost = "";
    private boolean marketCartBuilding = false;

    private boolean isVestaland(String host) {
        return host.equals("vestaland.smarbiz.sbs") || host.endsWith(".vestaland.smarbiz.sbs");
    }

    private boolean isMarketStore(String host) {
        return host.equals("vesta-cosmetics.ir") || host.endsWith(".vesta-cosmetics.ir")
                || host.equals("cutellashop.ir") || host.endsWith(".cutellashop.ir");
    }

    private String storeBase(String store) {
        if ("vesta".equals(store)) return "https://vesta-cosmetics.ir";
        if ("cutella".equals(store)) return "https://cutellashop.ir";
        return "";
    }

    private void enableMarketFlowFromVestaland() {
        Uri current = Uri.parse(webView.getUrl() == null ? "" : webView.getUrl());
        String host = current.getHost() == null ? "" : current.getHost();
        if (isVestaland(host)) marketPaymentActive = true;
    }

    private void expireStoreCookies(String base) {
        CookieManager cm = CookieManager.getInstance();
        String raw = cm.getCookie(base);
        if (raw == null || raw.trim().isEmpty()) return;
        String host = Uri.parse(base).getHost();
        if (host == null) return;
        for (String part : raw.split(";")) {
            String name = part.split("=", 2)[0].trim();
            if (name.isEmpty()) continue;
            cm.setCookie(base, name + "=; Max-Age=0; Path=/; SameSite=Lax");
            cm.setCookie("https://www." + host, name + "=; Max-Age=0; Path=/; SameSite=Lax");
        }
        cm.flush();
    }

    private void loadNextMarketCartStep() {
        if (!marketCartBuilding) return;
        if (marketCartQueueIndex >= marketCartQueue.size()) {
            marketCartBuilding = false;
            return;
        }
        String next = marketCartQueue.get(marketCartQueueIndex++);
        webView.loadUrl(next);
    }

    private class MarketBridge {
        @JavascriptInterface
        public void beginPayment() {
            runOnUiThread(() -> enableMarketFlowFromVestaland());
        }

        @JavascriptInterface
        public void openStore() {
            runOnUiThread(() -> enableMarketFlowFromVestaland());
        }

        @JavascriptInterface
        public void checkoutStore(String store, String itemsJson) {
            runOnUiThread(() -> {
                try {
                    String base = storeBase(store);
                    if (base.isEmpty()) throw new Exception("فروشگاه نامعتبر است");
                    JSONArray items = new JSONArray(itemsJson);
                    if (items.length() < 1 || items.length() > 50) throw new Exception("سبد خرید نامعتبر است");

                    enableMarketFlowFromVestaland();
                    expireStoreCookies(base);
                    marketCartQueue.clear();
                    marketCartQueueIndex = 0;
                    marketCartHost = Uri.parse(base).getHost();

                    for (int i = 0; i < items.length(); i++) {
                        JSONObject item = items.getJSONObject(i);
                        int id = item.optInt("id", 0);
                        int qty = Math.max(1, Math.min(20, item.optInt("quantity", 1)));
                        if (id <= 0) continue;
                        marketCartQueue.add(base + "/?add-to-cart=" + id + "&quantity=" + qty + "&vestaland_cart=1");
                    }
                    if (marketCartQueue.isEmpty()) throw new Exception("محصولی برای پرداخت نیست");
                    marketCartQueue.add(base + "/checkout/?vestaland=1");
                    marketCartBuilding = true;
                    Toast.makeText(MainActivity.this, "دارم سبد واقعی " + ("vesta".equals(store) ? "وستا" : "کیوتلا") + " رو آماده می‌کنم…", Toast.LENGTH_SHORT).show();
                    loadNextMarketCartStep();
                } catch (Exception e) {
                    marketCartBuilding = false;
                    Toast.makeText(MainActivity.this, "ساخت سبد فروشگاه انجام نشد.", Toast.LENGTH_LONG).show();
                }
            });
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
        settings.setUserAgentString(settings.getUserAgentString() + " VestalandBazaar/1.3");

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
                        marketCartBuilding = false;
                        marketCartQueue.clear();
                        view.loadUrl(APP_URL + "?market_paid=1");
                        return true;
                    }
                    return false;
                }

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
                String path = uri.getPath() == null ? "" : uri.getPath();

                if (marketCartBuilding && marketCartHost.equals(host)) {
                    // The last queued URL is the checkout page. Do not advance once it is visible.
                    if (!path.contains("checkout") || marketCartQueueIndex < marketCartQueue.size()) {
                        webView.postDelayed(() -> loadNextMarketCartStep(), 180);
                    } else {
                        marketCartBuilding = false;
                    }
                }

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
