import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The Supabase browser client, untyped.
 *
 * `supabase.types` is disabled in nuxt.config (there is no generated
 * `Database` type in the repo), which leaves `useSupabaseClient()` inferring
 * `never` for every table. Regenerating types on each schema change is more
 * ceremony than this small back-office needs, so the client is widened here in
 * one place instead of casting at every call site. The database still enforces
 * its own shape through RLS and column constraints.
 */
export function useDb(): SupabaseClient {
  return useSupabaseClient() as unknown as SupabaseClient
}
