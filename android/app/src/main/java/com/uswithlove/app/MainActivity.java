package com.uswithlove.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.uswithlove.app.tracking.BackgroundLocationPlugin;

public class MainActivity extends BridgeActivity {
  // Must match the channel id the backend sets on Touch push messages
  // (routes/auth.js -> sendFCMToPartner). Android locks a channel's
  // vibration pattern the first time it's created, so this uses a
  // fresh id rather than reusing whatever channel FCM's default
  // "Miscellaneous" bucket may already have created on existing
  // installs with its own (short/no) vibration settings.
  public static final String TOUCH_CHANNEL_ID = "touch_channel_v1";

  // Must match routes/auth.js's CALLS_CHANNEL_ID. Android also locks a
  // channel's sound the first time it's created, so an incoming call push
  // that reuses the default channel would only ever play the short default
  // "ding" — this dedicated channel carries the device's actual ringtone
  // with high importance so it rings the same way a real phone call does.
  public static final String CALLS_CHANNEL_ID = "calls_channel_v1";

  // ── Additional per-category channels (must match CHANNEL_MAP in
  // routes/auth.js). Before this, every notification that wasn't a Touch
  // or a Call fell into FCM's auto-created "Miscellaneous" bucket — one
  // shared importance level, one shared (default) sound, no per-category
  // mute control in Android's app notification settings. Splitting these
  // out is what lets someone mute Games but keep Messages, exactly like
  // WhatsApp's Settings > Notifications does per category. ──
  public static final String MESSAGES_CHANNEL_ID = "messages_channel_v1";
  public static final String PARTNER_CHANNEL_ID = "partner_requests_channel_v1";
  public static final String MEMORIES_CHANNEL_ID = "memories_channel_v1";
  public static final String GAMES_CHANNEL_ID = "games_channel_v1";
  public static final String REMINDERS_CHANNEL_ID = "reminders_channel_v1";
  public static final String SAFETY_CHANNEL_ID = "safety_channel_v1";
  public static final String GENERAL_CHANNEL_ID = "general_channel_v1";

