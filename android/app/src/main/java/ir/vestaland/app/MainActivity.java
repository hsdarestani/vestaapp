package ir.vestaland.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

public class MainActivity extends Activity {
    private static final String APP_URL = "https://vestaland.smarbiz.sbs/";
    private WebView webView;

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
        settings.setUserAgentString(settings.getUserAgentString() + " VestalandBazaar/1.0");

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost() == null ? "" : uri.getHost();

                if (host.equals("pay.hamooncloud.ir")) {
                    Toast.makeText(MainActivity.this,
                            "پرداخت نسخه بازار بعد از فعال‌سازی پرداخت درون‌برنامه‌ای بازار در دسترس می‌شود.",
                            Toast.LENGTH_LONG).show();
                    return true;
                }

                if (host.equals("vestaland.smarbiz.sbs") || host.endsWith(".vestaland.smarbiz.sbs")) {
                    return false;
                }

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
                String js = "(() => {" +
                        "document.documentElement.classList.add('bazaar-app');" +
                        "document.querySelectorAll('[data-pay-plan]').forEach(b=>{b.disabled=true;b.style.opacity='.48';b.style.cursor='default';});" +
                        "const note=document.querySelector('.payment-note');" +
                        "if(note) note.textContent='پرداخت اشتراک نسخه بازار از طریق پرداخت درون‌برنامه‌ای بازار فعال می‌شود.';" +
                        "})();";
                view.evaluateJavascript(js, null);
            }
        });

        webView.setOnLongClickListener(v -> true);
        webView.setLongClickable(false);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        webView.loadUrl(APP_URL);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}
