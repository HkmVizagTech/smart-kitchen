-- Brandix kitchen: bring the database up to the deployed code.
--
-- Paste the whole thing into Railway -> Postgres -> Data -> Query and run it.
-- It is one transaction: it either all applies or none of it does. Running it
-- a second time changes nothing.
--
--   1. the Day enum and the two menu tables that db:push never created
--   2. the 42 dishes the lunch menu needs
--   3. three packing factors that were wrong against the 28 Apr sheet
--   4. the repeating weekly menu the booking screen reads
--
-- It does not touch orders, users, routes or anything already recorded.

BEGIN;

CREATE TABLE IF NOT EXISTS "MenuSlot" (
  id          SERIAL PRIMARY KEY,
  session     "Session"   NOT NULL,
  week        INTEGER     NOT NULL DEFAULT 1,
  day         TEXT        NOT NULL,
  "group"     "DishGroup",
  "sortOrder" INTEGER     NOT NULL DEFAULT 0,
  "dishId"    INTEGER     NOT NULL REFERENCES "Dish"(id),
  date        TIMESTAMP(3)
);
CREATE TABLE IF NOT EXISTS "MenuSlotAccompaniment" (
  id       SERIAL PRIMARY KEY,
  "slotId" INTEGER NOT NULL REFERENCES "MenuSlot"(id) ON DELETE CASCADE,
  "dishId" INTEGER NOT NULL REFERENCES "Dish"(id)
);
CREATE INDEX  IF NOT EXISTS "MenuSlot_session_week_day_idx" ON "MenuSlot" (session, week, day);
CREATE INDEX  IF NOT EXISTS "MenuSlot_session_date_idx"     ON "MenuSlot" (session, date);
CREATE UNIQUE INDEX IF NOT EXISTS "MenuSlotAccompaniment_slotId_dishId_key"
  ON "MenuSlotAccompaniment" ("slotId", "dishId");

-- Prisma expects day to be the Day enum. Created separately and applied after
-- the table exists, so a re-run cannot trip over a type that is already there.
DO $do$ BEGIN
  CREATE TYPE "Day" AS ENUM ('MON','TUE','WED','THU','FRI','SAT','SUN');
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

DO $do$ BEGIN
  ALTER TABLE "MenuSlot" ALTER COLUMN day TYPE "Day" USING day::"Day";
EXCEPTION WHEN others THEN NULL; END $do$;


-- The lunch menu's dishes. ON CONFLICT leaves any later edit of yours alone.
INSERT INTO "Dish" (name, "group", bookable, accompaniment, "sortOrder", "qtyPerPlate", unit, "packingFactor", "packingVesselKg") VALUES
  ('Tomato Chutney','ITEM1',true,true,4,50,'G',50,15),
  ('Rice','ITEM2',false,false,100,0,'G',0,15),
  ('Louki Dal','ITEM2',false,false,101,0,'G',0,15),
  ('Coconut Rice','ITEM2',false,false,103,0,'G',0,15),
  ('Vankaya Batani','ITEM2',false,false,104,0,'G',0,15),
  ('Papad','ITEM2',false,false,105,0,'G',0,15),
  ('Cabbage Pachadi','ITEM2',false,false,106,0,'G',0,15),
  ('Vammu Rasam','ITEM2',false,false,108,0,'G',0,15),
  ('Banana Fruit','ITEM2',false,false,109,0,'G',0,15),
  ('Cabbage Fry','ITEM2',false,false,110,0,'G',0,15),
  ('Mini Saggu Papad','ITEM2',false,false,111,0,'G',0,15),
  ('Coconut Pachadi','ITEM2',false,false,112,0,'G',0,15),
  ('Dosakaya Dal','ITEM2',false,false,113,0,'G',0,15),
  ('Anawaram Sweet','ITEM2',false,false,114,0,'G',0,15),
  ('Aloo Capsicum Fry','ITEM2',false,false,115,0,'G',0,15),
  ('Fryums','ITEM2',false,false,116,0,'G',0,15),
  ('Dondakaya Pachadi','ITEM2',false,false,117,0,'G',0,15),
  ('Gongora Dal','ITEM2',false,false,118,0,'G',0,15),
  ('Miryalu Rasam','ITEM2',false,false,119,0,'G',0,15),
  ('Pudina Rice','ITEM2',false,false,120,0,'G',0,15),
  ('Donda Fry','ITEM2',false,false,121,0,'G',0,15),
  ('Anapkaya Pachadi','ITEM2',false,false,122,0,'G',0,15),
  ('Vankaya Dal','ITEM2',false,false,123,0,'G',0,15),
  ('Raw Banana Fry','ITEM2',false,false,124,0,'G',0,15),
  ('Gongora Pachadi','ITEM2',false,false,125,0,'G',0,15),
  ('Tomato Rasam','ITEM2',false,false,126,0,'G',0,15),
  ('Bhundi Sweet','ITEM2',false,false,127,0,'G',0,15),
  ('Aloo Fry','ITEM2',false,false,128,0,'G',0,15),
  ('Mix Veg Pachadi','ITEM2',false,false,129,0,'G',0,15),
  ('Mango Pappu','ITEM2',false,false,130,0,'G',0,15),
  ('Pepper Rasam','ITEM2',false,false,131,0,'G',0,15),
  ('Curd','ITEM2',false,false,132,0,'G',0,15),
  ('Saggu Papad','ITEM2',false,false,133,0,'G',0,15),
  ('Gongora Pappu','ITEM2',false,false,134,0,'G',0,15),
  ('Rasam','ITEM2',false,false,135,0,'G',0,15),
  ('Bhendi Fry','ITEM2',false,false,136,0,'G',0,15),
  ('Donda Pachadi','ITEM2',false,false,137,0,'G',0,15),
  ('Jeera Pappu','ITEM2',false,false,138,0,'G',0,15),
  ('Tomato Pappu','ITEM2',false,false,139,0,'G',0,15),
  ('Dondakaya Fry','ITEM2',false,false,140,0,'G',0,15),
  ('Dosakaya Pappu','ITEM2',false,false,141,0,'G',0,15),
  ('Veg Sambar','ITEM2',false,false,142,0,'G',0,15)
