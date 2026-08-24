/**
 * Pricing engine.
 *
 * Mirrors public.nightly_rate_cents() in SQL so the widget, the API and any
 * report built straight on the database agree on the number. All amounts are
 * integer minor units (cents) — money never touches a float.
 */
import { addDays, eachNight, isWeekendNight, nightsBetween } from './dates'
import type { AppSettings, NightPrice, Quote, RatePeriod } from './types'

export class QuoteError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

/** Highest-priority active season covering a given night; ties break to the shorter one. */
export function ratePeriodFor(day: string, periods: RatePeriod[]): RatePeriod | null {
  const matches = periods.filter(p => p.active && day >= p.start_date && day <= p.end_date)
  if (!matches.length) return null

  return matches.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    const spanA = nightsBetween(a.start_date, a.end_date)
    const spanB = nightsBetween(b.start_date, b.end_date)
    return spanA - spanB
  })[0]!
}

export function nightlyRate(day: string, settings: AppSettings, periods: RatePeriod[]): NightPrice {
  const period = ratePeriodFor(day, periods)
  const base = period?.nightly_cents ?? settings.base_nightly_cents
  const uplift = Number(period?.weekend_uplift_pct ?? settings.weekend_uplift_pct ?? 0)
  const weekend = isWeekendNight(day)
  const cents = weekend && uplift > 0 ? Math.round(base * (1 + uplift / 100)) : base

  return { date: day, cents, weekend, rate_period: period?.name ?? null }
}

/** Minimum stay that applies to a check-in date (season overrides the global setting). */
export function minNightsFor(day: string, settings: AppSettings, periods: RatePeriod[]): number {
  const withMin = periods.filter(
    p => p.active && p.min_nights != null && day >= p.start_date && day <= p.end_date
  )
  if (!withMin.length) return settings.min_nights
  return withMin.sort((a, b) => b.priority - a.priority)[0]!.min_nights!
}

export function depositFor(totalCents: number, settings: AppSettings): number {
  switch (settings.deposit_type) {
    case 'full':
      return totalCents
    case 'fixed':
      return Math.min(settings.deposit_fixed_cents, totalCents)
    case 'percent':
    default:
      return Math.min(Math.round((totalCents * Number(settings.deposit_percent)) / 100), totalCents)
  }
}

export interface QuoteInput {
  checkIn: string
  checkOut: string
  adults: number
  children?: number
}

/**
 * Validates the stay against the house rules and returns the full price
 * breakdown. Throws QuoteError with a machine-readable code the UI translates.
 */
export function buildQuote(
  input: QuoteInput,
  settings: AppSettings,
  periods: RatePeriod[],
  now: string
): Quote {
  const { checkIn, checkOut } = input
  const adults = Math.max(1, Math.trunc(input.adults))
  const children = Math.max(0, Math.trunc(input.children ?? 0))
  const guests = adults + children

  if (checkOut <= checkIn) {
    throw new QuoteError('invalid_range', 'Check-out must be after check-in')
  }

  const nights = nightsBetween(checkIn, checkOut)
  const minNights = minNightsFor(checkIn, settings, periods)

  if (checkIn < addDays(now, settings.advance_notice_days)) {
    throw new QuoteError('too_soon', `Bookings need ${settings.advance_notice_days} day(s) of notice`)
  }
  if (checkIn > addDays(now, settings.booking_window_days)) {
    throw new QuoteError('too_far', 'That date is not open for booking yet')
  }
  if (nights < minNights) {
    throw new QuoteError('min_nights', `Minimum stay is ${minNights} nights`)
  }
  if (nights > settings.max_nights) {
    throw new QuoteError('max_nights', `Maximum stay is ${settings.max_nights} nights`)
  }
  if (guests > settings.max_guests) {
    throw new QuoteError('max_guests', `This apartment sleeps up to ${settings.max_guests} guests`)
  }

  const breakdown = eachNight(checkIn, checkOut).map(day => nightlyRate(day, settings, periods))
  const nightlySubtotal = breakdown.reduce((sum, night) => sum + night.cents, 0)

  const extraGuests = Math.max(0, guests - settings.guests_included)
  const extraGuestCents = extraGuests * settings.extra_guest_fee_cents * nights

  let discountLabel: Quote['discount_label'] = null
  let discountPct = 0
  if (nights >= 28 && Number(settings.monthly_discount_pct) > 0) {
    discountLabel = 'monthly'
    discountPct = Number(settings.monthly_discount_pct)
  } else if (nights >= 7 && Number(settings.weekly_discount_pct) > 0) {
    discountLabel = 'weekly'
    discountPct = Number(settings.weekly_discount_pct)
  }
  const discountCents = Math.round((nightlySubtotal * discountPct) / 100)

  const taxable = nightlySubtotal - discountCents + extraGuestCents + settings.cleaning_fee_cents
  const taxCents = Math.round((taxable * Number(settings.tax_pct)) / 100)
  const totalCents = taxable + taxCents

  const depositCents = depositFor(totalCents, settings)
  const balanceCents = totalCents - depositCents
  const balanceDueDate = balanceCents > 0
    ? addDays(checkIn, -settings.balance_due_days_before)
    : null

  return {
    currency: settings.currency,
    check_in: checkIn,
    check_out: checkOut,
    nights,
    guests,
    adults,
    children,
    breakdown,
    nightly_subtotal_cents: nightlySubtotal,
    extra_guest_cents: extraGuestCents,
    cleaning_fee_cents: settings.cleaning_fee_cents,
    discount_cents: discountCents,
    discount_label: discountLabel,
    discount_pct: discountPct,
    tax_cents: taxCents,
    total_cents: totalCents,
    deposit_cents: depositCents,
    balance_cents: balanceCents,
    balance_due_date: balanceDueDate,
    security_deposit_cents: settings.security_deposit_cents,
    min_nights: minNights,
    checkin_time: settings.checkin_time,
    checkout_time: settings.checkout_time,
    cancellation_policy: settings.cancellation_policy
  }
}
