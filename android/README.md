# Android APK (GrapheneOS and other de-Googled devices)

Browser PWA is the primary client. Use this only when you want a sideloadable APK.

DCEngineer does **not** require Google Play Services, Firebase, or FCM. That is intentional for GrapheneOS.

Set `DCE_PUBLIC_URL` (and Capacitor `server.url` if you wrap a live site) to **your** hostname from `.env`.

## Option A — PWA (recommended on GrapheneOS)

1. Open `https://${DCE_HOSTNAME}` (example: `https://dce.example.com`) in Vanadium.
2. Menu → **Install app** / **Add to Home screen**.
3. Grant camera only when scanning serials or taking rack photos.

This uses JWTAuth the same way the desktop browser does.

## Option B — Capacitor APK (no Play Store)

Build the web UI, wrap it, and sideload.

On a Linux build machine with JDK 21, Android SDK, and Node 22:

```bash
cd frontend
npm install
npm install @capacitor/core @capacitor/cli @capacitor/android
npm run build

# Live against your hosted GUI
export DCE_PUBLIC_URL=https://dce.example.com
# set frontend/capacitor.config.ts server.url to the same value
npx cap add android
npx cap sync android

# USB debugging or GrapheneOS *Install unknown apps*
cd android
./gradlew assembleRelease
```

The unsigned APK is at `android/app/build/outputs/apk/release/`. Sign it with your own keystore:

```bash
keytool -genkey -v -keystore dcengineer.keystore -alias dce -keyalg RSA -keysize 4096 -validity 10000
apksigner sign --ks dcengineer.keystore app-release-unsigned.apk
```

Copy the APK to the phone (Syncthing, `adb install`, or a private F-Droid repo). GrapheneOS: Settings → Apps → special access → Install unknown apps for the installer you use.

## Networking

The APK should reach `${DCE_PUBLIC_URL}` over the internet or over your overlay VPN (ZeroTier, Tailscale, Twingate), same as a browser. If you only expose the app on an overlay address, set `DCE_PUBLIC_URL` to that HTTPS URL and install your internal CA on the device.

Do not embed JWT secrets in the APK. Tokens are issued at login and stored in the WebView.
