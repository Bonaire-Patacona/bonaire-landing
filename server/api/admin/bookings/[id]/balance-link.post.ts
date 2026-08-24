/**
 * POST /api/admin/bookings/:id/balance-link
 *
 * Creates a Stripe Checkout link for whatever is still owed and stores it on
 * the booking, so it can be pasted into an email to the guest. Asking for the
 * link means the host is taking the collection over by hand, so any pending
 * automatic charge stands down.
 */
import { assertNoDbError, getAdminProperty, getSettings, requireAdmin, serviceClient } from '~~/server/utils/supabase'
import { createBalanceCheckout } from '~~/server/utils/payments'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const property = await getAdminProperty(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing booking id' })

  const supabase = serviceClient()
  const { data: booking, error } = await supabase
    .from('bookings').select('*').eq('id', id).eq('property_id', property.id).single()
  assertNoDbError(error, 'loading the booking')
  if (!booking) throw createError({ statusCode: 404, statusMessage: 'Booking not found' })

  const outstanding = booking.total_cents - booking.amount_paid_cents
  if (outstanding <= 0) {
    throw createError({ statusCode: 409, statusMessage: 'This booking is already paid in full' })
  }

  const settings = await getSettings(property.id)
  const session = await createBalanceCheckout(booking, outstanding, settings)

  await supabase.from('bookings')
    .update({
      balance_payment_url: session.url,
      balance_charge_status: 'manual',
      balance_next_attempt_at: null
    })
    .eq('id', booking.id)

  await supabase.from('booking_payments').insert({
    booking_id: booking.id,
    kind: 'balance',
    amount_cents: outstanding,
    currency: booking.currency,
    status: 'pending',
    stripe_session_id: session.id
  })

  return { url: session.url, amount_cents: outstanding, currency: booking.currency }
})
