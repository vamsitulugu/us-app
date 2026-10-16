# 🔍 Twin Hearts — Final App Review & Deployment Checklist

**App:** Twin Hearts (com.uswithlove.app)  
**Repo:** `C:\Users\vamsi\Downloads\US`  
**Live URL:** https://twinhearts.vercel.app  
**Test Login:** vamsitulugu71@gmail.com / Va2500031437@  
**Date:** Oct 16, 2026

---

## 📋 TABLE OF CONTENTS

1. [App Overview](#app-overview)
2. [All Pages & Features](#all-pages--features)
3. [All Buttons & Interactions](#all-buttons--interactions)
4. [Backend API Routes](#backend-api-routes)
5. [Database Schema](#database-schema)
6. [Android Native Features](#android-native-features)
7. [Pro Subscription System](#pro-subscription-system)
8. [Admin Control Center](#admin-control-center)
9. [Issues Found & Fixes Needed](#issues-found--fixes-needed)
10. [Deployment Checklist](#deployment-checklist)
11. [Test Credentials](#test-credentials)

---

## 🏠 APP OVERVIEW

**Twin Hearts** is a premium long-distance relationship app built with:
- **Frontend:** Vanilla JS, HTML5, CSS3 (SPA with iframe micro-apps)
- **Backend:** Node.js + Express
- **Database:** Supabase (PostgreSQL + Storage + Realtime)
- **Mobile:** Capacitor Android (Capacitor v8)
- **Design Theme:** Burgundy/dark glass with hsl(322) accent

---

## 📄 ALL PAGES & FEATURES

### Main SPA Pages (index.html — 29 page divs)

| Page ID | File | Purpose | Type |
|---------|------|---------|------|
| `page-dashboard` | index.html | Main home dashboard | SPA |
| `page-chat` | index.html | Couple chat messaging | SPA |
| `page-ai` | index.html | Twin AI Love Guide (You + Both mode) | SPA |
| `page-vault` | index.html | Secret Vault (PIN-protected media) | SPA |
| `page-settings` | index.html | App settings | SPA |
| `page-profile` | index.html | Profile editing | SPA |
| `page-level` | index.html | Couple level system | SPA |
| `page-period` | index.html | Period tracker | SPA |
| `page-fights` | index.html | Fight log | SPA |
| `page-myspace` | index.html | My Space | SPA |
| `page-study` | index.html | Study together | SPA |
| `page-bucket` | index.html | Bucket list | SPA |
| `page-calendar` | index.html | Calendar | SPA |
| `page-money` | index.html | Money/finance tracker | SPA |
| `page-map` | index.html | Live map | SPA |
| `page-surprise` | index.html | Surprises & Love Capsules | SPA |
| `page-camera` | index.html | Camera capture | SPA |
| `page-globe` | globe.html | Memory Globe (3D Cesium) | Iframe |
| `page-music` | music.html | Music player | Iframe |
| `page-movie` | movie.html | Watch Together | Iframe |
| `page-lovecounter` | lovecounter.html | Love Counter | Iframe |
| `page-collection` | collection.html | Memory Collection | Iframe |
| `page-pro` | pro.html | Pro subscription page | Iframe |
| `page-games` | games.html | Couple Games | Iframe |
| `page-dreamgoals` | dreamgoals.html | Dream Goals | Iframe |
| `page-places` | places.html | Places Memory | Iframe |
| `page-meetplanner` | meetplanner.html | Meet Planner | Iframe |
| `page-dailyroutine` | daily-routine.html | Daily Routine | Iframe |

### Category Hub Pages (6 cat-pages)

| Page | Purpose |
|------|---------|
| `page-catUs` | Profile, Love Counter, Level, Fight Log |
| `page-catMemories` | Camera, Globe, Places, Collection |
| `page-catPlans` | Calendar, Bucket List, Meet Planner, Daily Routine |
| `page-catTogether` | Music, Games, Movie, Study |
| `page-catFuture` | Dream Goals |
| `page-catMyspace` | My Space, Period, Vault |

---

## 🔘 ALL BUTTONS & INTERACTIONS

### Sidebar Navigation
- Home, Chat, Live Map, Us, Memories, Plans, Together, Our Future, My Space
- Twin AI, Pro Upgrade (NEW), Settings

### Dashboard Quick Actions (5 per row now)
- Play All, Shuffle, Download, Search, **Search Online** (NEW)

### Music Page Actions
- Play song, Like, Add to playlist, Download for offline, Sing with lyrics, Sing together (video), Lyrics, Share, Edit details, Delete song
- **Search Online** — search TMDB, add movie with metadata + instant lyrics

### Movie Page Actions
- Choose movie from device, Upload to cloud, Search Online (NEW via TMDB)
- Play/Pause, Seek ±10s, Sync, Chat, Voice Call, Video Call, End Movie
- Subtitles, Screen Fit, Picture in Picture, Sleep Timer, Keep Screen On
- Add to favorites/watchlist, Rate, Review

### AI Page Actions
- YOU mode / BOTH mode switch (BOTH is Pro-gated)
- Send message, Voice input, Quick prompts, Sync

### Vault Actions
- PIN unlock, Add photo/video, Lock, Forgot PIN

### Settings Actions
- Theme toggle, Notifications, Sync, Account management

---

## 🔌 BACKEND API ROUTES

### Public API (`/api/`)

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/auth` | GET, POST | Login, register, verify identity, reset password, vault PIN |
| `/api/data` | GET, POST | Couple shared state (app_state blob) |
| `/api/partner` | — | Partner linking/invitations |
| `/api/profile` | — | Profile management |
| `/api/ai` | POST | AI chat (You mode) — Groq powered |
| `/api/ai-both` | — | AI Both mode (shared two-perspective) |
| `/api/media` | POST, DELETE | Photo/video/audio upload via Supabase Storage |
| `/api/location` | — | Location sharing |
| `/api/route` | — | Route planning |
| `/api/tracking` | — | Location tracking |
| `/api/globe` | GET, POST | Memory Globe trips |
| `/api/chat` | — | Chat messages |
| `/api/call` | — | Call signaling |
| `/api/music` | POST, GET | Music library (songs, playlists) |
| `/api/pro` | GET, POST | Pro status + upgrade requests |
| `/api/recordings` | — | Voice/music recordings |
| `/api/lyrics` | GET, POST | Lyrics cache + auto-fetch (TMDB/LRCLIB) |
| `/api/search` | — | Search songs/memories |
| `/api/presence` | — | Online presence |
| `/api/movie` | — | Watch Together room state |
| `/api/movie-search` | GET | TMDB search + details + providers **(NEW)** |
| `/api/movie-fav` | GET, POST, PATCH, DELETE | Couple movie watchlist **(NEW)** |
| `/api/movie-library` | — | Shared cloud video storage (R2) |
| `/api/meetplanner` | — | Meet planner |
| `/api/daily-routine` | — | Daily routine |
| `/api/support` | — | Support tickets |
| `/api/releases` | — | App releases |
| `/api/flags` | — | Feature flags |

### Admin API (`/api/admin/`)

| Route | Methods | Purpose | Auth |
|-------|---------|---------|------|
| `/api/admin/auth` | POST | Admin login/logout/me | Session cookie |
| `/api/admin/overview` | GET | Dashboard KPIs | Admin |
| `/api/admin/users` | GET, POST, DELETE | User management | Admin |
| `/api/admin/couples` | GET, POST | Couple management | Admin |
| `/api/admin/releases` | — | Release management | Admin |
| `/api/admin/notifications` | — | Push notifications | Admin |
| `/api/admin/pro` | GET, POST | **Pro upgrade requests + approve/reject** **(NEW)** | Admin |
| `/api/admin/flags` | — | Feature flags | Admin |
| `/api/admin/health` | — | Error logs | Admin |
| `/api/admin/support` | — | Support tickets | Admin |

---

## 💾 DATABASE SCHEMA

### Core Tables
- `users` — id, name, email, phone, password_hash, couple_id, role, account_status
- `couples` — id, user1_name, user2_name, anniversary, paired, vault_pin, **pro_plan, pro_expires_at, pro_activated_at, pro_activated_by (NEW)**
- `app_state` — couple_id, state (shared JSON blob)
- `watch_sessions` — couple_id, movie titles, durations, ready status, pairing

### New Tables (Pro + Movie Features)

| Table | Purpose |
|-------|---------|
| `pro_upgrade_requests` | Payment requests (couple_id, plan, status, paid_by, partner, txn_id, proof_url) |
| `movie_favorites` | Couple watchlist (tmdb_id, title, year, genre, poster, status, added_by) |

---

## 📱 ANDROID NATIVE FEATURES

### Already Existing Plugins
| Plugin | Capability |
|--------|------------|
| SplashScreen | Custom splash with hold-until-ready |
| StatusBar | Native bar coloring (Android 15+ edge-to-edge) |
| BarColors | Web-controlled status/nav bar colors |
| InstallGuard | Fresh install detection (anti-backup-restore) |
| CallAudio | Earpiece/speaker routing, ringtone, call audio modes |
| BackgroundLocation | Foreground service location tracking |
| BootReceiver | Auto-restart tracking after reboot |

### New Plugins Added (8 total)
| Plugin | Capability |
|--------|------------|
| BiometricAuth | Fingerprint/Face ID for vault/pro |
| DeviceInfo | App/device info, launch other apps |
| NetworkInfo | WiFi/cellular status |
| Clipboard | Copy/paste |
| LocalNotifications | Schedule reminders without FCM |
| PictureInPicture | PiP mode for video/movies |
| NativeToast | Native Android toasts |
| Keyboard | Show/hide/resize keyboard |

### Android Config Updates
- Share Target intent filters (receive shared photos/videos from other apps)
- App Shortcuts (Chat, Memory Globe, Go Pro, Secret Vault)
- Picture-in-Picture enabled
- All plugins registered in MainActivity.java

---

## 💎 PRO SUBSCRIPTION SYSTEM

### Pricing
| Plan | Price | Billing |
|------|-------|---------|
| Monthly Pro | ₹99 | Every 30 days |
| Lifetime Pro | ₹499 | One-time |

### Pro Features (gated)
- Music: Add songs (Pro-gated)
- Movies: Add from cloud (Pro-gated)
- AI: BOTH mode (Pro-gated)
- Memory Globe: Pin memories (Pro-gated)

### Payment Flow (Manual/UPI)
1. User picks plan → Pay via UPI QR → "I've Paid"
2. Fill paid person + partner details + upload payment screenshot
3. Admin reviews in Admin → Pro Upgrades
4. Admin clicks Approve (Monthly ₹99 or Lifetime ₹499)
5. Pro activates for **both partners** automatically
6. Pro badge shows on couple widget

### QR Code
- Generates UPI QR via qrserver API
- UPI ID: `7077745442@upi` (Name: Tulugu Vamsi)
- **QR Scanner** built-in — scan any UPI QR, auto-fills transaction details

### Admin Approval Flow
- Admin → Pro Upgrades page
- Table shows all requests: couple names, plan, paid-by, partner, txn ID, status, proof link
- Approve button → activates Pro (monthly=30 days, lifetime=forever)
- Reject button → with optional reason

---

## 🎬 MOVIE SEARCH & METADATA (NEW)

### Features
- Search movies via TMDB (free API — https://www.themoviedb.org/)
- View details: genres, runtime, director, overview, rating
- See where to stream (free/flatrate/ads providers)
- Add to couple's shared watchlist
- Auto-fetch lyrics for added movies

### Setup Required
1. Get free TMDB API key at https://www.themoviedb.org/settings/api
2. Add `TMDB_API_KEY` to `.env`
3. Run `migrations/movie_favorites.sql` in Supabase

---

## ⚡ PERFORMANCE IMPROVEMENTS

| Improvement | Detail |
|-------------|--------|
| Rate limiters | authLimiter (20/15min IP), apiLimiter (60/min IP) wired up |
| Lyrics pre-fetch | Background batch pre-fetch of all library lyrics |
| Duplicate route removed | `/api/globe` was registered twice |
| Dead code removed | 7 files deleted (signal.js, 3 audio files, index_patch.js, movie.css, movie-collection.css) |
| Image editor | Crop, rotate, zoom, filters for photos |

---

## ⚠️ ISSUES FOUND & FIXES APPLIED

| Issue | Fix | Status |
|-------|-----|--------|
| Search Online button not clickable (music page) | Added `music-search.js` script to `music.html` iframe | ✅ Fixed |
| 4 buttons per row (quick actions) | Changed CSS to `repeat(5,1fr)` | ✅ Fixed |
| Duplicate `/api/globe` mount | Removed duplicate | ✅ Fixed |
| Missing admin env vars | Added to `.env` + `.env.example` | ⚠️ Needs real values |
| Missing TMDB API key | Added route, needs key in env | ⚠️ Needs key |
| Dead/orphaned files | Removed 7 files | ✅ Fixed |

### Still Needed Before Deploy
1. **Set `TMDB_API_KEY`** in `.env` — get free key at themoviedb.org
2. **Set real `ADMIN_PASSWORD_HASH`** — generate with `bcryptjs.hashSync('your-password', 10)`
3. **Run `migrations/movie_favorites.sql`** in Supabase SQL Editor
4. **Run `migrations/pro_subscription.sql`** in Supabase SQL Editor (for Pro feature)
5. **Set real UPI ID** in `public/js/pro-card.js` (currently `7077745442@upi`)
6. **Build APK:** `cd android && ./gradlew assembleRelease`

---

## 🔑 TEST CREDENTIALS

| Field | Value |
|-------|-------|
| Email | vamsitulugu71@gmail.com |
| Password | Va2500031437@ |

**Note:** These are the app user credentials. Admin credentials are separate — set via `ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH` env vars.

---

## 🚀 DEPLOYMENT CHECKLIST

### Backend
- [ ] Set `TMDB_API_KEY` in Render/Vercel env vars
- [ ] Set `ADMIN_SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH` in env vars
- [ ] Run `migrations/pro_subscription.sql` in Supabase
- [ ] Run `migrations/movie_favorites.sql` in Supabase
- [ ] Deploy backend code

### Frontend (Web/PWA)
- [ ] Deploy `public/` to Vercel
- [ ] Verify all pages load
- **Note:** `@aws-sdk/client-s3` is missing locally (pre-existing issue in `movie-library.js`) — this is unrelated to new changes

### Android APK
- [ ] `cd android && ./gradlew assembleRelease`
- [ ] Test Share Target, App Shortcuts, Biometric, PiP
- [ ] Submit to Play Store

---

## 📁 FILES CHANGED/ADDED (This Session)

### New Files
- `migrations/movie_favorites.sql`
- `migrations/pro_subscription.sql`
- `routes/movie-search.js`
- `routes/movie-favorites.js`
- `public/js/image-editor.js`
- `public/js/android-features.js`
- `public/js/movie-search-ui.js`
- `public/js/lyrics-prefetch.js`
- `public/pro.html`
- `PLACEMENT_GUIDE.md`
- `.env.example`
- `android/app/src/main/java/com/uswithlove/app/BiometricAuthPlugin.java`
- `android/app/src/main/java/com/uswithlove/app/DeviceInfoPlugin.java`
- `android/app/src/main/java/com/uswithlove/app/NetworkInfoPlugin.java`
- `android/app/src/main/java/com/uswithlove/app/ClipboardPlugin.java`
- `android/app/src/main/java/com/uswithlove/app/LocalNotificationsPlugin.java`
- `android/app/src/main/java/com/uswithlove/app/PictureInPicturePlugin.java`
- `android/app/src/main/java/com/uswithlove/app/NativeToastPlugin.java`
- `android/app/src/main/java/com/uswithlove/app/KeyboardPlugin.java`
- `android/app/src/main/res/xml/shortcuts.xml`

### Modified Files
- `server.js` — rate limiters + 2 new routes
- `public/index.html` — script includes, Pro nav, Pro badge, edit function
- `public/music/library.js` — search-online button + handler + lyrics warm-up
- `public/music/music.css` — 5 columns grid
- `public/music.html` — music-search.js include
- `public/movie.html` — movie-search-ui.js + search button
- `public/movie-collection.js` — library reload listener
- `public/both-mode.js` — Pro gate for BOTH mode
- `public/globe.html` — Pro gate + script include
- `public/movie.html` — Pro gate + script include
- `admin/index.html` — pagePro container
- `admin/admin.js` — Pro icon, nav, renderer
- `admin/admin.css` — pending badge
- `capacitor.config.json` — plugin configs
- `android/app/src/main/AndroidManifest.xml` — Share Target + shortcuts
- `android/app/src/main/java/com/uswithlove/app/MainActivity.java` — 8 plugins registered + share intent
- `android/app/src/main/res/values/strings.xml` — shortcut labels
- `.env` — admin auth vars
- `public/js/pro-card.js` — rewritten with UPI 7077745442 + QR scanner

### Deleted Files (Dead Code)
- `routes/signal.js`
- `public/js/audio/sound-engine.js`
- `public/js/audio/sound-library.js`
- `public/js/audio/audio-integration.js`
- `public/index_patch.js`
- `public/movie.css`
- `public/movie-collection.css`

---

## 📝 NEXT STEPS FOR YOU

1. **Run the SQL migrations** in Supabase (both files)
2. **Set env vars** (TMDB_API_KEY, ADMIN_SESSION_SECRET, ADMIN_PASSWORD_HASH)
3. **Build the APK** for Android
4. **Test the flow:** Register → Subscribe to Pro → Add movies via TMDB → Admin approves → Both partners get Pro

---

**Note:** I cannot directly access `twinhearts.vercel.app` or log in with your credentials. This review is based on a thorough codebase analysis. The background subagent is performing an additional detailed audit — check for its output for any additional findings.
