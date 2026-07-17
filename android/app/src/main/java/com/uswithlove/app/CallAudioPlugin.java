package com.uswithlove.app;

import android.content.Context;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Root cause this plugin fixes: the web layer's only tool for audio
// routing is HTMLMediaElement.setSinkId(), which on Android WebView never
// actually moves audio between the earpiece and the loudspeaker at the OS
// level — it's a documented no-op there. Real routing requires native
// AudioManager calls, which plain web APIs can't reach. This plugin is the
// thin bridge call.js needs for that.
@CapacitorPlugin(name = "CallAudio")
public class CallAudioPlugin extends Plugin {

  private AudioManager audioManager() {
    return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
  }

  // Root cause this pair of methods fixes: when the app is open in the
  // foreground and an incoming call arrives before the user has tapped
  // anything since launch, the web layer's ringtone (an HTML <audio> /
  // WebAudio tone in call.js) is silently blocked by the WebView's
  // autoplay policy — there's no exception for it, unlike the OS-level
  // notification ringtone that plays when the app is fully closed. Using
  // Android's own Ringtone API here plays sound through the system layer
  // directly, completely outside the WebView, so it is never subject to
  // that autoplay restriction regardless of prior user interaction.
  private Ringtone activeRingtone = null;
  private Handler ringtoneLoopHandler = null;
  private final Runnable ringtoneLoopRunnable = new Runnable() {
    @Override public void run() {
      if (activeRingtone != null && !activeRingtone.isPlaying()) {
        activeRingtone.play();
      }
      if (ringtoneLoopHandler != null) ringtoneLoopHandler.postDelayed(this, 500);
    }
  };

  @PluginMethod
  public void playRingtone(PluginCall call) {
    stopRingtoneInternal();
    Uri uri = RingtoneManager.getActualDefaultRingtoneUri(getContext(), RingtoneManager.TYPE_RINGTONE);
    if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
    activeRingtone = RingtoneManager.getRingtone(getContext(), uri);
    if (activeRingtone != null) {
      activeRingtone.play();
      // Ringtone has no built-in loop flag pre-API 28 in a reliable cross-
      // device way, so poll and restart it if it stops — cheap and simple.
      ringtoneLoopHandler = new Handler(Looper.getMainLooper());
      ringtoneLoopHandler.postDelayed(ringtoneLoopRunnable, 500);
    }
    call.resolve();
  }

  @PluginMethod
  public void stopRingtone(PluginCall call) {
    stopRingtoneInternal();
    call.resolve();
  }

  private void stopRingtoneInternal() {
    if (ringtoneLoopHandler != null) {
      ringtoneLoopHandler.removeCallbacks(ringtoneLoopRunnable);
      ringtoneLoopHandler = null;
    }
    if (activeRingtone != null) {
      try { activeRingtone.stop(); } catch (Exception e) {}
      activeRingtone = null;
    }
  }

  // Used while a call is ringing (incoming or outgoing/ringback). Keeps the
  // OS in normal playback mode with the speaker forced on, so the ringtone/
  // ringback tone plays loudly like a real dialer — mirrors how a stock
  // phone app rings before pickup, regardless of the user's in-call
  // speaker preference from a previous call.
  @PluginMethod
  public void setRinging(PluginCall call) {
    AudioManager am = audioManager();
    if (am != null) {
      am.setMode(AudioManager.MODE_NORMAL);
      am.setSpeakerphoneOn(true);
    }
    call.resolve();
  }

  // Used once the call actually connects. Switches into communication mode
  // (required for proper echo cancellation / mic routing during a real
  // call) and applies the user's chosen speaker/earpiece preference.
  @PluginMethod
  public void setConnected(PluginCall call) {
    boolean speakerOn = call.getBoolean("speakerOn", false);
    AudioManager am = audioManager();
    if (am != null) {
      am.setMode(AudioManager.MODE_IN_COMMUNICATION);
      am.setSpeakerphoneOn(speakerOn);
    }
    call.resolve();
  }

  // Used when the user taps the in-call speaker toggle.
  @PluginMethod
  public void setSpeaker(PluginCall call) {
    boolean speakerOn = call.getBoolean("speakerOn", false);
    AudioManager am = audioManager();
    if (am != null) {
      am.setSpeakerphoneOn(speakerOn);
    }
    call.resolve();
  }

  // Used on call cleanup, to release communication-mode audio focus back
  // to the rest of the OS instead of leaving the audio session pinned in
  // call mode after the call has ended.
  @PluginMethod
  public void release(PluginCall call) {
    AudioManager am = audioManager();
    if (am != null) {
      am.setMode(AudioManager.MODE_NORMAL);
      am.setSpeakerphoneOn(false);
    }
    call.resolve();
  }
}