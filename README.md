# Smart Kitchen

Meal indent, packing and verification system for a central kitchen serving six
delivery routes. Bookers order plate counts a day ahead; the kitchen gets an
auto-generated Excel turning those plates into cookable quantities and vessel
counts; after delivery each route reports consumption and a verification team
signs it off, which unlocks that route's next booking.

> **New here?** Read [`docs/HANDOVER.md`](docs/HANDOVER.md) first — what the
> system does, how it is deployed, and the domain rules, in one pass.

---

## Layout

```
apps/
  api/            Fastify + Prisma backend — the only service that touches Postgres
  web/            The app everyone uses. One sign-in; the role on your account
                  decides which sections appear (see apps/web/src/nav.tsx)
packages/
  db/             Prisma schema, client and seed
  logic/          Shared rules: order windows + the packing/vessel engine
docs/             Specs, the original build plan, and reference spreadsheets
```

Four separate apps were merged into `apps/web` in September 2026 — see
[`MERGE_NOTES.md`](MERGE_NOTES.md).

## Run it locally

Needs Node 20+ and pnpm 9.

```bash
cp .env.example .env       # point DATABASE_URL at your OWN database, not production
pnpm install
pnpm db:generate           # build the Prisma client
pnpm db:push               # create the tables
pnpm db:seed               # units, dishes, vessels, demo users

pnpm dev                   # API + the web app together
```

The app runs at http://localhost:5173 and the API at http://localhost:4000.
Without a `.env` in `apps/web`, the app calls `http://<page-host>:4000`, which is
why local dev needs no configuration. `pnpm db:studio` browses the data.

`pnpm db:seed` prints the starter account passwords once — copy them from that
output; they are not stored in the source.

## Deployment

Two Railway services, both built from **this same repo**, plus a `Postgres`
service with a volume. Which app a service builds is decided by its **Build
Command** and **Start Command**, set in that service's Settings:

| Service | Build Command | Start Command |
|---|---|---|
| `web` | `pnpm --filter @sk/web build` | `pnpm exec serve -s apps/web/dist -l tcp://0.0.0.0:$PORT` |
| `api` | `pnpm --filter @sk/db generate` | `pnpm --filter @sk/api start` |

The root `build` and `start` scripts are a safety net, not the normal path: with
no config file and no dashboard commands, a builder auto-detects them and the
**api** still comes up correctly (`build` generates the Prisma client — and
builds the web app too, which is wasted but harmless; `start` runs the api).
That is what makes it safe to delete a Railway config file without first being
able to set the dashboard values, since Railway locks those fields while a
config file supplies them.

> **There are deliberately no `railway.json` / `railway.*.json` files in this
> repo.** Railway reads a root `railway.json` and applies it to *every* service
> built from the repo, overriding that service's dashboard settings. That is
> exactly what broke the first `web` deploy: it picked up the api's config, ran
> `prisma generate` instead of `vite build`, produced no `apps/web/dist`, and
> served 404s from a container that looked healthy.
>
> Railway's Config as Code is deprecated anyway — closed to new services since
> 2026-08-28, and existing files stop being read on 2026-12-01 — so the commands
> above live in each service's dashboard. If you ever reintroduce a config file,
> remember it is repo-wide, not per-service. The supported replacement is
> Infrastructure as Code (`.railway/railway.ts`), applied with
> `railway config apply` from the CLI rather than read on deploy.

### Required variables

| Service | Variables |
|---|---|
| `api` | `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`, `AUTH_SECRET`, `UPDATE_SECRET` |
| `web` | `VITE_API_URL` |

`AUTH_SECRET` is mandatory — the API refuses to start in production without it.
Optional: `APP_TIMEZONE` (default `Asia/Kolkata`), `TOKEN_TTL_DAYS` (default 30),
`SELF_SIGNUP_ROLES` (default `BOOKING` — never add `SUPER_ADMIN`).

### Deploying

Both services are connected to this repo, so a push to `main` deploys them.
To push from a machine instead:

```bash
railway up --service api
railway up --service web --detach
```

## Roles

| Role | Lands on | Sees |
|---|---|---|
| `BOOKING` | New Booking | New Booking · My Bookings · Close a Meal |
| `KITCHEN_ADMIN` | Orders | Orders · Packing Sheet |
| `VERIFICATION_ADMIN` | To verify | To verify · Payments |
| `SUPER_ADMIN` | Dashboard | all 14 sections |

Which sections a role sees is one table: `apps/web/src/nav.tsx`. That controls
what is *shown* — what is *allowed* is enforced by the API in
`apps/api/src/guard.ts`, and both must agree.

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

## Mobile

The app is a PWA — open the URL and add it to the home screen on Android or iOS.

The four old Capacitor APKs in `apk-out/` are from before the merge and are now
stale: they point at the old per-role URLs. `build-android.sh` only runs on
macOS. See [`MERGE_NOTES.md`](MERGE_NOTES.md) if you want a merged APK later.

## Security

See [`SECURITY_FIXES.md`](SECURITY_FIXES.md) for what was hardened in
September 2026 and what remains open. Never commit `.env` or `SECRETS.local.md`.
