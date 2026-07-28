package com.uswithlove.app.tracking;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;

/**
 * BackgroundLocationPlugin — the JS-facing bridge. From the WebView:
 *
 *   const { BackgroundLocation } = window.Capacitor.Plugins;
 *   await BackgroundLocation.start({ coupleId, role, apiBase });
 *   await BackgroundLocation.stop();
 *   const { enabled } = await BackgroundLocation.status();
 *
 * Handles the runtime permission dance Android 10+ requires for
 * background location: foreground location must be granted FIRST,
 * then background location is requested as a separate follow-up
 * permission (the OS refuses to show both in one dialog from
 * API 30+, and even earlier versions handle it more reliably this way).
 */
@CapacitorPlugin(
    name = "BackgroundLocation",
    permissions = {
        @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, alias = "location"),
        @Permission(strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }, alias = "backgroundLocation")
    }
)
public class BackgroundLocationPlugin extends Plugin {

    private String pendingCoupleId, pendingRole, pendingApiBase;

    @PluginMethod
    public void start(PluginCall call) {
        String coupleId = call.getString("coupleId");
        String role = call.getString("role");
        String apiBase = call.getString("apiBase");
        if (coupleId == null || role == null || apiBase == null) {
            call.reject("coupleId, role and apiBase are required");
            return;
        }
        pendingCoupleId = coupleId; pendingRole = role; pendingApiBase = apiBase;

        if (getPermissionState("location") != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "foregroundLocationCallback");
            return;
        }
        proceedToBackgroundPermission(call);
    }

    @PermissionCallback
    private void foregroundLocationCallback(PluginCall call) {
        if (getPermissionState("location") != com.getcapacitor.PermissionState.GRANTED) {
            call.reject("Location permission is required for live location sharing");
            return;
        }
        proceedToBackgroundPermission(call);
    }

    private void proceedToBackgroundPermission(PluginCall call) {
        // Background location permission only exists / is required as a
        // separate grant on API 29+ (Android 10+). Below that, foreground
        // location is sufficient for a foreground service to keep reading
        // location while backgrounded.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || getPermissionState("backgroundLocation") == com.getcapacitor.PermissionState.GRANTED) {
            startServiceNow(call);
            return;
        }
        requestPermissionForAlias("backgroundLocation", call, "backgroundLocationCallback");
    }

    @PermissionCallback
    private void backgroundLocationCallback(PluginCall call) {
        // Not fatal if denied — foreground tracking (app open/minimized but
        // not killed) still works; only true "app fully closed" tracking
        // needs this grant. Start the service either way and let the
        // Foreground Service + FusedLocationProvider combo do what it can.
        startServiceNow(call);
    }

    private void startServiceNow(PluginCall call) {
        Intent intent = new Intent(getContext(), LocationForegroundService.class);
        intent.setAction(LocationForegroundService.ACTION_START);
        intent.putExtra(LocationForegroundService.EXTRA_COUPLE_ID, pendingCoupleId);
        intent.putExtra(LocationForegroundService.EXTRA_ROLE, pendingRole);
        intent.putExtra(LocationForegroundService.EXTRA_API_BASE, pendingApiBase);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
        JSObject ret = new JSObject();
        ret.put("started", true);
        ret.put("backgroundGranted", getPermissionState("backgroundLocation") == com.getcapacitor.PermissionState.GRANTED);
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), LocationForegroundService.class);
        intent.setAction(LocationForegroundService.ACTION_STOP);
        getContext().startService(intent);
        JSObject ret = new JSObject();
        ret.put("stopped", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void status(PluginCall call) {
        android.content.SharedPreferences prefs = getContext().getSharedPreferences("twinhearts_tracking_state", android.content.Context.MODE_PRIVATE);
        JSObject ret = new JSObject();
        ret.put("enabled", prefs.getBoolean("enabled", false));
        ret.put("coupleId", prefs.getString("coupleId", null));
        ret.put("backgroundGranted", getPermissionState("backgroundLocation") == com.getcapacitor.PermissionState.GRANTED);
        call.resolve(ret);
    }
}
