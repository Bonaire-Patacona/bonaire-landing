/**
 * POST /api/bookings
 *
 * Creates a booking in `pending` state, holds the dates for
 * app_settings.hold_minutes and opens a Stripe Checkout session for the
 * deposit. The booking only becomes `confirmed` when the Stripe webhook
 * confirms the payment — never from the browser.
 */
import { isIsoDate, today } from '~~/server/utils/dates'
import { isRangeAvailable, runHousekeeping } from '~~/server/utils/availability'
import { assertNoDbError, getRatePeriods, getSettings, serviceClient } from '~~/server/utils/supabase'
import { QuoteError, buildQuote } from '~~/server/utils/pricing'
import { generateReference } from '~~/server/utils/reference'
import { getStripe, isStripeConfigured, toStripeAmount } from '~~/server/utils/stripe'

interface CreateBookingBody {
  check_in?: string
  check_out?: string
  adults?: number
  children?: number
  guest_name?: string
  guest_email?: string
  guest_phone?: string
  guest_country?: string
  notes?: string
  locale?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateBookingBody>(event)
  const config = useRuntimeConfig()

  // --- validate -------------------------------------------------------------
  if (!isIsoDate(body?.check_in) || !isIsoDate(body?.check_out)) {
    throw createError({ statusCode: 400, statusMessage: 'check_in and check_out must be YYYY-MM-DD' })
  }
  const guestName = (body.guest_name ?? '').trim()
  const guestEmail = (body.guest_email ?? '').trim().toLowerCase()
  if (guestName.length < 2) {
    throw createError({ statusCode: 400, statusMessage: 'A guest name is required' })
  }
  if (!EMAIL_RE.test(guestEmail)) {
    throw createError({ statusCode: 400, statusMessage: 'A valid email address is required' })
  }

  // Free up anything whose hold lapsed, so those dates can be re-sold now.
  await runHousekeeping()

  const [settings, periods] = await Promise.all([getSettings(true), getRatePeriods(true)])

  let quote
  try {
    quote = buildQuote(
      {
        checkIn: body.check_in,
        checkOut: body.check_out,
        adults: Number(body.adults ?? 2),
        children: Number(body.children ?? 0)
      },
      settings,
      periods,
      today()
    )
  } catch (error) {
    if (error instanceof QuoteError) {
      throw createError({ statusCode: 422, statusMessage: error.message, data: { code: error.code } })
    }
    throw error
  }

  if (!(await isRangeAvailable(quote.check_in, quote.check_out))) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Those dates are no longer available',
      data: { code: 'unavailable' }
    })
  }

  // --- persist --------------------------------------------------------------
  const supabase = serviceClient()
  const reference = await generateReference()
  const holdExpiresAt = new Date(Date.now() + settings.hold_minutes * 60_000).toISOString()

  const { data: booking, error } = await supabase
    .from('bookings')
    .insert({
      reference,
      status: 'pending',
      source: 'direct',
      check_in: quote.check_in,
      check_out: quote.check_out,
      adults: quote.adults,
      children: quote.children,
      guest_name: guestName,
      guest_email: guestEmail,
      guest_phone: (body.guest_phone ?? '').trim() || null,
      guest_country: (body.guest_country ?? '').trim() || null,
      locale: body.locale ?? 'es',
      notes: (body.notes ?? '').trim() || null,
      currency: quote.currency,
      nightly_subtotal_cents: quote.nightly_subtotal_cents,
      cleaning_fee_cents: quote.cleaning_fee_cents,
      extra_guest_cents: quote.extra_guest_cents,
      discount_cents: quote.discount_cents,
      tax_cents: quote.tax_cents,
      total_cents: quote.total_cents,
      deposit_cents: quote.deposit_cents,
      balance_cents: quote.balance_cents,
      security_deposit_cents: quote.security_deposit_cents,
      price_breakdown: quote.breakdown,
      balance_due_date: quote.balance_due_date,
      hold_expires_at: holdExpiresAt
    })
    .select()
    .single()

  // 23P01 = exclusion constraint: someone else grabbed the dates first.
  if (error?.code === '23P01') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Those dates were just booked by someone else',
      data: { code: 'unavailable' }
    })
  }
  assertNoDbError(error, 'creating the booking')

  // --- payment --------------------------------------------------------------
  if (!isStripeConfigured() || quote.deposit_cents <= 0) {
    return {
      reference: booking.reference,
      status: booking.status,
      checkout_url: null,
      requires_manual_confirmation: true,
      quote
    }
  }

  const siteUrl = config.public.siteUrl.replace(/\/$/, '')
  const stripe = getStripe()

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: guestEmail,
      client_reference_id: booking.reference,
      locale: stripeLocale(booking.locale),
      // Stripe releases the session (and we release the hold) at the same time.
      expires_at: Math.floor(Date.now() / 1000) + Math.max(30, settings.hold_minutes) * 60,
      success_url: `${siteUrl}/reserva/${booking.reference}?paid=1`,
      cancel_url: `${siteUrl}/reserva/${booking.reference}?cancelled=1`,
      metadata: {
        booking_id: booking.id,
        reference: booking.reference,
        kind: 'deposit'
      },
      payment_intent_data: {
        metadata: { booking_id: booking.id, reference: booking.reference, kind: 'deposit' }
      },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: quote.currency.toLowerCase(),
          unit_amount: toStripeAmount(quote.deposit_cents),
          product_data: {
            name: `${settings.property_name} · ${quote.check_in} → ${quote.check_out}`,
            description: quote.balance_cents > 0
              ? `Deposit (${quote.nights} nights). Balance due by ${quote.balance_due_date}.`
              : `Full payment (${quote.nights} nights).`
          }
        }
      }]
    })

    await supabase.from('bookings')
      .update({ stripe_checkout_session_id: session.id })
      .eq('id', booking.id)

    await supabase.from('booking_payments').insert({
      booking_id: booking.id,
      kind: quote.balance_cents > 0 ? 'deposit' : 'full',
      amount_cents: quote.deposit_cents,
      currency: quote.currency,
      status: 'pending',
      stripe_session_id: session.id
    })

    return {
      reference: booking.reference,
      status: booking.status,
      checkout_url: session.url,
      requires_manual_confirmation: false,
      quote
    }
  } catch (stripeError) {
    // Do not sit on the dates if we could not even open a checkout.
    console.error('[stripe] checkout session failed:', stripeError)
    await supabase.from('bookings')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancellation_reason: 'Payment session could not be created' })
      .eq('id', booking.id)

    throw createError({ statusCode: 502, statusMessage: 'Could not start the payment. Please try again.' })
  }
})

/** Stripe accepts a fixed list of locales; fall back to auto-detection. */
function stripeLocale(locale: string) {
  const supported = ['en', 'es', 'fr', 'de', 'it', 'nl', 'sv'] as const
  return (supported as readonly string[]).includes(locale)
    ? locale as (typeof supported)[number]
    : 'auto'
}
