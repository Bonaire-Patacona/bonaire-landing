import { assertNoDbError, serviceClient } from '~~/server/utils/supabase'
import { isPropertyLocale } from '~~/server/utils/property-translations'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  const requestedLocale = getQuery(event).locale
  const supabase = serviceClient()
  const { data: property, error } = await supabase.from('properties').select('*')
    .eq('slug', slug).eq('active', true).eq('published', true).maybeSingle()
  assertNoDbError(error, 'loading property page')
  if (!property) throw createError({ statusCode: 404, statusMessage: 'Property not found' })

  const locale = isPropertyLocale(requestedLocale) ? requestedLocale : property.source_locale
  const [images, features, reviews, settings, translation] = await Promise.all([
    supabase.from('property_images').select('id, url, alt, is_cover').eq('property_id', property.id).order('sort_order'),
    supabase.from('property_features').select('id, name, description, icon').eq('property_id', property.id).order('sort_order'),
    supabase.from('property_reviews').select('id, author, quote, rating, source, reviewed_at')
      .eq('property_id', property.id).eq('active', true).order('sort_order'),
    supabase.from('app_settings').select('currency, base_nightly_cents, max_guests, checkin_time, checkout_time')
      .eq('property_id', property.id).single(),
    locale === property.source_locale
      ? Promise.resolve({ data: null })
      : supabase.from('property_translations').select('name, short_description, description, features, reviews')
          .eq('property_id', property.id).eq('locale', locale).maybeSingle()
  ])
  const translatedFeatures = new Map(
    ((translation.data?.features ?? []) as Array<{ id: string, name: string, description: string }>)
      .map(item => [item.id, item])
  )
  const translatedReviews = new Map(
    ((translation.data?.reviews ?? []) as Array<{ id: string, quote: string }>).map(item => [item.id, item])
  )
  return {
    ...property,
    ...(translation.data ?? {}),
    locale,
    images: images.data ?? [],
    features: (features.data ?? []).map(feature => ({ ...feature, ...(translatedFeatures.get(feature.id) ?? {}) })),
    reviews: (reviews.data ?? []).map(review => ({ ...review, ...(translatedReviews.get(review.id) ?? {}) })),
    booking: settings.data
  }
})
