import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { H3Event } from 'h3'
import type { AppSettings, RatePeriod } from './types'

let client: SupabaseClient | null = null

/**
 * Service-role Supabase client. Bypasses RLS, so it must never be reachable
 * from the browser — only from `server/` code.
 *
 * In compose the app talks to Kong over the internal network
 * (NUXT_SUPABASE_INTERNAL_URL), which avoids a round trip through the public
 * domain and keeps working if the public URL is not resolvable from inside.
 */
export function serviceClient(): SupabaseClient {
  if (client) return client

  const config = useRuntimeConfig()
  const url = config.supabaseInternalUrl || config.public.supabase?.url
  const key = config.supabaseServiceKey

  if (!url || !key) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Supabase is not configured (NUXT_SUPABASE_INTERNAL_URL / NUXT_SUPABASE_SERVICE_KEY)'
    })
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  return client
}

/** Throws a 4xx/5xx H3 error out of a PostgREST error. */
export function assertNoDbError(error: { message: string, code?: string } | null, context: string): void {
  if (!error) return
  console.error(`[db] ${context}:`, error)
  throw createError({ statusCode: 500, statusMessage: `Database error while ${context}` })
}

// -----------------------------------------------------------------------------
// Settings and rates, cached for a few seconds so a single request that quotes
// several date ranges does not hammer PostgREST.
// -----------------------------------------------------------------------------
const CACHE_MS = 15_000
let settingsCache: { at: number, value: AppSettings } | null = null
let ratesCache: { at: number, value: RatePeriod[] } | null = null

export async function getSettings(force = false): Promise<AppSettings> {
  if (!force && settingsCache && Date.now() - settingsCache.at < CACHE_MS) {
    return settingsCache.value
  }
  const { data, error } = await serviceClient()
    .from('app_settings').select('*').eq('id', 1).single()
  assertNoDbError(error, 'loading settings')
  settingsCache = { at: Date.now(), value: data as AppSettings }
  return settingsCache.value
}

export async function getRatePeriods(force = false): Promise<RatePeriod[]> {
  if (!force && ratesCache && Date.now() - ratesCache.at < CACHE_MS) {
    return ratesCache.value
  }
  const { data, error } = await serviceClient()
    .from('rate_periods').select('*').eq('active', true)
    .order('priority', { ascending: false })
  assertNoDbError(error, 'loading rate periods')
  ratesCache = { at: Date.now(), value: (data ?? []) as RatePeriod[] }
  return ratesCache.value
}

export function invalidatePricingCache(): void {
  settingsCache = null
  ratesCache = null
}

/**
 * Resolves the signed-in Supabase user from the request and checks that they
 * are an admin. Every /api/admin/* route starts with this.
 */
export async function requireAdmin(event: H3Event): Promise<{ id: string, email: string }> {
  const token = getRequestAuthToken(event)
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }

  const supabase = serviceClient()
  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  if (userError || !userData?.user) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid session' })
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles').select('id, email, role').eq('id', userData.user.id).single()

  if (profileError || profile?.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Administrator access required' })
  }

  return { id: userData.user.id, email: userData.user.email ?? profile.email ?? '' }
}

/** Reads the access token from the Authorization header or the Supabase cookie. */
function getRequestAuthToken(event: H3Event): string | null {
  const header = getRequestHeader(event, 'authorization')
  if (header?.startsWith('Bearer ')) return header.slice(7)

  // @nuxtjs/supabase stores the session in `sb-<ref>-auth-token`, possibly split
  // across `.0`, `.1`, … chunks and prefixed with `base64-`.
  const cookies = parseCookies(event)
  const chunks = Object.keys(cookies)
    .filter(name => name.startsWith('sb-') && name.includes('-auth-token'))
    .sort()
  if (!chunks.length) return null

  let raw = chunks.map(name => cookies[name]).join('')
  if (raw.startsWith('base64-')) {
    raw = Buffer.from(raw.slice(7), 'base64').toString('utf8')
  }
  try {
    const parsed = JSON.parse(raw)
    return parsed?.access_token ?? (Array.isArray(parsed) ? parsed[0] : null)
  } catch {
    return null
  }
}

/** Guards the /api/cron/* endpoints when an external scheduler drives them. */
export function requireCronSecret(event: H3Event): void {
  const expected = useRuntimeConfig().cronSecret
  if (!expected) return // no secret configured -> endpoint is disabled below
  const header = getRequestHeader(event, 'authorization')
  const provided = header?.startsWith('Bearer ') ? header.slice(7) : getQuery(event).secret
  if (provided !== expected) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid cron secret' })
  }
}
