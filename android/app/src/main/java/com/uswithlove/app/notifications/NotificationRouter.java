package com.uswithlove.app.notifications;

/**
 * Mirrors channelForTag() in routes/auth.js — kept as a single source of
 * truth for "which tag gets which channel and which notification style"
 * on the native side. If you add a new push tag on the backend, add it
 * here too so it doesn't silently fall into GENERAL.
 */
public class NotificationRouter {

  public static final String TOUCH_CHANNEL_ID = "touch_channel_v1";
  public static final String CALLS_CHANNEL_ID = "calls_channel_v1";
  public static final String MESSAGES_CHANNEL_ID = "messages_channel_v1";
  public static final String PARTNER_CHANNEL_ID = "partner_requests_channel_v1";
  public static final String MEMORIES_CHANNEL_ID = "memories_channel_v1";
  public static final String GAMES_CHANNEL_ID = "games_channel_v1";
  public static final String REMINDERS_CHANNEL_ID = "reminders_channel_v1";
  public static final String SAFETY_CHANNEL_ID = "safety_channel_v1";
  public static final String GENERAL_CHANNEL_ID = "general_channel_v1";

  public static final String BRAND_ACCENT_COLOR = "#B30000";

  public enum Category {
    TOUCH(TOUCH_CHANNEL_ID),
    CALL(CALLS_CHANNEL_ID),
    CHAT(MESSAGES_CHANNEL_ID),
    PARTNER_REQUEST(PARTNER_CHANNEL_ID),
    MEMORY(MEMORIES_CHANNEL_ID),
    GAME(GAMES_CHANNEL_ID),
    REMINDER(REMINDERS_CHANNEL_ID),
    SAFETY(SAFETY_CHANNEL_ID),
    GENERAL(GENERAL_CHANNEL_ID);

    public final String channelId;
    Category(String channelId) { this.channelId = channelId; }
  }

  public static Category categorize(String tag) {
    if (tag == null) tag = "";
    if (tag.equals("touch")) return Category.TOUCH;
    if (tag.equals("incoming-call")) return Category.CALL;
    if (tag.equals("chat-msg") || tag.equals("missed-call") || tag.equals("missyou") || tag.equals("hug")) return Category.CHAT;
    if (tag.equals("partner-request") || tag.equals("partner-accepted") || tag.equals("paired") || tag.equals("ck-invite")) return Category.PARTNER_REQUEST;
    if (tag.startsWith("safety-")) return Category.SAFETY;
    if (tag.equals("events") || tag.equals("reminder") || tag.equals("meetplan") || tag.equals("meetup-complete")) return Category.REMINDER;
    if (tag.equals("photos") || tag.startsWith("globe-") || tag.startsWith("home-") || tag.equals("journal") || tag.equals("milestone") || tag.equals("capsule")) return Category.MEMORY;
    if (tag.startsWith("music-") || tag.equals("song") || tag.equals("karaoke-rec")) return Category.GAME;
    return Category.GENERAL;
  }
}
