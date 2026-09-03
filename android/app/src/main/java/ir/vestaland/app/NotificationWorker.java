package ir.vestaland.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class NotificationWorker extends Worker {
    static final String PREFS = "vestaland_native";
    static final String TOKEN_KEY = "session_token";
    private static final String LAST_ID_KEY = "last_notification_id";
    private static final String CHANNEL_ID = "vestaland_community";
    private static final String API_URL = "https://vestaland.smarbiz.sbs/api/notifications";

    public NotificationWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        SharedPreferences prefs = getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String token = prefs.getString(TOKEN_KEY, "");
        if (token == null || token.trim().isEmpty()) return Result.success();

        HttpURLConnection connection = null;
        try {
            URL url = new URL(API_URL);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(12000);
            connection.setReadTimeout(12000);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Authorization", "Bearer " + token.trim());

            int status = connection.getResponseCode();
            if (status == 401) {
                prefs.edit().remove(TOKEN_KEY).apply();
                return Result.success();
            }
            if (status < 200 || status >= 300) return Result.retry();

            BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8));
            StringBuilder raw = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) raw.append(line);
            reader.close();

            JSONObject response = new JSONObject(raw.toString());
            JSONArray notifications = response.optJSONArray("notifications");
            if (notifications == null || notifications.length() == 0) return Result.success();

            long lastSeen = prefs.getLong(LAST_ID_KEY, 0L);
            long newest = lastSeen;
            ensureChannel();

            // API is newest-first. Show old-to-new so the latest notification is visible last.
            for (int i = notifications.length() - 1; i >= 0; i--) {
                JSONObject item = notifications.optJSONObject(i);
                if (item == null) continue;
                long id = item.optLong("id", 0L);
                if (id <= lastSeen) continue;
                newest = Math.max(newest, id);
                if (!item.optBoolean("is_read", false)) {
                    showNotification(id, item.optString("title", "اعلان جدید"), item.optString("body", "یه خبر تازه توی وستالند داری."));
                }
            }

            if (newest > lastSeen) prefs.edit().putLong(LAST_ID_KEY, newest).apply();
            return Result.success();
        } catch (Exception ignored) {
            return Result.retry();
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getApplicationContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "اعلان‌های وستالند", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("واکنش‌ها، نظرها و اتفاق‌های دورهمی");
        manager.createNotificationChannel(channel);
    }

    private void showNotification(long id, String title, String body) {
        Context context = getApplicationContext();
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                (int) (id % Integer.MAX_VALUE),
                open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent);

        NotificationManagerCompat.from(context).notify((int) (id % Integer.MAX_VALUE), builder.build());
    }
}
