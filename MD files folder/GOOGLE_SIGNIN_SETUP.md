# Continue with Google — setup (web + Android)

## How it behaves
1. Person taps **Continue with Google** (Sign In tab or Sign Up tab).
2. Server checks the Google token (`POST /api/auth/google`).
   - Email already has an account → signed in immediately (nothing else to type).
   - New email → "Almost there" step: name (pre-filled), Girl/Boy, phone, password, vault PIN + confirm.
     Then `POST /api/auth/google/complete` creates the account exactly like the normal sign-up.

## One-time Google Cloud setup (only you can do this)
1. Google Cloud Console → APIs & Services → OAuth consent screen (External, add app name + your email).
2. Credentials → Create credentials → OAuth client ID → **Web application**.
   - Authorized JavaScript origins: your site (e.g. `https://us-app-av6d.onrender.com` and your custom domain, plus `http://localhost:3000` for testing).
   - Copy the **Client ID**. This one id is used by web AND Android.
3. Credentials → Create → OAuth client ID → **Android** (needed so Google lets the app ask for sign-in):
   - Package name `com.twinhearts.app`
   - SHA-1 of your debug key AND your release/Play signing key
     (`./gradlew signingReport`; for Play App Signing copy the SHA-1 from Play Console → App integrity).

## Server
- Env var `GOOGLE_CLIENT_ID` = the Web client id (comma-separate if you ever have several).
- Optional `GOOGLE_SIGNUP_SECRET` = any long random string (falls back to `SUPABASE_SERVICE_KEY`).
- Run `migrations/google_auth.sql` in the Supabase SQL editor (optional but recommended).
- `npm install` (adds `google-auth-library`).
- If `GOOGLE_CLIENT_ID` is not set, the Google buttons stay hidden.

## Android
- In `local.properties` add: `GOOGLE_WEB_CLIENT_ID=<the same Web client id>`
- If it is missing, the Google button is hidden.
