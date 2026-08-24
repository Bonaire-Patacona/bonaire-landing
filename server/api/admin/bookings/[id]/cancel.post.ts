/**
 * POST /api/admin/bookings/:id/cancel  { reason?, refund?, refund_cents?, dry_run? }
 *
 * Frees the dates and, when asked, refunds through Stripe. How much is owed
 * back comes from the cancellation policy frozen on the booking, not from
 * whatever policy is configured today — the guest agreed to the former.
 *
 * `dry_run` answers "what would this cost?" without touching anything, so the
 * back office can show the number before the host commits.
 */
import { assertNoDbError, requireAdmin, serviceClient } from '~~/server/utils/supabase'
import { getStripe, isStripeConfigured } from '~~/server/utils/stripe'
import { policyFromSnapshot, refundFor } from '~~/server/utils/cancellation'
import { today } from '~~/server/utils/dates'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing booking id' })

  const body = await readBody<{
    reason?: string
    refund?: boolean
    refund_cents?: number
    dry_run?: boolean
  }>(event)
  const supabase = serviceClient()

  const { data: booking, error } = await supabase
    .from('bookings').select('*').eq('id', id).single()
  assertNoDbError(error, 'loading the booking')
  if (!booking) throw createError({ statusCode: 404, statusMessage: 'Booking not found' })

  const policy = policyFromSnapshot(booking.cancellation_policy)
  const outcome = refundFor(
    { amount_paid_cents: booking.amount_paid_cents, check_in: booking.check_in, policy },
    today()
  )

  if (body?.dry_run) {
    return {
      policy: { code: policy.code, name: policy.name },
      amount_paid_cents: booking.amount_paid_cents,
      currency: booking.currency,
      ...outcome
    }
  }

  // The host may overrule the policy in either direction, but never refund more
  // than the guest actually paid.
  const requested = body?.refund_cents != null
    ? Math.max(0, Math.round(body.refund_cents))
    : outcome.refund_cents
  const amount = body?.refund ? Math.min(booking.amount_paid_cents, requested) : 0

  let refunded = 0
  if (amount > 0) {
    if (!booking.stripe_payment_intent_id) {
      throw createError({
        statusCode: 409,
        statusMessage: 'There is no Stripe payment on this booking to refund'
      })
    }
    if (!isStripeConfigured()) {
      throw createError({ statusCode: 503, statusMessage: 'Stripe is not configured' })
    }
    await getStripe().refunds.create({
      payment_intent: booking.stripe_payment_intent_id,
      amount,
      metadata: { booking_id: booking.id, reference: booking.reference }
    })
    refunded = amount
  }

  const { error: updateError } = await supabase.from('bookings').update({
    status: 'cancelled',
    cancelled_at: new Date().toISOString(),
    cancellation_reason: (body?.reason ?? '').trim() || 'Cancelled by the host',
    hold_expires_at: null,
    balance_payment_url: null,
    // Nothing more will be collected from a cancelled booking.
    balance_charge_status: 'not_due',
    balance_next_attempt_at: null,
    refunded_cents: booking.refunded_cents + refunded
  }).eq('id', booking.id)
  assertNoDbError(updateError, 'cancelling the booking')

  return {
    cancelled: true,
    refunded_cents: refunded,
    policy: { code: policy.code, name: policy.name },
    policy_refund_cents: outcome.refund_cents,
    policy_refund_pct: outcome.refund_pct
  }
})
