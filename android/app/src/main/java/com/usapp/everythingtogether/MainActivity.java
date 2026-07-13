package com.usapp.everythingtogether;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // ── Runtime notification permission (Android 13 / API 33+) ─────
        // POST_NOTIFICATIONS became a runtime-requested permission starting
        // API 33; below that it's granted automatically at install time.
        // This is required for the app's existing web-push notifications
        // (see server.js/web-push) to actually be allowed to show on
        // Android 13+ — no Capacitor plugin covers this permission, so it
        // needs this small native request.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                    this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1001);
            }
        }

        // ── Edge-to-edge ────────────────────────────────────────────
        // Android 15 (API 35+) enforces edge-to-edge regardless of this call,
        // but setting it explicitly keeps behavior identical and correct on
        // every supported OS version down to minSdk 24, instead of only the
        // newest devices. The WebView is allowed to draw behind both the
        // status bar and the gesture/3-button navigation bar.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);

        // Dark background (#1a0010) behind both bars -> light/white system
        // bar icons, matching capacitor.config.json's StatusBar.style: DARK.
        WindowInsetsControllerCompat insetsController =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        insetsController.setAppearanceLightStatusBars(false);
        insetsController.setAppearanceLightNavigationBars(false);

        // ── Propagate real system-bar/keyboard insets into the WebView ──
        // Without this, edge-to-edge content would draw UNDER the status
        // bar / gesture nav bar with no way for the existing CSS to avoid
        // it. This pushes the actual inset sizes in as CSS custom
        // properties on <html>, so index.html's existing top bar / bottom
        // nav can pad themselves by these amounts (see the matching CSS
        // addition in public/index.html for this same task).
        ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (view, insets) -> {
            Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) {
                float density = getResources().getDisplayMetrics().density;
                String js = "document.documentElement.style.setProperty('--android-inset-top','"
                    + (bars.top / density) + "px');"
                    + "document.documentElement.style.setProperty('--android-inset-bottom','"
                    + (Math.max(bars.bottom, ime.bottom) / density) + "px');"
                    + "document.documentElement.style.setProperty('--android-inset-left','"
                    + (bars.left / density) + "px');"
                    + "document.documentElement.style.setProperty('--android-inset-right','"
                    + (bars.right / density) + "px');";
                webView.post(() -> webView.evaluateJavascript(js, null));
            }
            return insets;
        });
    }
}
