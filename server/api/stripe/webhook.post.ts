/**
 * POST /api/stripe/webhook
 *
 * The only place a booking is allowed to become `confirmed`. The signature is
 * verified against NUXT_STRIPE_WEBHOOK_SECRET and every event id is recorded, so
 * Stripe's at-least-once delivery cannot double-count a payment.
 *
 * Configure in Stripe -> Developers -> Webhooks with these events:
 *   checkout.session.completed
 *   checkout.session.expired
 *   payment_intent.payment_failed
 *   charge.refunded
 */
import type Stripe from 'stripe'
import { assertNoDbError, serviceClient } from '~~/server/utils/supabase'
import { getStripe } from '~~/server/utils/stripe'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const secret = config.stripeWebhookSecret
  if (!secret) {
    throw createError({ statusCode: 503, statusMessage: 'Stripe webhook secret is not configured' })
  }

  const signature = getRequestHeader(event, 'stripe-signature')
  const payload = await readRawBody(event, false)
  if (!signature || !payload) {
    throw createError({ statusCode: 400, statusMessage: 'Missing Stripe signature' })
  }

  const stripe = getStripe()
  let stripeEvent: Stripe.Event
  try {
    stripeEvent = stripe.webhooks.constructEvent(payload, signature, secret)
  } catch (error) {
    console.error('[stripe] signature verification failed:', error)
    throw createError({ statusCode: 400, statusMessage: 'Invalid Stripe signature' })
  }

  const supabase = serviceClient()

  // Idempotency: the primary key rejects a replay of an event we already saw.
  const { error: dedupeError } = await supabase
    .from('stripe_events')
    .insert({ id: stripeEvent.id, type: stripeEvent.type })

  if (dedupeError?.code === '23505') {
    return { received: true, duplicate: true }
  }
  assertNoDbError(dedupeError, 'recording the Stripe event')

  switch (stripeEvent.type) {
    case 'checkout.session.completed':
      await onCheckoutCompleted(stripeEvent.data.object)
      break
    case 'checkout.session.expired':
      await onCheckoutExpired(stripeEvent.data.object)
      break
    case 'payment_intent.payment_failed':
      await onPaymentFailed(stripeEvent.data.object)
      break
    case 'charge.refunded':
      await onChargeRefunded(stripeEvent.data.object)
      break
    default:
      // Acknowledged and ignored — Stripe retries anything we 4xx/5xx.
      break
  }

  return { received: true }
})

function bookingIdOf(object: { metadata?: Stripe.Metadata | null }): string | null {
  return object.metadata?.booking_id ?? null
}

async function onCheckoutCompleted(session: Stripe.Checkout.Session) {
  const bookingId = bookingIdOf(session)
  if (!bookingId || session.payment_status !== 'paid') return

  const supabase = serviceClient()
  const kind = session.metadata?.kind === 'balance' ? 'balance' : 'deposit'
  const amount = session.amount_total ?? 0
  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id ?? null

  const { data: booking, error } = await supabase
    .from('bookings').select('*').eq('id', bookingId).single()
  assertNoDbError(error, 'loading the paid booking')
  if (!booking) return

  const amountPaid = booking.amount_paid_cents + amount
  const patch: Record<string, unknown> = {
    amount_paid_cents: amountPaid,
    balance_cents: Math.max(0, booking.total_cents - amountPaid),
    stripe_payment_intent_id: paymentIntentId,
    stripe_customer_id: typeof session.customer === 'string' ? session.customer : null
  }

  // A deposit payment is what turns a hold into a real reservation.
  if (booking.status === 'pending' || booking.status === 'expired') {
    patch.status = 'confirmed'
    patch.confirmed_at = new Date().toISOString()
    patch.hold_expires_at = null
  }
  if (kind === 'balance' && amountPaid >= booking.total_cents) {
    patch.balance_payment_url = null
  }

  await supabase.from('bookings').update(patch).eq('id', bookingId)

  // Settle the pending row created next to the checkout session; if there is
  // none (payment link created outside the normal flow), record a fresh one.
  const { data: settled } = await supabase.from('booking_payments')
    .update({
      status: 'succeeded',
      amount_cents: amount,
      stripe_payment_intent_id: paymentIntentId,
      raw: session as unknown as Record<string, unknown>
    })
    .eq('stripe_session_id', session.id)
    .eq('status', 'pending')
    .select('id')

  if (!settled?.length) {
    await supabase.from('booking_payments').insert({
      booking_id: bookingId,
      kind,
      amount_cents: amount,
      currency: (session.currency ?? booking.currency).toUpperCase(),
      status: 'succeeded',
      stripe_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      raw: session as unknown as Record<string, unknown>
    })
  }
}

async function onCheckoutExpired(session: Stripe.Checkout.Session) {
  const bookingId = bookingIdOf(session)
  if (!bookingId) return

  const supabase = serviceClient()
  await supabase.from('bookings')
    .update({
      status: 'expired',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: 'Checkout session expired'
    })
    .eq('id', bookingId)
    .eq('status', 'pending')

  await supabase.from('booking_payments')
    .update({ status: 'cancelled' })
    .eq('stripe_session_id', session.id)
    .eq('status', 'pending')
}

async function onPaymentFailed(intent: Stripe.PaymentIntent) {
  const bookingId = bookingIdOf(intent)
  if (!bookingId) return

  await serviceClient().from('booking_payments')
    .update({ status: 'failed' })
    .eq('stripe_payment_intent_id', intent.id)
}

async function onChargeRefunded(charge: Stripe.Charge) {
  const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null
  if (!paymentIntentId) return

  const supabase = serviceClient()
  const { data: booking } = await supabase
    .from('bookings').select('id, amount_paid_cents, total_cents')
    .eq('stripe_payment_intent_id', paymentIntentId).maybeSingle()

  if (!booking) return

  await supabase.from('booking_payments').insert({
    booking_id: booking.id,
    kind: 'refund',
    amount_cents: -(charge.amount_refunded ?? 0),
    currency: charge.currency.toUpperCase(),
    status: 'refunded',
    stripe_payment_intent_id: paymentIntentId,
    stripe_charge_id: charge.id,
    raw: charge as unknown as Record<string, unknown>
  })

  const amountPaid = Math.max(0, booking.amount_paid_cents - (charge.amount_refunded ?? 0))
  await supabase.from('bookings').update({
    amount_paid_cents: amountPaid,
    balance_cents: Math.max(0, booking.total_cents - amountPaid)
  }).eq('id', booking.id)
}
