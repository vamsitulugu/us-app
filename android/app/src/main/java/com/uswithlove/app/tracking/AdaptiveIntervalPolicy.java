package com.uswithlove.app.tracking;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;

/**
 * AdaptiveIntervalPolicy — decides how often to request a GPS fix
 * based on current motion speed and battery/charging state (item 8:
 * "Smart Battery Optimization"). Pure logic, no Android location APIs
 * here, so it's trivially unit-testable.
 *
 * Rules (fastest-wins — if charging AND driving, use the driving
 * interval since responsiveness matters more than the marginal
 * battery cost while plugged in):
 *   - stationary (< 0.3 m/s ~ 1 km/h)      -> 5 minutes
 *   - walking    (0.3 - 2.5 m/s)           -> 20 seconds
 *   - driving    (> 2.5 m/s, ~9 km/h+)     -> 5 seconds
 *   - charging                              -> force "high accuracy" (5s) regardless of motion
 *   - battery <= 15% and NOT charging       -> force battery-saver floor (min 60s) regardless of motion
 */
public class AdaptiveIntervalPolicy {

    public static final long STATIONARY_MS = 5 * 60 * 1000L;
    public static final long WALKING_MS    = 20 * 1000L;
    public static final long DRIVING_MS    = 5 * 1000L;
    public static final long BATTERY_SAVER_FLOOR_MS = 60 * 1000L;

    private static final float WALK_SPEED_MS = 0.3f;   // m/s
    private static final float DRIVE_SPEED_MS = 2.5f;  // m/s

    public static class Decision {
        public final long intervalMs;
        public final String mode; // "stationary" | "walking" | "driving" | "battery_saver" | "high_accuracy"
        public Decision(long intervalMs, String mode) { this.intervalMs = intervalMs; this.mode = mode; }
    }

    public static Decision decide(Context ctx, float lastSpeedMs) {
        BatteryState battery = readBattery(ctx);

        long base;
        String mode;
        if (lastSpeedMs > DRIVE_SPEED_MS) { base = DRIVING_MS; mode = "driving"; }
        else if (lastSpeedMs > WALK_SPEED_MS) { base = WALKING_MS; mode = "walking"; }
        else { base = STATIONARY_MS; mode = "stationary"; }

        if (battery.charging) {
            // Plugged in — battery cost is irrelevant, favor responsiveness.
            return new Decision(Math.min(base, DRIVING_MS), "high_accuracy");
        }
        if (!battery.charging && battery.pct <= 15) {
            // Low battery and unplugged — never go faster than the floor,
            // even if the person is driving, to protect the last of the charge.
            return new Decision(Math.max(base, BATTERY_SAVER_FLOOR_MS), "battery_saver");
        }
        return new Decision(base, mode);
    }

    public static class BatteryState {
        public final int pct;
        public final boolean charging;
        BatteryState(int pct, boolean charging) { this.pct = pct; this.charging = charging; }
    }

    public static BatteryState readBattery(Context ctx) {
        IntentFilter filter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
        Intent batteryStatus = ctx.registerReceiver(null, filter);
        if (batteryStatus == null) return new BatteryState(100, false);
        int level = batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
        int pct = (level >= 0 && scale > 0) ? Math.round(level * 100f / scale) : 100;
        int status = batteryStatus.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
        boolean charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL;
        return new BatteryState(pct, charging);
    }
}
