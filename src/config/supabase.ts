import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

// ─────────────────────────────────────────────────────────────────────────────
// supabase.ts — Supabase client singleton for Storage operations
//
// Uses the service_role key for server-side uploads (bypasses RLS).
// Only used for Supabase Storage — the database continues to use Prisma.
// ─────────────────────────────────────────────────────────────────────────────

let _client: SupabaseClient | null = null;

/**
 * Returns a lazily-initialized Supabase client.
 * The client is created once and reused for the lifetime of the process.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!_client) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        "Supabase credentials are not configured. " +
        "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment."
      );
    }

    _client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        // We don't need Supabase Auth — only Storage
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return _client;
}

/** The name of the Supabase Storage bucket for public documents (PDFs). */
export const DOCUMENTS_BUCKET = "public-documents";