  // App theme's dark background (matches public/index.html body
  // background #0B0B0B). Used so the status/nav bars read as part of
  // the app instead of showing the OS's default gray scrim.
  private static final int SYSTEM_BAR_COLOR = Color.parseColor("#0B0B0B");

  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(CallAudioPlugin.class);
    registerPlugin(BackgroundLocationPlugin.class);
    registerPlugin(InstallGuardPlugin.class);
    super.onCreate(savedInstanceState);
    setupSystemBars();
    createTouchNotificationChannel();
    createCallsNotificationChannel();
    createSimpleChannel(MESSAGES_CHANNEL_ID, "Messages", "New chat messages from your partner",
        NotificationManager.IMPORTANCE_HIGH, new long[]{0, 250, 150, 250});
    createSimpleChannel(PARTNER_CHANNEL_ID, "Partner Requests", "Pairing and connection requests",
        NotificationManager.IMPORTANCE_HIGH, new long[]{0, 300, 200, 300, 200, 300});
    createSimpleChannel(MEMORIES_CHANNEL_ID, "Memories", "Photos, journal entries, and shared memories",
        NotificationManager.IMPORTANCE_DEFAULT, new long[]{0, 200});
    createSimpleChannel(GAMES_CHANNEL_ID, "Games", "Game invitations from your partner",
        NotificationManager.IMPORTANCE_DEFAULT, new long[]{0, 150, 100, 150, 100, 150});
    createSimpleChannel(REMINDERS_CHANNEL_ID, "Reminders", "Calendar, anniversary, and birthday reminders",
        NotificationManager.IMPORTANCE_DEFAULT, new long[]{0, 200, 200, 200});
    createSimpleChannel(SAFETY_CHANNEL_ID, "Location & Safety", "Location check and mock-GPS alerts",
        NotificationManager.IMPORTANCE_HIGH, new long[]{0, 400, 200, 400});
    createSimpleChannel(GENERAL_CHANNEL_ID, "General", "Everything else Twin Hearts lets you know about",
        NotificationManager.IMPORTANCE_DEFAULT, new long[]{0, 150});
    handleDeepLink(getIntent());
  }

  @Override
  public void onNewIntent(android.content.Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    handleDeepLink(intent);
  }

  private static final String APP_ORIGIN = "https://twinhearts.vercel.app";
  private final android.os.Handler pendingLinkHandler = new android.os.Handler(android.os.Looper.getMainLooper());
  private String pendingDeepLinkTarget = null;

  // Notifications built in TwinHeartsMessagingService attach the target
  // in-app path (e.g. "/?page=chat") as a "deepLinkUrl" extra on both the
  // tap-to-open PendingIntent and the Answer-call / quick-action intents.
  // This turns that into an actual in-app navigation instead of just
  // opening to whatever page the WebView happened to be on.
  //
  // ROOT CAUSE FIX (see investigation notes):
  // 1) This used to silently drop the deep link if getBridge().getWebView()
  //    was still null (cold start, bridge not fully attached yet) — the
  //    Answer notification action would vanish with no retry, which is why
  //    tapping Answer while the app was fully closed did nothing until you
  //    reopened it manually. Now we retry until the WebView exists instead
  //    of giving up.
  // 2) This used to call webView.loadUrl() unconditionally, even when the
  //    WebView was already showing the live app (app open/backgrounded) —
  //    a full page reload that re-ran the entire skeleton/init sequence
  //    just to deliver a notification tap. Now, if the WebView is already
  //    on our origin, we hand the action straight to the running JS via
  //    evaluateJavascript instead of reloading anything.
  private void handleDeepLink(android.content.Intent intent) {
    if (intent == null) return;
    String path = intent.getStringExtra("deepLinkUrl");
    if (path == null || path.isEmpty()) return;
    String target = path.startsWith("http") ? path : APP_ORIGIN + path;
    boolean isCallAnswer = path.contains("pendingAction=answer");

    android.webkit.WebView webView = getBridge() != null ? getBridge().getWebView() : null;

    if (webView != null && webView.getUrl() != null && webView.getUrl().startsWith(APP_ORIGIN)) {
      // App runtime is already warm — never reload it. That reload is what
      // caused the skeleton flash on Answer taps while the app was already
      // open or backgrounded.
      if (isCallAnswer) {
        webView.post(() -> webView.evaluateJavascript(
            "window.Call && window.Call.consumeNativeAnswer && window.Call.consumeNativeAnswer();", null));
      } else {
        webView.post(() -> webView.loadUrl(target));
      }
      return;
    }

    // WebView not attached yet (cold/sleeping app). Don't drop the action —
    // keep the target and retry shortly until the bridge is ready, then
    // deliver it as a normal navigation (call.js's consumePendingCallAction()
    // picks up ?pendingAction=answer on load, same as before).
    pendingDeepLinkTarget = target;
    retryPendingDeepLink();
  }

  private void retryPendingDeepLink() {
    if (pendingDeepLinkTarget == null) return;
    android.webkit.WebView webView = getBridge() != null ? getBridge().getWebView() : null;
    if (webView != null) {
      String target = pendingDeepLinkTarget;
      pendingDeepLinkTarget = null;
      webView.post(() -> webView.loadUrl(target));
      return;
    }
    // Bridge/WebView still not ready — try again shortly. Bounded implicitly
    // by well under the 30s ring timeout in call.js so a genuinely broken
    // bridge doesn't retry forever in practice.
    pendingLinkHandler.postDelayed(this::retryPendingDeepLink, 150);
  }

  @Override
