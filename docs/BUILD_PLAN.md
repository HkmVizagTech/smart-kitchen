# Smart Kitchen Indent & Packing Management System — Build Plan

**Prepared for:** ISKCON Kitchen Operations
**Date:** 12 June 2026
**Status:** Planning / pre-development

---

## 1. Summary of decisions

| Decision | Choice | Why |
|---|---|---|
| Frontend | **React (web) + React Native via Expo (mobile)**, TypeScript | One language for all apps, ~70% shared code, builds installable APKs without an app store |
| Backend + DB | **Railway** — Postgres + Node API (Fastify + Prisma) | Already subscribed; one platform hosts DB, API, and both web apps. Relational data fits this domain; SQL makes reports & Excel exports trivial |
| App structure | **Separate app per role** | Cleaner UX, each user only sees what they need |
| Auth | **Hardcoded / simple login for now** | Per requirement; designed so we can swap to real auth later without rework |
| Distribution | **Manual install** — APK sideload (mobile) + private web URL (desktop) | No Play Store / App Store |

---

## 2. Roles & apps

Each role gets its own app, but they all talk to the same Railway-hosted API and database.

| # | App | Users | Platform | Core jobs |
|---|---|---|---|---|
| 1 | **Booking App** | Booking person per unit (Unit-1…4, Vishaka, etc.) | Mobile (phone) | Place tiffin/dinner/lunch orders; after delivery, submit consumption + mandatory feedback; can't reorder until verified |
| 2 | **Kitchen App** | Kitchen team (manages cooking sections) | Web (tablet/desktop) | See incoming orders per section; view auto prep sheet; packing checklist; mark dispatched |
| 3 | **Verification App** | Verification team | Web | Review each unit's consumption, verify counts, prepare invoices/payments, approve → unlocks that unit's next order |
| 4 | **Super Admin Panel** | Super admin (manages the kitchens) | Web | All features: users, units, menus & rotation, packing factors & vessel sizes, lock/unlock windows, emergency approvals, download Excel packing sheets, all reports |
| 5 | **Dispatch App** *(Phase 2)* | Courier / drivers | Mobile (phone) | See assigned deliveries; update status |

> The booking → kitchen → verification → super-admin loop is the core. Dispatch tracking can ship in Phase 2; until then the kitchen marks delivery directly.

---

## 3. Architecture

```
   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
   │ Warden App  │   │ Kitchen App │   │ Dispatch App│   │ Admin Panel │
   │  (mobile)   │   │   (web)     │   │  (mobile)   │   │   (web)     │
   └──────┬──────┘   └──────┬──────┘   └──────┬──────┘   └──────┬──────┘
          │                 │                 │                 │
          └─────────────────┴────────┬────────┴─────────────────┘
                                      │  (HTTPS / REST + WebSocket)
                            ┌─────────▼──────────┐
                            │   RAILWAY (cloud)   │
                            │                     │
                            │  Node API service   │  ← Fastify + Prisma
                            │   • rules engine    │  ← indent gate, window rules
                            │   • prep-sheet calc │
                            │   • PDF / Excel gen  │
                            │   • WebSocket (live) │  ← status tracking
                            │         │           │
                            │  ┌──────▼───────┐   │
                            │  │ Postgres DB  │   │
                            │  └──────────────┘   │
                            │  Volume (PDF files) │
                            └─────────────────────┘
```

Both web apps (Kitchen, Admin) are also deployed as Railway services. Mobile apps (Warden, Dispatch) are installed on phones and call the same API over HTTPS.

**Monorepo layout** (one repository, shared code):

```
/apps
  /warden        (Expo app)
  /kitchen       (React web)
  /dispatch      (Expo app)
  /admin         (React web)
  /api           (Node + Fastify + Prisma — the backend service)
/packages
  /db            (Prisma schema, types, API client — shared)
  /logic         (indent rules, quantity formulas — shared)
  /ui            (shared components)
```

---

## 4. Data model (Postgres tables)

| Table | Key fields |
|---|---|
| `units` | id, name (Unit-1…4, Vishaka…), member_count, location |
| `users` | id, name, role (booking/kitchen/verification/dispatch/superadmin), unit_id, pin |
| `dishes` | id, name, qty_per_plate, unit (`nos`/`g`), **packing_factor**, **packing_vessel_kg** — master catalog + packing config |
| `vessel_sizes` | id, session, kind (idly/wada), size — configurable counted-vessel sizes |
| `item2_options` | id, label, dish_ids[] — the selectable Item-2 sets |
| `menu_templates` | id, week_no, day, session (breakfast/dinner), item1_dish_ids[], item3_dish_ids[], default_item2_option_id |
| `menu_rotation` | date, week_no — maps calendar dates to a rotation week |
| `orders` | id, unit_id, date, session (breakfast/lunch/dinner), idly_plates, item2_plates, wada_plates, item2_option_id, type (normal/emergency), status |
| `order_windows` | session, date, is_locked, deadline |
| `consumption` | id, order_id, served_headcount, qty_served, notes, status (pending/verified/rejected) |
| `feedback` | id, order_id, rating, is_good (bool), remarks — **mandatory** before verification |
| `invoices` | id, consumption_id, unit_id, amount, line_items[], status (draft/approved/paid) |
| `packing_sheets` | id, date, session, generated_at, file_url — the auto Excel |
| `packing_items` | id, order_id, dish_id, qty, packed (bool) |
| `dispatch` | id, order_id, driver, status (preparing/dispatched/arrived/confirmed) |
| `receipts` | id, dispatch_id, missing_items, notes, confirmed_at |

