import { createClient } from "@supabase/supabase-js";

/**
 * Cookie-less Supabase client for public, read-only content.
 *
 * Unlike the SSR server client (`./server`), this does not touch Next's
 * `cookies()`, so pages that only read public data can be statically
 * rendered at build time instead of rendered on every request.
 *
 * Used by the public landing page and its data helpers. Uses the publishable
 * (anon) key, so RLS still applies exactly as before.
 */
export function createPublicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "X-Client-Info": "thoddoo-marine-public-read" } },
    }
  );
}
