package com.uswithlove.app.tracking;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * LocationForegroundService — TRUE background location tracking
 * (item 1). Runs as an Android Foreground Service with an ongoing
 * notification (required by the OS since Android 8+ to avoid being
 * killed within seconds of backgrounding), so it keeps running:
 *   - when the app is minimized
 *   - when the app is fully closed (service persists independently
 *     of any Activity/WebView)
 *   - when the phone is locked / screen is off
 *
 * It does NOT keep running forever unconditionally — Android can
 * still kill any process under extreme memory pressure — but
 * START_STICKY plus BootReceiver plus a periodic WorkManager
 * heartbeat (see BackgroundLocationPlugin) together give it the same
 * resilience model apps like Life360 rely on.
 *
 * Data flow: FusedLocationProviderClient callback -> build a point ->
 * try to POST it to /api/location/ping immediately (same endpoint the
 * foreground JS already uses, so both paths write to the exact same
 * live_locations/route_points tables) -> on any failure, persist it
 * into OfflineQueue instead of losing it -> a periodic flush attempt
 * drains the queue via /api/tracking/batch once connectivity returns.
 */
public class LocationForegroundService extends Service {

    public static final String ACTION_START = "com.uswithlove.app.tracking.START";
    public static final String ACTION_STOP  = "com.uswithlove.app.tracking.STOP";
    public static final String EXTRA_COUPLE_ID = "coupleId";
    public static final String EXTRA_ROLE = "role";
    public static final String EXTRA_API_BASE = "apiBase";

    private static final String CHANNEL_ID = "location_tracking_v1";
    private static final int NOTIFICATION_ID = 9911;

    private FusedLocationProviderClient fusedClient;
    private LocationCallback locationCallback;
    private OfflineQueue offlineQueue;
    private ExecutorService networkExecutor;
    private Handler mainHandler;

    private String coupleId, role, apiBase;
    private float lastSpeedMs = 0f;
    private long currentIntervalMs = AdaptiveIntervalPolicy.STATIONARY_MS;
    private Runnable flushRunnable;
    private static final long FLUSH_PERIOD_MS = 45 * 1000L;

    @Override
    public void onCreate() {
        super.onCreate();
        fusedClient = LocationServices.getFusedLocationProviderClient(this);
        offlineQueue = new OfflineQueue(this);
        networkExecutor = Executors.newSingleThreadExecutor();
        mainHandler = new Handler(Looper.getMainLooper());
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopTracking();
            return START_NOT_STICKY;
        }

        if (intent != null) {
            coupleId = intent.getStringExtra(EXTRA_COUPLE_ID);
            role = intent.getStringExtra(EXTRA_ROLE);
            apiBase = intent.getStringExtra(EXTRA_API_BASE);
        }
        // Persist so BootReceiver / a killed-and-restarted service can
        // resume with the same identity without the Activity's help.
        SharedPreferences prefs = getSharedPreferences("twinhearts_tracking_state", MODE_PRIVATE);
        if (coupleId != null) {
            prefs.edit().putString("coupleId", coupleId).putString("role", role).putString("apiBase", apiBase).putBoolean("enabled", true).apply();
        } else {
            coupleId = prefs.getString("coupleId", null);
            role = prefs.getString("role", null);
            apiBase = prefs.getString("apiBase", null);
        }

        if (coupleId == null || role == null || apiBase == null) {
            // Nothing to track yet (e.g. boot-triggered restart before first
            // login) — stop cleanly rather than run a useless foreground service.
            stopSelf();
            return START_NOT_STICKY;
        }

