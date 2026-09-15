# Packing / Delivery Sheet Specification

**Source:** "Brandix Morning/Evening Delivery Sheet — Tuesday, 28 April 2026" (Touch Stone Foundation, Vishakhapatnam)
**Purpose:** Auto-generated Excel handed to the kitchen telling them exactly how much to cook and in which vessels. One sheet per session (Morning tiffin, Evening dinner). Generated automatically once all units' orders are in, downloadable from the Admin page.

---

## 1. Structure of the sheet

For each session (Morning, Evening) there is one block with a header (foundation name, "… Delivery Sheet", date) and a table:

**Left side — Indent (plate counts per kitchen section/route):**

| Col | Meaning |
|---|---|
| S.No | row number |
| Route | kitchen section / unit: Unit-1, Unit-2, Unit-3, Unit-4, Vishaka, Others |
| Idly | Item-1 plate count |
| Biryani | Item-2 plate count (whatever Item-2 was selected that day) |
| Wada | Item-3 plate count |
| Total | Idly + Biryani + Wada plate counts |

**Right side — per-dish quantity + vessel breakdown:**
Each dish gets a `Qty` column plus columns for each available vessel size. The dishes are derived from the day's menu (Item1 + chosen Item2 + Item3), so the column set is **dynamic per day**. On 28 April: Idly, Sambar, FG Chutney, Biryani, Kurma, Wada.

A **Total** row at the bottom sums every column across all units.

---

## 2. Per-plate conversion factors (VERIFIED against the 28 April sheet)

These convert plate counts → cookable quantity. Every value below was confirmed against multiple units on the original sheet.

| Dish | Per plate | Multiplied by | Result unit |
|---|---|---|---|
| **Idly** | 4 | idly plates | count (nos) |
| **Wada** | 4 | wada plates | count (nos) |
| **Sambar** | 60 g | (idly + wada) plates | grams → kg |
| **FG Chutney** | 80 g | (idly + wada) plates | grams → kg |
| **Biryani** | 300 g | biryani plates | grams → kg |
| **Kurma** | 120 g | biryani plates | grams → kg |

> **Key rule:** Sambar and FG Chutney are accompaniments for **both** Idly (Item 1) and Wada (Item 3), so they use the **combined** idly + wada plate count. Kurma accompanies Biryani (Item 2), so it uses biryani plates only.

**Worked check (Unit-2 morning: 250 idly, 650 biryani, 200 wada):**
- Idly = 250 × 4 = **1000** ✓
- Wada = 200 × 4 = **800** ✓
- Sambar = (250 + 200) × 60 = **27.0 kg** ✓
- FG Chutney = 450 × 80 = **36.0 kg** ✓
- Biryani = 650 × 300 = **195.0 kg** ✓
- Kurma = 650 × 120 = **78.0 kg** ✓

> Note: these packing factors (Sambar 60 g, Chutney 80 g, Kurma 120 g) differ slightly from the menu-card display amounts. The **packing factors above are authoritative for cooking quantities** and should be stored per dish, editable by the super admin.

---

## 3. Vessel sizes

**Counted dishes (Idly, Wada)** — vessels measured in number of pieces:
- Morning: **200, 160, 120, 80, 40**
- Evening: **200, 160, 120, 100, 40**

**Weight dishes** — single vessel size each (kg):
- Sambar: **15**
- FG Chutney: **15**
- Biryani: **20**
- Kurma: **15**

> Vessel sizes are **configurable** (note morning uses an 80 vessel, evening a 100). Store as editable config per session.

---

## 4. Fill algorithms

### Counted dishes (Idly, Wada) — vessel breakdown
Given required count `Q` and vessel sizes sorted descending (largest = `L`):
1. Use `n = floor(Q / L)` of the largest vessel `L`. Remainder `r = Q − n·L`.
2. If `r > 0`: pick the **smallest vessel ≥ r** and add **one** of it (round up).
3. If `r == 0`: done.

**Verified examples:**
- 320 idly (evening) → 1×200, remainder 120 → 1×120. **Result: 1-200, 1-120** ✓
- 500 idly (evening) → 2×200, remainder 100 → 1×100. **Result: 2-200, 1-100** ✓
- 600 idly (morning) → 3×200, remainder 0. **Result: 3-200** ✓
- 550 idly → 2×200, remainder 150 → smallest vessel ≥150 is 160 → 1×160. **Result: 2-200, 1-160** ✓

### Weight dishes (Sambar, Chutney, Biryani, Kurma) — vessel count
`vessel_count = required_kg ÷ vessel_size`, shown as a decimal to 1 place (NOT rounded up — it indicates how many vessel-loads).
- Sambar 27.0 kg ÷ 15 = **1.8**; Biryani 195 kg ÷ 20 = **9.8**; Kurma 78 ÷ 15 = **5.2**. ✓

---

## 5. Empty / missing handling
When a unit orders nothing for a dish, leave the cell blank (or 0). Use **blank** for unused vessel columns to keep the sheet readable; use **0** in the Qty/Total columns.

---

## 6. When it generates
- **Tiffin (morning) & Dinner (evening):** ordered **today for tomorrow**.
- **Lunch:** ordered **tomorrow for tomorrow, before 11:00 AM**. *(Earlier infographic said 10:30 AM — confirm which is correct.)*
- Once every kitchen section's order for a session is submitted, the Excel packing sheet is generated automatically and made downloadable on the Admin page.
