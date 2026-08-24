/** POST /api/admin/sync-channels — run the iCal import right now. */
import { getProperty, requireAdmin } from '~~/server/utils/supabase'
import { syncAllFeeds } from '~~/server/utils/ical-sync'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const selector = getHeader(event, 'x-property-id')
  const property = selector ? await getProperty(selector) : null
  const results = await syncAllFeeds(property?.id)
  return { synced: results.length, results }
})
