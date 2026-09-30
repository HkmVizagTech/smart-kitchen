# Smart Kitchen — Project Overview

**For a developer joining this project.** Written 28 September 2026.
Read this first; it explains what the system does, how it is put together today,
what has already been fixed, and what is still open.

There is a deeper technical brief in [`docs/HANDOVER.md`](HANDOVER.md) and a
security write-up in [`SECURITY_FIXES.md`](../SECURITY_FIXES.md). This document
is the map; those two are the detail.

---

## 1. What the system is, in one paragraph

A central kitchen cooks meals for **six delivery routes**. Every route has
someone who books meals — "we need 100 plates of idly and 50 of wada for
tomorrow morning". The kitchen needs those plate counts turned into something
cookable: kilograms of sambar, numbers of idlys, and how many of each physical
vessel to fill. After the food is delivered, the route reports **what was
actually eaten** and rates the meal. A verification team signs that off, and the
numbers feed a wastage report.

That is the whole product. The value is in the middle step — plates → cookable
quantities → vessels — and in forcing the loop to close, so nobody keeps
ordering without ever reporting consumption.

The six routes are `Unit-1`, `Unit-2`, `Unit-3`, `Unit-4`, `Visakha`, `Others`.

> **A note on the branding.** The app is called **Brandix** (rebranded from
> *"Akshaya Patra Kitchen"* on 30 Sep 2026; the old name was leftover from the
> reference spreadsheet the original developer worked from). The generated Excel
> already said *"Touch Stone Foundation — Vishakhapatnam" / "Brandix Delivery
> Sheet"*, so the two now agree. It is text in a handful of files, not a
> dependency. Note the Android package ids are still `com.akshayapatra.*` — see
> `BUILD_MOBILE.md` before changing those, as renaming them breaks OTA updates
> for already-installed apps.

---

## 2. The daily rhythm

| # | Who | What they do |
|---|---|---|
| 1 | **Booking** (one person per route) | Enters plate counts for tomorrow's tiffin or dinner, or a headcount for today's lunch |
| 2 | **Kitchen** | Sees the day's orders, downloads the packing sheet, marks each order Preparing → Dispatched → Delivered |
| 3 | **Booking** | Closes the meal out — how much was actually consumed per dish, plus a mandatory taste & quality rating |
| 4 | **Verification** | Reviews the close-out and approves it (or sends it back) |
| 5 | **The system** | Approval closes the order; the numbers land in the wastage report |

A booker cannot start a new order for a meal until the previous one of that meal
is closed out. That rule is the point of the whole system — see §6.

---

## 3. Four apps became one — what to expect

**This is the biggest change from what you may have been told about the project.**

Until September 2026 there were four separate websites — one for booking, one
for the kitchen, one for verification, one for the super admin — each with its
own URL, its own build, its own copy of nearly the same code. Roughly 85% of the
code was identical across the four; five files were byte-for-byte the same in
all of them. Changing a colour meant editing four files.

They are now **one app**. You sign in once, and the role on your account decides
which sections appear in the sidebar. Nothing about security changed by doing
this — all four apps always called the same API with the same tokens, and access
was, and still is, decided by the server on every request.

| Role | Lands on | Can see |
|---|---|---|
| `BOOKING` | New Booking | New Booking · My Bookings · Close a Meal |
| `KITCHEN_ADMIN` | Orders | Orders · Packing Sheet |
| `VERIFICATION_ADMIN` | To verify | To verify · Payments |
| `SUPER_ADMIN` | Dashboard | all 14 sections |

One person, one role, one account. Someone who genuinely does two jobs needs two
accounts — changing that is a database change, not a settings change.

The navigation lives in a single table: `apps/web/src/nav.tsx`. Adding a screen
is one row in that table. **But that table only controls what is *shown*.** What
is *allowed* is enforced separately by the API in `apps/api/src/guard.ts`, and
the two must be kept in agreement.

---

## 4. Railway — what the five services were, and what they are now

Everything runs on Railway. **All the services build from the same repository**;
what makes them different is the build command each one is given.

### Before (five services)

| Service | What it was |
|---|---|
| `api` | The backend — the only thing that talks to the database |
| `web-booking` | The booking website |
| `web-kitchen` | The kitchen website |
| `verification` | The verification website |
| `admin` | The super-admin website |
| `Postgres` | The database |

### Now (three services)

