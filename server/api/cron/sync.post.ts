/**
 * POST /api/cron/sync  (Authorization: Bearer $CRON_SECRET)
 *
 * Same work as the in-process scheduled tasks, exposed over HTTP for platforms
 * that prefer an external scheduler (Dokploy/Dockhand cron job, GitHub Action,
 * uptime pinger). Disabled unless NUXT_CRON_SECRET is set.
 */
import { runHousekeeping } from '~~/server/utils/availability'
import { syncAllFeeds } from '~~/server/utils/ical-sync'
import { requireCronSecret } from '~~/server/utils/supabase'

export default defineEventHandler(async (event) => {
  if (!useRuntimeConfig().cronSecret) {
    throw createError({ statusCode: 404, statusMessage: 'Cron endpoint is disabled' })
  }
  requireCronSecret(event)

  const housekeeping = await runHousekeeping()
  const feeds = useRuntimeConfig().icalSyncEnabled === 'false' ? [] : await syncAllFeeds()

  return { housekeeping, feeds }
})
