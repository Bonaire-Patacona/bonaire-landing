/** Public catalogue used by a multi-property landing page or selector. */
import { assertNoDbError, serviceClient } from '~~/server/utils/supabase'
import { isPropertyLocale } from '~~/server/utils/property-translations'

export default defineEventHandler(async (event) => {
  const locale = isPropertyLocale(getQuery(event).locale) ? String(getQuery(event).locale) : null
  const supabase = serviceClient()
  const { data, error } = await supabase.from('properties')
    .select('id, slug, name, short_description, city, country, is_default, source_locale')
    .eq('active', true).eq('published', true).order('name')
  assertNoDbError(error, 'loading properties')
  if (!locale || !data?.length) return data ?? []

  const ids = data.filter(property => property.source_locale !== locale).map(property => property.id)
  if (!ids.length) return data
  const { data: translations, error: translationError } = await supabase.from('property_translations')
    .select('property_id, name, short_description').eq('locale', locale).in('property_id', ids)
  assertNoDbError(translationError, 'loading property catalogue translations')
  const translated = new Map((translations ?? []).map(row => [row.property_id, row]))
  return data.map((property) => {
    const translation = translated.get(property.id)
    return { ...property, ...(translation ? { name: translation.name, short_description: translation.short_description } : {}) }
  })
})
