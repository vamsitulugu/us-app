package com.uswithlove.app.tracking;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

/**
 * OfflineQueue — a tiny, dependency-free persisted queue of GPS points
 * that couldn't be sent immediately (no internet, or the API call
 * failed). Backed by SharedPreferences as a single JSON array, which
 * is plenty for a couple-app's realistic queue depth (a few hundred
 * points at most between reconnects) without pulling in Room/SQLite
 * for what is fundamentally a small FIFO buffer.
 *
 * Thread-safety: all methods are synchronized because
 * LocationForegroundService calls this from its location callback
 * thread while a separate flush() may run from a WorkManager job.
 */
public class OfflineQueue {
    private static final String PREFS = "twinhearts_offline_queue";
    private static final String KEY_POINTS = "points";
    private static final int MAX_QUEUED_POINTS = 5000; // hard ceiling so a week of no internet can't fill the disk

    private final SharedPreferences prefs;

    public OfflineQueue(Context ctx) {
        prefs = ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public synchronized void enqueue(JSONObject point) {
        try {
            JSONArray arr = load();
            arr.put(point);
            // Trim from the front (oldest) if we've grown past the ceiling —
            // losing the very oldest points during an extreme outage is a
            // better trade-off than losing the most recent (most relevant)
            // ones, or running out of storage entirely.
            if (arr.length() > MAX_QUEUED_POINTS) {
                JSONArray trimmed = new JSONArray();
                for (int i = arr.length() - MAX_QUEUED_POINTS; i < arr.length(); i++) trimmed.put(arr.get(i));
                arr = trimmed;
            }
            save(arr);
        } catch (JSONException e) {
            // Never crash the location callback over a queue write failure.
        }
    }

    public synchronized int size() {
        return load().length();
    }

    /** Returns up to `limit` queued points WITHOUT removing them — caller removes via {@link #removeFirst(int)} only after a confirmed successful upload. */
    public synchronized List<JSONObject> peek(int limit) {
        JSONArray arr = load();
        List<JSONObject> out = new ArrayList<>();
        for (int i = 0; i < Math.min(limit, arr.length()); i++) {
            try { out.add(arr.getJSONObject(i)); } catch (JSONException ignored) {}
        }
        return out;
    }

    public synchronized void removeFirst(int count) {
        JSONArray arr = load();
        JSONArray remaining = new JSONArray();
        for (int i = count; i < arr.length(); i++) {
            try { remaining.put(arr.get(i)); } catch (JSONException ignored) {}
        }
        save(remaining);
    }

    private JSONArray load() {
        String raw = prefs.getString(KEY_POINTS, "[]");
        try { return new JSONArray(raw); } catch (JSONException e) { return new JSONArray(); }
    }

    private void save(JSONArray arr) {
        prefs.edit().putString(KEY_POINTS, arr.toString()).apply();
    }
}
