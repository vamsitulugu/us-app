package com.uswithlove.app;

import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.BridgeActivity;

// BridgeActivity already gives us, for free, everything the brief asks for:
//   - back button behavior (WebView history back, then app exit)
//   - standard Android app lifecycle (onPause/onResume/onDestroy)
//   - persistent WebView storage (localStorage/IndexedDB survive restarts,
//     exactly like a normal browser profile — this is what keeps the
//     existing "uwl_v5" session/pairing state intact across app launches)
// So none of that needs custom code. The only native wiring this project
// needs is telling the splash screen when the *real* remote page (over the
// network) has finished loading, since we disabled the fixed-timer splash
// in favor of one that hides only when the site is actually ready.
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    WebView webView = this.bridge.getWebView();
    final WebViewClient existingClient = webView.getWebViewClient();

    webView.setWebViewClient(new WebViewClient() {
      @Override
      public void onPageFinished(WebView view, String url) {
        // Preserve whatever WebViewClient Capacitor/plugins already
        // installed (e.g. for allowNavigation / CORS handling) —
        // we only add a hook, we don't replace their behavior.
        if (existingClient != null) {
          existingClient.onPageFinished(view, url);
        }
        view.evaluateJavascript(
          "window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SplashScreen " +
          "&& window.Capacitor.Plugins.SplashScreen.hide();",
          null
        );
      }
    });
  }
}