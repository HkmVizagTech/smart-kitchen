# Deploy the 4 web apps to Railway

This puts each app on its own public HTTPS URL — for browser use and for the
**iPhone PWA install** (open the link in Safari → Add to Home Screen). The apps
already call your live API via `VITE_API_URL`, so this is just hosting the
front-ends.

Each app becomes its own small Railway service that serves the built files at
its own URL (so all the existing `/`-rooted paths and the PWA manifest work
with zero code changes).

| App | Railway service to create | Config file (already in repo) |
|-----|---------------------------|-------------------------------|
| Booking | `web-booking` | `railway.booking.json` |
| Kitchen | `web-kitchen` | `railway.kitchen.json` |
| Verification | `web-verification` | `railway.verify.json` |
| Super Admin | `web-admin` | `railway.admin.json` |

---

## One-time setup (in the Railway dashboard, same project as the API)

For **each** of the four apps:

1. **Create the service:** project canvas → **+ New → Empty Service** → name it
   exactly as in the table (`web-booking`, `web-kitchen`, `web-verification`,
   `web-admin`).
2. **Point it at its config file:** open the service → **Settings** → find
   **Config File** (a.k.a. "Railway Config File") → set it to the matching file
   from the table (e.g. `railway.booking.json`). This tells Railway to build just
   that app and serve it (instead of running the API).
3. **Add the API URL variable:** service → **Variables** → New Variable →
   `VITE_API_URL` = `https://api-production-24df3.up.railway.app`
   (this gets baked into the build so the app talks to your live API).

---

## Deploy

From the project folder:

```
cd ~/Desktop/iskon/smart-kitchen
bash deploy-web.sh
```

(or one at a time: `bash deploy-web.sh web-admin`)

Each runs `railway up --service <name>`, which builds that app and starts a tiny
static server on Railway's port.

---

## Get the public links

For each web service → **Settings → Networking → Generate Domain**. You'll get
URLs like:

- `https://web-booking-production-xxxx.up.railway.app`
- `https://web-kitchen-production-xxxx.up.railway.app`
- `https://web-verification-production-xxxx.up.railway.app`
- `https://web-admin-production-xxxx.up.railway.app`

Share each link with the right role. On iPhone, open the link in **Safari** →
**Share → Add to Home Screen** to install it like an app.

---

## Notes

- Updating the web version later: just run `bash deploy-web.sh` again (it
  rebuilds and redeploys). The Android apps still update via `push-update.sh`.
- If a build fails, open that service's **Deployments** log and paste the error.
- The API and database services are unaffected — these are separate, static-only
  services.
