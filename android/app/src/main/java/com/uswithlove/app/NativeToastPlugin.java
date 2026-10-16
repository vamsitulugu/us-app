package com.uswithlove.app;

import android.content.Context;
import android.widget.Toast;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeToast")
public class NativeToastPlugin extends Plugin {

  @PluginMethod
  public void show(PluginCall call) {
    String text = call.getString("text", "Twin Hearts");
    int duration = call.getInt("duration", 2000);
    final boolean longDuration = duration > 2000;

    if (getActivity() == null) {
      call.reject("No activity available");
      return;
    }

    getActivity().runOnUiThread(() -> {
      Toast toast = Toast.makeText(
          getContext(), text, longDuration ? Toast.LENGTH_LONG : Toast.LENGTH_SHORT);
      toast.show();
      JSObject result = new JSObject();
      result.put("shown", true);
      call.resolve(result);
    });
  }
}
