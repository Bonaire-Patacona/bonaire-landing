/**
 * Collecting the balance of a booking without the guest doing anything.
 *
 * Why not simply pre-authorise the total at booking time: a card authorisation
 * only lives for about 7 days, and most reservations are made months ahead. So
 * the deposit is a normal charge that also stores the card
 * (`setup_future_usage: 'off_session'`), and the balance is a second,
 * merchant-initiated charge against that saved card on the due date.
 *
 * Off-session charges can still be declined — typically `authentication_required`
 * when the issuer insists on SCA. That is not an error condition, it is the
 * expected minority case, so it degrades into the payment link the host already
 * had: `createBalanceCheckout()`.
 */
import Stripe from 'stripe'
import { assertNoDbError, getSettings, serviceClient } from './supabase'
import { getStripe, isStripeConfigured, toStripeAmount } from './stripe'
import type { AppSettings, BalanceChargeStatus, BookingRow } from './types'

/** How many bookings one pass of the task is allowed to charge. */
const BATCH_SIZE = 25

/**
 * A Checkout link for whatever is still owed. Used by the back office and as
 * the fallback whenever an unattended charge cannot go through.
 */
export async function createBalanceCheckout(
  booking: Pick<BookingRow, 'id' | 'reference' | 'guest_email' | 'currency' | 'check_in' | 'check_out'>,
  outstandingCents: number,
  settings: AppSettings
): Promise<Stripe.Checkout.Session> {
  const siteUrl = useRuntimeConfig().public.siteUrl.replace(/\/$/, '')

  return getStripe().checkout.sessions.create({
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
        unit_amount: toStripeAmount(outstandingCents),
        product_data: {
          name: `${settings.property_name} · ${booking.reference}`,
          description: `Remaining balance for ${booking.check_in} → ${booking.check_out}`
        }
      }
    }]
  })
}

export interface BalanceRunResult {
  charged: number
  failed: number
  skipped: number
}

/**
 * Charges every balance that has come due. Safe to run concurrently: each
 * booking is claimed with a conditional update before Stripe is called, so a
 * second worker (or an overlapping cron tick) finds nothing left to claim.
 */
