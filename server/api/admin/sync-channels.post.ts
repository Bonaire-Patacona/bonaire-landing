/** POST /api/admin/sync-channels — run the iCal import right now. */
import { requireAdmin } from '~~/server/utils/supabase'
import { syncAllFeeds } from '~~/server/utils/ical-sync'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const results = await syncAllFeeds()
  return { synced: results.length, results }
})
