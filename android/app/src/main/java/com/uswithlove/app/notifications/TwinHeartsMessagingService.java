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
  // where we place the partner's circular profile photo. RIGHT-side
  // large logo stays completely untouched.
  private void showChatMessage(Map<String, String> data, String tag, String senderName, String body, String url) {
    Context ctx = getApplicationContext();
    String title = "💬 " + senderName;

    // LEFT-side avatar: partner's uploaded profile photo (data["senderAvatar"],
    // populated by routes/chat.js from couples.user1_avatar/user2_avatar).
    // Falls back to the default person-avatar bitmap if no photo is available/loadable.
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

  // Left-side avatar: just the sender's circular profile photo now — the
  // tiny Twin Hearts badge that used to overlap its bottom-right corner
  // was removed per request. Falls back to the shared default person
  // avatar (see buildDefaultAvatarBitmap) when no photo is available/loadable
  // — previously this fell back to a PLAIN BRAND-COLOR CIRCLE with nothing
  // drawn on it, which is the "blank red circle" bug. This is the one and
  // only place that produced it (baseBuilder()/showChatMessage() both call
  // through here), so fixing it here fixes every notification type at once.
  private Bitmap buildAvatarWithBadge(Context ctx, @Nullable Bitmap photo) {
    int avatarSize = 144; // px, downscaled by RemoteViews/Android to the 48dp slot

    if (photo != null) {
      return circleCrop(photo, avatarSize);
    }
    return buildDefaultAvatarBitmap(avatarSize);
  }

  // ── Shared default person-avatar bitmap: brand-accent circular
  // background + a clean white neutral person silhouette (head + shoulder
  // dome), drawn entirely in code so it never depends on a missing/XML-only
  // drawable resource. Deliberately mirrors the in-app SVG fallback
  // (public/js: renderDefaultAvatar — circle head + rounded shoulder arc)
  // so the notification and in-app UI show the same default. Used both for
  // the chat/general notification left-avatar (buildAvatarWithBadge) and
  // the incoming-call Person icon (showIncomingCall) — the two places a
  // sender/profile avatar is ever rendered in a notification. Never used
  // for the separate Twin Hearts app/logo large icon (buildAppLogoBitmap).
  //
  // Sizing: the red background is a circle INSCRIBED in the size×size
  // bitmap — it only touches the square's edges at the four midpoints, so
  // there's empty (transparent) space in the four corners between the
  // circle and the bitmap edge. The previous version clipped the shoulder
  // shape to a plain RECTANGLE, not the circle itself, so white pixels
  // painted into those corners were never actually cut off — that's what
  // made the body look like it "extended outside" the red circle. Fixed
  // by (a) clipping all foreground drawing to the exact same circular
  // path as the background, as a safety net, and (b) sizing/positioning
  // the head + shoulders so the whole silhouette — including its widest
  // point, the shoulder corners — sits well inside that circle with
  // margin to spare, verified below by distance-from-center math rather
  // than by eyeballing the source drawable.
  private Bitmap buildDefaultAvatarBitmap(int size) {
    Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
    Canvas c = new Canvas(bmp);

    float cx = size / 2f, cy = size / 2f, r = size / 2f;

    Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
    bg.setColor(Color.parseColor(NotificationRouter.BRAND_ACCENT_COLOR));
    c.drawCircle(cx, cy, r, bg);

    // Safety clip to the exact circular boundary — nothing drawn below can
    // ever bleed past the red circle, even if this geometry changes later.
    android.graphics.Path circleClip = new android.graphics.Path();
    circleClip.addCircle(cx, cy, r, android.graphics.Path.Direction.CW);
    c.save();
    c.clipPath(circleClip);

    Paint fg = new Paint(Paint.ANTI_ALIAS_FLAG);
    fg.setColor(Color.parseColor("#EBFFFFFF")); // near-white silhouette, matches in-app opacity

    // Head — simple filled circle, positioned above center.
    float headR = size * 0.13f;
    float headCy = cy - size * 0.14f;
    c.drawCircle(cx, headCy, headR, fg);

    // Shoulders — the top half of an oval ("dome"), NOT a full circle
    // clipped by a rectangle. drawArc(..., 180, 180, true, ...) fills
    // exactly the upper half of the oval, so the shape's flat bottom edge
    // (its widest points, the "shoulder corners") is fixed and known —
    // unlike a rect-clipped circle, there's no way for this to extend
    // past where we explicitly put it.
    float bodyRadiusX = size * 0.25f;
    float bodyRadiusY = size * 0.17f;
    float bodyBaseY = cy + size * 0.16f; // flat edge / widest point of the dome
    android.graphics.RectF bodyOval = new android.graphics.RectF(
        cx - bodyRadiusX, bodyBaseY - bodyRadiusY, cx + bodyRadiusX, bodyBaseY + bodyRadiusY);
    c.drawArc(bodyOval, 180, 180, true, fg);
    // Sanity check (design-time): the shoulder corners (cx±bodyRadiusX, bodyBaseY)
    // are the silhouette's farthest points from center. At the sizes used here
    // (144px avatar / 256px call icon) that distance is ~42px / ~75px against a
    // circle radius of 72px / 128px — roughly 59% of the radius, leaving ~41%
    // margin on all sides, comfortably inside the 55–65%-of-diameter target.

    c.restore();
    return bmp;
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
    // When there's no photo (or it fails to load), attach the same brand
    // default-avatar bitmap used elsewhere, instead of leaving the icon
    // unset — keeps the incoming-call screen visually consistent with
    // every other notification's fallback rather than an OS-generic icon.
    Person.Builder callerBuilder = new Person.Builder().setName(callerName);
    Bitmap callerPhoto = downloadBitmap(data.get("senderAvatar"));
    Bitmap callerIconBitmap = callerPhoto != null ? circleCrop(callerPhoto, 256) : buildDefaultAvatarBitmap(256);
    callerBuilder.setIcon(IconCompat.createWithBitmap(callerIconBitmap));
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

  // ── Partner requests / games / reminders: avatar left, 2 actions ──
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

  // ── Everything else: avatar left, single tap-to-open ────────
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
  // which shows the sender's avatar on the left.
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