package com.usapp.everythingtogether;

import android.view.WindowManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Wake-lock, scoped deliberately narrow: the app never keeps the screen on
 * globally (that would just drain battery for no reason on every page).
 * capacitor-bridge.js only calls enable() while an active voice/video call
 * is open (#callOverlay.open) and disable() the instant it closes — see
 * wireWakeLock() there. Uses the plain Android window flag rather than a
 * PARTIAL_WAKE_LOCK, so it only keeps the SCREEN on while the call is in
 * the foreground; it releases itself automatically if the app is
 * backgrounded, which is the correct behavior (no CPU wake-lock needed,
 * no extra WAKE_LOCK permission required).
 */
@CapacitorPlugin(name = "KeepAwake")
public class KeepAwakePlugin extends Plugin {

    @PluginMethod
    public void enable(PluginCall call) {
        getActivity().runOnUiThread(() ->
            getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        );
        call.resolve();
    }

    @PluginMethod
    public void disable(PluginCall call) {
        getActivity().runOnUiThread(() ->
            getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        );
        call.resolve();
    }
}
