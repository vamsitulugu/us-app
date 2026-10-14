package com.uswithlove.app;

import android.graphics.Color;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Lets the web layer colour the area behind the Android status bar (top) and
// navigation bar (bottom). @capacitor/status-bar's setBackgroundColor is a
// no-op on Android 15+/targetSdk 36 (edge-to-edge), so the colour is painted
// natively instead (see MainActivity.BarsBackground).
@CapacitorPlugin(name = "BarColors")
public class BarColorsPlugin extends Plugin {
  // Called by the web layer once the loading spinner has painted.
  @PluginMethod
  public void splashDone(PluginCall call) {
    if (getActivity() instanceof MainActivity) ((MainActivity) getActivity()).releaseSplash();
    call.resolve();
  }

  @PluginMethod
  public void set(PluginCall call) {
    final String top = call.getString("top");
    final String bottom = call.getString("bottom");
    final int t, b;
    try {
      t = top != null ? Color.parseColor(top) : 0;
      b = bottom != null ? Color.parseColor(bottom) : 0;
    } catch (IllegalArgumentException e) {
      call.reject("Invalid colour");
      return;
    }
    if (getActivity() instanceof MainActivity) {
      getActivity().runOnUiThread(() ->
          ((MainActivity) getActivity()).setBarColors(top != null, t, bottom != null, b));
    }
    call.resolve();
  }
}
