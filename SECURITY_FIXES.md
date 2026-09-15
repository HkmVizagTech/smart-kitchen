# Security fixes — what changed and what you still have to do

Applied 12 Sep 2026. Every change below compiles clean (`tsc` on the API and all
four apps) and was smoke-tested against a running server.

---

## Part 1 — What the code now does

### The API is no longer open to the public

Before: **every** `/admin`, `/orders`, `/packing` and `/verification` route
answered anyone on the internet with no token at all. The user list, password
resets, packing factors and order history were all readable and writable by
anybody who knew the URL.

Now every route declares who may call it, via `apps/api/src/guard.ts`:

| Routes | Who may call |
|---|---|
| `/health`, `/updates/:app/latest`, `/updates/:app/:version/file` | anyone (liveness + app bundle downloads) |
| `/auth/login`, `/auth/signup` | anyone (signup is role-restricted, see below) |
| `/booking-menu`, `/orders` (GET), `/units/:id/*`, `/bookings/recent`, `/orders/:id/closeout-items`, `/booking/progress` | any signed-in user |
| `/notifications/*` | any signed-in user, scoped to their own rows |
| `/orders` (POST), `/orders/consumption` | `BOOKING` |
| `/orders/:id/status`, `/orders/status/bulk`, `/packing/*` | `KITCHEN_ADMIN` |
| `/verification/pending`, `/verification/done`, `/orders/verify` | `VERIFICATION_ADMIN` |
| everything under `/admin/*` | `SUPER_ADMIN` |

`SUPER_ADMIN` passes every check. The `/admin/*` guard is registered as a hook on
the whole route file, so a route added there later cannot accidentally ship
unprotected.

### Nobody can make themselves an admin

`POST /auth/signup` took `role` straight from the request body. Sending
`"role": "SUPER_ADMIN"` created a full administrator. Self-signup is now limited
to `BOOKING` (configurable via `SELF_SIGNUP_ROLES`, which should never include
`SUPER_ADMIN`). Kitchen, verification and admin accounts are created by a Super
Admin in the admin console — the **Create account** tab is hidden in those three
apps and replaced with "Need an account? A Super Admin creates it for you."

Minimum signup password went from 4 characters to 8.

### User ids are read from the session, not the request body

- `POST /orders/verify` accepted `verifiedBy` as a number in the body, so a
  verification could be attributed to anyone. It now comes from the signed-in
  session.
- `POST /orders` accepted `bookedById` the same way. Same fix.

### Tokens expire and can be invalidated

Login tokens had no expiry and no way to revoke them — one leaked token was
valid forever. They now carry a 30-day expiry (`TOKEN_TTL_DAYS`), and signature
comparison is constant-time. Changing `AUTH_SECRET` invalidates every token
immediately, which is your emergency "log everyone out" switch.

The API also **refuses to start in production without `AUTH_SECRET`**. It used to
fall back to the string `"dev-secret"`, which is in the source — meaning anyone
who read this repo could forge an admin session.

### The Excel download still works

Locking `/packing/excel` would normally break it, because the button is a plain
`<a href>` and a browser navigation cannot send an `Authorization` header. The
guard therefore also accepts `?token=`, and the kitchen and admin apps now append
the signed-in user's token to that link. This applies to the download route only.

### Deadlines run on India time

`packages/logic/src/windows.ts` used the container clock. Railway runs UTC, so:

- the 11:00 AM lunch cutoff actually fired at **16:30 IST**;
- between midnight and 05:30 IST the server still thought it was yesterday, so a
  legitimate "today for tomorrow" booking made late at night was rejected.

Everything is now evaluated in `Asia/Kolkata` (override with `APP_TIMEZONE`).
The new `apps/api/src/time.ts` also separates the two clocks that were being
confused: *the user's day* (India) versus *the day an order is stored under*
(UTC midnight, because dates come from `"YYYY-MM-DD"` strings). The admin
dashboard's today/tomorrow and the report date range were rebuilt on it.

### Verified behaviour

