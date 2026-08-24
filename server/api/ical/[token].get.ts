/**
 * GET /api/ical/:token  (the .ics suffix is optional and stripped)
 *
 * The outbound half of the two-way sync: an iCalendar feed of everything that
 * makes the apartment unavailable. Paste this URL into Airbnb
 * (Calendar -> Availability -> Sync calendars -> Import) and into the
 * Booking.com extranet so those channels stop selling dates we already sold.
 *
 * Guarded by app_settings.ical_export_token — rotate it from /admin/channels if
 * the URL ever leaks. Guest names are never included, only "Reserved".
 */
import { addDays, today } from '~~/server/utils/dates'
import { getCalendarBlocks } from '~~/server/utils/availability'
import { getSettings } from '~~/server/utils/supabase'
import { buildIcs, type IcsEvent } from '~~/server/utils/ical'

export default defineEventHandler(async (event) => {
  // The file is [token].get.ts rather than [token].ics.get.ts on purpose: a
  // literal suffix inside a route segment becomes part of the parameter *name*
  // ("token.ics"), not a separate match, so the param would never resolve.
  const token = getRouterParam(event, 'token')?.replace(/\.ics$/i, '')
  const settings = await getSettings()

  if (!token || token !== settings.ical_export_token) {
    throw createError({ statusCode: 404, statusMessage: 'Calendar not found' })
  }

  const from = addDays(today(), -90)
  const to = addDays(today(), settings.booking_window_days)
  const blocks = await getCalendarBlocks(from, to)

  const events: IcsEvent[] = blocks
    // Channels import our feed; echoing their own events back would create a
    // sync loop, so imported blocks are left out.
    .filter(block => block.kind !== 'external')
    .map(block => ({
      uid: `${block.kind}-${block.source_id}`,
      summary: block.kind === 'booking' ? 'Reserved' : (block.label || 'Not available'),
      start: block.start_date,
      end: block.end_date
    }))

  const body = buildIcs({
    name: `${settings.property_name} — availability`,
    domain: new URL(useRuntimeConfig().public.siteUrl).hostname,
    events
  })

  setHeader(event, 'content-type', 'text/calendar; charset=utf-8')
  setHeader(event, 'content-disposition', 'inline; filename="bonaire-patacona.ics"')
  setHeader(event, 'cache-control', 'public, max-age=300')
  return body
})
