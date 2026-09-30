# Four apps → one

Applied 15 Sep 2026. The booking, kitchen, verification and super-admin apps are
now a single web app at `apps/web`. You sign in once, and the role on your
account decides which sections you see.

---

## Why

The four apps were ~85% the same code. These files were **byte-for-byte
identical** in all four: `styles.css` (623 lines), `Logo.tsx`, `Notifications.tsx`,
`OtaUpdate.tsx`, `main.tsx`. `Auth.tsx` and `api.ts` were near-copies. Roughly
3,000 lines existed only because they had been pasted four times — every CSS
tweak was a four-file edit.

The separation was never a security boundary either: all four called the same
API with the same tokens. Access is enforced server-side in
`apps/api/src/guard.ts`, which is unchanged by this merge.

## What it looks like now

One sign-in screen. After that, the sidebar is built from the signed-in user's
role:

| Role | Lands on | Sees |
|---|---|---|
| `BOOKING` | New Booking | New Booking · My Bookings · Close a Meal |
| `KITCHEN_ADMIN` | Orders | Orders · Packing Sheet |
| `VERIFICATION_ADMIN` | To verify | To verify · Payments |
| `SUPER_ADMIN` | Dashboard | all 14 sections |

Super Admin gaining every section is a real change, not just tidiness — before,
an admin literally could not open a booking or kitchen screen without a separate
account on a different URL.

## Where things live

```
apps/web/src/
  nav.tsx              THE navigation table — one row per section, declaring
                       which roles may see it. Adding a screen = adding a row.
  App.tsx              the shell: header, role-filtered sidebar, section area
  Auth.tsx             one sign-in; self-signup creates BOOKING accounts only
  api.ts               one API client (was four)
  ErrorBoundary.tsx    stops a broken section blanking the whole app
  sections/
    booking.tsx        New Booking · My Bookings · Close a Meal
    kitchen.tsx        the kitchen's order list
    packing.tsx        the packing sheet + Excel download
    verification.tsx   To verify · Payments
    admin.tsx          Dashboard · Reports · Dishes · Vessels · Routes · Users · Settings
```

To add a section: write the component, add one row to `NAV` in `nav.tsx`. To
change who sees something: edit that row's `roles` — **and** the matching guard
in `apps/api/src/guard.ts`, because the nav only controls what is *shown*.

## Decisions taken

- **One role per user.** The schema keeps a single `role` column. Someone who
  needs two jobs gets two accounts. Revisit before the user table fills up —
  it's a schema change (`role` → a list) plus a guard change.
- **One Railway service.** The four `railway.{admin,booking,kitchen,verify}.json`
  configs are gone; the web service's commands live in the dashboard (see
  Deploying below).
- **Web only.** The Capacitor OTA update bar was removed — it only ever did
  anything inside a native APK, and pulling it out dropped two dependencies.
  The four existing APKs are untouched and now stale; they still point at the
  old URLs. If you want a merged APK later, the OTA bar comes back along with
  the `@capacitor/*` and `@capgo/*` packages.

## Deploying

In the Railway dashboard, create a service, connect it to this repo, and set
under **Settings**:

| Field | Value |
|---|---|
| Build Command | `pnpm --filter @sk/web build` |
| Start Command | `pnpm exec serve -s apps/web/dist -l tcp://0.0.0.0:$PORT` |
| Variable | `VITE_API_URL` = the api service's public URL |

Then generate a domain, check it, and delete the four old web services.

Railway's Config as Code is deprecated and closed to new services since
2026-08-28, so there is no `railway.web.json` — the commands go in the
dashboard. See the deployment section of the README for what this means for the
`api` service's legacy `railway.json` before 2026-12-01.

The `api` and `Postgres` services are untouched.

## Verifying

```bash
pnpm typecheck                        # api + web
pnpm --filter @sk/web build
node apps/web/test/role-nav.test.mjs  # needs playwright
```

The test drives the built app in a real browser with a stubbed API and asserts
that each role's sidebar shows exactly the right sections and nothing else, that
a signed-out visitor gets the login screen, and that a deliberately crashing
section leaves the nav and sign-out working.

Last run — all pass:

```
BOOKING             lands on "New Booking"  sees 3
KITCHEN_ADMIN       lands on "Orders"       sees 2
VERIFICATION_ADMIN  lands on "To verify"    sees 2
SUPER_ADMIN         lands on "Dashboard"    sees 14
signed out          login screen, no sidebar
crashing section    nav still shows 14 items, sign-out works
```

## Bundle

One 213 KB bundle (63.9 KB gzipped) replaces four of 160–190 KB each.

## What was dropped

- `apps/booking` — the abandoned Expo app; not in the workspace, built by nothing.
- The admin app's own read-only Orders table and bare Packing download button —
  superseded by the kitchen versions, which a Super Admin can now see.
- `OtaUpdate.tsx` — see "Web only" above.
