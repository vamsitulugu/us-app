package com.uswithlove.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

@CapacitorPlugin(name = "DeviceInfo")
public class DeviceInfoPlugin extends Plugin {

  @PluginMethod
  public void getInfo(PluginCall call) {
    Context context = getContext();
    PackageManager pm = context.getPackageManager();
    String packageName = context.getPackageName();

    JSObject result = new JSObject();
    result.put("platform", "android");
    result.put("appId", packageName);
    result.put("appName", context.getString(context.getApplicationInfo().labelRes));
    result.put("appVersion", getAppVersion(pm, packageName));
    result.put("appBuild", getAppBuild(pm, packageName));
    result.put("osVersion", android.os.Build.VERSION.RELEASE);
    result.put("osSdk", android.os.Build.VERSION.SDK_INT);
    result.put("deviceManufacturer", android.os.Build.MANUFACTURER);
    result.put("deviceModel", android.os.Build.MODEL);
    result.put("deviceBrand", android.os.Build.BRAND);
    result.put("deviceSerial", android.os.Build.SERIAL);
    result.put("isTablet", isTablet(context));
    call.resolve(result);
  }

  @PluginMethod
  public void isAppInstalled(PluginCall call) {
    String packageName = call.getString("packageName", "");
    if (packageName == null || packageName.isEmpty()) {
      call.reject("packageName is required");
      return;
    }
    PackageManager pm = getContext().getPackageManager();
    boolean installed = isPackageInstalled(pm, packageName);
    JSObject result = new JSObject();
    result.put("installed", installed);
    call.resolve(result);
  }

  @PluginMethod
  public void launchApp(PluginCall call) {
    String packageName = call.getString("packageName", "");
    if (packageName == null || packageName.isEmpty()) {
      call.reject("packageName is required");
      return;
    }
    PackageManager pm = getContext().getPackageManager();
    Intent intent = pm.getLaunchIntentForPackage(packageName);
    if (intent != null) {
      getActivity().startActivity(intent);
      call.resolve();
    } else {
      call.reject("App not installed: " + packageName);
    }
  }

  private boolean isPackageInstalled(PackageManager pm, String packageName) {
    try {
      pm.getPackageInfo(packageName, 0);
      return true;
    } catch (PackageManager.NameNotFoundException e) {
      return false;
    }
  }

  private String getAppVersion(PackageManager pm, String packageName) {
    try {
      return pm.getPackageInfo(packageName, 0).versionName;
    } catch (Exception e) {
      return "unknown";
    }
  }

  private String getAppBuild(PackageManager pm, String packageName) {
    try {
      return String.valueOf(pm.getPackageInfo(packageName, 0).versionCode);
    } catch (Exception e) {
      return "unknown";
    }
  }

  private boolean isTablet(Context context) {
    return (context.getResources().getConfiguration().screenLayout &
        android.content.res.Configuration.SCREENLAYOUT_SIZE_MASK) >=
        android.content.res.Configuration.SCREENLAYOUT_SIZE_LARGE;
  }
}
