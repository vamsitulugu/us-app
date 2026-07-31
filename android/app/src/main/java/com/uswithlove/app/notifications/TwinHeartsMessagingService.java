package com.uswithlove.app.notifications;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.graphics.drawable.IconCompat;
import androidx.annotation.NonNull;
import com.bumptech.glide.Glide;
import com.bumptech.glide.load.resource.bitmap.CircleCrop;
import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import com.uswithlove.app.MainActivity;

import java.util.Map;
import java.util.Random;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Replaces Capacitor's default MessagingService (see AndroidManifest.xml,
 * which points the com.google.firebase.MESSAGING_EVENT intent-filter at
 * this class instead). Capacitor's own service calls
 * super.onMessageReceived(), which is FirebaseMessagingService's built-in
 * behavior — that's what auto-posted the plain, unstyled system
 * notification for every "notification"-payload push before this file
 * existed. Every push from the backend (routes/auth.js) is now sent as a
 * data-only message instead, so it always reaches onMessageReceived()
 * here — even while the app is fully backgrounded — and this class is
 * fully in control of how it looks.
 *
 * Still forwards to PushNotificationsPlugin so any foreground JS
 * `pushNotificationReceived` listeners the web app already has keep
 * firing exactly as before.
 */
public class TwinHeartsMessagingService extends FirebaseMessagingService {

  // Single background executor for the (best-effort, non-blocking) avatar
  // fetch below. Never used to delay posting the notification itself —
  // the notification always goes out first with a letter-avatar fallback,
  // then gets silently swapped to the real photo if/when it loads.
  private static final ExecutorService AVATAR_EXECUTOR = Executors.newCachedThreadPool();

  // 46dp — matches the "44-48dp" premium-avatar spec, converted to px
  // at draw time via displayMetrics.
  private static final int AVATAR_SIZE_DP = 46;

  @Override
  public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
    // Deliberately NOT calling super.onMessageReceived() — that's what
    // triggers FCM's own auto-display of a plain notification, which
    // would show a second, ugly duplicate alongside the one built below.
    PushNotificationsPlugin.sendRemoteMessage(remoteMessage);

    Map<String, String> data = remoteMessage.getData();
    if (data.isEmpty()) return; // nothing to show

    String tag = data.getOrDefault("tag", "");
    String title = data.getOrDefault("title", "Twin Hearts 💕");
    String body = data.getOrDefault("body", "");
    String url = data.getOrDefault("url", "/");
    String senderName = data.getOrDefault("senderName", "Your partner");

    NotificationRouter.Category category = NotificationRouter.categorize(tag);

