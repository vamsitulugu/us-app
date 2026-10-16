package com.uswithlove.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NetworkInfo")
public class NetworkInfoPlugin extends Plugin {

  @PluginMethod
  public void getStatus(PluginCall call) {
    ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
    JSObject result = new JSObject();
    if (cm != null) {
      NetworkInfo activeNetwork = cm.getActiveNetworkInfo();
      boolean connected = activeNetwork != null && activeNetwork.isConnectedOrConnecting();
      result.put("connected", connected);
      result.put("connectionType", activeNetwork != null ? getConnectionTypeName(activeNetwork.getType()) : "none");
      result.put("isWiFi", activeNetwork != null && activeNetwork.getType() == ConnectivityManager.TYPE_WIFI);
      result.put("isMobile", activeNetwork != null && activeNetwork.getType() == ConnectivityManager.TYPE_MOBILE);
    } else {
      result.put("connected", false);
      result.put("connectionType", "none");
      result.put("isWiFi", false);
      result.put("isMobile", false);
    }
    call.resolve(result);
  }

  private String getConnectionTypeName(int type) {
    switch (type) {
      case ConnectivityManager.TYPE_WIFI: return "wifi";
      case ConnectivityManager.TYPE_MOBILE: return "cellular";
      case ConnectivityManager.TYPE_ETHERNET: return "ethernet";
      case ConnectivityManager.TYPE_BLUETOOTH: return "bluetooth";
      case ConnectivityManager.TYPE_VPN: return "vpn";
      default: return "unknown";
    }
  }
}
