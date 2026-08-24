/**
 * POST /api/admin/bookings/:id/security-deposit  { amount_cents?, reason? }
 *
 * Charges damages to the card the guest left at booking time.
 *
 * Nothing is ever held: an authorisation expires after about 7 days, so
 * covering a stay would mean re-authorising every few days, and every renewal
 * is another chance for the issuer to decline — while the guest watches two
 * pending amounts on their statement. The card stays on file instead and is
 * only charged if something actually breaks.
 */
import Stripe from 'stripe'
import { assertNoDbError, getSettings, requireAdmin, serviceClient } from '~~/server/utils/supabase'
import { getStripe, isStripeConfigured, toStripeAmount } from '~~/server/utils/stripe'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing booking id' })

  const body = await readBody<{ amount_cents?: number, reason?: string }>(event)
  const supabase = serviceClient()

  const { data: booking, error } = await supabase
    .from('bookings').select('*').eq('id', id).single()
  assertNoDbError(error, 'loading the booking')
  if (!booking) throw createError({ statusCode: 404, statusMessage: 'Booking not found' })

  const settings = await getSettings()
  if (settings.security_deposit_mode !== 'card_on_file') {
    throw createError({
      statusCode: 409,
      statusMessage: 'The damage deposit is switched off (Ajustes → Fianza)'
    })
  }
  if (!isStripeConfigured()) {
    throw createError({ statusCode: 503, statusMessage: 'Stripe is not configured' })
  }
  if (!booking.stripe_customer_id || !booking.stripe_payment_method_id) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This booking has no card on file, so nothing can be charged'
    })
  }

  const amount = Math.round(body?.amount_cents ?? booking.security_deposit_cents ?? 0)
  if (amount <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'The amount must be greater than zero' })
  }

  const reason = (body?.reason ?? '').trim()

  try {
    const intent = await getStripe().paymentIntents.create({
      amount: toStripeAmount(amount),
      currency: booking.currency.toLowerCase(),
      customer: booking.stripe_customer_id,
      payment_method: booking.stripe_payment_method_id,
      off_session: true,
      confirm: true,
      description: `${settings.property_name} · ${booking.reference} · ${reason || 'damage deposit'}`,
      metadata: {
        booking_id: booking.id,
        reference: booking.reference,
        kind: 'security_deposit',
        // Deliberately not 'auto_balance': damages are not part of the stay
        // price, so the webhook must leave amount_paid_cents alone.
        source: 'security_deposit'
      }
    })

    await supabase.from('booking_payments').insert({
      booking_id: booking.id,
      kind: 'security_deposit',
      amount_cents: amount,
      currency: booking.currency,
      status: 'succeeded',
      stripe_payment_intent_id: intent.id,
      stripe_charge_id: typeof intent.latest_charge === 'string' ? intent.latest_charge : null,
      raw: { reason: reason || null }
    })

    return { charged_cents: amount, currency: booking.currency, payment_intent_id: intent.id }
  } catch (stripeError) {
    const declined = stripeError instanceof Stripe.errors.StripeError ? stripeError : null
    const message = declined?.message ?? 'The card was declined'
    console.error(`[payments] damage charge declined for ${booking.reference}:`, message)

    await supabase.from('booking_payments').insert({
      booking_id: booking.id,
      kind: 'security_deposit',
      amount_cents: amount,
      currency: booking.currency,
      status: 'failed',
      stripe_payment_intent_id: declined?.payment_intent?.id ?? null,
      raw: { reason: reason || null, error: message, code: declined?.code ?? null }
    })

    throw createError({ statusCode: 402, statusMessage: message })
  }
})
