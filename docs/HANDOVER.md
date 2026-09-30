# Smart Kitchen — Handover Brief

Compiled from `iskon.zip` and verified against the live Railway deployment, 12 Sep 2026.

**Verification note:** the app versions in the zip match the OTA bundles your live API is
currently serving (admin 0.1.6, booking 0.1.3, kitchen 0.1.2, verification 0.1.2).
This code *is* what is deployed. Nothing is missing.

---

## 1. What the system is

A **meal indent & packing system** for a central kitchen that cooks for six delivery
routes: `Unit-1`, `Unit-2`, `Unit-3`, `Unit-4`, `Visakha`, `Others`.

Each route books plate counts a day ahead. The kitchen needs those counts converted
into cookable quantities (kg of sambar, number of idlys) and split across physical
vessels. After delivery each route reports what was actually eaten, and a verification
team signs it off before that route may book again.

Internally the code is branded **"Akshaya Patra Kitchen"** and the generated Excel says
**"Touch Stone Foundation — Vishakhapatnam" / "Brandix Delivery Sheet"**. That is
leftover branding from the reference spreadsheet the developer built against — not
something you have to keep.

### The core loop

| # | Who | Does what |
|---|---|---|
| 1 | Booking | Enters per-dish plate counts for tomorrow's tiffin or dinner (or a headcount for today's lunch) |
| 2 | Kitchen | Sees the day's orders, downloads the packing sheet, marks preparing → dispatched → delivered |
| 3 | Booking | Closes the meal out: consumed vs. ordered per dish + mandatory taste & quality feedback |
| 4 | Verification | Reviews the close-out, approves or returns it |
| 5 | System | Approval closes the order and unlocks that route's next booking |

---

## 2. Which Railway service is which

All five services deploy **the same monorepo**. What makes them different is one
dashboard setting per service — **Settings → Config File** — pointing at a different
`railway.*.json` in the repo root. That file decides which app gets built and how it starts.

| Railway service | URL | What it actually is | Config file | Source folder |
|---|---|---|---|---|
| **api** | `api-production-24df3` | Fastify + Prisma backend. The only service that touches Postgres. Serves all four apps, generates the Excel, stores OTA bundles. | `railway.json` | `apps/api` |
| **web-booking** | `hkbooking` | Booking portal. New Booking · My Bookings · Close a Meal. | `railway.booking.json` | `apps/booking-web` |
| **web-kitchen** | `hkkitchen` | Kitchen screen. Orders for a cooking date + Packing Sheet tab with the Excel download. | `railway.kitchen.json` | `apps/kitchen` |
| **verification** | `hkverification` | Two lists — To verify (pending close-outs) and Payments (verified history). Approve / return. | `railway.verify.json` | `apps/verification` |
| **admin** | `hkadmin` | Super Admin console. Dashboard, Orders, Packing, Reports, Dishes, Vessels, Units, Users, Settings. | `railway.admin.json` | `apps/admin` |
| **Postgres** | internal + public proxy | The database, with `postgres-volume` attached. | — | `packages/db` |

The four web services are **not** running React on the server. They run
`serve -s apps/<app>/dist` — a tiny static file server. Their only link to the backend
is `VITE_API_URL`, which is **baked in at build time**. Change the API's URL and all
four must be *rebuilt*, not just restarted.

---

## 3. Why the services show no Git source

There is no `.git` folder anywhere in the zip. The developer deployed with
`railway up`, which uploads the current folder straight to Railway's builder. That is
why Railway shows *"railway up · via CLI"* instead of a commit, and why **Connect Repo**
is still an empty button on every service.

Practically: **this zip is the only copy of the source that exists.** No history, no
branches, and nobody can deploy without it. Getting it into GitHub and connecting each
service to that repo is the highest-value thing you can do first — after that, deploys
happen on push and the developer's laptop stops being a dependency.

### Deploying today, until Git is wired up

From the `smart-kitchen` folder, with the Railway CLI logged in and the project linked:

```bash
# backend
railway up --service api

# the four front-ends (this is what deploy-web.sh runs)
railway up --service web-booking   --detach
railway up --service web-kitchen   --detach
railway up --service verification  --detach
railway up --service admin         --detach
```

The per-service **Config File** setting is already correct in your dashboard. Don't
change it, or a front-end service will start running the API instead.

### Variables each service needs

- **api** — `DATABASE_URL` (set it to `${{Postgres.DATABASE_URL}}`, not a pasted string),
  `AUTH_SECRET`, `UPDATE_SECRET`. `PORT` is injected by Railway.
- **the four web services** — `VITE_API_URL` = the api service's public URL.

One wrinkle: `.railwayignore` excludes `node_modules` and `dist` but **not** `.env`.
Every `railway up` uploads the repo-root `.env` — which in this zip holds a live
database URL — into the build. Railway's own variables take priority over it, so
nothing is broken, but the credential travels with every deploy.

