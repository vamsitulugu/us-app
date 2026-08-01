package com.uswithlove.app.notifications;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import androidx.core.app.RemoteInput;
import androidx.core.app.NotificationManagerCompat;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Handles taps on notification action buttons (Accept/Decline/Answer/
 * Reply/Mark as Read/…) without needing to open the app first — the same
 * "quick action" pattern WhatsApp and Google Messages use. Talks directly
 * to the existing REST API (see routes/partner.js, routes/chat.js,
 * routes/call.js) — no new backend endpoints were added; these are the
 * same calls the web app itself already makes.
 *
 * Runs the network call on a background thread via goAsync(), since
 * BroadcastReceiver.onReceive() must return quickly and networking is not
 * allowed on the main thread.
 */
public class NotificationActionReceiver extends BroadcastReceiver {

  public static final String KEY_REPLY_TEXT = "key_reply_text";
  private static final String API_BASE = "https://us-app-av6d.onrender.com";

  @Override
  public void onReceive(Context context, Intent intent) {
    String action = intent.getAction();
    if (action == null) return;

    String tag = intent.getStringExtra("tag");
    NotificationManager nm = context.getSystemService(NotificationManager.class);

    final PendingResult pendingResult = goAsync();
    new Thread(() -> {
      try {
        switch (action) {
          case "ACCEPT_PARTNER":
            post("/api/partner/accept", jsonOf(
                "requestId", intent.getStringExtra("requestId"),
                "userId", intent.getStringExtra("userId")));
            break;
          case "DECLINE_PARTNER":
            post("/api/partner/reject", jsonOf(
                "requestId", intent.getStringExtra("requestId"),
                "userId", intent.getStringExtra("userId")));
            break;
          case "ANSWER_CALL":
            // No quick-accept API for calls (WebRTC needs the app open to
            // negotiate media) — open the app with a pendingAction=answer
            // flag on the deep link URL instead. call.js's
            // consumePendingCallAction() picks this up on boot and runs
            // the SAME acceptCall() the in-app Answer button uses, once
            // the matching offer has arrived. See MainActivity.handleDeepLink().
            openApp(context, appendPendingAction(intent.getStringExtra("url"), "answer"));
            break;
          case "DECLINE_CALL":
            // ROOT CAUSE FIX: this used to POST /api/call/log with
            // status "declined", which only writes a chat-history row —
            // it never touches the call_signals table, so the caller
            // (still polling/subscribed for a 'decline' signal, same as
            // handleSignal() in call.js) never found out and kept
            // ringing until their own 30s timeout. Post the SAME
            // {type:'decline'} signal the in-app Decline button sends
            // via pushSignal(), using this device's own role (myRole,
            // the recipient's role — see fcmData in routes/auth.js) so
            // it lands as this side's rejection, then log it exactly
            // like the app does.
            postDeclineSignal(intent.getStringExtra("coupleId"), intent.getStringExtra("myRole"));
            post("/api/call/log", jsonOf(
                "coupleId", intent.getStringExtra("coupleId"),
                "callerRole", intent.getStringExtra("callerRole"),
                "type", intent.getStringExtra("type"),
                "status", "declined"));
            break;
          case "MARK_READ":
            post("/api/chat/" + intent.getStringExtra("coupleId") + "/read", jsonOf(
                "role", intent.getStringExtra("role")));
            break;
          case "REPLY":
            Bundle remoteInput = RemoteInput.getResultsFromIntent(intent);
            String replyText = remoteInput != null ? String.valueOf(remoteInput.getCharSequence(KEY_REPLY_TEXT)) : null;
            if (replyText != null && !replyText.trim().isEmpty()) {
              post("/api/chat", jsonOf(
                  "coupleId", intent.getStringExtra("coupleId"),
                  "clientId", "reply_" + System.currentTimeMillis(),
                  "senderRole", intent.getStringExtra("myRole"),
                  "type", "text",
                  "text", replyText));
            }
            break;
          case "DISMISS":
            // Nothing to call — just closing the notification below is enough.
            break;
          default:
            openApp(context, intent.getStringExtra("url"));
        }
      } catch (Exception ignored) {
        // Best-effort: a failed quick action still lets the person open
        // the app and do it there, so we swallow errors rather than crash.
      } finally {
        if (tag != null && nm != null) NotificationManagerCompat.from(context).cancel(tag, tag.hashCode());
        pendingResult.finish();
      }
    }).start();
  }

  private void openApp(Context context, String url) {
    Intent launch = new Intent(context, com.uswithlove.app.MainActivity.class);
    launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    launch.putExtra("deepLinkUrl", url != null ? url : "/");
    context.startActivity(launch);
  }

  // coupleId/role are safe here (server-side-generated UUID/enum, never
  // free text), so a hand-built literal is fine — avoids pulling payload
  // through jsonOf(), which would incorrectly quote it as a JSON string.
  private void postDeclineSignal(String coupleId, String role) throws Exception {
    if (coupleId == null || role == null) return;
    String json = "{\"coupleId\":\"" + escape(coupleId) + "\",\"role\":\"" + escape(role)
        + "\",\"payload\":{\"type\":\"decline\"}}";
    URL url = new URL(API_BASE + "/api/call/signal");
    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
    conn.setRequestMethod("POST");
    conn.setRequestProperty("Content-Type", "application/json");
    conn.setConnectTimeout(8000);
    conn.setReadTimeout(8000);
    conn.setDoOutput(true);
    try (OutputStream os = conn.getOutputStream()) {
      os.write(json.getBytes(StandardCharsets.UTF_8));
    }
    conn.getResponseCode();
    conn.disconnect();
  }

  // Appends ?pendingAction=answer (or &pendingAction=answer if the URL
  // already has a query string) so call.js's consumePendingCallAction()
  // can detect a notification-driven launch once the WebView loads it.
  private String appendPendingAction(String url, String action) {
    String base = (url == null || url.isEmpty()) ? "/" : url;
    String sep = base.contains("?") ? "&" : "?";
    return base + sep + "pendingAction=" + action;
  }

  private void post(String path, String json) throws Exception {
    URL url = new URL(API_BASE + path);
    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
    conn.setRequestMethod("POST");
    conn.setRequestProperty("Content-Type", "application/json");
    conn.setConnectTimeout(8000);
    conn.setReadTimeout(8000);
    conn.setDoOutput(true);
    try (OutputStream os = conn.getOutputStream()) {
      os.write(json.getBytes(StandardCharsets.UTF_8));
    }
    conn.getResponseCode(); // triggers the request; response body isn't needed
    conn.disconnect();
  }

  // Tiny hand-rolled JSON builder — avoids pulling in org.json edge cases
  // for what is always a flat string-keyed object here. Pairs of
  // (key, value) varargs; null values are skipped.
  private String jsonOf(String... pairs) {
    StringBuilder sb = new StringBuilder("{");
    boolean first = true;
    for (int i = 0; i < pairs.length - 1; i += 2) {
      String key = pairs[i], value = pairs[i + 1];
      if (value == null) continue;
      if (!first) sb.append(",");
      sb.append("\"").append(key).append("\":\"").append(escape(value)).append("\"");
      first = false;
    }
    return sb.append("}").toString();
  }

  private String escape(String s) {
    return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n");
  }
}
