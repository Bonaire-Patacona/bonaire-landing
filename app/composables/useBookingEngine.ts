import { parseDate } from '@internationalized/date'
import type { DateRange } from 'reka-ui'

/**
 * reka-ui re-exports its own `DateValue` union, which does not line up
 * structurally with the one from @internationalized/date. Everything here only
 * ever needs the calendar fields, so the helpers accept that shape instead of
 * the union and cast once, at the boundary with <UCalendar>.
 */
export interface CalendarDateLike {
  year: number
  month: number
  day: number
}

type RangeDate = NonNullable<DateRange['start']>

export interface AvailabilityDay {
  date: string
  available: boolean
  cents: number
  min_nights: number
}

export interface AvailabilityResponse {
  from: string
  to: string
  currency: string
  max_guests: number
  guests_included: number
  checkin_time: string
  checkout_time: string
  advance_notice_days: number
  unavailable: string[]
  days: AvailabilityDay[]
}

export interface RefundTier {
  days_before: number
  refund_pct: number
}

export interface CancellationTerms {
  code: string
  name: string
  tiers: RefundTier[]
  notes: string
}

export interface NightPrice {
  date: string
  cents: number
  weekend: boolean
  rate_period: string | null
}

export interface QuoteResponse {
  currency: string
  check_in: string
  check_out: string
  nights: number
  guests: number
  adults: number
  children: number
  breakdown: NightPrice[]
  nightly_subtotal_cents: number
  extra_guest_cents: number
  cleaning_fee_cents: number
  discount_cents: number
  discount_label: 'weekly' | 'monthly' | null
  discount_pct: number
  tax_cents: number
  total_cents: number
  deposit_cents: number
  balance_cents: number
  balance_due_date: string | null
  security_deposit_cents: number
  min_nights: number
  checkin_time: string
  checkout_time: string
  cancellation: CancellationTerms
  available: boolean
}

export function isoToCalendarDate(iso: string): RangeDate {
  return parseDate(iso) as unknown as RangeDate
}

export function calendarDateToIso(value: CalendarDateLike): string {
  return `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`
}

/**
 * Availability + live quoting for the public booking widget.
 *
 * Availability is fetched once for the whole booking window and cached; quotes
 * are re-fetched whenever the range or the party size changes, because only the
 * server may decide what a stay costs.
 */
export function useBookingEngine() {
  const availability = ref<AvailabilityResponse | null>(null)
  const quote = ref<QuoteResponse | null>(null)
  const loadingAvailability = ref(false)
  const loadingQuote = ref(false)
  const quoteError = ref<{ code: string, message: string } | null>(null)

  const unavailable = computed(() => new Set(availability.value?.unavailable ?? []))
  const priceByDate = computed(() => {
    const map = new Map<string, number>()
    for (const day of availability.value?.days ?? []) map.set(day.date, day.cents)
    return map
  })

  async function loadAvailability(from?: string, to?: string) {
    loadingAvailability.value = true
    try {
      availability.value = await $fetch<AvailabilityResponse>('/api/availability', {
        query: { from: from ?? todayIso(), to: to ?? addDays(todayIso(), 365) }
      })
    } finally {
      loadingAvailability.value = false
    }
  }

  async function fetchQuote(input: { checkIn: string, checkOut: string, adults: number, children: number }) {
    loadingQuote.value = true
    quoteError.value = null
    try {
      quote.value = await $fetch<QuoteResponse>('/api/quote', {
        method: 'POST',
        body: {
          check_in: input.checkIn,
          check_out: input.checkOut,
          adults: input.adults,
          children: input.children
        }
      })
    } catch (error) {
      quote.value = null
      const err = error as { data?: { data?: { code?: string }, message?: string, statusMessage?: string } }
      quoteError.value = {
        code: err.data?.data?.code ?? 'unknown',
        message: err.data?.statusMessage ?? err.data?.message ?? 'Could not price those dates'
      }
    } finally {
      loadingQuote.value = false
    }
  }

  /** A night is bookable when nothing else holds it. */
  function isDateUnavailable(date: CalendarDateLike): boolean {
    return unavailable.value.has(calendarDateToIso(date))
  }

  function nightlyPriceFor(date: CalendarDateLike): number | null {
    return priceByDate.value.get(calendarDateToIso(date)) ?? null
  }

  return {
    availability,
    quote,
    quoteError,
    loadingAvailability,
    loadingQuote,
    unavailable,
    loadAvailability,
    fetchQuote,
    isDateUnavailable,
    nightlyPriceFor
  }
}
