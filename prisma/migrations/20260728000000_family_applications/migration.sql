-- Additive family-registration support. Existing applications retain their
-- historical account-holder name as their individual applicant name.
ALTER TABLE "Draw"
  ADD COLUMN IF NOT EXISTS "maxApplicationsPerUser" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Application"
  ADD COLUMN IF NOT EXISTS "applicantName" TEXT;

UPDATE "Application" AS application
SET "applicantName" = "User"."name"
FROM "User"
WHERE application."userId" = "User"."id"
  AND application."applicantName" IS NULL;

ALTER TABLE "Application"
  ALTER COLUMN "applicantName" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "Application_drawId_userId_createdAt_idx"
  ON "Application"("drawId", "userId", "createdAt");
