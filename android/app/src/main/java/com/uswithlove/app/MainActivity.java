package com.uswithlove.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  // Must match the channel id the backend sets on Touch push messages
  // (routes/auth.js -> sendFCMToPartner). Android locks a channel's
  // vibration pattern the first time it's created, so this uses a
  // fresh id rather than reusing whatever channel FCM's default
  // "Miscellaneous" bucket may already have created on existing
  // installs with its own (short/no) vibration settings.
  public static final String TOUCH_CHANNEL_ID = "touch_channel_v1";

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    createTouchNotificationChannel();
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
