# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# ── Capacitor / WebView JS bridge ──────────────────────────────────
# Capacitor's native<->JS bridge calls plugin methods via reflection.
# Without these keep rules, R8 (enabled above for release builds) would
# strip the annotated methods/classes since it can't see the JS-side
# calls, silently breaking every native feature (camera, splash, status
# bar, share, etc.) ONLY in release builds — debug would keep working,
# making this very easy to miss without the rule.
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { *; }
-keepclassmembers,allowobfuscation class * {
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
}
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