export async function chargeDueBalances(): Promise<BalanceRunResult> {
  const result: BalanceRunResult = { charged: 0, failed: 0, skipped: 0 }
  if (!isStripeConfigured()) return result

  const supabase = serviceClient()
  const { data: due, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('status', 'confirmed')
    .eq('balance_charge_status', 'scheduled')
    .lte('balance_next_attempt_at', new Date().toISOString())
    .order('balance_next_attempt_at')
    .limit(BATCH_SIZE)

  assertNoDbError(error, 'loading balances due')

  for (const booking of (due ?? []) as BookingRow[]) {
    const settings = await getSettings(booking.property_id)
    if (!settings.auto_charge_balance) {
      result.skipped++
      continue
    }
    const claimed = await claim(booking)
    if (!claimed) {
      result.skipped++
      continue
    }
    const ok = await chargeOne(claimed, settings)
    if (ok) result.charged++
    else result.failed++
  }

  return result
}

/** Marks the booking as being worked on. Returns null if someone else got it. */
async function claim(booking: BookingRow): Promise<BookingRow | null> {
  const { data } = await serviceClient()
    .from('bookings')
    .update({
      balance_charge_status: 'processing',
      balance_charge_attempts: booking.balance_charge_attempts + 1
    })
    .eq('id', booking.id)
    .eq('balance_charge_status', 'scheduled')
    .select('*')
    .maybeSingle()

  return (data as BookingRow | null) ?? null
}

async function chargeOne(booking: BookingRow, settings: AppSettings): Promise<boolean> {
  const supabase = serviceClient()
  const outstanding = booking.total_cents - booking.amount_paid_cents

  if (outstanding <= 0) {
    await supabase.from('bookings')
      .update({ balance_charge_status: 'not_due', balance_next_attempt_at: null })
      .eq('id', booking.id)
    return true
  }

  if (!booking.stripe_customer_id || !booking.stripe_payment_method_id) {
    await giveUp(booking, settings, outstanding, 'manual', 'No card on file')
    return false
  }

  try {
    await getStripe().paymentIntents.create({
      amount: toStripeAmount(outstanding),
      currency: booking.currency.toLowerCase(),
      customer: booking.stripe_customer_id,
      payment_method: booking.stripe_payment_method_id,
      off_session: true,
      confirm: true,
      description: `${settings.property_name} · ${booking.reference} · balance`,
      metadata: {
        booking_id: booking.id,
        reference: booking.reference,
        kind: 'balance',
        // Tells the webhook this charge did not come from a Checkout session,
        // so it is the one that has to post it to the ledger.
        source: 'auto_balance'
      }
    }, {
      // Survives a retry of the task after a network timeout: Stripe returns
      // the original PaymentIntent instead of charging the guest twice.
      idempotencyKey: `balance-${booking.id}-${booking.balance_charge_attempts}`
    })

    // The money itself is posted by the payment_intent.succeeded webhook, which
    // is the single place a booking's amount_paid_cents ever moves.
    await supabase.from('bookings')
      .update({
        balance_charge_status: 'succeeded',
        balance_next_attempt_at: null,
        balance_last_error: null
      })
      .eq('id', booking.id)

    return true
  } catch (error) {
    return await onChargeDeclined(booking, settings, outstanding, error)
  }
}

async function onChargeDeclined(
  booking: BookingRow,
  settings: AppSettings,
  outstanding: number,
  error: unknown
): Promise<boolean> {
  const stripeError = error instanceof Stripe.errors.StripeError ? error : null
  const reason = stripeError?.message ?? (error as Error)?.message ?? 'Unknown error'
  const needsAuth = stripeError?.code === 'authentication_required'

  console.error(`[payments] balance charge declined for ${booking.reference}:`, reason)

  await serviceClient().from('booking_payments').insert({
    booking_id: booking.id,
    kind: 'balance',
    amount_cents: outstanding,
    currency: booking.currency,
    status: 'failed',
    stripe_payment_intent_id: stripeError?.payment_intent?.id ?? null,
    raw: { error: reason, code: stripeError?.code ?? null }
  })

  // SCA cannot be satisfied off-session, so there is no point retrying: the
  // guest has to come back and authenticate on the payment page.
  const retriesLeft = booking.balance_charge_attempts < settings.balance_retry_days
  if (needsAuth || !retriesLeft) {
    await giveUp(booking, settings, outstanding, needsAuth ? 'requires_action' : 'failed', reason)
    return false
  }

  const tomorrow = new Date(Date.now() + 86_400_000).toISOString()
  await serviceClient().from('bookings')
    .update({
      balance_charge_status: 'scheduled',
      balance_next_attempt_at: tomorrow,
      balance_last_error: reason
    })
    .eq('id', booking.id)

  return false
}

/**
 * Stops trying and leaves the host a payment link to send. The link is best
 * effort: if Stripe is unreachable the booking is still flagged, which is the
 * part that must not be lost.
 */
async function giveUp(
  booking: BookingRow,
  settings: AppSettings,
  outstanding: number,
  status: BalanceChargeStatus,
  reason: string
): Promise<void> {
  let url: string | null = null
  try {
    const session = await createBalanceCheckout(booking, outstanding, settings)
    url = session.url
  } catch (error) {
    console.error(`[payments] could not create the fallback link for ${booking.reference}:`, error)
  }

  await serviceClient().from('bookings')
    .update({
      balance_charge_status: status,
      balance_next_attempt_at: null,
      balance_last_error: reason,
      ...(url ? { balance_payment_url: url } : {})
    })
    .eq('id', booking.id)
}
