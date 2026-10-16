package com.uswithlove.app;

import android.content.Context;
import android.hardware.biometrics.BiometricPrompt;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "BiometricAuth")
public class BiometricAuthPlugin extends Plugin {

  private final Executor executor = Executors.newSingleThreadExecutor();

  @PluginMethod
  public void isAvailable(PluginCall call) {
    BiometricManager biometricManager = BiometricManager.from(getContext());
    int availability = biometricManager.canAuthenticate();
    JSObject result = new JSObject();
    boolean available = (availability == BiometricManager.BIOMETRIC_SUCCESS);
    result.put("available", available);
    result.put("biometricType", availability == BiometricManager.BIOMETRIC_SUCCESS ? "biometric" : "none");
    call.resolve(result);
  }

  @PluginMethod
  public void authenticate(PluginCall call) {
    final String title = call.getString("title", "Authenticate");
    final String subtitle = call.getString("subtitle", "Use your fingerprint or face to unlock");
    final String description = call.getString("description", "Biometric authentication required");
    final String negativeButtonText = call.getString("negativeButtonText", "Cancel");

    Context context = getContext();
    BiometricManager biometricManager = BiometricManager.from(context);
    int availability = biometricManager.canAuthenticate();
    if (availability != BiometricManager.BIOMETRIC_SUCCESS) {
      call.reject("Biometric authentication not available on this device");
      return;
    }

    final BiometricPrompt biometricPrompt = new BiometricPrompt(
        getActivity(),
        executor,
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
          public void onAuthenticationFailed(@NonNull CharSequence errorString) {
            super.onAuthenticationFailed(errorString);
            call.reject("Authentication failed: " + errorString);
          }
        }
    );

    final BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
        .setTitle(title)
        .setSubtitle(subtitle)
        .setDescription(description)
        .setNegativeButtonText(negativeButtonText)
        .build();

    new Handler(Looper.getMainLooper()).post(() -> biometricPrompt.authenticate(promptInfo));
  }
}
