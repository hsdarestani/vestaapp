package ir.vestaland.app;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import org.json.JSONTokener;

import java.lang.reflect.Field;
import java.util.concurrent.TimeUnit;

public class MainActivityV2 extends MainActivity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 4201;
    private final Handler handler = new Handler(Looper.getMainLooper());

    private final Runnable sessionSync = new Runnable() {
        @Override
        public void run() {
            syncSessionToken();
            handler.postDelayed(this, 15000L);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestNotificationPermissionIfNeeded();
        scheduleBackgroundNotifications();
        handler.postDelayed(sessionSync, 1200L);
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                    this,
                    new String[]{Manifest.permission.POST_NOTIFICATIONS},
                    NOTIFICATION_PERMISSION_REQUEST
            );
        }
    }

    private void scheduleBackgroundNotifications() {
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                NotificationWorker.class,
                15,
                TimeUnit.MINUTES
        ).setConstraints(constraints).build();
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
                "vestaland-community-notifications",
                ExistingPeriodicWorkPolicy.UPDATE,
                request
        );
    }

    private WebView getVestalandWebView() {
        try {
            Field field = MainActivity.class.getDeclaredField("webView");
            field.setAccessible(true);
            Object value = field.get(this);
            return value instanceof WebView ? (WebView) value : null;
        } catch (Exception ignored) {
            return null;
        }
    }

    private void syncSessionToken() {
        WebView webView = getVestalandWebView();
        if (webView == null) return;
        webView.evaluateJavascript("localStorage.getItem('vestaland:token')||''", value -> {
            String token = "";
            try {
                Object parsed = new JSONTokener(value == null ? "\"\"" : value).nextValue();
                if (parsed != null) token = String.valueOf(parsed).trim();
            } catch (Exception ignored) {
                token = "";
            }
            getSharedPreferences(NotificationWorker.PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putString(NotificationWorker.TOKEN_KEY, token)
                    .apply();
        });
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(sessionSync);
        super.onDestroy();
    }
}
