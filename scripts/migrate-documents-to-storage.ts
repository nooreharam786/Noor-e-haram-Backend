// ─────────────────────────────────────────────────────────────────────────────
// migrate-documents-to-storage.ts
//
// One-time migration script to move existing PublicDocument PDF data
// from PostgreSQL bytea columns to Supabase Storage.
//
// Usage:
//   npx tsx scripts/migrate-documents-to-storage.ts              # Live run
//   npx tsx scripts/migrate-documents-to-storage.ts --dry-run    # Preview only
//
// Features:
// - Processes documents one at a time to avoid memory spikes
// - Continues on per-document failure (reports all errors at end)
// - Dry-run mode for safe preview
// - Progress logging with counts
// - Sets data = null after successful upload to free DB space
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

// ── Load environment ────────────────────────────────────────────────────────
dotenv.config();
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: path.resolve(process.cwd(), "backend/.env") });
}
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: path.resolve(__dirname, "../.env") });
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET_NAME = "public-documents";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in your environment.");
  process.exit(1);
}

const isDryRun = process.argv.includes("--dry-run");

// ── Initialize clients ──────────────────────────────────────────────────────
const prisma = new PrismaClient();
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Sanitize filename for storage path */
function sanitizeFilename(original: string): string {
  return original
    .replace(/.*[/\\]/, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "") || "document.pdf";
}

/** Sleep for a given number of milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Main migration ──────────────────────────────────────────────────────────
async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Noor-e-Haram: Migrate Documents to Supabase Storage       ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();

  if (isDryRun) {
    console.log("🔍 DRY RUN MODE — No changes will be made.\n");
  }

  // Find all documents that haven't been migrated yet
  const documents = await prisma.publicDocument.findMany({
    where: {
      storagePath: null,
      data: { not: null },
    },
    select: {
      id: true,
      filename: true,
      contentType: true,
      size: true,
      title: true,
      data: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (documents.length === 0) {
    console.log("✅ No documents to migrate. All documents are already in Supabase Storage.");
    return;
  }

  console.log(`📄 Found ${documents.length} document(s) to migrate.\n`);

  let successCount = 0;
  let failCount = 0;
  const errors: Array<{ id: string; title: string; error: string }> = [];

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    const progress = `[${i + 1}/${documents.length}]`;
    const sizeKB = doc.size ? `${(doc.size / 1024).toFixed(1)} KB` : "unknown size";

    console.log(`${progress} Processing: "${doc.title}" (${doc.filename}, ${sizeKB})`);

    if (isDryRun) {
      const storagePath = `documents/${doc.id}_${sanitizeFilename(doc.filename)}`;
      console.log(`  → Would upload to: ${storagePath}`);
      console.log(`  → Would clear data column for document ${doc.id}`);
      successCount++;
      continue;
    }

    try {
      if (!doc.data) {
        console.log(`  ⚠ Skipping — no binary data in DB.`);
        continue;
      }

      const buffer = Buffer.from(doc.data);

      // Verify PDF magic bytes
      if (buffer.length < 4 || buffer[0] !== 0x25 || buffer[1] !== 0x50 || buffer[2] !== 0x44 || buffer[3] !== 0x46) {
        throw new Error("File does not have PDF magic bytes (%PDF header)");
      }

      const storagePath = `documents/${doc.id}_${sanitizeFilename(doc.filename)}`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(storagePath, buffer, {
          contentType: doc.contentType || "application/pdf",
          upsert: true,
          cacheControl: "public, max-age=31536000, immutable",
        });

      if (uploadError) {
        throw new Error(`Supabase upload failed: ${uploadError.message}`);
      }

      // Get the public URL
      const { data: urlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(storagePath);

      if (!urlData?.publicUrl) {
        throw new Error("Failed to generate public URL after upload");
      }

      // Update DB: set storagePath + storageUrl, clear data to free space
      await prisma.publicDocument.update({
        where: { id: doc.id },
        data: {
          storagePath,
          storageUrl: urlData.publicUrl,
          data: null, // Free DB space
        },
      });

      console.log(`  ✅ Uploaded to: ${storagePath}`);
      console.log(`  🔗 URL: ${urlData.publicUrl}`);
      successCount++;

      // Small delay between uploads to avoid rate limiting
      if (i < documents.length - 1) {
        await sleep(200);
      }
    } catch (err: any) {
      console.error(`  ❌ FAILED: ${err.message}`);
      errors.push({ id: doc.id, title: doc.title, error: err.message });
      failCount++;
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  MIGRATION SUMMARY");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`  Total documents:  ${documents.length}`);
  console.log(`  ✅ Successful:    ${successCount}`);
  console.log(`  ❌ Failed:        ${failCount}`);

  if (isDryRun) {
    console.log("\n  🔍 This was a DRY RUN. Run without --dry-run to execute.");
  }

  if (errors.length > 0) {
    console.log("\n  ERRORS:");
    for (const err of errors) {
      console.log(`    • [${err.id}] "${err.title}": ${err.error}`);
    }
  }

  console.log("══════════════════════════════════════════════════════════════\n");
}

// ── Run ─────────────────────────────────────────────────────────────────────
main()
  .catch((err) => {
    console.error("💥 Migration script crashed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
