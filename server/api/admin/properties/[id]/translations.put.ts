import { assertNoDbError, requireAdmin, serviceClient } from '~~/server/utils/supabase'
import { isPropertyLocale, propertySourceHash, type PropertySourceText } from '~~/server/utils/property-translations'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const propertyId = getRouterParam(event, 'id')
  const body = await readBody<Partial<PropertySourceText> & { locale?: unknown }>(event)
  if (!isPropertyLocale(body.locale)) throw createError({ statusCode: 400, statusMessage: 'Invalid locale' })

  const supabase = serviceClient()
  const [{ data: property, error }, features, reviews] = await Promise.all([
    supabase.from('properties').select('id, name, short_description, description, source_locale')
      .eq('id', propertyId).maybeSingle(),
    supabase.from('property_features').select('id, name, description').eq('property_id', propertyId).order('sort_order'),
    supabase.from('property_reviews').select('id, quote').eq('property_id', propertyId).order('sort_order')
  ])
  assertNoDbError(error, 'loading translation source')
  assertNoDbError(features.error, 'loading features for manual translation')
  assertNoDbError(reviews.error, 'loading reviews for manual translation')
  if (!property) throw createError({ statusCode: 404, statusMessage: 'Property not found' })
  if (body.locale === property.source_locale) {
    throw createError({ statusCode: 400, statusMessage: 'Edit the source language in the main property form' })
  }

  const source: PropertySourceText = {
    name: property.name,
    short_description: property.short_description,
    description: property.description,
    features: features.data ?? [],
    reviews: reviews.data ?? []
  }
  const submittedFeatures = Array.isArray(body.features) ? body.features : []
  const submittedReviews = Array.isArray(body.reviews) ? body.reviews : []
  const row = {
    property_id: property.id,
    locale: body.locale,
    name: String(body.name ?? '').trim(),
    short_description: String(body.short_description ?? '').trim(),
    description: String(body.description ?? '').trim(),
    features: source.features.map((feature) => {
      const submitted = submittedFeatures.find(item => item.id === feature.id)
      return {
        id: feature.id,
        name: String(submitted?.name ?? feature.name).trim(),
        description: String(submitted?.description ?? feature.description).trim()
      }
    }),
    reviews: source.reviews.map((review) => {
      const submitted = submittedReviews.find(item => item.id === review.id)
      return { id: review.id, quote: String(submitted?.quote ?? review.quote).trim() }
    }),
    origin: 'manual',
    source_hash: propertySourceHash(source),
    generated_at: null,
    updated_at: new Date().toISOString()
  }
  const { data, error: upsertError } = await supabase.from('property_translations').upsert(row).select('*').single()
  assertNoDbError(upsertError, 'saving manual translation')
  return data
})
