import { assertNoDbError, requireAdmin, serviceClient } from '~~/server/utils/supabase'

const BUCKET = 'property-images'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const propertyId = getRouterParam(event, 'id')
  const imageId = getRouterParam(event, 'imageId')
  const supabase = serviceClient()
  const { data: image, error } = await supabase.from('property_images')
    .select('id, storage_path').eq('id', imageId).eq('property_id', propertyId).maybeSingle()
  assertNoDbError(error, 'loading property image')
  if (!image) throw createError({ statusCode: 404, statusMessage: 'Image not found' })

  if (image.storage_path) {
    const { error: storageError } = await supabase.storage.from(BUCKET).remove([image.storage_path])
    if (storageError) throw createError({ statusCode: 500, statusMessage: `Could not remove stored image: ${storageError.message}` })
  }
  const { error: deleteError } = await supabase.from('property_images').delete().eq('id', image.id)
  assertNoDbError(deleteError, 'deleting property image')
  return { deleted: true }
})