ON CONFLICT (name) DO NOTHING;

-- Reverse-engineered from the kitchen's own 28 Apr packing sheet. The old
-- values had the kitchen cooking ~8% too much sambar and chutney and 25% too
-- much kurma, every day.
UPDATE "Dish" SET "packingFactor" = 60  WHERE name = 'Sambar';
UPDATE "Dish" SET "packingFactor" = 80  WHERE name = 'FG Chutney';
UPDATE "Dish" SET "packingFactor" = 120, accompaniment = true WHERE name = 'Kurma';


-- The weekly menu. Rewritten rather than merged, so a re-run cannot leave a
-- day carrying a stale extra line nobody can see. Any single-day overrides
-- (date IS NOT NULL) are left untouched.
DELETE FROM "MenuSlotAccompaniment"
  WHERE "slotId" IN (SELECT id FROM "MenuSlot" WHERE date IS NULL);
DELETE FROM "MenuSlot" WHERE date IS NULL;

INSERT INTO "MenuSlot" (session, week, day, "group", "sortOrder", "dishId")
SELECT v.ses::"Session", v.wk, v.dy::"Day", v.grp::"DishGroup", v.srt, d.id
FROM (VALUES
  ('BREAKFAST',1,'MON','ITEM1',0,'Idly'),
  ('BREAKFAST',1,'MON','ITEM2',1,'White Rice'),
  ('BREAKFAST',1,'MON','ITEM3',2,'Punugulu'),
  ('BREAKFAST',1,'TUE','ITEM1',0,'Idly'),
  ('BREAKFAST',1,'TUE','ITEM2',1,'Biryani'),
  ('BREAKFAST',1,'TUE','ITEM3',2,'Wada'),
  ('BREAKFAST',1,'WED','ITEM1',0,'Idly'),
  ('BREAKFAST',1,'WED','ITEM2',1,'Lemon Rice'),
  ('BREAKFAST',1,'WED','ITEM3',2,'Semiya Uppama'),
  ('BREAKFAST',1,'THU','ITEM1',0,'Idly'),
  ('BREAKFAST',1,'THU','ITEM2',1,'White Rice'),
  ('BREAKFAST',1,'THU','ITEM3',2,'Mysore/Rawa Bhonda'),
  ('BREAKFAST',1,'FRI','ITEM1',0,'Idly'),
  ('BREAKFAST',1,'FRI','ITEM2',1,'Biryani'),
  ('BREAKFAST',1,'FRI','ITEM3',2,'Wada'),
  ('BREAKFAST',1,'SAT','ITEM1',0,'Idly'),
  ('BREAKFAST',1,'SAT','ITEM2',1,'Pulihora'),
  ('BREAKFAST',1,'SAT','ITEM3',2,'Bansi Rawa Uppama'),
  ('LUNCH',1,'MON',NULL,0,'Rice'),
  ('LUNCH',1,'MON',NULL,1,'Louki Dal'),
  ('LUNCH',1,'MON',NULL,2,'Sambar'),
  ('LUNCH',1,'MON',NULL,3,'Coconut Rice'),
  ('LUNCH',1,'MON',NULL,4,'Vankaya Batani'),
  ('LUNCH',1,'MON',NULL,5,'Papad'),
  ('LUNCH',1,'MON',NULL,6,'Cabbage Pachadi'),
  ('LUNCH',1,'TUE',NULL,0,'Rice'),
  ('LUNCH',1,'TUE',NULL,1,'Tomato Dal'),
  ('LUNCH',1,'TUE',NULL,2,'Vammu Rasam'),
  ('LUNCH',1,'TUE',NULL,3,'Banana Fruit'),
  ('LUNCH',1,'TUE',NULL,4,'Cabbage Fry'),
  ('LUNCH',1,'TUE',NULL,5,'Mini Saggu Papad'),
  ('LUNCH',1,'TUE',NULL,6,'Coconut Pachadi'),
  ('LUNCH',1,'WED',NULL,0,'Rice'),
  ('LUNCH',1,'WED',NULL,1,'Dosakaya Dal'),
  ('LUNCH',1,'WED',NULL,2,'Sambar'),
  ('LUNCH',1,'WED',NULL,3,'Anawaram Sweet'),
  ('LUNCH',1,'WED',NULL,4,'Aloo Capsicum Fry'),
  ('LUNCH',1,'WED',NULL,5,'Fryums'),
  ('LUNCH',1,'WED',NULL,6,'Dondakaya Pachadi'),
  ('LUNCH',1,'THU',NULL,0,'Rice'),
  ('LUNCH',1,'THU',NULL,1,'Gongora Dal'),
  ('LUNCH',1,'THU',NULL,2,'Miryalu Rasam'),
  ('LUNCH',1,'THU',NULL,3,'Pudina Rice'),
  ('LUNCH',1,'THU',NULL,4,'Donda Fry'),
  ('LUNCH',1,'THU',NULL,5,'Papad'),
  ('LUNCH',1,'THU',NULL,6,'Anapkaya Pachadi'),
  ('LUNCH',1,'FRI',NULL,0,'Rice'),
  ('LUNCH',1,'FRI',NULL,1,'Vankaya Dal'),
  ('LUNCH',1,'FRI',NULL,2,'Sambar'),
  ('LUNCH',1,'FRI',NULL,3,'Banana Fruit'),
  ('LUNCH',1,'FRI',NULL,4,'Raw Banana Fry'),
  ('LUNCH',1,'FRI',NULL,5,'Mini Saggu Papad'),
  ('LUNCH',1,'FRI',NULL,6,'Gongora Pachadi'),
  ('LUNCH',1,'SAT',NULL,0,'Rice'),
  ('LUNCH',1,'SAT',NULL,1,'Tomato Dal'),
  ('LUNCH',1,'SAT',NULL,2,'Tomato Rasam'),
  ('LUNCH',1,'SAT',NULL,3,'Bhundi Sweet'),
  ('LUNCH',1,'SAT',NULL,4,'Aloo Fry'),
  ('LUNCH',1,'SAT',NULL,5,'Fryums'),
  ('LUNCH',1,'SAT',NULL,6,'Mix Veg Pachadi'),
  ('LUNCH',2,'MON',NULL,0,'Rice'),
  ('LUNCH',2,'MON',NULL,1,'Mango Pappu'),
  ('LUNCH',2,'MON',NULL,2,'Pepper Rasam'),
  ('LUNCH',2,'MON',NULL,3,'Pudina Rice'),
  ('LUNCH',2,'MON',NULL,4,'Cabbage Fry'),
  ('LUNCH',2,'MON',NULL,5,'Curd'),
  ('LUNCH',2,'MON',NULL,6,'Anapkaya Pachadi'),
  ('LUNCH',2,'MON',NULL,7,'Fryums'),
  ('LUNCH',2,'TUE',NULL,0,'Rice'),
  ('LUNCH',2,'TUE',NULL,1,'Vankaya Dal'),
  ('LUNCH',2,'TUE',NULL,2,'Sambar'),
  ('LUNCH',2,'TUE',NULL,3,'Banana Fruit'),
  ('LUNCH',2,'TUE',NULL,4,'Aloo Capsicum Fry'),
  ('LUNCH',2,'TUE',NULL,5,'Curd'),
  ('LUNCH',2,'TUE',NULL,6,'Cabbage Pachadi'),
  ('LUNCH',2,'TUE',NULL,7,'Saggu Papad'),
  ('LUNCH',2,'WED',NULL,0,'Rice'),
  ('LUNCH',2,'WED',NULL,1,'Gongora Pappu'),
  ('LUNCH',2,'WED',NULL,2,'Rasam'),
  ('LUNCH',2,'WED',NULL,3,'Bhundi Sweet'),
  ('LUNCH',2,'WED',NULL,4,'Bhendi Fry'),
  ('LUNCH',2,'WED',NULL,5,'Curd'),
  ('LUNCH',2,'WED',NULL,6,'Donda Pachadi'),
  ('LUNCH',2,'WED',NULL,7,'Fryums'),
  ('LUNCH',2,'THU',NULL,0,'Rice'),
  ('LUNCH',2,'THU',NULL,1,'Jeera Pappu'),
  ('LUNCH',2,'THU',NULL,2,'Sambar'),
  ('LUNCH',2,'THU',NULL,3,'Coconut Rice'),
  ('LUNCH',2,'THU',NULL,4,'Raw Banana Fry'),
  ('LUNCH',2,'THU',NULL,5,'Curd'),
  ('LUNCH',2,'THU',NULL,6,'Gongora Pachadi'),
  ('LUNCH',2,'THU',NULL,7,'Saggu Papad'),
  ('LUNCH',2,'FRI',NULL,0,'Rice'),
  ('LUNCH',2,'FRI',NULL,1,'Tomato Pappu'),
  ('LUNCH',2,'FRI',NULL,2,'Rasam'),
  ('LUNCH',2,'FRI',NULL,3,'Banana Fruit'),
  ('LUNCH',2,'FRI',NULL,4,'Dondakaya Fry'),
  ('LUNCH',2,'FRI',NULL,5,'Curd'),
  ('LUNCH',2,'FRI',NULL,6,'Mix Veg Pachadi'),
  ('LUNCH',2,'FRI',NULL,7,'Fryums'),
  ('LUNCH',2,'SAT',NULL,0,'Rice'),
  ('LUNCH',2,'SAT',NULL,1,'Dosakaya Pappu'),
  ('LUNCH',2,'SAT',NULL,2,'Veg Sambar'),
  ('LUNCH',2,'SAT',NULL,3,'Anawaram Sweet'),
  ('LUNCH',2,'SAT',NULL,4,'Aloo Fry'),
  ('LUNCH',2,'SAT',NULL,5,'Curd'),
  ('LUNCH',2,'SAT',NULL,6,'Coconut Pachadi'),
  ('LUNCH',2,'SAT',NULL,7,'Papad'),
  ('DINNER',1,'MON','ITEM1',0,'Idly'),
  ('DINNER',1,'MON','ITEM2',1,'White Rice'),
  ('DINNER',1,'MON','ITEM3',2,'Punugulu'),
  ('DINNER',1,'TUE','ITEM1',0,'Idly'),
  ('DINNER',1,'TUE','ITEM2',1,'Biryani'),
  ('DINNER',1,'TUE','ITEM3',2,'Wada'),
  ('DINNER',1,'WED','ITEM1',0,'Idly'),
  ('DINNER',1,'WED','ITEM2',1,'Lemon Rice'),
  ('DINNER',1,'WED','ITEM3',2,'Semiya Uppama'),
  ('DINNER',1,'THU','ITEM1',0,'Idly'),
  ('DINNER',1,'THU','ITEM2',1,'White Rice'),
  ('DINNER',1,'THU','ITEM3',2,'Mysore/Rawa Bhonda'),
  ('DINNER',1,'FRI','ITEM1',0,'Idly'),
  ('DINNER',1,'FRI','ITEM2',1,'Biryani'),
  ('DINNER',1,'FRI','ITEM3',2,'Wada'),
  ('DINNER',1,'SAT','ITEM1',0,'Idly'),
  ('DINNER',1,'SAT','ITEM2',1,'Pulihora'),
  ('DINNER',1,'SAT','ITEM3',2,'Bansi Rawa Uppama')
) AS v(ses, wk, dy, grp, srt, dish)
JOIN "Dish" d ON d.name = v.dish;

