/**
 * POST /api/admin/bookings/manual
 *
 * Records a booking taken outside the website (phone, WhatsApp, a channel that
 * does not sync). It goes straight to `confirmed`, so the dates are blocked and
 * the outbound iCal feed picks it up on the next channel refresh.
 */
import { isIsoDate } from '~~/server/utils/dates'
import { isRangeAvailable } from '~~/server/utils/availability'
import { assertNoDbError, getAdminProperty, getCancellationPolicy, getProperty, getRateOverrides, getRatePeriods, getSettings, requireAdmin, serviceClient } from '~~/server/utils/supabase'
import { buildQuote, QuoteError } from '~~/server/utils/pricing'
import { generateReference } from '~~/server/utils/reference'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const body = await readBody<{
    property?: string
    check_in?: string
    check_out?: string
    adults?: number
    children?: number
    guest_name?: string
    guest_email?: string
    guest_phone?: string
    source?: string
    notes?: string
    total_cents?: number
    amount_paid_cents?: number
  }>(event)

  if (!isIsoDate(body?.check_in) || !isIsoDate(body?.check_out)) {
    throw createError({ statusCode: 400, statusMessage: 'check_in and check_out must be YYYY-MM-DD' })
  }
  if (!(body.guest_name ?? '').trim()) {
    throw createError({ statusCode: 400, statusMessage: 'A guest name is required' })
  }
  const property = body.property ? await getProperty(body.property) : await getAdminProperty(event)
  if (!(await isRangeAvailable(property.id, body.check_in, body.check_out))) {
    throw createError({ statusCode: 409, statusMessage: 'Those dates are already taken' })
  }

  const [settings, periods, overrides, cancellation] = await Promise.all([
    getSettings(property.id), getRatePeriods(property.id), getRateOverrides(property.id),
    getCancellationPolicy(property.id, false, body.check_in)
  ])

  // The host may override the price; otherwise fall back to the rate card.
  // House rules (min stay, notice) do not apply to a manual entry.
  let quote = null
  try {
    quote = buildQuote(
      {
        checkIn: body.check_in,
        checkOut: body.check_out,
        adults: Number(body.adults ?? 2),
        children: Number(body.children ?? 0)
      },
      { ...settings, min_nights: 1, advance_notice_days: 0, booking_window_days: 3650 },
      periods,
      body.check_in,
      overrides
    )
  } catch (error) {
    if (!(error instanceof QuoteError)) throw error
  }

  const total = Math.max(0, Math.round(body.total_cents ?? quote?.total_cents ?? 0))
  const paid = Math.min(total, Math.max(0, Math.round(body.amount_paid_cents ?? 0)))

  const { data, error } = await serviceClient().from('bookings').insert({
    property_id: property.id,
    reference: await generateReference(),
    status: 'confirmed',
    source: body.source ?? 'manual',
    check_in: body.check_in,
    check_out: body.check_out,
    adults: Math.max(1, Number(body.adults ?? 2)),
    children: Math.max(0, Number(body.children ?? 0)),
    guest_name: body.guest_name!.trim(),
    guest_email: (body.guest_email ?? '').trim().toLowerCase() || 'sin-email@bonairepatacona.com',
    guest_phone: (body.guest_phone ?? '').trim() || null,
    notes: (body.notes ?? '').trim() || null,
    currency: settings.currency,
    nightly_subtotal_cents: quote?.nightly_subtotal_cents ?? total,
    cleaning_fee_cents: quote?.cleaning_fee_cents ?? 0,
    extra_guest_cents: quote?.extra_guest_cents ?? 0,
    discount_cents: quote?.discount_cents ?? 0,
    tax_cents: quote?.tax_cents ?? 0,
    total_cents: total,
    deposit_cents: paid,
    balance_cents: total - paid,
    amount_paid_cents: paid,
    price_breakdown: quote?.breakdown ?? [],
    cancellation_policy: cancellation,
    confirmed_at: new Date().toISOString()
  }).select().single()

  if (error?.code === '23P01') {
    throw createError({ statusCode: 409, statusMessage: 'Those dates are already taken' })
  }
  assertNoDbError(error, 'creating the manual booking')

  return data
})
