/**
 * POST /api/admin/bookings/:id/cancel  { reason?, refund?, refund_cents? }
 *
 * Frees the dates and, when asked, refunds what the guest already paid through
 * Stripe. The refund itself is reconciled by the charge.refunded webhook.
 */
import { assertNoDbError, requireAdmin, serviceClient } from '~~/server/utils/supabase'
import { getStripe, isStripeConfigured } from '~~/server/utils/stripe'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing booking id' })

  const body = await readBody<{ reason?: string, refund?: boolean, refund_cents?: number }>(event)
  const supabase = serviceClient()

  const { data: booking, error } = await supabase
    .from('bookings').select('*').eq('id', id).single()
  assertNoDbError(error, 'loading the booking')
  if (!booking) throw createError({ statusCode: 404, statusMessage: 'Booking not found' })

  let refunded = 0
  if (body?.refund && booking.stripe_payment_intent_id && booking.amount_paid_cents > 0) {
    if (!isStripeConfigured()) {
      throw createError({ statusCode: 503, statusMessage: 'Stripe is not configured' })
    }
    const amount = Math.min(
      booking.amount_paid_cents,
      Math.max(0, Math.round(body.refund_cents ?? booking.amount_paid_cents))
    )
    if (amount > 0) {
      await getStripe().refunds.create({
        payment_intent: booking.stripe_payment_intent_id,
        amount,
        metadata: { booking_id: booking.id, reference: booking.reference }
      })
      refunded = amount
    }
  }

  const { error: updateError } = await supabase.from('bookings').update({
    status: 'cancelled',
    cancelled_at: new Date().toISOString(),
    cancellation_reason: (body?.reason ?? '').trim() || 'Cancelled by the host',
    hold_expires_at: null,
    balance_payment_url: null
  }).eq('id', booking.id)
  assertNoDbError(updateError, 'cancelling the booking')

  return { cancelled: true, refunded_cents: refunded }
})
