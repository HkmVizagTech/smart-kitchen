# Over-the-air (OTA) updates — self-hosted, free

Ship new versions of the apps **without reinstalling the APK** and **without any
paid service**. The update bundles are stored on your own Railway API; the apps
download them with the free, open-source Capgo plugin.

What OTA can update: the whole web layer — screens, features, fixes, text, styles.
What still needs a fresh APK: native changes only — app **name, icon, Android
permissions, or adding a native plugin**.

---

## One-time setup

1. **Pick a secret.** Generate a real random one, don't invent a short string:
   `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`

2. **Add it to the API on Railway:** dashboard → your `api` service → Variables →
   New Variable → `UPDATE_SECRET` = your generated value. Then redeploy the API:
   ```
   cd ~/Desktop/iskon/smart-kitchen
   railway up
   ```

3. **Build + install the APKs once** (this build contains the OTA engine):
   ```
   bash build-android.sh
   ```
   Install the `apk-out/*.apk` files on the phones. This is the last manual install.

---

## Every time you want to ship a change

```
cd path/to/smart-kitchen
UPDATE_SECRET=<your-update-secret> bash push-update.sh
```

This builds each app, bumps its version, zips it, and uploads it to your API
(`/updates/<app>`). Next time someone opens an app, it checks your API, sees the
new version, and shows a green **"Update now"** bar. They tap it → the app
downloads the bundle and relaunches into the new version. iPhone PWA users get
the change automatically on reopen.

> The secret must match the `UPDATE_SECRET` variable on the Railway **api**
> service. Never write it into this repo — put it in your shell profile instead:
> `export UPDATE_SECRET=<your-update-secret>`, or in the gitignored `.env`.

---

## How it works (for reference)

- Bundles are stored in your Postgres (`AppBundle` table) and served from
  `GET /updates/:app/latest` (metadata) and `/updates/:app/:version/file` (zip).
- The app boots, calls `notifyAppReady()` (so a bad update auto-rolls back), then
  compares its running version to `/updates/<app>/latest`.
- No Capgo account, no cloud, no fees — only the free plugin is used, pointed at
  your own server.