---

## 4. The logic that will surprise you

Most behaviour people will complain about lives in three small places:
`packages/logic/src/windows.ts`, the order-creation handler in
`apps/api/src/routes/orders.ts`, and `packages/logic/src/packing.ts`.

### Order windows
- **Tiffin & dinner** — today for tomorrow only. Exactly one day ahead; two days ahead is rejected.
- **Lunch** — same day, before 11:00, headcount only, no dish list.
- **Emergency** — skips every window check. The docs say it needs super-admin approval;
  **no approval endpoint was ever built**, so an emergency order goes straight through.

### The reorder gate
This is the loop the whole system exists to enforce: **order → eat → report what was
consumed → rate it → only then order again.**

A booker's *first* order of a meal is free. Every order after that is refused with `409`
until the previous order **in that same meal** has been closed out — consumption submitted
**and** feedback submitted. The refusal names the order, the route, the date and what is
still missing, and `GET /me/booking-status` returns the same answer per meal so the New
Booking screen can grey out a meal before anyone fills in a form.

Three things about how strict it is, each deliberate:

- **Per meal, not across meals.** Tiffin, lunch and dinner are separate chains. A shared
  gate deadlocks: book tiffin + dinner for tomorrow, close out tiffin in the morning, and
  dinner is not delivered until evening — so you could not book the next day's tiffin
  before the cutoff.
- **Close-out, not verification.** Requiring an *approved* verification would put the
  verification team on the critical path of every booking; miss it before the cutoff and
  that booker cannot order. Verification stays downstream, as the finance/accuracy step.
- **Emergency orders are exempt**, and an emergency order never becomes the thing blocking
  someone's next booking.

Where it lives: `blockingOrder()` in `apps/api/src/routes/orders.ts`, enforced in
`POST /orders` and reported by `GET /me/booking-status`.

There is also an **older per-route gate**, `GET /units/:id/can-order` — "this route has an
order not yet `CLOSED`". It is still there and the kitchen screens read it, but it is
**advisory only**: nothing refuses an order because of it. If a route looks stuck, that is
this gate, and it clears when the order is verified.

⚠️ **An order left open blocks its booker forever.** Before switching the gate on in a live
database, find them — `SELECT id, "unitId", date, session, "bookedById" FROM "Order" o
WHERE NOT EXISTS (SELECT 1 FROM "Consumption" c WHERE c."orderId" = o.id)` — and either
close them out or delete them.

### Routes are auto-assigned, but the booker can change it
When someone books without naming a route, the API assigns the order to *the first of the
six routes that has no order yet for that date and session*. Six bookings fill all six
routes; the seventh is rejected with *"All 6 routes are already booked."*

Since September 2026 a booker may also send `unitId` to pick a route themselves — the New
Booking screen shows the auto-assigned one with a picker to override it. A route already
taken for that date and session is refused; the auto-assignment is only the default.

### Accompaniments are derived, never booked
Sambar and FG Chutney are flagged `accompaniment`. The booker never enters them — the API
sets their plate count to the sum of all Item 1 + Item 3 solid plates, matching the real
rule that sambar accompanies both idly and wada. If a chutney quantity ever looks wrong on
the sheet, check this derivation before blaming the packing factors.

### Plates → quantities → vessels
- **Counted dishes** (idly, wada, bhonda): `packingFactor × plates` pieces, then filled
  greedily into the largest vessel, remainder rounded **up** into the smallest vessel that covers it.
- **Weight dishes**: `packingFactor × plates ÷ 1000` kg, then `÷ packingVesselKg` for the vessel count.
- Vessel sizes are configurable per session — live values: morning 200/160/120/80/40,
  evening 160/120/100/40.
- The Excel download is **gated**: nothing generates until all six routes have booked that
  session. That gate is a deliberate rule, not a bug — and it is the most likely reason
  someone tells you "the download is broken."

---

## 5. Live state, checked today

I woke your API and read it. The system is configured but essentially unused.

| | |
|---|---|
| Routes | 6 |
| Dishes | 16 |
| Users | 4 (all seed accounts) |
| Orders ever placed | 3 |
| Pending verifications | 0 |
| Lunch cutoff setting | 11:00 |

The four users are the demo accounts from `packages/db/prisma/seed.ts` — usernames
`booking`, `kitchen`, `verify`, `admin`, with the passwords printed in that same file.

The last real order was in June. One test order from August is still sitting `PLACED`,
which means **Unit-1 is currently gate-locked and cannot book**. Advancing its status or
closing it out will release it.

---

## 6. What I would fix first

Ordered by how much damage each can do. The first three are not theoretical — I confirmed
them from outside your network, with no credentials.

### 🔴 CRITICAL — Anyone can sign up as Super Admin
`POST /auth/signup` is public and accepts `role` from the request body, validated only
against the list of valid roles. Sending `"role": "SUPER_ADMIN"` creates a full
administrator. The four apps each hard-code their own role in the UI, but the API does not
care which app you came from.

