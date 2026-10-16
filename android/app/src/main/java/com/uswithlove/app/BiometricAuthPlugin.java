package com.uswithlove.app;

import android.app.Activity;
import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Biometric unlock using the AndroidX Biometric library (works on API 24+).
 * Previously this mixed the platform android.hardware.biometrics.BiometricPrompt
 * (API 28+, different constructor/callback signatures) with the AndroidX API,
 * which is why it did not compile.
 */
@CapacitorPlugin(name = "BiometricAuth")
public class BiometricAuthPlugin extends Plugin {

  private static final int AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_WEAK;

  @PluginMethod
  public void isAvailable(PluginCall call) {
    int availability = BiometricManager.from(getContext()).canAuthenticate(AUTHENTICATORS);
    boolean available = availability == BiometricManager.BIOMETRIC_SUCCESS;
    JSObject result = new JSObject();
    result.put("available", available);
    result.put("biometricType", available ? "biometric" : "none");
    call.resolve(result);
  }

  @PluginMethod
  public void authenticate(final PluginCall call) {
    final String title = call.getString("title", "Authenticate");
    final String subtitle = call.getString("subtitle", "Use your fingerprint or face to unlock");
    final String description = call.getString("description", "Biometric authentication required");
    final String negativeButtonText = call.getString("negativeButtonText", "Cancel");

    int availability = BiometricManager.from(getContext()).canAuthenticate(AUTHENTICATORS);
    if (availability != BiometricManager.BIOMETRIC_SUCCESS) {
      call.reject("Biometric authentication not available on this device");
      return;
    }

    final Activity activity = getActivity();
    if (!(activity instanceof FragmentActivity)) {
      call.reject("Biometric authentication needs a FragmentActivity");
      return;
    }
    final FragmentActivity fragmentActivity = (FragmentActivity) activity;

    // BiometricPrompt must be created and shown on the main thread.
    activity.runOnUiThread(() -> {
      try {
        final BiometricPrompt prompt = new BiometricPrompt(
            fragmentActivity,
            ContextCompat.getMainExecutor(fragmentActivity),
            new BiometricPrompt.AuthenticationCallback() {
              @Override
              public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                super.onAuthenticationError(errorCode, errString);
                call.reject("Authentication error: " + errString);
              }

              @Override
              public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                super.onAuthenticationSucceeded(result);
                JSObject res = new JSObject();
                res.put("success", true);
                call.resolve(res);
              }

              @Override
              public void onAuthenticationFailed() {
                // One unrecognised attempt — the system prompt stays open and lets the
                // user retry, so don't reject the call here.
                super.onAuthenticationFailed();
              }
            });

        final BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setDescription(description)
            .setNegativeButtonText(negativeButtonText)
            .setAllowedAuthenticators(AUTHENTICATORS)
            .build();

        prompt.authenticate(promptInfo);
      } catch (Exception e) {
        call.reject("Could not start biometric prompt: " + e.getMessage());
      }
    });
  }
}