---

## 5. Core business logic (the rules engine)

These live in `/packages/logic` so every app and the backend agree:

1. **Reorder gate (mandatory loop)** — A unit cannot place its next order until the *previous* order is closed out: (a) order delivered → (b) booking person submits **consumption** (food served + headcount) → (c) **mandatory feedback** (rating + good/not-good + remarks) → (d) **verification team** checks counts and prepares the invoice/payment → (e) verification approved. Only then does that unit's next order unlock. Enforced in DB + UI.
2. **Order window rules:**
   - *Tiffin (morning) + Dinner (evening)* → ordered **today for tomorrow**
   - *Lunch* → ordered **tomorrow for tomorrow, before 11:00 AM** *(reconcile with the 10:30 AM on the infographic)*
   - *Emergency* → anytime, current menu auto-applied, needs super-admin approval
3. **Tiffin slot rule** — Each plate = Item 1 (fixed daily) + Item 2 (booking person picks one of the day's options) + Item 3 (fixed per day). Item 1 & 3 come from the day's `menu_template`; only `item2_option_id` is stored per order. Same menu serves breakfast and dinner, rotating by week. See `MENU_SPEC.md`.
4. **Packing sheet (auto Excel)** — Once every section's order for a session is in, the API generates the kitchen packing sheet: per-unit plate counts → per-dish quantities via packing factors → vessel breakdown (greedy largest + round remainder up for counted dishes; qty÷vessel for weight dishes). Downloadable as Excel from the Super Admin panel. Engine already prototyped in `packing_sheet.py`; spec in `PACKING_SHEET_SPEC.md`.
5. **Status lifecycle** — Preparing → Dispatched → Arrived → Confirmed, pushed live to booking app + kitchen via the API's WebSocket channel.

---

## 6. Authentication (now vs. later)

**Now (hardcoded/simple):** A `users` table with name + 4-digit PIN + role (booking / kitchen / verification / dispatch / superadmin). Login screen picks unit/user and enters PIN. No passwords, no email verification. Fast to build, fine for a closed internal tool.

**Built to upgrade:** All login goes through a single `/auth` endpoint on the API that returns a token, so later we can swap PIN for phone-OTP or proper passwords and add per-role access checks in one place, with almost no app changes. **Note:** until real auth is enabled, keep the API on a private URL / restricted access and never expose the database port publicly — Railway keeps the DB internal by default, which helps.

---

## 7. Build & distribution (no app store)

- **Mobile (Booking, Dispatch):** Build with `eas build --profile preview` → produces a `.apk` file → share the file (Drive/USB/link) → users enable "install from unknown sources" and tap to install. Updates: rebuild APK and re-share, or use Expo OTA updates to push JS changes instantly without reinstall.
- **Web (Kitchen, Verification, Super Admin):** Deploy as Railway services, each on its own URL. Open in any browser; can also "Add to Home Screen" as a PWA on the kitchen tablet.
- **API + DB:** Railway hosts the Node API and Postgres as services in one project, plus a volume for generated Excel/PDF files. The mobile APKs are built pointing at the API's public Railway URL.
- **iOS note:** Sideloading on iPhone is painful without the App Store. If any user is on iPhone, have them use the web version instead. (Confirm whether anyone uses iPhone.)

---

## 8. Phased roadmap

**Phase 0 — Setup (week 1)**
Railway project (Postgres + API service), Prisma schema + tables, monorepo scaffold, shared packages, simple login endpoint.

**Phase 1 — Core loop / MVP (weeks 2–4)**
Super Admin: users, units, menus + rotation, packing factors & vessel sizes, lock/unlock windows.
Booking app: place tiffin/dinner/lunch orders (Item-2 selection) within windows.
Kitchen app: see orders per section; **auto Excel packing sheet** (engine already built); packing checklist.
*Goal: orders in → correct packing sheet out, end to end.*

**Phase 2 — Consumption, verification & dispatch (weeks 5–6)**
Consumption + mandatory feedback submission; verification app (verify counts, build invoices, approve → unlock reorder); emergency orders + super-admin approval; dispatch app + status tracking + receipt confirmation.
PDF packing slips + Excel reports (date/session/unit/wastage%/ratings/remarks).

**Phase 3 — Polish (week 7+)**
Analytics dashboard (waste tracking, consumption trends, menu performance), daily summary, offline-friendly forms, hardening.

---

## 9. Cost

You already pay for **Railway**, which covers the Postgres DB, the API service, and both web app services — a deployment this size sits comfortably inside a Hobby/Pro plan's usage. Expo APK builds are free. So beyond your existing Railway subscription there are essentially **no new costs**.

---

## 10. Open questions before we start coding

1. Roughly how many units/hostels and total members? (sizes the DB and prep math)
2. Does anyone use an **iPhone**, or is everyone on Android? (affects mobile distribution)
3. Do units always have **internet**, or do forms need to work offline and sync later?
4. How many rotational menu variants, and how often do they rotate?
5. Who maintains the admin panel day-to-day?