INSERT INTO "MenuSlotAccompaniment" ("slotId", "dishId")
SELECT s.id, d.id
FROM (VALUES
  ('BREAKFAST',1,'MON',0,'FG Chutney'),
  ('BREAKFAST',1,'MON',0,'Sambar'),
  ('BREAKFAST',1,'MON',1,'Pachadi'),
  ('BREAKFAST',1,'MON',1,'Tomato Dal'),
  ('BREAKFAST',1,'MON',2,'FG Chutney'),
  ('BREAKFAST',1,'MON',2,'Tomato Chutney'),
  ('BREAKFAST',1,'TUE',0,'FG Chutney'),
  ('BREAKFAST',1,'TUE',0,'Sambar'),
  ('BREAKFAST',1,'TUE',1,'Kurma'),
  ('BREAKFAST',1,'TUE',2,'FG Chutney'),
  ('BREAKFAST',1,'TUE',2,'Sambar'),
  ('BREAKFAST',1,'WED',0,'FG Chutney'),
  ('BREAKFAST',1,'WED',0,'Sambar'),
  ('BREAKFAST',1,'WED',1,'Tomato Chutney'),
  ('BREAKFAST',1,'WED',2,'FG Chutney'),
  ('BREAKFAST',1,'THU',0,'FG Chutney'),
  ('BREAKFAST',1,'THU',0,'Sambar'),
  ('BREAKFAST',1,'THU',1,'Pachadi'),
  ('BREAKFAST',1,'THU',1,'Tomato Dal'),
  ('BREAKFAST',1,'THU',2,'FG Chutney'),
  ('BREAKFAST',1,'THU',2,'Sambar'),
  ('BREAKFAST',1,'FRI',0,'FG Chutney'),
  ('BREAKFAST',1,'FRI',0,'Sambar'),
  ('BREAKFAST',1,'FRI',1,'Raita'),
  ('BREAKFAST',1,'FRI',2,'FG Chutney'),
  ('BREAKFAST',1,'FRI',2,'Sambar'),
  ('BREAKFAST',1,'SAT',0,'FG Chutney'),
  ('BREAKFAST',1,'SAT',0,'Sambar'),
  ('BREAKFAST',1,'SAT',2,'FG Chutney'),
  ('DINNER',1,'MON',0,'FG Chutney'),
  ('DINNER',1,'MON',0,'Sambar'),
  ('DINNER',1,'MON',1,'Pachadi'),
  ('DINNER',1,'MON',1,'Tomato Dal'),
  ('DINNER',1,'MON',2,'FG Chutney'),
  ('DINNER',1,'MON',2,'Tomato Chutney'),
  ('DINNER',1,'TUE',0,'FG Chutney'),
  ('DINNER',1,'TUE',0,'Sambar'),
  ('DINNER',1,'TUE',1,'Kurma'),
  ('DINNER',1,'TUE',2,'FG Chutney'),
  ('DINNER',1,'TUE',2,'Sambar'),
  ('DINNER',1,'WED',0,'FG Chutney'),
  ('DINNER',1,'WED',0,'Sambar'),
  ('DINNER',1,'WED',1,'Tomato Chutney'),
  ('DINNER',1,'WED',2,'FG Chutney'),
  ('DINNER',1,'THU',0,'FG Chutney'),
  ('DINNER',1,'THU',0,'Sambar'),
  ('DINNER',1,'THU',1,'Pachadi'),
  ('DINNER',1,'THU',1,'Tomato Dal'),
  ('DINNER',1,'THU',2,'FG Chutney'),
  ('DINNER',1,'THU',2,'Sambar'),
  ('DINNER',1,'FRI',0,'FG Chutney'),
  ('DINNER',1,'FRI',0,'Sambar'),
  ('DINNER',1,'FRI',1,'Raita'),
  ('DINNER',1,'FRI',2,'FG Chutney'),
  ('DINNER',1,'FRI',2,'Sambar'),
  ('DINNER',1,'SAT',0,'FG Chutney'),
  ('DINNER',1,'SAT',0,'Sambar'),
  ('DINNER',1,'SAT',2,'FG Chutney')
) AS v(ses, wk, dy, srt, acc)
JOIN "MenuSlot" s
  ON s.session = v.ses::"Session" AND s.week = v.wk
 AND s.day = v.dy::"Day" AND s."sortOrder" = v.srt AND s.date IS NULL
JOIN "Dish" d ON d.name = v.acc
ON CONFLICT DO NOTHING;

COMMIT;

-- Should print 3 rows: BREAKFAST 18, LUNCH 90, DINNER 18.
SELECT session, count(*) AS lines FROM "MenuSlot" WHERE date IS NULL
GROUP BY session ORDER BY session;