| Service | What it is | Build command | Start command |
|---|---|---|---|
| **`smart-kitchen`** | The one merged app everybody uses | `pnpm --filter @sk/web build` | `pnpm exec serve -s apps/web/dist -l tcp://0.0.0.0:$PORT` |
| **`api`** | The backend | `pnpm --filter @sk/db generate` | `pnpm --filter @sk/api start` |
| **`Postgres`** | The database, with a volume attached | — | — |

The four old web services are dead and should be deleted: `admin`,
`verification`, `web-booking`, `web-kitchen`.

### Things that will bite you on Railway

- **The front-end is not running React on the server.** It runs `serve`, a tiny
  static file server. Its only link to the backend is `VITE_API_URL`, which is
  **baked in when it is built** — change the API's URL and the front-end must be
  *rebuilt*, not just restarted.
- **Never add a `railway.json` to the repo root.** Railway applies a root config
  file to *every* service built from that repo, overriding each service's own
  dashboard settings. That is exactly what broke the first deploy of the merged
  app: it picked up the API's config, ran `prisma generate` instead of building
  the website, produced no files to serve, and returned 404 from a container
  that looked perfectly healthy. Both config files have been deleted and the
  commands now live in each service's dashboard.
- **Railway's "Config as Code" is being retired anyway** — closed to new
  services since 28 Aug 2026, and existing files stop being read on 1 Dec 2026.
  The replacement is a CLI-applied infrastructure file, not something read on
  deploy. Nothing further is needed here; the repo is already clean of it.
- **Deploys happen on push to `main`.** Both services are connected to the
  GitHub repo, so the previous developer's laptop is no longer a dependency.

### Variables each service needs

