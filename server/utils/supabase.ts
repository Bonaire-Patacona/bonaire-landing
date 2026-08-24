import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { H3Event } from 'h3'
import { addDays, today } from './dates'
import { NON_REFUNDABLE, normaliseTiers } from './cancellation'
import { overridesByDay } from './pricing'
import type { CancellationPolicy } from './cancellation'
import type { AppSettings, RateOverride, RateOverrideMap, RatePeriod } from './types'

let client: SupabaseClient | null = null

/**
 * Service-role Supabase client. Bypasses RLS, so it must never be reachable
 * from the browser — only from `server/` code.
 *
 * In compose the app talks to Kong over the internal network
 * (NUXT_SUPABASE_INTERNAL_URL), which avoids a round trip through the public
 * domain and keeps working if the public URL is not resolvable from inside.
 * Locally the same pair comes from SUPABASE_URL / SERVICE_ROLE_KEY in `.env`.
 */
export function serviceClient(): SupabaseClient {
  if (client) return client

  const config = useRuntimeConfig()
  const url = config.supabaseInternalUrl || config.public.supabase?.url
  const key = config.supabaseServiceKey

  if (!url || !key) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Supabase is not configured (set SUPABASE_URL / SERVICE_ROLE_KEY in .env, or NUXT_SUPABASE_INTERNAL_URL / NUXT_SUPABASE_SERVICE_KEY at runtime)'
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
let overridesCache: { at: number, value: RateOverrideMap } | null = null
let policyCache: { at: number, value: CancellationPolicy } | null = null

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

/**
 * Per-day prices, indexed by day. One row per overridden night, so even a fully
 * hand-priced year is a few hundred rows — cheap enough to hold whole. Bounded
 * anyway, because a silently truncated page here would quote the wrong price.
 */
const OVERRIDE_LOOKBEHIND_DAYS = 365
const OVERRIDE_LOOKAHEAD_DAYS = 1095
const OVERRIDE_LIMIT = 5000

export async function getRateOverrides(force = false): Promise<RateOverrideMap> {
  if (!force && overridesCache && Date.now() - overridesCache.at < CACHE_MS) {
    return overridesCache.value
  }
  const now = today()
  const { data, error } = await serviceClient()
    .from('rate_overrides')
    .select('*')
    .gte('day', addDays(now, -OVERRIDE_LOOKBEHIND_DAYS))
    .lte('day', addDays(now, OVERRIDE_LOOKAHEAD_DAYS))
    .order('day')
    .limit(OVERRIDE_LIMIT)
  assertNoDbError(error, 'loading rate overrides')

  const rows = (data ?? []) as RateOverride[]
  if (rows.length === OVERRIDE_LIMIT) {
    console.warn('[pricing] hit the rate override limit; some nights will fall back to the rate card')
  }

  overridesCache = { at: Date.now(), value: overridesByDay(rows) }
  return overridesCache.value
}

/**
 * The cancellation policy new bookings are sold under, with the extra
 * conditions from app_settings appended. A missing or deleted policy falls back
 * to no refund rather than to a generous default: the safe side of a mistake.
 */
export async function getCancellationPolicy(force = false): Promise<CancellationPolicy> {
  if (!force && policyCache && Date.now() - policyCache.at < CACHE_MS) {
    return policyCache.value
  }

  const settings = await getSettings(force)
  const { data, error } = await serviceClient()
    .from('cancellation_policies')
    .select('*')
    .eq('code', settings.cancellation_policy_code)
    .maybeSingle()
  assertNoDbError(error, 'loading the cancellation policy')

  const row = data as { code: string, name: string, tiers: unknown, notes: string } | null
  const addendum = settings.cancellation_policy.trim()
  const base = row ? { code: row.code, name: row.name, notes: row.notes } : NON_REFUNDABLE

  policyCache = {
    at: Date.now(),
    value: {
      code: base.code,
      name: base.name,
      tiers: row ? normaliseTiers(row.tiers) : [],
      notes: [base.notes?.trim(), addendum].filter(Boolean).join('\n\n')
    }
  }
  return policyCache.value
}

export function invalidatePricingCache(): void {
  settingsCache = null
  ratesCache = null
  overridesCache = null
  policyCache = null
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
