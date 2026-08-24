/**
 * The inbound half of the two-way sync: pulls each configured feed and mirrors
 * its events into public.external_blocks.
 *
 * Events are matched on (feed_id, uid), so a channel that moves or shortens a
 * stay updates the existing row, and anything that disappeared from the feed is
 * deleted. A feed that fails to load leaves its previous blocks untouched — a
 * transient Airbnb outage must never free up dates that are actually sold.
 */
import { assertNoDbError, getSettings, serviceClient } from './supabase'
import { classifyExternalEvent, parseIcs } from './ical'

export interface FeedSyncResult {
  feed: string
  channel: string
  ok: boolean
  events: number
  removed: number
  error?: string
}

const FETCH_TIMEOUT_MS = 20_000

export async function syncFeed(feed: {
  id: string
  name: string
  channel: string
  url: string
}): Promise<FeedSyncResult> {
  const supabase = serviceClient()
  const result: FeedSyncResult = { feed: feed.name, channel: feed.channel, ok: false, events: 0, removed: 0 }

  try {
    const response = await $fetch<string>(feed.url, {
      responseType: 'text',
      timeout: FETCH_TIMEOUT_MS,
      retry: 1,
      headers: { accept: 'text/calendar, text/plain, */*' }
    })

    const events = parseIcs(response)
    // An empty calendar is legitimate (nothing booked), but a response that is
    // not a calendar at all usually means an expired/blocked URL.
    if (!response.includes('BEGIN:VCALENDAR')) {
      throw new Error('Response is not an iCalendar document')
    }

    const rows = events.map(evt => ({
      feed_id: feed.id,
      uid: evt.uid,
      summary: evt.summary,
      event_kind: classifyExternalEvent(evt.summary),
      link: evt.link ?? null,
      start_date: evt.start,
      end_date: evt.end,
      raw: evt.raw ?? null,
      synced_at: new Date().toISOString()
    }))

    if (rows.length) {
      const { error } = await supabase
        .from('external_blocks')
        .upsert(rows, { onConflict: 'feed_id,uid' })
      assertNoDbError(error, `upserting blocks for ${feed.name}`)
    }

    // Drop everything the feed no longer lists.
    const keep = events.map(evt => evt.uid)
    let query = supabase.from('external_blocks').delete().eq('feed_id', feed.id)
    if (keep.length) {
      query = query.not('uid', 'in', `(${keep.map(uid => `"${uid.replace(/"/g, '')}"`).join(',')})`)
    }
    const { data: deleted } = await query.select('id')

    result.ok = true
    result.events = rows.length
    result.removed = deleted?.length ?? 0

    await supabase.from('ical_feeds').update({
      last_synced_at: new Date().toISOString(),
      last_status: 'ok',
      last_error: null,
      events_count: rows.length
    }).eq('id', feed.id)
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    console.error(`[ical] sync failed for ${feed.name}:`, result.error)

    await supabase.from('ical_feeds').update({
      last_synced_at: new Date().toISOString(),
      last_status: 'error',
      last_error: result.error.slice(0, 500)
    }).eq('id', feed.id)
  }

  return result
}

export async function syncAllFeeds(propertyId?: string): Promise<FeedSyncResult[]> {
  const supabase = serviceClient()
  let query = supabase.from('ical_feeds').select('id, name, channel, url').eq('active', true)
  if (propertyId) query = query.eq('property_id', propertyId)
  const { data, error } = await query
  assertNoDbError(error, 'loading iCal feeds')

  const feeds = data ?? []
  if (!feeds.length) return []

  // Sequential on purpose: three or four feeds, and one slow channel should not
  // make the others time out.
  const results: FeedSyncResult[] = []
  for (const feed of feeds) {
    results.push(await syncFeed(feed))
  }
  return results
}

/** Absolute URL of the outbound feed, for display in the admin panel. */
export async function exportFeedUrl(propertyId?: string): Promise<string> {
  const settings = await getSettings(propertyId)
  const base = useRuntimeConfig().public.siteUrl.replace(/\/$/, '')
  return `${base}/api/ical/${settings.ical_export_token}.ics`
}
