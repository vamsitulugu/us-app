package com.uswithlove.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.view.WindowManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Keyboard")
public class KeyboardPlugin extends Plugin {

  @PluginMethod
  public void setResizeMode(PluginCall call) {
    String mode = call.getString("mode", "resize");
    if (getActivity() != null) {
      getActivity().runOnUiThread(() -> {
        try {
          android.view.Window window = getActivity().getWindow();
          if ("resize".equals(mode)) {
            window.setSoftInputMode(
                WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE |
                WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN
            );
          } else if ("pan".equals(mode)) {
            window.setSoftInputMode(
                WindowManager.LayoutParams.SOFT_INPUT_ADJUST_PAN |
                WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN
            );
          } else if ("nothing".equals(mode)) {
            window.setSoftInputMode(
                WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING |
                WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN
            );
          }
        } catch (Exception e) {
          call.reject("Failed to set keyboard mode: " + e.getMessage());
          return;
        }
        call.resolve();
      });
    } else {
      call.reject("No activity available");
    }
  }

  @PluginMethod
  public void hide(PluginCall call) {
    if (getActivity() != null) {
      getActivity().runOnUiThread(() -> {
        android.view.inputmethod.InputMethodManager imm =
            (android.view.inputmethod.InputMethodManager) getContext().getSystemService(
                android.content.Context.INPUT_METHOD_SERVICE);
        if (imm != null && getActivity().getCurrentFocus() != null) {
          imm.hideSoftInputFromWindow(getActivity().getCurrentFocus().getWindowToken(), 0);
        }
        call.resolve();
      });
    } else {
      call.reject("No activity available");
    }
  }

  @PluginMethod
  public void show(PluginCall call) {
    if (getActivity() != null) {
      getActivity().runOnUiThread(() -> {
        android.view.inputmethod.InputMethodManager imm =
            (android.view.inputmethod.InputMethodManager) getContext().getSystemService(
                android.content.Context.INPUT_METHOD_SERVICE);
        if (imm != null && getActivity().getCurrentFocus() != null) {
          imm.showSoftInput(getActivity().getCurrentFocus(), 0);
        }
        call.resolve();
      });
    } else {
      call.reject("No activity available");
    }
  }

  @PluginMethod
  public void isVisible(PluginCall call) {
    boolean visible = false;
    if (getActivity() != null) {
      android.view.inputmethod.InputMethodManager imm =
          (android.view.inputmethod.InputMethodManager) getContext().getSystemService(
              android.content.Context.INPUT_METHOD_SERVICE);
      if (imm != null) {
        visible = imm.isAcceptingText();
      }
    }
    JSObject result = new JSObject();
    result.put("visible", visible);
    call.resolve(result);
  }
}