```
unauthenticated /admin/users                    -> 401
BOOKING token   /admin/users                    -> 403
KITCHEN token   /admin/users                    -> 403
SUPER_ADMIN     /admin/users                    -> reaches the handler
BOOKING         /verification/pending           -> 403
BOOKING         /packing/preview                -> 403
expired token   /admin/users                    -> 401
forged token    /admin/users                    -> 401
signup as SUPER_ADMIN                           -> 403
/health, /updates/_health                       -> 200 (still public)
excel ?token=<kitchen>                          -> reaches the handler
excel ?token=<booking>                          -> 403
```

Timezone cases: lunch at 10:30 IST allowed, 11:30 IST rejected, 16:00 IST
rejected (the old bug allowed it), tiffin at 02:00 IST for tomorrow allowed.

---

## Part 2 — What only you can do

Code changes cannot undo a leaked credential. These three steps are yours, in
the Railway dashboard. **Do them before or at the same time as the deploy.**

### 1. Rotate the database password

Railway dashboard → **Postgres** service → **Settings → Rotate password**
(or delete and recreate the `PGPASSWORD` variable). Then on the **api** service,
make sure `DATABASE_URL` is the reference, not a pasted string:

```
DATABASE_URL = ${{Postgres.DATABASE_URL}}
```

Set that way it picks up the new password automatically. A hard-coded connection
string will silently keep using the old one and the api will stop connecting.

### 2. Set a fresh AUTH_SECRET

On the **api** service → **Variables**:

```
AUTH_SECRET = <the value from SECRETS.local.md>
```

A freshly generated value is waiting in `SECRETS.local.md` in this folder. That
file is gitignored and must never be committed. Generate another any time with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Everyone gets signed out once, including anyone holding a forged token. That is
the point.

### 3. Rotate UPDATE_SECRET

The current one is 16 characters and has been sitting in shell history. On the
**api** service:

```
UPDATE_SECRET = <the value from SECRETS.local.md>
```

Use the same value when you run `push-update.sh`. The old secret was written in
plaintext inside `CAPGO_SETUP.md` — it has been removed from that file, but it
is in the zip your developer sent and in shell history, so treat it as burnt.

### 4. Change the four seed passwords

`booking` / `kitchen` / `verify` / `admin` still have the passwords printed in
`packages/db/prisma/seed.ts`. Sign in as `admin`, go to **Users**, and use
**Reset password** on each. Delete or deactivate any you do not need.

### 5. Treat the old `.env` as burnt

The repo-root `.env` in the zip your developer sent holds the live database URL
and the old signing secret. Anyone who has that zip has your database. After
steps 1–3 it is harmless, but until then assume it is compromised. `.env` is
already in `.gitignore` — keep it there and never commit it.

---

## Part 3 — Deploying these changes

```bash
# from the smart-kitchen folder
railway up --service api

railway up --service web-booking   --detach
railway up --service web-kitchen   --detach
railway up --service verification  --detach
railway up --service admin         --detach
```

All five must go out. The front-ends changed too — the Excel link and the
signup tabs live in the built bundles, not on the server.

**Order matters:** set the Railway variables *first*. If you deploy the api
without `AUTH_SECRET` it will refuse to start, by design.

After deploying, confirm the lock actually took:

```bash
curl -i https://api-production-24df3.up.railway.app/admin/users
# expect: 401 {"error":"Sign in to continue."}
```

If that still returns your user list, the deploy did not land.

---

## Still open (not fixed here)

- **Emergency orders bypass approval.** `isEmergency` skips every window check
  and there is no approval endpoint, so anyone with a booking account can place
  an unlimited number of unscheduled orders. Needs a product decision first: who
  approves, and what happens while it is pending?
- **Bookers don't choose their route.** Orders are auto-assigned to the first of
  the six routes that is free for that date and session. If routes map to real
  units, this is wrong and should be changed before go-live.
- **OTA bundles accumulate in Postgres.** Every release writes a few MB into the
  `AppBundle` table and nothing prunes it.
- **No rate limiting on `/auth/login`.** Passwords can be guessed as fast as the
  network allows. `@fastify/rate-limit` on the auth routes is a small change.
