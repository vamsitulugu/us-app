package com.uswithlove.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  // Must match the channel id the backend sets on Touch push messages
  // (routes/auth.js -> sendFCMToPartner). Android locks a channel's
  // vibration pattern the first time it's created, so this uses a
  // fresh id rather than reusing whatever channel FCM's default
  // "Miscellaneous" bucket may already have created on existing
  // installs with its own (short/no) vibration settings.
  public static final String TOUCH_CHANNEL_ID = "touch_channel_v1";

  // App theme's dark background (matches public/index.html body
  // background #0B0B0B). Used so the status/nav bars read as part of
  // the app instead of showing the OS's default gray scrim.
  private static final int SYSTEM_BAR_COLOR = Color.parseColor("#0B0B0B");

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setupSystemBars();
    createTouchNotificationChannel();
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
}
