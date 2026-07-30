package com.uswithlove.app;

import android.content.Context;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.IOException;

// Root cause this plugin fixes: AndroidManifest.xml has android:allowBackup
// ="true" with no exclusion rules, so Android's Auto Backup copies the
// WebView's local storage (which holds the app's 'uwl_v5' session data) to
// the signed-in Google account's Drive, and silently restores it the next
// time this app is installed on the device — even after a full uninstall.
// That makes a brand-new install look, to the web layer, exactly like
// reopening an app that was never closed, so the previous account's
// session comes back automatically.
//
// This plugin lets the web layer tell the two cases apart regardless of
// backup settings. getNoBackupFilesDir() is a directory the OS guarantees
// is NEVER included in Auto Backup (that is its entire purpose) — so a
// marker file placed there only exists once THIS specific install has
// already run at least once. If it's missing, this is a true fresh
// install (even though the backed-up localStorage came back with it),
// and the web layer should discard the restored session instead of
// trusting it.
@CapacitorPlugin(name = "InstallGuard")
public class InstallGuardPlugin extends Plugin {

  private static final String MARKER_FILENAME = "install_marker";

  @PluginMethod
  public void checkFreshInstall(PluginCall call) {
    Context context = getContext();
    File marker = new File(context.getNoBackupFilesDir(), MARKER_FILENAME);

    boolean freshInstall = !marker.exists();

    if (freshInstall) {
      try {
        File parent = marker.getParentFile();
        if (parent != null) parent.mkdirs();
        marker.createNewFile();
      } catch (IOException e) {
        // If we can't persist the marker for some reason, fail safe by
        // NOT reporting a fresh install — it's better to occasionally
        // miss a reinstall than to risk wiping a legitimate ongoing
        // session on every single launch because the marker keeps
        // failing to write.
        freshInstall = false;
      }
    }

    JSObject result = new JSObject();
    result.put("freshInstall", freshInstall);
    call.resolve(result);
  }
}
