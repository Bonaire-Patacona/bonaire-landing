/**
 * GET /api/bookings/:reference[?email=...]
 *
 * Backs the guest-facing confirmation page. The reference alone returns the
 * stay summary; personal details are only echoed back when the caller also
 * proves they know the email address on the booking.
 */
import { assertNoDbError, getSettings, serviceClient } from '~~/server/utils/supabase'
import { policyFromSnapshot, refundFor } from '~~/server/utils/cancellation'
import { today } from '~~/server/utils/dates'

export default defineEventHandler(async (event) => {
  const reference = getRouterParam(event, 'reference')?.toUpperCase()
  if (!reference || !/^BP-[A-Z0-9]{4,12}$/.test(reference)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid booking reference' })
  }

  const { data, error } = await serviceClient()
    .from('bookings').select('*').eq('reference', reference).maybeSingle()
  assertNoDbError(error, 'loading the booking')

  if (!data) {
    throw createError({ statusCode: 404, statusMessage: 'Booking not found' })
  }

  const settings = await getSettings()
  const email = String(getQuery(event).email ?? '').trim().toLowerCase()
  const verified = Boolean(email) && email === data.guest_email

  // The terms this booking was sold under, not whatever is configured today.
  const cancellation = policyFromSnapshot(data.cancellation_policy)
  const refundable = refundFor(
    { amount_paid_cents: data.amount_paid_cents, check_in: data.check_in, policy: cancellation },
    today()
  )

  setHeader(event, 'cache-control', 'no-store')

  return {
    reference: data.reference,
    status: data.status,
    check_in: data.check_in,
    check_out: data.check_out,
    adults: data.adults,
    children: data.children,
    currency: data.currency,
    nightly_subtotal_cents: data.nightly_subtotal_cents,
    cleaning_fee_cents: data.cleaning_fee_cents,
    extra_guest_cents: data.extra_guest_cents,
    discount_cents: data.discount_cents,
    tax_cents: data.tax_cents,
    total_cents: data.total_cents,
    deposit_cents: data.deposit_cents,
    balance_cents: data.balance_cents,
    amount_paid_cents: data.amount_paid_cents,
    security_deposit_cents: data.security_deposit_cents,
    balance_due_date: data.balance_due_date,
    balance_payment_url: verified ? data.balance_payment_url : null,
    price_breakdown: data.price_breakdown,
    checkin_time: settings.checkin_time,
    checkout_time: settings.checkout_time,
    cancellation,
    refund_if_cancelled_now: ['pending', 'confirmed'].includes(data.status) ? refundable : null,
    property_name: settings.property_name,
    contact_email: settings.contact_email,
    guest_name: verified ? data.guest_name : maskName(data.guest_name),
    guest_email: verified ? data.guest_email : null
  }
})

function maskName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? ''
  return first ? `${first.charAt(0).toUpperCase()}${first.slice(1)}` : ''
}