| Service | Variables |
|---|---|
| `api` | `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (a reference, never a pasted string), `AUTH_SECRET`, `UPDATE_SECRET` |
| `smart-kitchen` | `VITE_API_URL` = the api service's public URL |

`AUTH_SECRET` is mandatory — the API deliberately refuses to start in production
without it. Optional: `APP_TIMEZONE` (defaults to `Asia/Kolkata`),
`TOKEN_TTL_DAYS` (30), `SELF_SIGNUP_ROLES` (defaults to `BOOKING` — never add
`SUPER_ADMIN` to it).

---

## 5. The screens, and what each one actually does

### Booking (3 screens)

**New Booking** — the main screen. Shows tomorrow's tiffin and dinner and
today's lunch as separate cards. Each meal starts empty; you fill it either in
one tap from your own history (**Repeat last**, or **My usual** — the dishes
present in at least half of your last five orders, at their average count) or
from a searchable chip picker, and only the dishes you chose get a row with
plate counts. Sambar and chutney are added automatically and shown on one line.
The route picker names the route you'll actually get. A bar pinned to the bottom
carries the running plate total and the confirm button. If a meal is waiting on
a close-out, that card is locked and a banner says which meal, which route,
which date and what is missing, with a link straight to the Close a Meal screen.

**My Bookings** — the booker's own recent orders and their status.

**Close a Meal** — pick a delivered order, enter how much of each main dish was
actually consumed, and give a taste and a quality rating. **Both parts are
required in the same submission** — the API rejects a close-out with no rating,
which is what stops the loop being half-completed. If verification sent a meal
back, it reappears here with their reason at the top and all your previous
figures already filled in, so you change what needs changing rather than
retyping the lot.

### Kitchen (2 screens)

**Orders** — every order for a chosen cooking date, with buttons to move them
through Preparing → Dispatched → Delivered. Each order has its own button; a
separate "Move all to" bar does a whole session at once, shows how many orders
each target would actually affect, and asks before firing.

**Packing Sheet** — the computed sheet on screen plus an Excel download. This is
the part with the real logic in it; see §6.

### Verification (2 screens)

**To verify** — close-outs waiting for review, showing ordered vs consumed per
dish, the leftover, any notes, and the booker's ratings. Approve, or send it
back with a reason (four common ones are one tap). Approving closes the order
and freezes the amount owed; sending it back puts the meal in front of the
booker again with your reason attached.

**Payments** — the last 100 verified close-outs with what each is worth in
rupees, totalled and broken down per route. The amount is consumed plates ×
the dish's rate, worked out at the moment of approval and then frozen, so
changing a rate later cannot rewrite what was already agreed and paid. Payment
follows what was *consumed*, not what was ordered.

### Administration (7 screens, Super Admin only)

| Screen | What it does |
|---|---|
| **Dashboard** | Tomorrow's tiffin and dinner coverage, today's lunch, pending verifications, recent orders |
| **Reports** | Pick a date range → total ordered, consumed, leftover, **wastage %**, average taste and quality, broken down per route. Only counts *verified* close-outs |
| **Dishes** | The menu — name, group, quantity per plate, packing factor, **rate per plate**, whether it's bookable |
| **Vessels** | The physical vessel sizes available, per session |
| **Routes** | The six routes and their member counts |
| **Users** | Create accounts, reset passwords, deactivate, delete, restore |
| **Settings** | Organisation name, the lunch cutoff time, and the **default rate per plate** used by any dish without its own |

A Super Admin also sees all the booking, kitchen and verification screens.
Before the merge they literally could not — they would have needed a separate
account on a different website.

### Across all screens

There is an in-app **notification** system: the kitchen is told when a booking
comes in, verification is told when a close-out is submitted, and the booker is
told when their meal is verified or returned.

---

## 6. The rules that will surprise you

Almost every "is this a bug?" question about this system is one of these five
rules working as designed.

### Order windows

- **Tiffin and dinner** — ordered *today, for tomorrow*. Exactly one day ahead.
  Today is refused; two days out is refused.
- **Lunch** — same day, before **11:00 AM India time**, and it is headcount only
  (no dish list).
- **Emergency** — skips every window check.

All of this is evaluated in **Asia/Kolkata**, deliberately. It used to run on the
server's clock, which on Railway is UTC — so the 11:00 lunch cutoff actually
fired at 16:30 IST, and between midnight and 05:30 IST the server still thought
it was yesterday, rejecting perfectly legitimate late-night bookings.

### The reorder gate — the rule the system exists for

**Order → eat → report consumption → rate it → only then order again.**

A booker's *first* order of a meal goes through freely. Every order after that is
refused until the previous order **of that same meal** has both consumption and
feedback submitted. The refusal is not a bare error: it names the order, the
route, the date and what is still missing, and the New Booking screen greys the
meal out before anyone fills in a form.

Three limits on how strict it is, each chosen on purpose:

- **Per meal, not across meals.** Tiffin, lunch and dinner are separate chains.
  A shared gate would deadlock: book tiffin and dinner for tomorrow, close out
  tiffin in the morning — dinner is not delivered until evening, so you could
  not book the next day's tiffin before the cutoff.
- **Closing out releases it, not verification.** Requiring an *approved*
  verification would put the verification team on the critical path of every
  single booking. Miss it before the cutoff and that booker is stuck.
  Verification stays downstream as the accuracy/payment step.
- **Emergency orders are exempt**, and never become the thing blocking someone.

There is also an **older per-route gate** ("this route has an order not yet
closed"). It still exists and the screens read it, but nothing refuses an order
because of it — treat it as informational only.

⚠️ **An order left open blocks its booker permanently.** Before this rule meets
real data, find the stragglers and either close them out or delete them:

```sql
SELECT o.id, u.name AS route, o.date::date, o.session, o."bookedById"
FROM "Order" o
JOIN "Unit" u ON u.id = o."unitId"
WHERE NOT EXISTS (SELECT 1 FROM "Consumption" c WHERE c."orderId" = o.id)
ORDER BY o.date;
```

### Routes are auto-assigned, but the booker can override

Book without naming a route and the order goes to the first of the six routes
with nothing booked for that date and meal. Six bookings fill all six; the
seventh is refused.

Since September 2026 the booker also sees a route picker, pre-filled with the
auto-assigned one, and can change it. A route already taken for that date and
meal is refused. **Auto-assignment is the default, not the only option.**

### Accompaniments are never booked — they are calculated

Sambar and FG Chutney are flagged as accompaniments. The booker never enters
them. The API sets their plate count to the sum of all Item 1 + Item 3 solid
plates, because sambar goes with both the idly and the wada. If a chutney
quantity ever looks wrong on the sheet, check this calculation before blaming
the packing factors.

### Plates → quantities → vessels

- **Counted dishes** (idly, wada, bhonda): `packing factor × plates` pieces,
  filled greedily into the largest vessel, with the remainder rounded *up* into
  the smallest vessel that covers it.
- **Weight dishes**: `packing factor × plates ÷ 1000` kg, then divided by the
  vessel's kg capacity.
- Vessel sizes are configurable per session — currently morning
  200/160/120/80/40 and evening 160/120/100/40.

### The Excel download is gated

The packing sheet generates **only once all six routes have booked that
session**. This is a deliberate rule, not a bug — and it is far and away the most
likely reason someone tells you "the download is broken."

---

## 7. What has been done

The project was inherited in September 2026 as a zip file with no Git history,
deployed by hand from the previous developer's laptop. Since then:

**Got it under control**

- Pushed to GitHub (`HkmVizagTech/smart-kitchen`) — there is now a history, and
  both services deploy on push instead of from someone's machine.
- Written up: this document, the handover brief, the merge notes, the security
  write-up.

**Fixed three serious security holes** (all three were confirmed from outside the
network, with no credentials)

- **Every `/admin/*` endpoint was completely unauthenticated.** The user list,
  password resets, packing factors and order history were readable and writable
  by anyone who knew the URL. Every route now declares who may call it.
- **Anyone could sign themselves up as Super Admin**, because the signup form
  accepted the role from the request. Self-signup is now limited to booking
  accounts; the other three roles are created by a Super Admin.
- **Live credentials were sitting in the zip** — a working database URL and the
  secret that signs every login token.

**Also hardened**

- User identity is now taken from the signed-in session, not from whatever the
  request body claimed. Previously a verification could be attributed to anyone.
- Login tokens now expire (30 days) and can all be invalidated at once by
  changing `AUTH_SECRET` — that is the emergency "sign everybody out" switch.
- The API refuses to start in production without `AUTH_SECRET`. It used to fall
  back to a default value that was written in the source code.
- Login and signup are rate-limited. (The first version of that limiter could
  itself be bypassed with a forged header; that was found and fixed.)
- The database's public TCP proxy was removed, so it is now reachable only from
  inside the Railway project.

**Product changes**

- Merged the four apps into one (8,652 lines deleted, 1,162 added).
- **Verification can say why it sent a close-out back**, and the booker sees
  that reason with their previous figures already filled in. Before this a
  returned meal was a dead end: the booker was notified, given no reason, and
  the order had already dropped off the list they were told to go to.
- **Payments shows money.** Dishes carry a rate per plate (with a default in
  Settings); the amount is worked out from consumed plates at approval and
  frozen on the record.
- **Rebuilt the interface** on the #F9F7F7 / #DBE2EF / #3F72AF / #112D4E
  palette: #DBE2EF carries the page so white cards read as raised, #3F72AF is
  the action colour, and navy is kept for text and small accents rather than
  used as a large fill. New logo and app icons, a light header in place of the
  dark bar, a bottom tab bar on phones, and contrast measured rather than
  eyeballed.
- Fixed all the deadline handling to run on India time.
- Added the route picker, keeping auto-assignment as the default.
- Restored the "one order per booker, per meal, per day" rule.
- **Made the reorder gate actually enforced.** It used to be merely *reported* —
  the screens asked whether a route was clear, but the API never checked, so any
  client that simply did not ask walked straight past it.
- **Rebuilt the booking screen.** It was 4,232px tall on a phone — five screens
  of scrolling to place one order, because all sixteen dishes were rendered as
  full rows whether you wanted them or not, with the confirm button stranded at
  the bottom. Now 1,530px: a meal starts empty and is filled in one tap from the
  booker's own history, or from a searchable picker, with a running total pinned
  to the bottom of the screen.
- **Fixed a dangerous control in the kitchen.** Preparing / Dispatched /
  Delivered looked like tabs but moved every order in the session. They now say
  what they do, show how many orders they would affect, and ask first.

**Testing**

- An end-to-end test (`apps/api/test/flow.test.mjs`) runs the whole loop against
  a real database: sign-in for all four roles, role separation, route selection
  and overrides, the window rules, the kitchen status flow, close-out,
  verification, the packing-sheet gate, the Excel download, and the reorder gate.
- A browser test (`apps/web/test/role-nav.test.mjs`) checks that each role's
  sidebar shows exactly the right sections and nothing else.

---

## 8. What is still pending

### Needs doing now, by whoever owns the Railway account

1. **Change the `admin` account's password.** `admin` / `admin123` still works in
   production. There is **no password-recovery flow** — if you lock yourself out
   of the only Super Admin account, the only way back in is editing the database
   directly. **Create a second Super Admin account before changing anything.**
2. **Change the other three seed passwords** (`booking`, `kitchen`, `verify`).
3. **Delete the four dead Railway services** — `admin`, `verification`,
   `web-booking`, `web-kitchen`.
4. **Clear any orders that were never closed out**, or their bookers will be
   permanently blocked by the reorder gate (query in §6).

### Open product decisions — code cannot decide these

- **Emergency orders have no approval step.** The specification says they need
  super-admin approval; no such endpoint was ever built. Today anyone with a
  booking account can place unlimited emergency orders, skipping every deadline.
  Needs a decision: who approves, and what happens to the order while it waits?
- **One role per user.** Someone who does two jobs needs two accounts. Changing
  this is a database change plus a permissions change — worth deciding before
  the user list grows.
- **The branding.** The app is called **Brandix**. The generated Excel says
  "Touch Stone Foundation — Vishakhapatnam" / "Brandix Delivery Sheet", which is
  leftover from the reference spreadsheet the original developer built against.
  The org name is a Super-Admin setting (`org_name`, default "Brandix") and the
  Excel headings live in `packingService.ts`. The Android package ids are still
  `com.akshayapatra.*`; changing those is a breaking change for installed apps.

### Known technical debt

- **App bundles pile up in the database.** The self-hosted over-the-air update
  system writes each built app zip into a database table as raw bytes, and
  nothing ever deletes the old rows. A few MB per release, growing forever.
  Worth a cleanup job before it becomes the largest table.
- **Duplicated logic.** The helper that works out which routes have booked exists
  in two files, so a rule change has to be made in both.
- **The four Android APKs are stale.** They were built before the merge and still
  point at the four old URLs, so they no longer work. The app is a PWA — open the
  URL and "Add to Home Screen" works on both Android and iOS, which is the
  simplest path. A merged APK is possible but needs the Capacitor packages added
  back. The build script also only runs on macOS.
- **`docs/BUILD_PLAN.md` is fiction.** It describes menu rotation, invoices and a
  dispatch app. None of it was built. Read the database schema, not the plan.

---

## 9. Running it on your own machine

Needs Node 20+ and pnpm 9.

```bash
cp .env.example .env       # point DATABASE_URL at YOUR OWN database, not production
pnpm install
pnpm db:generate           # build the database client
pnpm db:push               # create the tables
pnpm db:seed               # routes, dishes, vessels, demo users

pnpm dev                   # the API and the app together
```

The app comes up on `http://localhost:5173`, the API on `http://localhost:4000`.
With no configuration, the app calls the API on the same host at port 4000 —
which is why local development needs no setup.

`pnpm db:seed` **prints the starter passwords once**, when it runs. Copy them
from that output; they are not stored anywhere in the source. `pnpm db:studio`
opens a browsable view of the data.

### Where to change things

| To change… | Look in |
|---|---|
| Tables and columns | `packages/db/prisma/schema.prisma` |
| Booking deadlines and window rules | `packages/logic/src/windows.ts` |
| Vessel-fill and quantity maths | `packages/logic/src/packing.ts` |
| Order creation, route assignment, the reorder gate | `apps/api/src/routes/orders.ts` |
| Excel layout, headers, branding | `apps/api/src/packingService.ts` |
| Admin screens, dashboard, reports | `apps/api/src/routes/admin.ts` |
| Login, signup, tokens | `apps/api/src/routes/auth.ts` + `src/auth.ts` |
| Who may call what | `apps/api/src/guard.ts` |
| Which sections each role sees | `apps/web/src/nav.tsx` |
| Starting data — dishes, routes, vessels, users | `packages/db/prisma/seed.ts` |

### Before you push

```bash
pnpm typecheck
pnpm --filter @sk/web build
```

**Never commit `.env` or `SECRETS.local.md`.** The repository is public.

---

## 10. The stack, briefly

- **Backend** — Fastify (Node) with Prisma talking to PostgreSQL. TypeScript.
- **Front-end** — React 18 with Vite. TypeScript. Plain CSS, no framework.
- **Repository** — a pnpm workspace monorepo: `apps/api`, `apps/web`,
  `packages/db` (schema, client, seed), `packages/logic` (the window rules and
  the packing engine, shared by both sides).
- **Hosting** — Railway, three services, deploying on push to `main`.

The shared `packages/logic` is worth knowing about: the booking rules and the
packing maths live there precisely so the front-end and the backend cannot
disagree about them.
