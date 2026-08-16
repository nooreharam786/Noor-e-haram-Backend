-- Migration: Add address field to applications table and update entryFee default to 1499
ALTER TABLE "Application" ADD COLUMN "address" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Application" ALTER COLUMN "entryFee" SET DEFAULT 1499;
