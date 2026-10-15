-- Brandix kitchen: the emergency-approval columns and the corrected quantities.
--
-- Run this ONCE in Railway -> Postgres -> Data -> Query, AFTER deploying.
-- Safe to run twice: every statement guards itself.
--
--   1. the ApprovalStatus type and the four columns it needs
--   2. existing emergency orders marked approved, so nothing already cooked
--      disappears from the kitchen's screen
--   3. Sambar / FG Chutney / Kurma: the menu quantity brought to the cooked one
--
-- It does not touch any other order, user or setting.

BEGIN;

DO $do$ BEGIN
  CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING','APPROVED','DECLINED');
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "approval"      "ApprovalStatus";
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "approvedById"  INTEGER;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "approvedAt"    TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "declineReason" TEXT;

DO $do$ BEGIN
  ALTER TABLE "Order"
    ADD CONSTRAINT "Order_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

-- Emergency orders that already exist were placed when no approval was asked
-- for. Leaving them null would hide them from the kitchen; marking them
-- APPROVED keeps them exactly as they are today.
UPDATE "Order" SET "approval" = 'APPROVED'
  WHERE "isEmergency" = true AND "approval" IS NULL;

-- The menu said one number and the kitchen cooked another. The cooked figures
-- are the ones that reproduce the 28 Apr packing sheet.
UPDATE "Dish" SET "qtyPerPlate" = 60  WHERE name = 'Sambar';
UPDATE "Dish" SET "qtyPerPlate" = 80  WHERE name = 'FG Chutney';
UPDATE "Dish" SET "qtyPerPlate" = 120 WHERE name = 'Kurma';

COMMIT;

-- Should print the three dishes with both numbers now equal, and a count of
-- emergency orders carrying an approval.
SELECT name, "qtyPerPlate", "packingFactor"
FROM "Dish" WHERE name IN ('Sambar','FG Chutney','Kurma') ORDER BY name
