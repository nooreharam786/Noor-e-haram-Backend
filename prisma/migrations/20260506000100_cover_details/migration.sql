-- Add cover and family/group application fields.
ALTER TABLE "Application"
ADD COLUMN "coverId" TEXT,
ADD COLUMN "stateCode" TEXT,
ADD COLUMN "stateName" TEXT,
ADD COLUMN "city" TEXT,
ADD COLUMN "persons" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "entryFee" INTEGER NOT NULL DEFAULT 1500;

-- Backfill existing applications with stable legacy cover IDs.
UPDATE "Application"
SET
  "coverId" = CONCAT('CV', LPAD(row_number::TEXT, 6, '0')),
  "stateCode" = 'NA',
  "stateName" = 'Not specified',
  "city" = ''
FROM (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS row_number
  FROM "Application"
) AS numbered
WHERE "Application"."id" = numbered."id";

ALTER TABLE "Application" ALTER COLUMN "coverId" SET NOT NULL;
ALTER TABLE "Application" ALTER COLUMN "stateCode" SET NOT NULL;
ALTER TABLE "Application" ALTER COLUMN "stateName" SET NOT NULL;
ALTER TABLE "Application" ALTER COLUMN "city" SET NOT NULL;

CREATE UNIQUE INDEX "Application_coverId_key" ON "Application"("coverId");
CREATE INDEX "Application_stateCode_idx" ON "Application"("stateCode");
CREATE INDEX "Application_coverId_idx" ON "Application"("coverId");
