import { randomUUID } from 'node:crypto'
import { assertNoDbError, requireAdmin, serviceClient } from '~~/server/utils/supabase'

const BUCKET = 'property-images'
const MAX_BYTES = 15 * 1024 * 1024
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif'
}

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const propertyId = getRouterParam(event, 'id')
  const parts = await readMultipartFormData(event)
  const file = parts?.find(part => part.name === 'file' && part.filename)
  const alt = parts?.find(part => part.name === 'alt')?.data.toString().trim() ?? ''
  if (!file?.type || !EXTENSIONS[file.type]) {
    throw createError({ statusCode: 400, statusMessage: 'Upload a JPG, PNG, WebP or AVIF image' })
  }
  if (!file.data.length || file.data.length > MAX_BYTES) {
    throw createError({ statusCode: 400, statusMessage: 'The image must be smaller than 15 MB' })
  }

  const supabase = serviceClient()
  const { data: property, error: propertyError } = await supabase.from('properties')
    .select('id').eq('id', propertyId).maybeSingle()
  assertNoDbError(propertyError, 'checking property before image upload')
  if (!property) throw createError({ statusCode: 404, statusMessage: 'Property not found' })

  const { error: bucketError } = await supabase.storage.getBucket(BUCKET)
  if (bucketError) {
    const { error: createBucketError } = await supabase.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: MAX_BYTES,
      allowedMimeTypes: Object.keys(EXTENSIONS)
    })
    if (createBucketError && !createBucketError.message.toLowerCase().includes('exist')) {
      throw createError({ statusCode: 500, statusMessage: 'Could not prepare image storage' })
    }
  }

  const path = `${property.id}/${randomUUID()}.${EXTENSIONS[file.type]}`
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file.data, {
    contentType: file.type,
    cacheControl: '31536000',
    upsert: false
  })
  if (uploadError) throw createError({ statusCode: 500, statusMessage: `Image upload failed: ${uploadError.message}` })

  const config = useRuntimeConfig()
  const publicSupabaseUrl = (config.public as { supabase?: { url?: string } }).supabase?.url
    || process.env.SUPABASE_PUBLIC_URL
    || config.supabaseInternalUrl
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  const url = `${String(publicSupabaseUrl).replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/${encodedPath}`
  const { count } = await supabase.from('property_images').select('id', { count: 'exact', head: true })
    .eq('property_id', property.id)
  const { data: image, error: insertError } = await supabase.from('property_images').insert({
    property_id: property.id,
    url,
    storage_path: path,
    alt,
    sort_order: count ?? 0
  }).select('*').single()
  if (insertError) {
    await supabase.storage.from(BUCKET).remove([path])
    assertNoDbError(insertError, 'saving uploaded property image')
  }
  return image
})
