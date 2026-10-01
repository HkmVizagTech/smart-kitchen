-- Smart Kitchen: bring production up to the current schema and menu.
--
-- Run this ONCE in Railway -> Postgres -> Query. It is written to be safe to
-- re-run: every statement either guards itself or upserts, so a second run
-- changes nothing.
--
-- It does four things:
--   1. creates the Day enum and the two menu tables db:push never created
--   2. adds the 42 dishes the lunch menu needs
--   3. corrects three packing factors that were wrong against the kitchen's
--      own sheet, and makes Kurma an accompaniment
--   4. loads the repeating weekly menu the booking screen reads
--
-- Nothing here touches orders, users, or anything already recorded.

BEGIN;

-- ---------------------------------------------------------------- 1. schema
DO $$ BEGIN
  CREATE TYPE "Day" AS ENUM ('MON','TUE','WED','THU','FRI','SAT','SUN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "MenuSlot" (
  id          SERIAL PRIMARY KEY,
  session     "Session"   NOT NULL,
  week        INTEGER     NOT NULL DEFAULT 1,
  day         "Day"       NOT NULL,
  "group"     "DishGroup",
  "sortOrder" INTEGER     NOT NULL DEFAULT 0,
  "dishId"    INTEGER     NOT NULL REFERENCES "Dish"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  date        TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "MenuSlot_session_week_day_idx" ON "MenuSlot" (session, week, day);
CREATE INDEX IF NOT EXISTS "MenuSlot_session_date_idx"     ON "MenuSlot" (session, date);

CREATE TABLE IF NOT EXISTS "MenuSlotAccompaniment" (
  id       SERIAL PRIMARY KEY,
  "slotId" INTEGER NOT NULL REFERENCES "MenuSlot"(id) ON UPDATE CASCADE ON DELETE CASCADE,
  "dishId" INTEGER NOT NULL REFERENCES "Dish"(id)     ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS "MenuSlotAccompaniment_slotId_dishId_key"
  ON "MenuSlotAccompaniment" ("slotId", "dishId");

-- ---------------------------------------------------------------- 2. dishes
-- The lunch menu's dishes. ON CONFLICT means a re-run leaves any edit you have
-- since made in the Dishes screen alone.

INSERT INTO "Dish" (name, "group", bookable, accompaniment, "sortOrder", "qtyPerPlate", unit, "packingFactor", "packingVesselKg") VALUES
  ('Tomato Chutney', 'ITEM1', true, true, 4, 50, 'G', 50, 15),
  ('Rice', 'ITEM2', false, false, 100, 0, 'G', 0, 15),
  ('Louki Dal', 'ITEM2', false, false, 101, 0, 'G', 0, 15),
  ('Coconut Rice', 'ITEM2', false, false, 103, 0, 'G', 0, 15),
  ('Vankaya Batani', 'ITEM2', false, false, 104, 0, 'G', 0, 15),
  ('Papad', 'ITEM2', false, false, 105, 0, 'G', 0, 15),
  ('Cabbage Pachadi', 'ITEM2', false, false, 106, 0, 'G', 0, 15),
  ('Vammu Rasam', 'ITEM2', false, false, 108, 0, 'G', 0, 15),
  ('Banana Fruit', 'ITEM2', false, false, 109, 0, 'G', 0, 15),
  ('Cabbage Fry', 'ITEM2', false, false, 110, 0, 'G', 0, 15),
  ('Mini Saggu Papad', 'ITEM2', false, false, 111, 0, 'G', 0, 15),
  ('Coconut Pachadi', 'ITEM2', false, false, 112, 0, 'G', 0, 15),
  ('Dosakaya Dal', 'ITEM2', false, false, 113, 0, 'G', 0, 15),
  ('Anawaram Sweet', 'ITEM2', false, false, 114, 0, 'G', 0, 15),
  ('Aloo Capsicum Fry', 'ITEM2', false, false, 115, 0, 'G', 0, 15),
  ('Fryums', 'ITEM2', false, false, 116, 0, 'G', 0, 15),
  ('Dondakaya Pachadi', 'ITEM2', false, false, 117, 0, 'G', 0, 15),
  ('Gongora Dal', 'ITEM2', false, false, 118, 0, 'G', 0, 15),
  ('Miryalu Rasam', 'ITEM2', false, false, 119, 0, 'G', 0, 15),
  ('Pudina Rice', 'ITEM2', false, false, 120, 0, 'G', 0, 15),
  ('Donda Fry', 'ITEM2', false, false, 121, 0, 'G', 0, 15),
  ('Anapkaya Pachadi', 'ITEM2', false, false, 122, 0, 'G', 0, 15),
  ('Vankaya Dal', 'ITEM2', false, false, 123, 0, 'G', 0, 15),
  ('Raw Banana Fry', 'ITEM2', false, false, 124, 0, 'G', 0, 15),
  ('Gongora Pachadi', 'ITEM2', false, false, 125, 0, 'G', 0, 15),
  ('Tomato Rasam', 'ITEM2', false, false, 126, 0, 'G', 0, 15),
  ('Bhundi Sweet', 'ITEM2', false, false, 127, 0, 'G', 0, 15),
  ('Aloo Fry', 'ITEM2', false, false, 128, 0, 'G', 0, 15),
  ('Mix Veg Pachadi', 'ITEM2', false, false, 129, 0, 'G', 0, 15),
  ('Mango Pappu', 'ITEM2', false, false, 130, 0, 'G', 0, 15),
  ('Pepper Rasam', 'ITEM2', false, false, 131, 0, 'G', 0, 15),
  ('Curd', 'ITEM2', false, false, 132, 0, 'G', 0, 15),
  ('Saggu Papad', 'ITEM2', false, false, 133, 0, 'G', 0, 15),
  ('Gongora Pappu', 'ITEM2', false, false, 134, 0, 'G', 0, 15),
  ('Rasam', 'ITEM2', false, false, 135, 0, 'G', 0, 15),
  ('Bhendi Fry', 'ITEM2', false, false, 136, 0, 'G', 0, 15),
  ('Donda Pachadi', 'ITEM2', false, false, 137, 0, 'G', 0, 15),
  ('Jeera Pappu', 'ITEM2', false, false, 138, 0, 'G', 0, 15),
  ('Tomato Pappu', 'ITEM2', false, false, 139, 0, 'G', 0, 15),
  ('Dondakaya Fry', 'ITEM2', false, false, 140, 0, 'G', 0, 15),
  ('Dosakaya Pappu', 'ITEM2', false, false, 141, 0, 'G', 0, 15),
  ('Veg Sambar', 'ITEM2', false, false, 142, 0, 'G', 0, 15)
ON CONFLICT (name) DO NOTHING;

-- ------------------------------------------------- 3. corrected packing factors
-- Reverse-engineered from the kitchen's own 28 Apr packing sheet. The old
-- values made the kitchen cook roughly 8% too much sambar and chutney, and
-- 25% too much kurma, every single day.
UPDATE "Dish" SET "packingFactor" = 60  WHERE name = 'Sambar';
UPDATE "Dish" SET "packingFactor" = 80  WHERE name = 'FG Chutney';
UPDATE "Dish" SET "packingFactor" = 120, accompaniment = true WHERE name = 'Kurma';

-- ---------------------------------------------------------------- 4. the menu
-- Wiped and rewritten rather than merged, so a re-run cannot leave a day with
-- a stale fourth line nobody can see. Any one-day overrides (date IS NOT NULL)
-- are left untouched.
DELETE FROM "MenuSlotAccompaniment"
  WHERE "slotId" IN (SELECT id FROM "MenuSlot" WHERE date IS NULL);
DELETE FROM "MenuSlot" WHERE date IS NULL;


WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'BREAKFAST', 1, 'MON', 'ITEM1', 0, id FROM "Dish" WHERE name = 'Idly'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('FG Chutney', 'Sambar');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'BREAKFAST', 1, 'MON', 'ITEM2', 1, id FROM "Dish" WHERE name = 'White Rice'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('Pachadi', 'Tomato Dal');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'BREAKFAST', 1, 'MON', 'ITEM3', 2, id FROM "Dish" WHERE name = 'Punugulu'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('FG Chutney', 'Tomato Chutney');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'BREAKFAST', 1, 'TUE', 'ITEM1', 0, id FROM "Dish" WHERE name = 'Idly'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('FG Chutney', 'Sambar');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'BREAKFAST', 1, 'TUE', 'ITEM2', 1, id FROM "Dish" WHERE name = 'Biryani'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('Kurma');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'BREAKFAST', 1, 'TUE', 'ITEM3', 2, id FROM "Dish" WHERE name = 'Wada'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('FG Chutney', 'Sambar');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'BREAKFAST', 1, 'WED', 'ITEM1', 0, id FROM "Dish" WHERE name = 'Idly'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('FG Chutney', 'Sambar');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'BREAKFAST', 1, 'WED', 'ITEM2', 1, id FROM "Dish" WHERE name = 'Lemon Rice'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('Tomato Chutney');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'BREAKFAST', 1, 'WED', 'ITEM3', 2, id FROM "Dish" WHERE name = 'Semiya Uppama'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('FG Chutney');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'BREAKFAST', 1, 'THU', 'ITEM1', 0, id FROM "Dish" WHERE name = 'Idly'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('FG Chutney', 'Sambar');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'BREAKFAST', 1, 'THU', 'ITEM2', 1, id FROM "Dish" WHERE name = 'White Rice'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('Pachadi', 'Tomato Dal');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'BREAKFAST', 1, 'THU', 'ITEM3', 2, id FROM "Dish" WHERE name = 'Mysore/Rawa Bhonda'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('FG Chutney', 'Sambar');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'BREAKFAST', 1, 'FRI', 'ITEM1', 0, id FROM "Dish" WHERE name = 'Idly'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('FG Chutney', 'Sambar');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'BREAKFAST', 1, 'FRI', 'ITEM2', 1, id FROM "Dish" WHERE name = 'Biryani'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('Raita');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'BREAKFAST', 1, 'FRI', 'ITEM3', 2, id FROM "Dish" WHERE name = 'Wada'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('FG Chutney', 'Sambar');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'BREAKFAST', 1, 'SAT', 'ITEM1', 0, id FROM "Dish" WHERE name = 'Idly'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('FG Chutney', 'Sambar');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'BREAKFAST', 1, 'SAT', 'ITEM2', 1, id FROM "Dish" WHERE name = 'Pulihora'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'BREAKFAST', 1, 'SAT', 'ITEM3', 2, id FROM "Dish" WHERE name = 'Bansi Rawa Uppama'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('FG Chutney');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'MON', NULL, 0, id FROM "Dish" WHERE name = 'Rice'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'MON', NULL, 1, id FROM "Dish" WHERE name = 'Louki Dal'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'MON', NULL, 2, id FROM "Dish" WHERE name = 'Sambar'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'MON', NULL, 3, id FROM "Dish" WHERE name = 'Coconut Rice'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'MON', NULL, 4, id FROM "Dish" WHERE name = 'Vankaya Batani'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'MON', NULL, 5, id FROM "Dish" WHERE name = 'Papad'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'MON', NULL, 6, id FROM "Dish" WHERE name = 'Cabbage Pachadi'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'TUE', NULL, 0, id FROM "Dish" WHERE name = 'Rice'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'TUE', NULL, 1, id FROM "Dish" WHERE name = 'Tomato Dal'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'TUE', NULL, 2, id FROM "Dish" WHERE name = 'Vammu Rasam'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'TUE', NULL, 3, id FROM "Dish" WHERE name = 'Banana Fruit'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'TUE', NULL, 4, id FROM "Dish" WHERE name = 'Cabbage Fry'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'TUE', NULL, 5, id FROM "Dish" WHERE name = 'Mini Saggu Papad'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'TUE', NULL, 6, id FROM "Dish" WHERE name = 'Coconut Pachadi'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'WED', NULL, 0, id FROM "Dish" WHERE name = 'Rice'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'WED', NULL, 1, id FROM "Dish" WHERE name = 'Dosakaya Dal'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'WED', NULL, 2, id FROM "Dish" WHERE name = 'Sambar'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'WED', NULL, 3, id FROM "Dish" WHERE name = 'Anawaram Sweet'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'WED', NULL, 4, id FROM "Dish" WHERE name = 'Aloo Capsicum Fry'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'WED', NULL, 5, id FROM "Dish" WHERE name = 'Fryums'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'WED', NULL, 6, id FROM "Dish" WHERE name = 'Dondakaya Pachadi'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'THU', NULL, 0, id FROM "Dish" WHERE name = 'Rice'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'THU', NULL, 1, id FROM "Dish" WHERE name = 'Gongora Dal'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'THU', NULL, 2, id FROM "Dish" WHERE name = 'Miryalu Rasam'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'THU', NULL, 3, id FROM "Dish" WHERE name = 'Pudina Rice'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'THU', NULL, 4, id FROM "Dish" WHERE name = 'Donda Fry'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'THU', NULL, 5, id FROM "Dish" WHERE name = 'Papad'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'THU', NULL, 6, id FROM "Dish" WHERE name = 'Anapkaya Pachadi'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'FRI', NULL, 0, id FROM "Dish" WHERE name = 'Rice'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'FRI', NULL, 1, id FROM "Dish" WHERE name = 'Vankaya Dal'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'FRI', NULL, 2, id FROM "Dish" WHERE name = 'Sambar'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'FRI', NULL, 3, id FROM "Dish" WHERE name = 'Banana Fruit'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'FRI', NULL, 4, id FROM "Dish" WHERE name = 'Raw Banana Fry'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'FRI', NULL, 5, id FROM "Dish" WHERE name = 'Mini Saggu Papad'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'FRI', NULL, 6, id FROM "Dish" WHERE name = 'Gongora Pachadi'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'SAT', NULL, 0, id FROM "Dish" WHERE name = 'Rice'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'SAT', NULL, 1, id FROM "Dish" WHERE name = 'Tomato Dal'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'SAT', NULL, 2, id FROM "Dish" WHERE name = 'Tomato Rasam'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'SAT', NULL, 3, id FROM "Dish" WHERE name = 'Bhundi Sweet'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'SAT', NULL, 4, id FROM "Dish" WHERE name = 'Aloo Fry'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'SAT', NULL, 5, id FROM "Dish" WHERE name = 'Fryums'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 1, 'SAT', NULL, 6, id FROM "Dish" WHERE name = 'Mix Veg Pachadi'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'MON', NULL, 0, id FROM "Dish" WHERE name = 'Rice'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'MON', NULL, 1, id FROM "Dish" WHERE name = 'Mango Pappu'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'MON', NULL, 2, id FROM "Dish" WHERE name = 'Pepper Rasam'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'MON', NULL, 3, id FROM "Dish" WHERE name = 'Pudina Rice'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'MON', NULL, 4, id FROM "Dish" WHERE name = 'Cabbage Fry'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'MON', NULL, 5, id FROM "Dish" WHERE name = 'Curd'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'MON', NULL, 6, id FROM "Dish" WHERE name = 'Anapkaya Pachadi'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'MON', NULL, 7, id FROM "Dish" WHERE name = 'Fryums'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'TUE', NULL, 0, id FROM "Dish" WHERE name = 'Rice'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'TUE', NULL, 1, id FROM "Dish" WHERE name = 'Vankaya Dal'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'TUE', NULL, 2, id FROM "Dish" WHERE name = 'Sambar'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'TUE', NULL, 3, id FROM "Dish" WHERE name = 'Banana Fruit'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'TUE', NULL, 4, id FROM "Dish" WHERE name = 'Aloo Capsicum Fry'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'TUE', NULL, 5, id FROM "Dish" WHERE name = 'Curd'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'TUE', NULL, 6, id FROM "Dish" WHERE name = 'Cabbage Pachadi'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'TUE', NULL, 7, id FROM "Dish" WHERE name = 'Saggu Papad'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'WED', NULL, 0, id FROM "Dish" WHERE name = 'Rice'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'WED', NULL, 1, id FROM "Dish" WHERE name = 'Gongora Pappu'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'WED', NULL, 2, id FROM "Dish" WHERE name = 'Rasam'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'WED', NULL, 3, id FROM "Dish" WHERE name = 'Bhundi Sweet'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'WED', NULL, 4, id FROM "Dish" WHERE name = 'Bhendi Fry'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'WED', NULL, 5, id FROM "Dish" WHERE name = 'Curd'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'WED', NULL, 6, id FROM "Dish" WHERE name = 'Donda Pachadi'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'WED', NULL, 7, id FROM "Dish" WHERE name = 'Fryums'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'THU', NULL, 0, id FROM "Dish" WHERE name = 'Rice'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'THU', NULL, 1, id FROM "Dish" WHERE name = 'Jeera Pappu'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'THU', NULL, 2, id FROM "Dish" WHERE name = 'Sambar'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'THU', NULL, 3, id FROM "Dish" WHERE name = 'Coconut Rice'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'THU', NULL, 4, id FROM "Dish" WHERE name = 'Raw Banana Fry'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'THU', NULL, 5, id FROM "Dish" WHERE name = 'Curd'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'THU', NULL, 6, id FROM "Dish" WHERE name = 'Gongora Pachadi'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'THU', NULL, 7, id FROM "Dish" WHERE name = 'Saggu Papad'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'FRI', NULL, 0, id FROM "Dish" WHERE name = 'Rice'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'FRI', NULL, 1, id FROM "Dish" WHERE name = 'Tomato Pappu'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'FRI', NULL, 2, id FROM "Dish" WHERE name = 'Rasam'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'FRI', NULL, 3, id FROM "Dish" WHERE name = 'Banana Fruit'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'FRI', NULL, 4, id FROM "Dish" WHERE name = 'Dondakaya Fry'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'FRI', NULL, 5, id FROM "Dish" WHERE name = 'Curd'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'FRI', NULL, 6, id FROM "Dish" WHERE name = 'Mix Veg Pachadi'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'FRI', NULL, 7, id FROM "Dish" WHERE name = 'Fryums'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'SAT', NULL, 0, id FROM "Dish" WHERE name = 'Rice'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'SAT', NULL, 1, id FROM "Dish" WHERE name = 'Dosakaya Pappu'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'SAT', NULL, 2, id FROM "Dish" WHERE name = 'Veg Sambar'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'SAT', NULL, 3, id FROM "Dish" WHERE name = 'Anawaram Sweet'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'SAT', NULL, 4, id FROM "Dish" WHERE name = 'Aloo Fry'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'SAT', NULL, 5, id FROM "Dish" WHERE name = 'Curd'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'SAT', NULL, 6, id FROM "Dish" WHERE name = 'Coconut Pachadi'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'LUNCH', 2, 'SAT', NULL, 7, id FROM "Dish" WHERE name = 'Papad'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'DINNER', 1, 'MON', 'ITEM1', 0, id FROM "Dish" WHERE name = 'Idly'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('FG Chutney', 'Sambar');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'DINNER', 1, 'MON', 'ITEM2', 1, id FROM "Dish" WHERE name = 'White Rice'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('Pachadi', 'Tomato Dal');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'DINNER', 1, 'MON', 'ITEM3', 2, id FROM "Dish" WHERE name = 'Punugulu'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('FG Chutney', 'Tomato Chutney');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'DINNER', 1, 'TUE', 'ITEM1', 0, id FROM "Dish" WHERE name = 'Idly'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('FG Chutney', 'Sambar');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'DINNER', 1, 'TUE', 'ITEM2', 1, id FROM "Dish" WHERE name = 'Biryani'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('Kurma');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'DINNER', 1, 'TUE', 'ITEM3', 2, id FROM "Dish" WHERE name = 'Wada'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('FG Chutney', 'Sambar');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'DINNER', 1, 'WED', 'ITEM1', 0, id FROM "Dish" WHERE name = 'Idly'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('FG Chutney', 'Sambar');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'DINNER', 1, 'WED', 'ITEM2', 1, id FROM "Dish" WHERE name = 'Lemon Rice'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('Tomato Chutney');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'DINNER', 1, 'WED', 'ITEM3', 2, id FROM "Dish" WHERE name = 'Semiya Uppama'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('FG Chutney');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'DINNER', 1, 'THU', 'ITEM1', 0, id FROM "Dish" WHERE name = 'Idly'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('FG Chutney', 'Sambar');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'DINNER', 1, 'THU', 'ITEM2', 1, id FROM "Dish" WHERE name = 'White Rice'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('Pachadi', 'Tomato Dal');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'DINNER', 1, 'THU', 'ITEM3', 2, id FROM "Dish" WHERE name = 'Mysore/Rawa Bhonda'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('FG Chutney', 'Sambar');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'DINNER', 1, 'FRI', 'ITEM1', 0, id FROM "Dish" WHERE name = 'Idly'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('FG Chutney', 'Sambar');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'DINNER', 1, 'FRI', 'ITEM2', 1, id FROM "Dish" WHERE name = 'Biryani'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('Raita');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'DINNER', 1, 'FRI', 'ITEM3', 2, id FROM "Dish" WHERE name = 'Wada'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('FG Chutney', 'Sambar');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'DINNER', 1, 'SAT', 'ITEM1', 0, id FROM "Dish" WHERE name = 'Idly'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('FG Chutney', 'Sambar');

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'DINNER', 1, 'SAT', 'ITEM2', 1, id FROM "Dish" WHERE name = 'Pulihora'
  RETURNING id
)
SELECT count(*) FROM s;

WITH s AS (
  INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
  SELECT 'DINNER', 1, 'SAT', 'ITEM3', 2, id FROM "Dish" WHERE name = 'Bansi Rawa Uppama'
  RETURNING id
)
INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
  SELECT s.id, d.id FROM s, "Dish" d WHERE d.name IN ('FG Chutney');

COMMIT;

-- Check it worked: this should print one row per meal with a slot count.
SELECT session, count(*) AS lines, count(DISTINCT day) AS days
FROM "MenuSlot" WHERE date IS NULL GROUP BY session ORDER BY session;
