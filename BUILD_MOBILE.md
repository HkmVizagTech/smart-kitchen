# Mobile apps — Android (native APK) + iPhone (PWA)

Four separate apps, installed **without any app store**:

| App | Folder | App ID | Android | iPhone |
|-----|--------|--------|---------|--------|
| Booking | `apps/booking-web` | `com.akshayapatra.booking` | native APK | PWA |
| Kitchen | `apps/kitchen` | `com.akshayapatra.kitchen` | native APK | PWA |
| Verification | `apps/verification` | `com.akshayapatra.verify` | native APK | PWA |
| Super Admin | `apps/admin` | `com.akshayapatra.admin` | native APK | PWA |

- **Android** → a real `.apk` the user downloads from a link and installs by hand.
- **iPhone** → installed from the same web link via Safari → **Add to Home Screen** (a real native iOS app cannot be link-installed without a paid Apple account, so PWA is the free, unlimited route).

---

## 0. One-time: point the apps at your public API

Inside a phone, `localhost` is the phone itself — so the apps must call your **public API URL**, not localhost.

1. Deploy the API (`apps/api`) so it has a public HTTPS URL. You already use Railway for the database — add the API there too; Railway gives a URL like `https://smart-kitchen-api.up.railway.app`.
2. In **each** app folder create a file named `.env` containing that URL:

   ```
   # apps/booking-web/.env  (and the same in kitchen / verification / admin)
   VITE_API_URL=https://YOUR-API.up.railway.app
   ```

   Use the **https** URL. (Without `.env`, the apps fall back to `http://<page-host>:4000`, which only works on your dev Mac over Wi-Fi.)

---

## 1. Install the toolchain (one-time, on your Mac)

- **Node** (already have it) and **pnpm**.
- **Android Studio** → during setup install the **Android SDK** and **SDK Platform-Tools**.
- **JDK 17** (Android Studio bundles one; or `brew install openjdk@17`).
- Open Android Studio once so it finishes downloading the SDK.

Then install the new dependencies (adds Capacitor):

```
cd smart-kitchen
pnpm install
```

---

## 2. Build an APK (do this per app — example: Booking)

```
cd smart-kitchen

# a) generate the native app icons + splash from apps/booking-web/assets/icon.png
pnpm --filter @sk/booking-web exec capacitor-assets generate --android

# b) first time only: create the native android/ project
pnpm --filter @sk/booking-web cap:add

# c) build the web app, sync it into android, and produce the APK
pnpm --filter @sk/booking-web apk
```

The installable file lands at:

```
apps/booking-web/android/app/build/outputs/apk/debug/app-debug.apk
```

That **debug APK installs fine by sideloading**. Repeat with the other three:

```
pnpm --filter @sk/kitchen      exec capacitor-assets generate --android && pnpm --filter @sk/kitchen      cap:add && pnpm --filter @sk/kitchen      apk
pnpm --filter @sk/verification exec capacitor-assets generate --android && pnpm --filter @sk/verification cap:add && pnpm --filter @sk/verification apk
pnpm --filter @sk/admin        exec capacitor-assets generate --android && pnpm --filter @sk/admin        cap:add && pnpm --filter @sk/admin        apk
```

> After the first `cap:add`, you only need `pnpm --filter <app> apk` to rebuild.

### Optional: a signed release APK (recommended for real distribution)

A debug APK is fine for testing/sideloading. For a cleaner, stable build:

```
# create a keystore once
keytool -genkey -v -keystore ap-release.keystore -alias ap -keyalg RSA -keysize 2048 -validity 10000
```

Put the signing info in `apps/<app>/android/key.properties`, then:

```
pnpm --filter @sk/booking-web apk:release
# -> android/app/build/outputs/apk/release/app-release.apk
```

(Full signing steps: https://capacitorjs.com/docs/android/deploying-to-google-play#sign — you only need the signing part, not the Play upload.)

---

## 3. Distribute (no store)

1. Put the four `.apk` files somewhere the phone can download them over HTTPS — e.g. host them and link from the web platform's "Get the app" page (the next thing I can build for you), or any file host / your server.
2. Share the link. On the phone:
   - Tap the APK link → download.
   - Android asks to allow "install unknown apps" for the browser → allow → **Install**.
   - The app appears on the home screen with its own icon.

---

## 4. iPhone (PWA) — already done, no build needed

Send the iPhone user the **web link** for their app (e.g. `https://booking.yourdomain`), then:

1. Open it in **Safari**.
2. Tap **Share** → **Add to Home Screen**.
3. The app icon appears and opens full-screen, like an app.

A floating "Add to Home Screen" hint button already shows on iPhone Safari to guide them.

---

## 5. Updating an app later

- **Android:** rebuild the APK (`pnpm --filter <app> apk`), share the new file, users reinstall over the old one.
- **iPhone (PWA):** nothing to reinstall — it updates automatically the next time it's opened online.

---

## Notes

- The `android/` folders are generated; they can be re-created anytime with `cap:add`. Safe to commit or to `.gitignore`.
- Keep the API URL (`.env`) pointing at HTTPS — Android blocks plain-HTTP API calls by default.
- The same four web apps still run in any browser (`pnpm web`) — the native APK and PWA are just wrappers around them.
