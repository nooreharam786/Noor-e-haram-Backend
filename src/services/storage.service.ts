// ─────────────────────────────────────────────────────────────────────────────
// storage.service.ts — Bulletproof Supabase Storage service for PDF documents
//
// Features:
// - PDF magic-byte validation (verifies %PDF header)
// - Sanitized, unique file paths (cuid prefix)
// - Exponential-backoff retry (3 attempts) on transient failures
// - Size guard (defense-in-depth beyond multer)
// - Structured error handling with HttpError
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseClient, DOCUMENTS_BUCKET } from "../config/supabase";
import { HttpError } from "../utils/http";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 500;

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Verify the buffer starts with the PDF magic bytes (%PDF) */
function isPdfBuffer(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  // %PDF in ASCII = 0x25 0x50 0x44 0x46
  return (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  );
}

/** Strip dangerous characters from filenames, preserving extension */
function sanitizeFilename(original: string): string {
  const basename = original
    .replace(/.*[/\\]/, "") // strip directory path
    .replace(/[^a-zA-Z0-9._-]/g, "_") // only safe characters
    .replace(/_{2,}/g, "_") // collapse multiple underscores
    .replace(/^_+|_+$/g, ""); // trim leading/trailing underscores

  return basename || "document.pdf";
}

/** Generate a unique storage path for a document */
function generateStoragePath(documentId: string, originalFilename: string): string {
  const safeName = sanitizeFilename(originalFilename);
  return `documents/${documentId}_${safeName}`;
}

/** Sleep for a given number of milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Core Service Functions ──────────────────────────────────────────────────

/**
 * Upload a PDF document to Supabase Storage with retry logic.
 *
 * @param buffer    - The raw PDF file buffer
 * @param documentId - The Prisma document ID (used for unique path generation)
 * @param filename  - The original filename from the upload
 * @param contentType - The MIME type (should be application/pdf)
 * @returns Object containing the storage path and public URL
 * @throws HttpError on validation failure or persistent upload failure
 */
export async function uploadDocument(
  buffer: Buffer,
  documentId: string,
  filename: string,
  contentType: string = "application/pdf"
): Promise<{ storagePath: string; storageUrl: string }> {
  // ── Validation ──────────────────────────────────────────────────────────
  if (!buffer || buffer.length === 0) {
    throw new HttpError(422, "File buffer is empty");
  }

  if (buffer.length > MAX_FILE_SIZE) {
    throw new HttpError(
      422,
      `File size (${(buffer.length / 1024 / 1024).toFixed(1)} MB) exceeds the maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024} MB`
    );
  }

  if (!isPdfBuffer(buffer)) {
    throw new HttpError(
      422,
      "File does not appear to be a valid PDF (invalid magic bytes)"
    );
  }

  // ── Generate unique path ────────────────────────────────────────────────
  const storagePath = generateStoragePath(documentId, filename);

  // ── Upload with retry ───────────────────────────────────────────────────
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const supabase = getSupabaseClient();

      // Convert Buffer to standard Blob for bulletproof fetch compatibility in Node.js
      const blob = new Blob([new Uint8Array(buffer)], { type: contentType });

      const { error } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .upload(storagePath, blob, {
          cacheControl: "public, max-age=31536000, immutable",
          upsert: true,
        });

      if (error) {
        throw new Error(error.message);
      }

      // ── Get public URL ────────────────────────────────────────────────
      const { data: urlData } = supabase.storage
        .from(DOCUMENTS_BUCKET)
        .getPublicUrl(storagePath);

      if (!urlData?.publicUrl) {
        throw new Error("Failed to generate public URL after upload");
      }

      return {
        storagePath,
        storageUrl: urlData.publicUrl,
      };
    } catch (err: any) {
      lastError = err;

      // Don't retry on validation/client errors (4xx)
      if (err instanceof HttpError && err.statusCode < 500) {
        throw err;
      }

      // Log retry attempt
      console.warn(
        `[StorageService] Upload attempt ${attempt}/${MAX_RETRIES} failed for "${storagePath}": ${err.message}`
      );

      // Exponential backoff before retry (except on last attempt)
      if (attempt < MAX_RETRIES) {
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }
  }

  // All retries exhausted
  console.error(
    `[StorageService] Upload permanently failed for "${storagePath}" after ${MAX_RETRIES} attempts:`,
    lastError
  );
  throw new HttpError(
    502,
    `Failed to upload document to storage: ${lastError?.message || "Unknown error"}`
  );
}

/**
 * Delete a document from Supabase Storage.
 *
 * Silently succeeds if the file doesn't exist (idempotent).
 * Logs errors but does not throw — deletion failures should not block
 * the database record deletion.
 *
 * @param storagePath - The storage path to delete
 */
export async function deleteDocument(storagePath: string | null | undefined): Promise<void> {
  if (!storagePath) return;

  try {
    const supabase = getSupabaseClient();

    const { error } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .remove([storagePath]);

    if (error) {
      console.error(
        `[StorageService] Failed to delete "${storagePath}" from storage:`,
        error.message
      );
    }
  } catch (err: any) {
    // Log but don't throw — DB deletion should still proceed
    console.error(
      `[StorageService] Error deleting "${storagePath}" from storage:`,
      err.message
    );
  }
}

/**
 * Get the public URL for a stored document.
 *
 * @param storagePath - The storage path
 * @returns The public URL string, or null if path is empty
 */
export function getPublicUrl(storagePath: string | null | undefined): string | null {
  if (!storagePath) return null;

  try {
    const supabase = getSupabaseClient();
    const { data } = supabase.storage
      .from(DOCUMENTS_BUCKET)
      .getPublicUrl(storagePath);

    return data?.publicUrl || null;
  } catch {
    return null;
  }
}
