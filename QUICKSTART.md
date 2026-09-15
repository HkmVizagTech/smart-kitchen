# Smart Kitchen — Run & Check Guide

Everything below is verified working. The backend was tested end-to-end against
the live Railway database (login → order → packing sheet → status → verify), and
all web apps pass `vite build` + `tsc`.

---

## One-time setup

From the `smart-kitchen` folder:

```bash
pnpm install          # installs all apps (first run pulls a lot — give it a few minutes)
pnpm db:reset         # creates/clears tables on Railway (say "y" if prompted)
pnpm db:seed          # loads units, menu, vessels, and the 4 demo users
```

---

## Run EVERYTHING with ONE command

```bash
pnpm web
```

This starts the API **and all four panels** together (leave it running). Then open:

| App | URL | Sign in as |
|---|---|---|
| **Booking** | http://localhost:5176 | `booking` |
| **Kitchen** | http://localhost:5174 | `kitchen` |
| **Verification** | http://localhost:5175 | `verify` |
| **Super Admin** | http://localhost:5173 | `admin` |

> Passwords are **printed once by `pnpm db:seed`** — copy them from that output.
> They are no longer written in the source. To choose your own, run
> `SEED_PASSWORD=your-password pnpm db:seed`.

> The API runs on http://localhost:4000. Every panel needs it — that's what
> `pnpm web` guarantees. If a page looks empty, the API isn't up.

To brand the Booking app, drop `logo.png` and `hero.jpg` into
`apps/booking-web/public/` (see the README there) — it works without them too.

---

## How to check the whole flow works

1. **Booking** (http://localhost:5176): on the New Booking page, turn on
   Morning Tiffin and/or Dinner, pick Item-2, enter headcount, and Confirm — both
   in one page. They appear under My Bookings.
2. **Kitchen** (http://localhost:5174): set the cooking date to the
   booking's date → the order appears under that meal. Open the **Packing Sheet**
   tab → see computed quantities + vessel breakdown → **Download Excel**. Mark the
   order "Start preparing → dispatched → delivered".
3. **Booking** again → "Close out this meal": enter received/consumed/leftover +
   taste/quality → submit.
4. **Verification** (http://localhost:5175): the order shows under
   "To verify" → **Approve**. This closes it and unlocks the booker's next order.
5. **Super Admin** (http://localhost:5173): edit dishes, units, users,
   vessels; view orders; download packing sheets.

---

## If something doesn't show

- **Blank page / "Failed to fetch"** → the API isn't running. Use `pnpm web`, or
  run `pnpm api:dev` in its own terminal.
- **Login says invalid** → run `pnpm db:reset && pnpm db:seed` and use the
  passwords that command prints.
- **Port already in use** → an old process is running: `lsof -ti:4000 | xargs kill`
  (swap 4000 for 5173/5174/5175 as needed).
- **Booking app on phone won't load** → phone and Mac must be on the same WiFi;
  the app auto-detects the Mac's IP.

---

## The four roles

| Role | App | Does |
|---|---|---|
| Booking | Booking (mobile + web) | Places orders (tied to one section, auto-routed) |
| Kitchen Admin | Kitchen | Cook / pack / dispatch, packing sheets |
| Verification Admin | Verification | Verify consumption + feedback, payments |
| Super Admin | Super Admin | Manage everything |
