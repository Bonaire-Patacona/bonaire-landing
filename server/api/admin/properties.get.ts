import { assertNoDbError, requireAdmin, serviceClient } from '~~/server/utils/supabase'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { data, error } = await serviceClient().from('properties')
    .select('id, slug, name, active, is_default, created_at').order('name')
  assertNoDbError(error, 'loading properties')
  return data ?? []
})
