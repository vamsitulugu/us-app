package com.uswithlove.app;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "LocalNotifications")
public class LocalNotificationsPlugin extends Plugin {

  private static final String CHANNEL_ID = "twin_hearts_local";
  private static final int NOTIFICATION_ID_BASE = 10000;

  @PluginMethod
  public void schedule(PluginCall call) {
    String title = call.getString("title", "Twin Hearts");
    String body = call.getString("body", "");
    int id = call.getInt("id", NOTIFICATION_ID_BASE);
    long scheduleAt = call.getLong("scheduleAt", System.currentTimeMillis());
    String channelId = call.getString("channelId", CHANNEL_ID);

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      android.app.NotificationChannel channel = new android.app.NotificationChannel(
          channelId, "Local Notifications",
          android.app.NotificationManager.IMPORTANCE_DEFAULT
      );
      android.app.NotificationManager manager = getContext().getSystemService(android.app.NotificationManager.class);
      if (manager != null) {
        manager.createNotificationChannel(channel);
      }
    }

    Intent intent = new Intent(getContext(), getActivity().getClass());
    intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
    PendingIntent pendingIntent = PendingIntent.getActivity(
        getContext(), id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
    );

    NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), channelId)
        .setSmallIcon(getContext().getApplicationInfo().icon)
        .setContentTitle(title)
        .setContentText(body)
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .setAutoCancel(true)
        .setContentIntent(pendingIntent);

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      builder.setColor(getContext().getResources().getColor(
          getContext().getResources().getIdentifier("notification_icon_color", "color", getContext().getPackageName()),
          getContext().getTheme()));
    }

    NotificationManagerCompat.from(getContext()).notify(id, builder.build());

    JSObject result = new JSObject();
    result.put("id", id);
    result.put("scheduled", true);
    call.resolve(result);
  }

  @PluginMethod
  public void cancel(PluginCall call) {
    int id = call.getInt("id", -1);
    NotificationManagerCompat.from(getContext()).cancel(id);
    call.resolve();
  }

  @PluginMethod
  public void cancelAll(PluginCall call) {
    NotificationManagerCompat.from(getContext()).cancelAll();
    call.resolve();
  }

  @PluginMethod
  public void getPending(PluginCall call) {
    JSObject result = new JSObject();
    result.put("notifications", new JSObject[] {});
    call.resolve(result);
  }
}