    switch (category) {
      case CALL:
        showIncomingCall(data, tag, title, senderName, url);
        return;
      case CHAT:
        showChatMessage(data, tag, senderName, body, url);
        return;
      case PARTNER_REQUEST:
        if ("partner-request".equals(tag)) {
          showActionable(data, tag, category.channelId, title, body, url,
              "ACCEPT_PARTNER", "✅ Accept", "DECLINE_PARTNER", "✖️ Decline");
        } else {
          showSimple(data, tag, category.channelId, title, body, url);
        }
        return;
      case GAME:
        showActionable(data, tag, category.channelId, title, body, url,
            "OPEN", "🎮 Play Now", "DISMISS", "Later");
        return;
      case REMINDER:
        showActionable(data, tag, category.channelId, title, body, url,
            "OPEN", "Open", "DISMISS", "Dismiss");
        return;
      default:
        showSimple(data, tag, category.channelId, title, body, url);
    }
  }

  @Override
  public void onNewToken(@NonNull String token) {
    super.onNewToken(token);
    PushNotificationsPlugin.onNewToken(token);
  }

  // ── Chat: MessagingStyle, like WhatsApp/Telegram ─────────────────
  //
  // Appearance-only upgrade over the previous version:
  //  - sender's circular avatar (real profile photo if available, else a
  //    generated letter-avatar) shown next to the message, ~46dp
  //  - Twin Hearts logo shown as the notification's large icon (the
  //    "premium branding on the right" treatment RedBus/WhatsApp use)
  // None of the reply/mark-read actions, channel, group, tag, or FCM
  // handling below this comment were touched.
  private void showChatMessage(Map<String, String> data, String tag, String senderName, String body, String url) {
    Context ctx = getApplicationContext();

    Bitmap letterAvatar = buildLetterAvatarBitmap(ctx, senderName);
    Bitmap appLogo = buildAppLogoBitmap(ctx);
    String avatarUrl = data.get("senderAvatar");

    // Post immediately with the letter-avatar fallback — never wait on
    // the network for the notification to appear.
    postChatNotification(ctx, data, tag, senderName, body, url, letterAvatar, appLogo);

    if (avatarUrl == null || avatarUrl.trim().isEmpty()) return;

    // Best-effort, async: fetch + circle-crop the real profile photo
    // (Glide handles memory/disk caching for us) and silently re-post
    // the same notification (same tag/id) with the upgraded avatar once
    // it's ready. If this fails or is slow, the letter avatar already
    // shown just stays as-is — nothing blocks, nothing breaks.
    AVATAR_EXECUTOR.execute(() -> {
      try {
        int px = dpToPx(ctx, AVATAR_SIZE_DP);
        Bitmap real = Glide.with(ctx)
            .asBitmap()
            .load(avatarUrl)
            .transform(new CircleCrop())
            .submit(px, px)
            .get(); // this thread only — never the caller of onMessageReceived
        if (real != null) {
          postChatNotification(ctx, data, tag, senderName, body, url, real, appLogo);
        }
      } catch (Exception ignored) {
        // Download failed / timed out — letter avatar already posted stands.
      }
    });
  }

  private void postChatNotification(Context ctx, Map<String, String> data, String tag, String senderName,
                                     String body, String url, Bitmap avatar, Bitmap appLogo) {
    IconCompat avatarIcon = IconCompat.createWithBitmap(avatar);
    Person sender = new Person.Builder()
        .setName(senderName)
        .setIcon(avatarIcon)
        .build();

    NotificationCompat.MessagingStyle style =
        new NotificationCompat.MessagingStyle(new Person.Builder().setName("You").build())
            .setConversationTitle(senderName)
            .addMessage(body, System.currentTimeMillis(), sender);

    NotificationCompat.Action reply = new NotificationCompat.Action.Builder(
        android.R.drawable.ic_menu_send, "Reply", actionPendingIntent(ctx, "REPLY", data, 100))
        .addRemoteInput(new androidx.core.app.RemoteInput.Builder(NotificationActionReceiver.KEY_REPLY_TEXT)
            .setLabel("Type a reply…").build())
        .setAllowGeneratedReplies(true)
        .build();

    NotificationCompat.Action markRead = new NotificationCompat.Action.Builder(
        android.R.drawable.ic_menu_view, "Mark as Read", actionPendingIntent(ctx, "MARK_READ", data, 101))
        .build();

    NotificationCompat.Builder builder = baseBuilder(ctx, NotificationRouter.MESSAGES_CHANNEL_ID, "💬 New Message", body, url, data)
        .setStyle(style)
        .addAction(reply)
        .addAction(markRead)
        .setGroup("chat_" + data.getOrDefault("coupleId", "default"))
        .setLargeIcon(appLogo) // Twin Hearts branding, right side — like RedBus
        .setAutoCancel(true);

    notify(ctx, tag, builder);
  }

  // ── Circular letter-avatar fallback (drawn instantly, no I/O) ──────
  private Bitmap buildLetterAvatarBitmap(Context ctx, String senderName) {
    int px = dpToPx(ctx, AVATAR_SIZE_DP);
    Bitmap bitmap = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888);
    Canvas canvas = new Canvas(bitmap);

    Paint circlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    circlePaint.setColor(Color.parseColor(NotificationRouter.BRAND_ACCENT_COLOR));
    canvas.drawCircle(px / 2f, px / 2f, px / 2f, circlePaint);

    String initial = (senderName == null || senderName.trim().isEmpty())
        ? "?" : senderName.trim().substring(0, 1).toUpperCase();

    Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    textPaint.setColor(Color.WHITE);
    textPaint.setTextSize(px * 0.46f);
    textPaint.setTextAlign(Paint.Align.CENTER);
    textPaint.setFakeBoldText(true);
    float textY = (px / 2f) - ((textPaint.descent() + textPaint.ascent()) / 2f);
    canvas.drawText(initial, px / 2f, textY, textPaint);

    return bitmap;
  }

  // ── Twin Hearts app logo, circle-cropped for the notification's
  // large icon (the crisp branding shown on the right, RedBus-style) ──
  private Bitmap buildAppLogoBitmap(Context ctx) {
    int logoResId = ctx.getResources().getIdentifier("ic_launcher", "mipmap", ctx.getPackageName());
    Bitmap source = android.graphics.BitmapFactory.decodeResource(ctx.getResources(), logoResId);
    if (source == null) return null;

    int size = Math.min(source.getWidth(), source.getHeight());
    Bitmap output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
    Canvas canvas = new Canvas(output);
    Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    paint.setShader(new android.graphics.BitmapShader(source, android.graphics.Shader.TileMode.CLAMP, android.graphics.Shader.TileMode.CLAMP));
    canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint);
    return output;
  }

  private int dpToPx(Context ctx, int dp) {
    float density = ctx.getResources().getDisplayMetrics().density;
    return Math.round(dp * density);
  }

  // ── Calls: CallStyle + full-screen intent, like a real phone call ──
  private void showIncomingCall(Map<String, String> data, String tag, String title, String callerName, String url) {
    Context ctx = getApplicationContext();

    Intent fullScreenIntent = new Intent(ctx, MainActivity.class);
    fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    fullScreenIntent.putExtra("deepLinkUrl", url);
    PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
        ctx, 200, fullScreenIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

    Person caller = new Person.Builder().setName(callerName).build();
    PendingIntent answer = actionPendingIntent(ctx, "ANSWER_CALL", data, 201);
    PendingIntent decline = actionPendingIntent(ctx, "DECLINE_CALL", data, 202);

    NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, NotificationRouter.CALLS_CHANNEL_ID)
        .setSmallIcon(getIconRes(ctx))
        .setColor(Color.parseColor(NotificationRouter.BRAND_ACCENT_COLOR))
        .setContentTitle(title)
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setFullScreenIntent(fullScreenPendingIntent, true)
        .setOngoing(true)
        .setAutoCancel(false);

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      // CallStyle requires API 31+; older devices fall back to the plain
      // high-priority + full-screen-intent builder above, which still
      // rings and launches the incoming-call screen — just without the
      // OS's native two-button call layout.
      builder.setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer));
    } else {
      builder.addAction(new NotificationCompat.Action.Builder(android.R.drawable.ic_menu_call, "Answer", answer).build());
      builder.addAction(new NotificationCompat.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "Decline", decline).build());
    }

    notify(ctx, tag, builder);
  }

  // ── Partner requests / games / reminders: BigTextStyle + 2 actions ──
  private void showActionable(Map<String, String> data, String tag, String channelId, String title, String body, String url,
                               String action1Key, String action1Label, String action2Key, String action2Label) {
    Context ctx = getApplicationContext();
    NotificationCompat.Builder builder = baseBuilder(ctx, channelId, title, body, url, data)
        .addAction(new NotificationCompat.Action.Builder(android.R.drawable.ic_menu_send, action1Label,
            actionPendingIntent(ctx, action1Key, data, 300)).build())
        .addAction(new NotificationCompat.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, action2Label,
            actionPendingIntent(ctx, action2Key, data, 301)).build());
    notify(ctx, tag, builder);
  }

  // ── Everything else: clean BigTextStyle, single tap-to-open ────────
  private void showSimple(Map<String, String> data, String tag, String channelId, String title, String body, String url) {
    notify(getApplicationContext(), tag, baseBuilder(getApplicationContext(), channelId, title, body, url, data));
  }

  private NotificationCompat.Builder baseBuilder(Context ctx, String channelId, String title, String body, String url, Map<String, String> data) {
    Intent openIntent = new Intent(ctx, MainActivity.class);
    openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    openIntent.putExtra("deepLinkUrl", url);
    PendingIntent contentIntent = PendingIntent.getActivity(
        ctx, new Random().nextInt(), openIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

    return new NotificationCompat.Builder(ctx, channelId)
        .setSmallIcon(getIconRes(ctx))
        .setColor(Color.parseColor(NotificationRouter.BRAND_ACCENT_COLOR))
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
        .setAutoCancel(true)
        .setContentIntent(contentIntent)
        .setPriority(NotificationCompat.PRIORITY_HIGH);
  }

  private PendingIntent actionPendingIntent(Context ctx, String action, Map<String, String> data, int requestCode) {
    Intent intent = new Intent(ctx, NotificationActionReceiver.class);
    intent.setAction(action);
    for (Map.Entry<String, String> e : data.entrySet()) intent.putExtra(e.getKey(), e.getValue());
    return PendingIntent.getBroadcast(ctx, requestCode, intent,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE); // MUTABLE required for RemoteInput (Reply)
  }

  private int getIconRes(Context ctx) {
    return ctx.getResources().getIdentifier("ic_stat_notify", "drawable", ctx.getPackageName());
  }

  private void notify(Context ctx, String tag, NotificationCompat.Builder builder) {
    int notifyId = (tag == null || tag.isEmpty()) ? new Random().nextInt() : tag.hashCode();
    NotificationManagerCompat.from(ctx).notify(tag, notifyId, builder.build());
  }
}
