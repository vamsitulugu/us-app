package com.uswithlove.app;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Clipboard")
public class ClipboardPlugin extends Plugin {

  @PluginMethod
  public void write(PluginCall call) {
    String text = call.getString("text", "");
    ClipboardManager clipboard = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
    if (clipboard != null) {
      ClipData clip = ClipData.newPlainText("Twin Hearts", text);
      clipboard.setPrimaryClip(clip);
      JSObject result = new JSObject();
      result.put("success", true);
      call.resolve(result);
    } else {
      call.reject("Clipboard service not available");
    }
  }

  @PluginMethod
  public void read(PluginCall call) {
    ClipboardManager clipboard = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
    JSObject result = new JSObject();
    if (clipboard != null && clipboard.hasPrimaryClip()) {
      ClipData clip = clipboard.getPrimaryClip();
      if (clip != null && clip.getItemCount() > 0) {
        CharSequence text = clip.getItemAt(0).getText();
        result.put("text", text != null ? text.toString() : "");
        result.put("hasText", true);
      } else {
        result.put("text", "");
        result.put("hasText", false);
      }
    } else {
      result.put("text", "");
      result.put("hasText", false);
    }
    call.resolve(result);
  }
}
