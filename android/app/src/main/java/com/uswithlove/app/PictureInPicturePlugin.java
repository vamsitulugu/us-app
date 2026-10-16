package com.uswithlove.app;

import android.app.PictureInPictureParams;
import android.content.Intent;
import android.os.Build;
import android.util.Rational;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PictureInPicture")
public class PictureInPicturePlugin extends Plugin {

  @PluginMethod
  public void enter(PluginCall call) {
    if (getActivity() == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      call.reject("Picture-in-Picture not available");
      return;
    }
    final PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder();
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      builder.setAspectRatio(new Rational(16, 9));
    }
    getActivity().runOnUiThread(() -> {
      try {
        // Activity#enterPictureInPictureMode(PictureInPictureParams) — API 26+ (guarded above).
        getActivity().enterPictureInPictureMode(builder.build());
        call.resolve();
      } catch (Exception e) {
        call.reject("Could not enter Picture-in-Picture: " + e.getMessage());
      }
    });
  }

  @PluginMethod
  public void isAvailable(PluginCall call) {
    JSObject result = new JSObject();
    result.put("available", Build.VERSION.SDK_INT >= Build.VERSION_CODES.O);
    call.resolve(result);
  }
}
