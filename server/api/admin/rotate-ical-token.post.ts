/**
 * POST /api/admin/rotate-ical-token — issues a new export token.
 * The old URL stops working immediately, so the channels must be re-pointed.
 */
import { randomUUID } from 'node:crypto'
import { assertNoDbError, invalidatePricingCache, requireAdmin, serviceClient } from '~~/server/utils/supabase'
import { exportFeedUrl } from '~~/server/utils/ical-sync'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const { error } = await serviceClient()
    .from('app_settings').update({ ical_export_token: randomUUID() }).eq('id', 1)
  assertNoDbError(error, 'rotating the iCal token')

  invalidatePricingCache()
  return { ical_export_url: await exportFeedUrl() }
})