        startForeground(NOTIFICATION_ID, buildNotification("Tracking your location"));
        startLocationUpdates();
        scheduleFlush();
        // START_STICKY: if the OS kills this process under memory pressure,
        // it recreates the service (with a null intent) as soon as
        // resources allow — onStartCommand above falls back to the saved
        // SharedPreferences identity in that case.
        return START_STICKY;
    }

    private void startLocationUpdates() {
        if (locationCallback != null) fusedClient.removeLocationUpdates(locationCallback);

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                Location loc = result.getLastLocation();
                if (loc == null) return;
                handleNewLocation(loc);
            }
        };
        requestAtInterval(currentIntervalMs);
    }

    private void requestAtInterval(long intervalMs) {
        LocationRequest request = new LocationRequest.Builder(intervalMs)
            .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
            .setMinUpdateIntervalMillis(Math.max(2000L, intervalMs / 2))
            .build();
        try {
            fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper());
        } catch (SecurityException e) {
            // Permission was revoked mid-session (user pulled it from Settings) —
            // stop cleanly instead of crashing the service.
            stopSelf();
        }
    }

    private void handleNewLocation(Location loc) {
        lastSpeedMs = loc.hasSpeed() ? loc.getSpeed() : 0f;

        JSONObject point = new JSONObject();
        try {
            point.put("lat", loc.getLatitude());
            point.put("lng", loc.getLongitude());
            point.put("accuracy", loc.hasAccuracy() ? loc.getAccuracy() : JSONObject.NULL);
            point.put("heading", loc.hasBearing() ? loc.getBearing() : JSONObject.NULL);
            point.put("speed", lastSpeedMs);
            point.put("moving", lastSpeedMs > 0.3f);
            point.put("batteryLevel", AdaptiveIntervalPolicy.readBattery(this).pct);
            point.put("activityType", classifyActivity(lastSpeedMs));
            point.put("localDate", java.text.SimpleDateFormat.getDateInstance().format(new java.util.Date())); // overridden server-side format below
            point.put("localDate", new java.text.SimpleDateFormat("yyyy-MM-dd").format(new java.util.Date()));
            point.put("ts", System.currentTimeMillis());
        } catch (JSONException e) { return; }

        sendPingOrQueue(point);
        updateNotification(loc);
        maybeAdjustInterval();
    }

    private String classifyActivity(float speedMs) {
        if (speedMs < 0.3f) return "still";
        if (speedMs < 1.8f) return "walking";
        if (speedMs < 4.0f) return "running";
        if (speedMs < 9.0f) return "cycling";
        return "driving";
    }

    private void maybeAdjustInterval() {
        AdaptiveIntervalPolicy.Decision d = AdaptiveIntervalPolicy.decide(this, lastSpeedMs);
        if (d.intervalMs != currentIntervalMs) {
            currentIntervalMs = d.intervalMs;
            requestAtInterval(currentIntervalMs);
        }
    }

    // ── Networking (deliberately dependency-free HttpURLConnection —
    //    this is one small JSON POST per interval, not worth adding
    //    OkHttp/Retrofit as a Gradle dependency for) ──────────────────
    private void sendPingOrQueue(JSONObject point) {
        networkExecutor.execute(() -> {
            boolean ok = postJson(apiBase + "/api/location/ping", buildPingBody(point));
            if (!ok) offlineQueue.enqueue(point);
        });
    }

    private JSONObject buildPingBody(JSONObject point) {
        JSONObject body = new JSONObject();
        try {
            body.put("coupleId", coupleId);
            body.put("role", role);
            body.put("lat", point.get("lat"));
            body.put("lng", point.get("lng"));
            body.put("accuracy", point.opt("accuracy"));
            body.put("heading", point.opt("heading"));
            body.put("speed", point.opt("speed"));
            body.put("moving", point.opt("moving"));
            body.put("localDate", point.opt("localDate"));
        } catch (JSONException ignored) {}
        return body;
    }

    private boolean postJson(String urlStr, JSONObject body) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.toString().getBytes("UTF-8"));
            }
            int code = conn.getResponseCode();
            return code >= 200 && code < 300;
        } catch (Exception e) {
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    // ── Periodic offline-queue flush (item 17) ───────────────────────
    private void scheduleFlush() {
        if (flushRunnable != null) mainHandler.removeCallbacks(flushRunnable);
        flushRunnable = () -> {
            networkExecutor.execute(this::flushQueue);
            mainHandler.postDelayed(flushRunnable, FLUSH_PERIOD_MS);
        };
        mainHandler.postDelayed(flushRunnable, FLUSH_PERIOD_MS);
    }

    private void flushQueue() {
        int size = offlineQueue.size();
        if (size == 0) return;
        List<JSONObject> batch = offlineQueue.peek(500);
        if (batch.isEmpty()) return;

        org.json.JSONArray pointsArr = new org.json.JSONArray();
        for (JSONObject p : batch) pointsArr.put(p);
        JSONObject body = new JSONObject();
        try {
            body.put("coupleId", coupleId);
            body.put("role", role);
            body.put("points", pointsArr);
        } catch (JSONException e) { return; }

        boolean ok = postJson(apiBase + "/api/tracking/batch", body);
        if (ok) offlineQueue.removeFirst(batch.size());
        // on failure, leave the queue intact — will retry next cycle
    }

    // ── Notification (mandatory for a foreground service; kept
    //    minimal/neutral so it doesn't read as alarming, matching the
    //    existing app's calm tone) ─────────────────────────────────
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Location Sharing", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Keeps sharing your live location with your partner");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification(String text) {
        Intent stopIntent = new Intent(this, LocationForegroundService.class).setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(this, 0, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Twin Hearts")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .addAction(0, "Stop sharing", stopPending)
            .build();
    }

    private void updateNotification(Location loc) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        String text = String.format("Last update: %s · %s",
            new java.text.SimpleDateFormat("h:mm a").format(new java.util.Date()),
            classifyActivity(lastSpeedMs));
        manager.notify(NOTIFICATION_ID, buildNotification(text));
    }

    private void stopTracking() {
        SharedPreferences prefs = getSharedPreferences("twinhearts_tracking_state", MODE_PRIVATE);
        prefs.edit().putBoolean("enabled", false).apply();
        if (locationCallback != null) fusedClient.removeLocationUpdates(locationCallback);
        if (flushRunnable != null) mainHandler.removeCallbacks(flushRunnable);
        // One last flush attempt so we don't strand queued points.
        networkExecutor.execute(this::flushQueue);
        stopForeground(true);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (locationCallback != null) fusedClient.removeLocationUpdates(locationCallback);
        if (flushRunnable != null) mainHandler.removeCallbacks(flushRunnable);
        networkExecutor.shutdown();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) { return null; } // not a bound service — start/stop only
}
