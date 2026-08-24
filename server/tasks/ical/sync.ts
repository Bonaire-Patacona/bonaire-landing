/**
 * Nitro scheduled task — runs every 30 minutes (see nuxt.config.ts).
 * Pulls Airbnb / Booking.com / Vrbo calendars into external_blocks.
 */
import { syncAllFeeds, type FeedSyncResult } from '~~/server/utils/ical-sync'

export default defineTask({
  meta: {
    name: 'ical:sync',
    description: 'Import availability from the connected channel calendars'
  },
  async run() {
    if (useRuntimeConfig().icalSyncEnabled === 'false') {
      return { result: { skipped: true, feeds: 0, failed: 0, results: [] as FeedSyncResult[] } }
    }

    const results = await syncAllFeeds()
    const failed = results.filter(r => !r.ok)
    if (failed.length) {
      console.warn(`[ical:sync] ${failed.length}/${results.length} feeds failed`)
    }
    return { result: { skipped: false, feeds: results.length, failed: failed.length, results } }
  }
})
