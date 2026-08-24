/**
 * POST /api/admin/rotate-ical-token — issues a new export token.
 * The old URL stops working immediately, so the channels must be re-pointed.
 */
import { randomUUID } from 'node:crypto'
import { assertNoDbError, getAdminProperty, invalidatePricingCache, requireAdmin, serviceClient } from '~~/server/utils/supabase'
import { exportFeedUrl } from '~~/server/utils/ical-sync'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const property = await getAdminProperty(event)

  const { error } = await serviceClient()
    .from('app_settings').update({ ical_export_token: randomUUID() }).eq('property_id', property.id)
  assertNoDbError(error, 'rotating the iCal token')

  invalidatePricingCache(property.id)
  return { ical_export_url: await exportFeedUrl(property.id) }
})
