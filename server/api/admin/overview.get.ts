/**
 * GET /api/admin/overview — numbers for the dashboard, plus the state of the
 * channel connections and the outbound iCal URL.
 */
import { addDays, today } from '~~/server/utils/dates'
import { assertNoDbError, getProperty, getSettings, requireAdmin, serviceClient } from '~~/server/utils/supabase'
import { exportFeedUrl } from '~~/server/utils/ical-sync'
import { isStripeConfigured } from '~~/server/utils/stripe'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const selector = getHeader(event, 'x-property-id')
  const property = selector ? await getProperty(selector) : null

  const supabase = serviceClient()
  const now = today()
  const in30 = addDays(now, 30)
  const monthStart = `${now.slice(0, 7)}-01`

  let upcomingQuery = supabase.from('bookings')
    .select('id, reference, guest_name, check_in, check_out, status, total_cents, currency, source')
    .in('status', ['confirmed', 'pending'])
    .gte('check_out', now)
    .order('check_in')
    .limit(10)
  let pendingQuery = supabase.from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  let revenueQuery = supabase.from('bookings')
    .select('total_cents, amount_paid_cents')
    .in('status', ['confirmed', 'completed'])
    .gte('check_in', monthStart)
  let feedsQuery = supabase.from('ical_feeds')
    .select('id, name, channel, url, active, last_synced_at, last_status, last_error, events_count')
    .order('name')
  if (property) {
    upcomingQuery = upcomingQuery.eq('property_id', property.id)
    pendingQuery = pendingQuery.eq('property_id', property.id)
    revenueQuery = revenueQuery.eq('property_id', property.id)
    feedsQuery = feedsQuery.eq('property_id', property.id)
  }

  const [settings, exportUrl, upcoming, pending, monthRevenue, feeds] = await Promise.all([
    getSettings(property?.id, true),
    exportFeedUrl(property?.id),
    upcomingQuery,
    pendingQuery,
    revenueQuery,
    feedsQuery
  ])

  assertNoDbError(upcoming.error, 'loading upcoming bookings')
  assertNoDbError(monthRevenue.error, 'loading monthly revenue')
  assertNoDbError(feeds.error, 'loading channel feeds')

  const nightsBooked = (upcoming.data ?? []).filter(b => b.check_in <= in30).length

  return {
    property,
    currency: settings.currency,
    stripe_ready: isStripeConfigured(),
    ical_export_url: exportUrl,
    pending_count: pending.count ?? 0,
    upcoming_count: nightsBooked,
    month_revenue_cents: (monthRevenue.data ?? []).reduce((sum, b) => sum + b.total_cents, 0),
    month_collected_cents: (monthRevenue.data ?? []).reduce((sum, b) => sum + b.amount_paid_cents, 0),
    upcoming: upcoming.data ?? [],
    feeds: feeds.data ?? []
  }
})
