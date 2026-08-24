/**
 * GET /api/availability?from=2026-06-01&to=2026-09-30
 *
 * Feeds the public date picker: which days are taken, what each night costs and
 * the minimum stay that applies. Never leaks who is staying.
 */
import { addDays, isIsoDate, today } from '~~/server/utils/dates'
import { getUnavailableDays } from '~~/server/utils/availability'
import { getRatePeriods, getSettings } from '~~/server/utils/supabase'
import { minNightsFor, nightlyRate } from '~~/server/utils/pricing'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const settings = await getSettings()

  const from = isIsoDate(query.from) ? query.from : today()
  const maxTo = addDays(today(), settings.booking_window_days)
  let to = isIsoDate(query.to) ? query.to : addDays(from, 365)
  if (to > maxTo) to = maxTo
  if (to <= from) to = addDays(from, 1)

  const [unavailable, periods] = await Promise.all([
    getUnavailableDays(from, to),
    getRatePeriods()
  ])

  const taken = new Set(unavailable)
  const days: Array<{ date: string, available: boolean, cents: number, min_nights: number }> = []
  for (let day = from; day <= to; day = addDays(day, 1)) {
    days.push({
      date: day,
      available: !taken.has(day),
      cents: nightlyRate(day, settings, periods).cents,
      min_nights: minNightsFor(day, settings, periods)
    })
  }

  setHeader(event, 'cache-control', 'public, max-age=60, stale-while-revalidate=300')

  return {
    from,
    to,
    currency: settings.currency,
    max_guests: settings.max_guests,
    guests_included: settings.guests_included,
    checkin_time: settings.checkin_time,
    checkout_time: settings.checkout_time,
    advance_notice_days: settings.advance_notice_days,
    unavailable,
    days
  }
})
