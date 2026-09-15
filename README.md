# Smart Kitchen

Meal indent, packing and verification system for a central kitchen serving six
delivery routes. Bookers order plate counts a day ahead; the kitchen gets an
auto-generated Excel turning those plates into cookable quantities and vessel
counts; after delivery each route reports consumption and a verification team
signs it off, which unlocks that route's next booking.

> **New here?** Read [`docs/HANDOVER.md`](docs/HANDOVER.md) first — it explains
> the whole system, the Railway layout and the domain rules in one pass.

---

## Layout

```
apps/
  api/            Fastify + Prisma backend — the only service that touches Postgres
  booking-web/    Booking portal        (React + Vite)
  kitchen/        Kitchen + packing     (React + Vite)
  verification/   Verify close-outs     (React + Vite)
  admin/          Super Admin console   (React + Vite)
  booking/        DEAD — abandoned Expo version, not in the workspace
packages/
  db/             Prisma schema, client and seed
  logic/          Shared rules: order windows + the packing/vessel engine
docs/             Specs, the original build plan, and reference spreadsheets
```

## Run it locally

Needs Node 20+ and pnpm 9.

```bash
cp .env.example .env       # point DATABASE_URL at your OWN database, not production
pnpm install
pnpm db:generate           # build the Prisma client
pnpm db:push               # create the tables
pnpm db:seed               # units, dishes, vessels, demo users

pnpm web                   # API + all four apps together
```

| App | Local URL |
|---|---|
| Super Admin | http://localhost:5173 |
| Kitchen | http://localhost:5174 |
| Verification | http://localhost:5175 |
| Booking | http://localhost:5176 |
| API | http://localhost:4000 |

Without a per-app `.env`, each front-end calls `http://<page-host>:4000`, which
is why local dev needs no configuration. `pnpm db:studio` browses the data.

## Deployment

Five Railway services, all built from **this same repo**. Which app a service
builds is decided by its **Settings → Config File**:

| Service | Config file | Builds | Public URL |
|---|---|---|---|
| `api` | `railway.json` | `apps/api` | `api-production-24df3` |
| `web-booking` | `railway.booking.json` | `apps/booking-web` | `hkbooking` |
| `web-kitchen` | `railway.kitchen.json` | `apps/kitchen` | `hkkitchen` |
| `verification` | `railway.verify.json` | `apps/verification` | `hkverification` |
| `admin` | `railway.admin.json` | `apps/admin` | `hkadmin` |

Plus a `Postgres` service with a volume.

The four web services are static — they run `serve -s apps/<app>/dist`. Their
API URL is **baked in at build time** from `VITE_API_URL`, so changing the API's
address means rebuilding all four, not just restarting them.

### Required variables

| Service | Variables |
|---|---|
| `api` | `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`, `AUTH_SECRET`, `UPDATE_SECRET` |
| each web service | `VITE_API_URL` |

`AUTH_SECRET` is mandatory — the API refuses to start in production without it.
Optional: `APP_TIMEZONE` (default `Asia/Kolkata`), `TOKEN_TTL_DAYS` (default 30),
`SELF_SIGNUP_ROLES` (default `BOOKING` — never add `SUPER_ADMIN`).

### Deploying

Once the services are connected to this repo, a push to `main` deploys them.
To push from a machine instead:

```bash
railway up --service api
railway up --service web-booking   --detach
railway up --service web-kitchen   --detach
railway up --service verification  --detach
railway up --service admin         --detach
```

## Roles

| Role | App | Does |
|---|---|---|
| `BOOKING` | Booking | Places orders, submits consumption + feedback |
| `KITCHEN_ADMIN` | Kitchen | Cook / pack / dispatch, packing sheets |
| `VERIFICATION_ADMIN` | Verification | Verifies close-outs, unlocks reorder |
| `SUPER_ADMIN` | Super Admin | Everything, plus user and master-data management |

Only `BOOKING` accounts can self-register. The other three are created by a
Super Admin from the admin console.

## Rules worth knowing before you change anything

- **Tiffin & dinner** are ordered today for tomorrow. **Lunch** is same-day
  before 11:00 IST and is headcount-only. Rules live in `packages/logic/src/windows.ts`.
- **Reorder gate:** a route with any order not yet `CLOSED` cannot book again.
- **Routes are auto-assigned** — an order goes to the first of the six routes
  with nothing booked for that date and session. Bookers do not pick.
- **Accompaniments** (sambar, chutney) are never booked; their plate count is
  derived from the Item 1 + Item 3 totals.
- **The packing Excel is gated** — it generates only once all six routes have
  booked that session.

## Mobile apps

Four Android APKs built with Capacitor (same web apps in a native shell). Build
with `build-android.sh` (macOS, JDK 17). Ship JS-only updates over the air with
`push-update.sh`, which uploads bundles to the API under `UPDATE_SECRET`.
iPhone users add the web URL to their home screen instead.

## Security

See [`SECURITY_FIXES.md`](SECURITY_FIXES.md) for what was hardened in
September 2026 and what remains open. Never commit `.env` or `SECRETS.local.md`.