public void onDestroy() {
  pendingLinkHandler.removeCallbacksAndMessages(null);
  super.onDestroy();
}

  // Shared creator for every channel that doesn't need a custom sound
  // (Touch and Calls keep their own dedicated methods above since they
  // attach a ringtone/locked vibration). Idempotent — Android already
  // no-ops createNotificationChannel() for an existing id, and the
  // explicit getNotificationChannel() check avoids the lookup entirely
  // on the common (already-created) path.
  private void createSimpleChannel(String id, String name, String description,
                                    int importance, long[] vibrationPattern) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager manager = getSystemService(NotificationManager.class);
    if (manager == null || manager.getNotificationChannel(id) != null) return;

    NotificationChannel channel = new NotificationChannel(id, name, importance);
    channel.setDescription(description);
    channel.enableVibration(true);
    channel.setVibrationPattern(vibrationPattern);
    channel.enableLights(true);
    channel.setLightColor(Color.parseColor("#B30000")); // deep red brand accent
    manager.createNotificationChannel(channel);
  }

  // Root cause this addresses: targetSdk 36 (Android 15+) makes
  // edge-to-edge mandatory for every app — the OS ignores
  // android:statusBarColor/navigationBarColor and colorPrimaryDark
  // entirely on those versions, regardless of what styles.xml says.
  // Without this, the WebView content stops short of the system bar
  // areas and the OS paints its own default gray there. Making the
  // bars transparent (edge-to-edge) lets the app's own dark
  // background (and the CSS env(safe-area-inset-*) padding already
  // used in index.html/app-polish.css) show through and handle
  // spacing itself, so it blends seamlessly on every Android version
  // from minSdk 24 up. styles.xml's legacy color attributes remain in
  // place as the fallback for API < 35 devices where the OS still
  // honors them.
  private void setupSystemBars() {
    Window window = getWindow();
    WindowCompat.setDecorFitsSystemWindows(window, false);

    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
      // API < 35: edge-to-edge isn't forced, so explicitly transparent
      // bars here too keeps behavior identical instead of relying only
      // on the (already-correct) styles.xml colors — avoids any flash
      // of a different color between splash and first frame.
      window.setStatusBarColor(SYSTEM_BAR_COLOR);
      window.setNavigationBarColor(SYSTEM_BAR_COLOR);
    }

    WindowInsetsControllerCompat controller =
        WindowCompat.getInsetsController(window, window.getDecorView());
    if (controller != null) {
      // Dark background -> light (white) icons, matching the rest of
      // the app's theme and keeping icons visible.
      controller.setAppearanceLightStatusBars(false);
      controller.setAppearanceLightNavigationBars(false);
    }
  }

  private void createTouchNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return; // channels only exist on API 26+

    NotificationManager manager = getSystemService(NotificationManager.class);
    if (manager == null) return;

    NotificationChannel existing = manager.getNotificationChannel(TOUCH_CHANNEL_ID);
    if (existing != null) return; // already created on a previous launch — leave it as-is

    NotificationChannel channel = new NotificationChannel(
        TOUCH_CHANNEL_ID,
        "Touch",
        NotificationManager.IMPORTANCE_HIGH
    );
    channel.setDescription("Vibration alert when your partner sends you a Touch");
    channel.enableVibration(true);
    // A single sustained 10-second buzz: [delay, vibrate].
    channel.setVibrationPattern(new long[]{0, 10000});
    manager.createNotificationChannel(channel);
  }

  private void createCallsNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return; // channels only exist on API 26+

    NotificationManager manager = getSystemService(NotificationManager.class);
    if (manager == null) return;

    NotificationChannel existing = manager.getNotificationChannel(CALLS_CHANNEL_ID);
    if (existing != null) return; // already created on a previous launch — leave it as-is

    NotificationChannel channel = new NotificationChannel(
        CALLS_CHANNEL_ID,
        "Calls",
        NotificationManager.IMPORTANCE_HIGH
    );
    channel.setDescription("Incoming voice and video calls");
    channel.enableVibration(true);
    channel.setVibrationPattern(new long[]{0, 500, 500, 500, 500, 500});

    Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
    AudioAttributes attrs = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build();
    channel.setSound(ringtoneUri, attrs);

    manager.createNotificationChannel(channel);
  }
}