### 🔴 CRITICAL — Every `/admin/*` endpoint is unauthenticated
The route file's own comment says role checks *"come when we move off hardcoded auth"* —
they never came. I listed your users, dishes, units, vessels and dashboard from a plain
browser request with no token at all. The same routes create users, reset passwords and
edit packing factors. The order, packing and verification routes are equally open;
`POST /orders/verify` even takes `verifiedBy` as a number in the body and trusts it.

### 🔴 CRITICAL — Live credentials are sitting in the zip
The repo-root `.env` contains a working `DATABASE_URL` pointing at your Postgres through
Railway's public TCP proxy, plus the `AUTH_SECRET` that signs every login token. Anyone
with this zip has direct database access and can forge a valid admin session.
**Rotate the database password and change `AUTH_SECRET`** — the second one logs everybody
out, which is the point.

### 🟠 TIMEZONE — All deadlines run on UTC
The window rules use the server's local clock, and Railway containers run UTC. Your 11:00
lunch cutoff therefore fires at **16:30 IST**, and between midnight and 05:30 IST the
server still thinks it is yesterday — so a genuine "today for tomorrow" booking at 2 AM
gets rejected as being two days out. Fix by doing the day math in `Asia/Kolkata` rather
than in whatever zone the container happens to be in.

### 🟠 GROWTH — App bundles are stored as rows in Postgres
The self-hosted OTA system writes each built app zip into the `AppBundle` table as raw
bytes, and nothing ever deletes old rows. Each release adds a few MB to the database —
fine for now, worth a cleanup job before it becomes your largest table.

### ⚪ CLEANUP — Dead code and a stale plan
- `apps/booking` is an abandoned Expo/React-Native version of the booking app, excluded
  from `pnpm-workspace.yaml` and built by nothing. Safe to delete.
- The `coverage()` helper is duplicated between `orders.ts` and `packingService.ts`, so a
  rule change has to be made twice.
- `BUILD_PLAN.md` still describes menu rotation, invoices and a dispatch app. None of that
  was built, and the schema comments say so explicitly. Read the schema, not the plan.

---

## 7. Running it yourself

The zip already ships `node_modules`, so the first run is quick. Needs Node 20+ and pnpm 9.

```bash
# from smart-kitchen/ — point .env at your OWN database first, not production
pnpm install
pnpm db:generate     # build the Prisma client
pnpm db:push         # create the tables
pnpm db:seed         # units, dishes, vessels, 4 demo users

pnpm web             # API + all four apps at once
```

That puts the API on `:4000`, admin `:5173`, kitchen `:5174`, verification `:5175`,
booking `:5176`. Without a per-app `.env`, each front-end falls back to
`http://<page-host>:4000` — which is why they just work locally with no configuration.
`pnpm db:studio` gives you a browsable view of the data.

### Where to change things

| If you want to change… | Look in |
|---|---|
| Tables, columns, enums | `packages/db/prisma/schema.prisma` |
| Booking deadlines and window rules | `packages/logic/src/windows.ts` |
| Vessel-fill and quantity maths | `packages/logic/src/packing.ts` |
| Order creation, route assignment, reorder gate | `apps/api/src/routes/orders.ts` |
| Excel layout, headers, branding | `apps/api/src/packingService.ts` |
| Admin CRUD, dashboard, reports | `apps/api/src/routes/admin.ts` |
| Login, signup, token signing | `apps/api/src/routes/auth.ts` + `src/auth.ts` |
| Every Super Admin screen | `apps/admin/src/sections.tsx` |
| Starting data — dishes, units, vessels, users | `packages/db/prisma/seed.ts` |

### The Android apps

Four APKs sit in `apk-out/`, built with Capacitor — the same web apps in a native shell,
pointed at the same API. `build-android.sh` rebuilds them but only runs on macOS with
Homebrew and JDK 17. Once an APK is installed, `push-update.sh` ships JavaScript-only
changes over the air without reinstalling: it bumps each app's version, builds, zips the
`dist/`, and uploads it to the API under `UPDATE_SECRET`. iPhone users get the same apps
by opening the web URL in Safari and adding to the home screen.

---

## 8. Suggested order of work

1. Push this code to a private GitHub repo (add `.env` to `.gitignore` first — it already is).
2. Rotate the Postgres password and `AUTH_SECRET`; update the Railway variables.
3. Connect each of the five services to the repo so deploys stop depending on a laptop.
4. Add auth middleware to the API: verify the bearer token and check the role on every
   `/admin/*`, `/orders/*`, `/packing/*` and `/verification/*` route. Lock `signup` down to
   non-admin roles (or remove public signup entirely and create users from the admin panel).
5. Fix the timezone handling.
6. Then decide the product question: should bookers pick their own route instead of being
   auto-assigned?
