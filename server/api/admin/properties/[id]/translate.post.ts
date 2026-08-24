import OpenAI from 'openai'
import { assertNoDbError, requireAdmin, serviceClient } from '~~/server/utils/supabase'
import {
  isPropertyLocale,
  PROPERTY_LOCALES,
  propertySourceHash,
  translationSchema,
  type PropertyLocale,
  type PropertySourceText
} from '~~/server/utils/property-translations'

interface TranslationResult extends PropertySourceText { locale: PropertyLocale }

function hasExactlyIds(source: Array<{ id: string }>, translated: Array<{ id: string }>): boolean {
  return source.length === translated.length
    && new Set(translated.map(item => item.id)).size === translated.length
    && source.every(item => translated.some(candidate => candidate.id === item.id))
}

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const propertyId = getRouterParam(event, 'id')
  const body = await readBody<{ locales?: unknown[], overwrite?: boolean }>(event)
  const config = useRuntimeConfig()
  if (!config.openaiApiKey) {
    throw createError({ statusCode: 503, statusMessage: 'AI translations are not configured (OPENAI_API_KEY)' })
  }

  const supabase = serviceClient()
  const [{ data: property, error }, features, reviews] = await Promise.all([
    supabase.from('properties').select('id, name, short_description, description, source_locale')
      .eq('id', propertyId).maybeSingle(),
    supabase.from('property_features').select('id, name, description').eq('property_id', propertyId).order('sort_order'),
    supabase.from('property_reviews').select('id, quote').eq('property_id', propertyId).order('sort_order')
  ])
  assertNoDbError(error, 'loading translation source')
  assertNoDbError(features.error, 'loading features to translate')
  assertNoDbError(reviews.error, 'loading reviews to translate')
  if (!property) throw createError({ statusCode: 404, statusMessage: 'Property not found' })

  const requested = body.locales?.filter(isPropertyLocale) ?? [...PROPERTY_LOCALES]
  const targets = [...new Set(requested)].filter(locale => locale !== property.source_locale)
  if (!targets.length) return { translated: [], skipped: [] }

  const source: PropertySourceText = {
    name: property.name,
    short_description: property.short_description,
    description: property.description,
    features: features.data ?? [],
    reviews: reviews.data ?? []
  }
  const hash = propertySourceHash(source)

  const { data: existing, error: existingError } = await supabase.from('property_translations')
    .select('locale, origin, source_hash').eq('property_id', property.id).in('locale', targets)
  assertNoDbError(existingError, 'loading existing translations')
  const existingByLocale = new Map((existing ?? []).map(row => [row.locale, row]))
  const locales = body.overwrite
    ? targets
    : targets.filter((locale) => {
        const row = existingByLocale.get(locale)
        return !row || (row.origin === 'ai' && row.source_hash !== hash)
      })
  const skipped = targets.filter(locale => !locales.includes(locale))
  if (!locales.length) return { translated: [], skipped }

  const response = await new OpenAI({ apiKey: config.openaiApiKey }).responses.create({
    model: config.openaiTranslationModel,
    store: false,
    instructions: [
      'You translate commercial copy for a holiday-rental booking website.',
      'Preserve meaning, proper nouns, factual details, tone, paragraph breaks and units.',
      'Translate feature names, feature descriptions and review quotes too.',
      'Keep every feature and review ID unchanged and return every source item exactly once.',
      'Do not add claims or information. Return every requested locale exactly once.'
    ].join(' '),
    input: JSON.stringify({ source_locale: property.source_locale, target_locales: locales, content: source }),
    text: {
      format: {
        type: 'json_schema',
        name: 'property_translations',
        strict: true,
        schema: translationSchema(locales)
      }
    }
  })

  let parsed: { translations: TranslationResult[] }
  try {
    parsed = JSON.parse(response.output_text) as typeof parsed
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'The translation service returned invalid data' })
  }
  const byLocale = new Map(parsed.translations.map(translation => [translation.locale, translation]))
  if (locales.some(locale => !byLocale.has(locale))) {
    throw createError({ statusCode: 502, statusMessage: 'The translation service omitted a requested language' })
  }
  if ([...byLocale.values()].some(translation =>
    !hasExactlyIds(source.features, translation.features) || !hasExactlyIds(source.reviews, translation.reviews)
  )) {
    throw createError({ statusCode: 502, statusMessage: 'The translation service changed feature or review identifiers' })
  }

  const now = new Date().toISOString()
  const rows = locales.map((locale) => {
    const translation = byLocale.get(locale)!
    return {
      property_id: property.id,
      locale,
      name: translation.name,
      short_description: translation.short_description,
      description: translation.description,
      features: translation.features,
      reviews: translation.reviews,
      origin: 'ai',
      source_hash: hash,
      generated_at: now,
      updated_at: now
    }
  })
  const { error: upsertError } = await supabase.from('property_translations').upsert(rows)
  assertNoDbError(upsertError, 'saving AI translations')
  return { translated: locales, skipped }
})
