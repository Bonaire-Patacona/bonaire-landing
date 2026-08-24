/**
 * POST /api/admin/bookings/:id/balance-link
 *
 * Creates a Stripe Checkout link for whatever is still owed and stores it on
 * the booking, so it can be pasted into an email to the guest.
 */
import { assertNoDbError, getSettings, requireAdmin, serviceClient } from '~~/server/utils/supabase'
import { getStripe, toStripeAmount } from '~~/server/utils/stripe'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing booking id' })

  const supabase = serviceClient()
  const { data: booking, error } = await supabase
    .from('bookings').select('*').eq('id', id).single()
  assertNoDbError(error, 'loading the booking')
  if (!booking) throw createError({ statusCode: 404, statusMessage: 'Booking not found' })

  const outstanding = booking.total_cents - booking.amount_paid_cents
  if (outstanding <= 0) {
    throw createError({ statusCode: 409, statusMessage: 'This booking is already paid in full' })
  }

  const settings = await getSettings()
  const siteUrl = useRuntimeConfig().public.siteUrl.replace(/\/$/, '')

  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    customer_email: booking.guest_email,
    client_reference_id: booking.reference,
    success_url: `${siteUrl}/reserva/${booking.reference}?paid=1`,
    cancel_url: `${siteUrl}/reserva/${booking.reference}`,
    metadata: { booking_id: booking.id, reference: booking.reference, kind: 'balance' },
    payment_intent_data: {
      metadata: { booking_id: booking.id, reference: booking.reference, kind: 'balance' }
    },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: booking.currency.toLowerCase(),
        unit_amount: toStripeAmount(outstanding),
        product_data: {
          name: `${settings.property_name} · ${booking.reference}`,
          description: `Remaining balance for ${booking.check_in} → ${booking.check_out}`
        }
      }
    }]
  })

  await supabase.from('bookings')
    .update({ balance_payment_url: session.url })
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
