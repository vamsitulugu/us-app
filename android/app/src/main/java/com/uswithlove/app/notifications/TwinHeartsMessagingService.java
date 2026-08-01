package com.uswithlove.app.notifications;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.net.Uri;
import android.os.Build;
import android.widget.RemoteViews;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.graphics.drawable.IconCompat;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import com.uswithlove.app.MainActivity;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;
import java.util.Random;

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

  // ── Chat: DecoratedCustomViewStyle — partner avatar (left) + app logo (right) ──
  //
  // Previously plain BigTextStyle (see showActionable/showSimple), which
  // only has one image slot (setLargeIcon, right side) — the Twin Hearts
  // logo lived there and the partner's photo had nowhere to go.
  // MessagingStyle was considered and rejected: its avatar circle only
  // survives in the COLLAPSED preview and gets replaced by the
  // conversation thread on expand, for every app using it (WhatsApp/
  // Telegram included), so there's no way to keep it persistent.
  //
  // DecoratedCustomViewStyle solves both: Android still owns/renders all
  // the standard chrome (status-bar smallIcon, setLargeIcon on the right,
  // app name, timestamp, expand affordance) — it only lets our RemoteViews
  // layout (notify_chat_left_avatar.xml) replace the middle content row,
  // where we place the partner's circular avatar with the tiny Twin
  // Hearts badge baked into its bottom-right corner. RIGHT-side large
  // logo stays completely untouched; LEFT now matches the incoming-call
  // notification's look.
  private void showChatMessage(Map<String, String> data, String tag, String senderName, String body, String url) {
    Context ctx = getApplicationContext();
    String title = "💬 " + senderName;

    // LEFT-side avatar: partner's uploaded profile photo (data["senderAvatar"],
    // populated by routes/chat.js from couples.user1_avatar/user2_avatar) with
    // the tiny Twin Hearts logo badge composited onto its bottom-right corner —
    // same treatment as the incoming-call notification's caller avatar. Falls
    // back to a plain brand-colored circle if no photo is available/loadable.
    Bitmap partnerPhoto = downloadBitmap(data.get("senderAvatar"));
    Bitmap leftAvatar = buildAvatarWithBadge(ctx, partnerPhoto);
    RemoteViews collapsed = buildAvatarRemoteViews(ctx, title, body, leftAvatar);

    NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, NotificationRouter.MESSAGES_CHANNEL_ID)
        .setSmallIcon(getIconRes(ctx)) // unchanged: Android-mandated monochrome status-bar icon
        .setColor(Color.parseColor(NotificationRouter.BRAND_ACCENT_COLOR))
        .setContentTitle(title)
        .setContentText(body)
        .setLargeIcon(buildAppLogoBitmap(ctx)) // unchanged: RIGHT-side large Twin Hearts logo
        .setStyle(new NotificationCompat.DecoratedCustomViewStyle()) // keeps large icon/right chrome, replaces middle row only
        .setCustomContentView(collapsed)
        .setCustomBigContentView(collapsed)
        .setAutoCancel(true)
        .setContentIntent(contentIntent(ctx, url))
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .addAction(new NotificationCompat.Action.Builder(
            android.R.drawable.ic_menu_send, "Reply", actionPendingIntent(ctx, "REPLY", data, 100))
            .addRemoteInput(new androidx.core.app.RemoteInput.Builder(NotificationActionReceiver.KEY_REPLY_TEXT)
                .setLabel("Type a reply…").build())
            .setAllowGeneratedReplies(true)
            .build())
        .addAction(new NotificationCompat.Action.Builder(
            android.R.drawable.ic_menu_view, "Mark as Read", actionPendingIntent(ctx, "MARK_READ", data, 101))
            .build())
        .setGroup("chat_" + data.getOrDefault("coupleId", "default"));

    notify(ctx, tag, builder);
  }

  // ── Download a bitmap from a URL, synchronously. Safe here: onMessageReceived()
  // already runs off the main thread (FCM's own background thread). Returns
  // null on any failure so callers fall back cleanly — never throws.
  @Nullable
  private Bitmap downloadBitmap(@Nullable String urlStr) {
    if (urlStr == null || urlStr.isEmpty()) return null;
    HttpURLConnection conn = null;
    try {
      conn = (HttpURLConnection) new URL(urlStr).openConnection();
      conn.setConnectTimeout(4000);
      conn.setReadTimeout(4000);
      conn.setDoInput(true);
      conn.connect();
      try (InputStream in = conn.getInputStream()) {
        return BitmapFactory.decodeStream(in);
      }
    } catch (Exception e) {
      return null;
    } finally {
      if (conn != null) conn.disconnect();
    }
  }

  // Circle-crops any source bitmap to a square of the given size (px).
  private Bitmap circleCrop(Bitmap source, int size) {
    Bitmap scaled = Bitmap.createScaledBitmap(source, size, size, true);
    Bitmap output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
    Canvas canvas = new Canvas(output);
    Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    paint.setShader(new android.graphics.BitmapShader(scaled, android.graphics.Shader.TileMode.CLAMP, android.graphics.Shader.TileMode.CLAMP));
    canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint);
    return output;
  }

  // Composites a large circular avatar (partner's photo, or a plain
  // brand-colored circle fallback when no photo is available/loadable)
  // with the tiny Twin Hearts logo badge overlapping its bottom-right
  // corner — the same visual treatment as the incoming-call notification.
  // Builds the shared left-avatar RemoteViews content row (title + body +
  // avatar bitmap) used by both showChatMessage() and baseBuilder() —
  // the single place that wires the layout, so the two callers don't
  // each duplicate setTextViewText/setImageViewBitmap calls.
  private RemoteViews buildAvatarRemoteViews(Context ctx, String title, String body, @Nullable Bitmap leftAvatar) {
    RemoteViews views = new RemoteViews(ctx.getPackageName(), com.uswithlove.app.R.layout.notify_chat_left_avatar);
    views.setTextViewText(com.uswithlove.app.R.id.notif_title, title);
    views.setTextViewText(com.uswithlove.app.R.id.notif_body, body);
    if (leftAvatar != null) {
      views.setImageViewBitmap(com.uswithlove.app.R.id.notif_left_avatar, leftAvatar);
    }
    return views;
  }

  private Bitmap buildAvatarWithBadge(Context ctx, @Nullable Bitmap photo) {
    int avatarSize = 144; // px, downscaled by RemoteViews/Android to the 48dp slot
    int badgeSize = (int) (avatarSize * 0.38f);

    Bitmap avatarCircle;
    if (photo != null) {
      avatarCircle = circleCrop(photo, avatarSize);
    } else {
      avatarCircle = Bitmap.createBitmap(avatarSize, avatarSize, Bitmap.Config.ARGB_8888);
      Canvas c = new Canvas(avatarCircle);
      Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
      p.setColor(Color.parseColor(NotificationRouter.BRAND_ACCENT_COLOR));
      c.drawCircle(avatarSize / 2f, avatarSize / 2f, avatarSize / 2f, p);
    }

    Bitmap logo = buildAppLogoBitmap(ctx);
    if (logo == null) return avatarCircle;
    Bitmap badge = circleCrop(logo, badgeSize);

    Bitmap composite = Bitmap.createBitmap(avatarSize, avatarSize, Bitmap.Config.ARGB_8888);
    Canvas canvas = new Canvas(composite);
    canvas.drawBitmap(avatarCircle, 0, 0, null);
    Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
    ring.setColor(Color.WHITE);
    float cx = avatarSize - badgeSize / 2f, cy = avatarSize - badgeSize / 2f;
    canvas.drawCircle(cx, cy, badgeSize / 2f + 4, ring);
    canvas.drawBitmap(badge, avatarSize - badgeSize, avatarSize - badgeSize, null);
    return composite;
  }

  // ── Twin Hearts app logo, circle-cropped for the notification's
  // large icon (the crisp branding shown on the right, RedBus-style) ──
  //
  // NOTE: this deliberately does NOT read the "ic_launcher" mipmap.
  // On API 26+ that identifier resolves to mipmap-anydpi-v26/ic_launcher.xml
  // — an <adaptive-icon> XML, not a raster image. BitmapFactory.decodeResource()
  // can't decode XML drawables, so it silently returned null here, which
  // is why the large icon never actually appeared on real devices (Android
  // just omits it rather than crashing). ic_notification_logo is a plain
  // PNG in res/drawable-nodpi/ built from resources/icon.png specifically
  // so this always decodes to a real Bitmap.
  private Bitmap buildAppLogoBitmap(Context ctx) {
    int logoResId = ctx.getResources().getIdentifier("ic_notification_logo", "drawable", ctx.getPackageName());
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

  // ── Calls: CallStyle + full-screen intent, like a real phone call ──
  private void showIncomingCall(Map<String, String> data, String tag, String title, String callerName, String url) {
    Context ctx = getApplicationContext();

    Intent fullScreenIntent = new Intent(ctx, MainActivity.class);
    fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    fullScreenIntent.putExtra("deepLinkUrl", url);
    PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
        ctx, 200, fullScreenIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

    // ROOT CAUSE FIX: this used to build the Person with just a name, so
    // CallStyle always fell back to a generic initials/silhouette avatar —
    // it never actually tried to load the partner's uploaded photo. data
    // now carries "senderAvatar" (see routes/call.js), same field/shape as
    // chat notifications, so we download and attach it here the same way.
    Person.Builder callerBuilder = new Person.Builder().setName(callerName);
    Bitmap callerPhoto = downloadBitmap(data.get("senderAvatar"));
    if (callerPhoto != null) {
      callerBuilder.setIcon(IconCompat.createWithBitmap(circleCrop(callerPhoto, 256)));
    }
    Person caller = callerBuilder.build();
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

  // ── Partner requests / games / reminders: avatar+badge left, 2 actions ──
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

  // ── Everything else: avatar+badge left, single tap-to-open ────────
  private void showSimple(Map<String, String> data, String tag, String channelId, String title, String body, String url) {
    notify(getApplicationContext(), tag, baseBuilder(getApplicationContext(), channelId, title, body, url, data));
  }

  private PendingIntent contentIntent(Context ctx, String url) {
    Intent openIntent = new Intent(ctx, MainActivity.class);
    openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    openIntent.putExtra("deepLinkUrl", url);
    return PendingIntent.getActivity(
        ctx, new Random().nextInt(), openIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
  }

  // Shared by showActionable() (partner-request, games, reminders) and
  // showSimple() (partner-accepted/paired/ck-invite, memories, safety,
  // general) — i.e. every notification type that isn't chat or a call.
  // Same DecoratedCustomViewStyle treatment as showChatMessage(): Android
  // keeps rendering its own chrome (smallIcon, right-side large logo, app
  // name, timestamp) and only the middle row is replaced by our layout,
  // which shows the sender's avatar + Twin Hearts badge on the left.
  // data["senderAvatar"] is now populated centrally for every push (see
  // sendFCMToPartner in routes/auth.js), so no per-notification-type
  // lookup is needed here — this one implementation covers all of them.
  private NotificationCompat.Builder baseBuilder(Context ctx, String channelId, String title, String body, String url, Map<String, String> data) {
    Bitmap leftAvatar = buildAvatarWithBadge(ctx, downloadBitmap(data.get("senderAvatar")));
    RemoteViews content = buildAvatarRemoteViews(ctx, title, body, leftAvatar);

    return new NotificationCompat.Builder(ctx, channelId)
        .setSmallIcon(getIconRes(ctx))
        .setColor(Color.parseColor(NotificationRouter.BRAND_ACCENT_COLOR))
        .setContentTitle(title)
        .setContentText(body)
        .setLargeIcon(buildAppLogoBitmap(ctx)) // unchanged: RIGHT-side large Twin Hearts logo
        .setStyle(new NotificationCompat.DecoratedCustomViewStyle())
        .setCustomContentView(content)
        .setCustomBigContentView(content)
        .setAutoCancel(true)
        .setContentIntent(contentIntent(ctx, url))
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