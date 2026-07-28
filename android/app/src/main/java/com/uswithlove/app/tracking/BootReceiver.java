package com.uswithlove.app.tracking;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

/**
 * BootReceiver — item 1's "Resume automatically after device restart".
 * Android kills every running process (including foreground services)
 * on reboot; this listens for BOOT_COMPLETED and restarts the
 * tracking service using the identity it saved to SharedPreferences
 * the last time it was running, but ONLY if the person hadn't
 * explicitly turned tracking off before the restart.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;

        SharedPreferences prefs = context.getSharedPreferences("twinhearts_tracking_state", Context.MODE_PRIVATE);
        boolean wasEnabled = prefs.getBoolean("enabled", false);
        String coupleId = prefs.getString("coupleId", null);
        if (!wasEnabled || coupleId == null) return; // person had it off, or never logged in — don't start anything

        Intent serviceIntent = new Intent(context, LocationForegroundService.class);
        serviceIntent.setAction(LocationForegroundService.ACTION_START);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent);
        } else {
            context.startService(serviceIntent);
        }
    }
}
