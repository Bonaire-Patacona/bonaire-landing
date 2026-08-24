/** Create a property with an independent settings row cloned from the default. */
import { randomUUID } from 'node:crypto'
import { assertNoDbError, getProperty, getSettings, requireAdmin, serviceClient } from '~~/server/utils/supabase'

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const body = await readBody<{ name?: string, slug?: string }>(event)
  const name = body.name?.trim() ?? ''
  const slug = body.slug?.trim().toLowerCase() ?? ''
  if (name.length < 2 || !SLUG_RE.test(slug)) {
    throw createError({ statusCode: 400, statusMessage: 'Name and a valid URL slug are required' })
  }

  const supabase = serviceClient()
  const { data: property, error } = await supabase.from('properties')
    .insert({ name, slug }).select('*').single()
  if (error?.code === '23505') throw createError({ statusCode: 409, statusMessage: 'That property slug already exists' })
  assertNoDbError(error, 'creating property')

  const defaultProperty = await getProperty()
  const source = await getSettings(defaultProperty.id)
  const { id: _id, property_id: _propertyId, updated_at: _updatedAt, ical_export_token: _token, ...defaults } = source
  const { error: settingsError } = await supabase.from('app_settings').insert({
    ...defaults,
    property_id: property.id,
    property_name: name,
    ical_export_token: randomUUID()
  })
  if (settingsError) {
    // Avoid leaving a property that cannot be booked or configured.
    await supabase.from('properties').delete().eq('id', property.id)
    assertNoDbError(settingsError, 'creating property settings')
  }

  return property
})
