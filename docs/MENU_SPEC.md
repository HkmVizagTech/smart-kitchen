# Tiffin Menu Specification (Breakfast & Dinner)

**Source:** "3 Items Menu 1st Jan 2026.xlsx"
**Applies to:** Morning tiffin **and** evening dinner (same menu & rules)
**Cost:** Rs 30.25 per plate
**Rotation:** Week-based (Week 1 below; further weeks rotate)

---

## 1. The selection rule (how an order works)

Every tiffin plate has **three slots**. When a unit orders for a given day:

| Slot | Behaviour | Who decides |
|---|---|---|
| **Item 1** | **Fixed** — identical every day, auto-filled, not editable | System |
| **Item 2** | **Customizable** — warden picks **one** of the 6 available Item-2 sets | Warden |
| **Item 3** | **Fixed per day** — set by the day's menu, auto-filled, not editable | System (per day) |

So the only choice the warden makes is **Item 2**, chosen from the pool of all six days' Item-2 sets. Item 1 and Item 3 are locked by the day.

---

## 2. Week 1 menu

### Item 1 — FIXED (every day, both sessions)
- Idly — **4 nos**
- Sambar — **65 g**
- FG Chutney — **85 g**

### Item 2 — CUSTOMIZABLE (warden picks one of these six sets)

| Option | Dishes (per plate) |
|---|---|
| **A — Mon** | White Rice 300 g + Tomato Dal 150 g + Pachadi |
| **B — Tue** | Biryani 300 g + Kurma 150 g |
| **C — Wed** | Lemon Rice 300 g + Tomato Chutney 50 g |
| **D — Thu** | White Rice 300 g + Tomato Dal 150 g + Pachadi *(same as A)* |
| **E — Fri** | Biryani 300 g + Raita 50 g |
| **F — Sat** | Pulihora 300 g |

### Item 3 — FIXED PER DAY

| Day | Dishes (per plate) |
|---|---|
| **Mon** | Punugulu 120 g + Tomato & FG Chutney 80 g |
| **Tue** | Wada 4 nos + Sambar 75 g + FG Chutney 85 g |
| **Wed** | Semiya Uppama 300 g + Chutney 85 g |
| **Thu** | Mysore / Rawa Bhonda 4 nos + Sambar 75 g + FG Chutney 85 g |
| **Fri** | Wada 4 nos (30 g each) + Sambar 75 g + FG Chutney 85 g |
| **Sat** | Bansi Rawa Uppama 300 g + FG Chutney 85 g |

---

## 3. Dish catalog (per-plate quantities → drives prep sheet)

These are the raw components and their per-plate amounts. The central prep sheet = Σ (per-plate qty × plate count) across all units.

| Dish | Qty / plate | Unit |
|---|---|---|
| Idly | 4 | nos |
| Sambar (Item1) | 65 | g |
| FG Chutney (Item1) | 85 | g |
| White Rice | 300 | g |
| Tomato Dal | 150 | g |
| Pachadi | TBD | g |
| Biryani | 300 | g |
| Kurma | 150 | g |
| Lemon Rice | 300 | g |
| Tomato Chutney | 50 | g |
| Raita | 50 | g |
| Pulihora | 300 | g |
| Punugulu | 120 | g |
| Tomato & FG Chutney | 80 | g |
| Wada | 4 | nos |
| Sambar (Item3) | 75 | g |
| FG Chutney (Item3) | 85 | g |
| Semiya Uppama | 300 | g |
| Chutney | 85 | g |
| Mysore / Rawa Bhonda | 4 | nos |
| Bansi Rawa Uppama | 300 | g |

> **To confirm:** Pachadi quantity (sheet says "Pachadi Grms" without a number), and the per-plate weight of Pulihora.

---

## 4. How this maps to the database

Two new ideas drive the schema: dishes are reusable components, and a day's menu is built from **slots** that are either fixed or customizable.

| Table | Purpose | Key fields |
|---|---|---|
| `dishes` | Master catalog of every food component | id, name, qty_per_plate, unit (`nos`/`g`) |
| `item2_options` | The selectable Item-2 sets | id, label (A–F), dish_ids[] |
| `menu_templates` | A day's menu for a session | id, week_no, day, session (`breakfast`/`dinner`), item1_dish_ids[], item3_dish_ids[], default_item2_option_id |
| `menu_rotation` | Maps calendar dates → week_no | date, week_no |

**Order record** then stores: unit, date, session, plate_count, and the **chosen** `item2_option_id`. Item 1 and Item 3 are read from the day's `menu_template` — never stored per order, so they stay locked.

**Prep-sheet calc:** for each order, expand Item1 + chosen Item2 + Item3 into dishes, multiply each dish's `qty_per_plate × plate_count`, then sum every dish across all units for that session/date.

---

## 5. Open items
1. Pachadi per-plate grams (missing in sheet).
2. Pulihora per-plate grams (assumed 300 g).
3. Other rotation weeks (Week 2, 3, …) — needed to finish the rotation table.
4. Confirm dinner uses the **same week/day mapping** as breakfast (i.e., Monday dinner = Monday tiffin items), or whether dinner has a different day offset.
