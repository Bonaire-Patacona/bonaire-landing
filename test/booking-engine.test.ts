/**
 * Booking engine checks: pricing rules, stay validation and iCal interchange.
 *
 * Run with `npm test`. esbuild bundles the server utils (they import each other
 * without file extensions, which plain Node ESM will not resolve) and the
 * bundle runs on Node — no test framework, no database, no network.
 */
import { buildQuote, nightlyRate, minNightsFor, depositFor, overridesByDay, planBalanceCharge, QuoteError } from '../server/utils/pricing'
import { normaliseTiers, refundFor, tierFor } from '../server/utils/cancellation'
import { parseIcs, buildIcs } from '../server/utils/ical'
import { eachNight, nightsBetween, addDays, isIsoDate, isWeekendNight } from '../server/utils/dates'
import type { AppSettings, RateOverride, RatePeriod } from '../server/utils/types'

let failures = 0
function check(name: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`ok   ${name} = ${JSON.stringify(actual)}`)
    return
  }
  failures++
  console.log(`FAIL ${name}`)
  console.log(`  expected ${JSON.stringify(expected)}`)
  console.log(`  actual   ${JSON.stringify(actual)}`)
}

const settings: AppSettings = {
  id: 1, property_name: 'X', contact_email: null, currency: 'EUR',
  base_nightly_cents: 10000, weekend_uplift_pct: 10, cleaning_fee_cents: 5000, tax_pct: 10,
  guests_included: 2, extra_guest_fee_cents: 1500, max_guests: 4,
  min_nights: 2, max_nights: 30, advance_notice_days: 1, booking_window_days: 540, turnover_days: 0,
  checkin_time: '16:00', checkout_time: '11:00',
  weekly_discount_pct: 10, monthly_discount_pct: 20,
  deposit_type: 'percent', deposit_percent: 30, deposit_fixed_cents: 0,
  balance_due_days_before: 14, security_deposit_cents: 20000, hold_minutes: 30,
  cancellation_policy: '', ical_export_token: 't',
  availability_mode: 'open', auto_charge_balance: true, balance_retry_days: 3,
  security_deposit_mode: 'none', cancellation_policy_code: 'moderate',
  updated_at: ''
}

const periods: RatePeriod[] = [
  { id: 'a', name: 'High', start_date: '2026-06-15', end_date: '2026-09-15', nightly_cents: 20000, min_nights: 5, weekend_uplift_pct: null, priority: 20, active: true },
  { id: 'b', name: 'Fallas', start_date: '2026-06-20', end_date: '2026-06-22', nightly_cents: 30000, min_nights: 3, weekend_uplift_pct: 0, priority: 30, active: true },
  { id: 'c', name: 'Off', start_date: '2026-01-01', end_date: '2026-12-31', nightly_cents: 9000, min_nights: null, weekend_uplift_pct: null, priority: 0, active: false }
]

// --- dates -----------------------------------------------------------------
check('nightsBetween', nightsBetween('2026-03-01', '2026-03-08'), 7)
check('eachNight excludes checkout', eachNight('2026-03-01', '2026-03-04'), ['2026-03-01', '2026-03-02', '2026-03-03'])
check('addDays across month', addDays('2026-02-28', 1), '2026-03-01')
check('leap day 2028', addDays('2028-02-28', 1), '2028-02-29')
check('isIsoDate rejects 2026-02-30', isIsoDate('2026-02-30'), false)
check('isIsoDate accepts', isIsoDate('2026-07-04'), true)
// 2026-07-03 is a Friday, 2026-07-04 a Saturday, 2026-07-05 a Sunday
check('friday is weekend night', isWeekendNight('2026-07-03'), true)
check('sunday is not', isWeekendNight('2026-07-05'), false)

// --- rate resolution --------------------------------------------------------
check('base rate midweek', nightlyRate('2026-03-04', settings, periods).cents, 10000)
check('base rate weekend +10%', nightlyRate('2026-03-06', settings, periods).cents, 11000)
check('season overrides base', nightlyRate('2026-07-01', settings, periods).cents, 20000)
check('season inherits weekend uplift', nightlyRate('2026-07-03', settings, periods).cents, 22000)
check('higher priority season wins', nightlyRate('2026-06-20', settings, periods).cents, 30000)
check('season uplift 0 disables weekend', nightlyRate('2026-06-20', settings, periods).weekend, true)
check('inactive season ignored', nightlyRate('2026-01-05', settings, periods).cents, 10000)
check('minNights from season', minNightsFor('2026-07-01', settings, periods), 5)
check('minNights fallback', minNightsFor('2026-03-04', settings, periods), 2)

// --- per-day overrides ------------------------------------------------------
// 2026-07-03 is a Friday inside the High season, i.e. 20000 + 10% uplift.
const overrides = overridesByDay([
  { day: '2026-07-03', nightly_cents: 15000, min_nights: null, note: 'Oferta' },
  { day: '2026-07-04', nightly_cents: null, min_nights: 2, note: null }
] satisfies RateOverride[])

check('override beats the season', nightlyRate('2026-07-03', settings, periods, overrides).cents, 15000)
check('override is used as typed, no weekend uplift', nightlyRate('2026-07-03', settings, periods, overrides).weekend, true)
check('override note replaces the season label', nightlyRate('2026-07-03', settings, periods, overrides).rate_period, 'Oferta')
check('a min-nights-only override leaves the price alone', nightlyRate('2026-07-04', settings, periods, overrides).cents, 22000)
check('override beats the season min stay', minNightsFor('2026-07-04', settings, periods, overrides), 2)
check('days without an override are untouched', nightlyRate('2026-07-05', settings, periods, overrides).cents, 20000)

// --- deposits ---------------------------------------------------------------
check('deposit percent', depositFor(10000, settings), 3000)
check('deposit fixed capped at total', depositFor(1000, { ...settings, deposit_type: 'fixed', deposit_fixed_cents: 5000 }), 1000)
check('deposit full', depositFor(12345, { ...settings, deposit_type: 'full' }), 12345)

// --- full quote -------------------------------------------------------------
// Mon 2026-03-02 -> Wed 2026-03-04: 2 nights, both midweek, 2 guests.
const q = buildQuote({ checkIn: '2026-03-02', checkOut: '2026-03-04', adults: 2 }, settings, periods, '2026-01-01')
check('quote nights', q.nights, 2)
check('quote nightly subtotal', q.nightly_subtotal_cents, 20000)
check('quote no extra guests', q.extra_guest_cents, 0)
check('quote no LOS discount', q.discount_cents, 0)
check('quote tax 10% of 25000', q.tax_cents, 2500)
check('quote total', q.total_cents, 27500)
check('quote deposit 30%', q.deposit_cents, 8250)
check('quote balance', q.balance_cents, 19250)
check('quote balance due 14d before', q.balance_due_date, '2026-02-16')

// 8 nights with 4 guests -> weekly discount + extra guest fees
const q2 = buildQuote({ checkIn: '2026-03-02', checkOut: '2026-03-10', adults: 3, children: 1 }, settings, periods, '2026-01-01')
const expectedNightly = eachNight('2026-03-02', '2026-03-10')
  .reduce((s, d) => s + nightlyRate(d, settings, periods).cents, 0)
check('quote2 subtotal matches per-night sum', q2.nightly_subtotal_cents, expectedNightly)
check('quote2 weekly discount applied', q2.discount_label, 'weekly')
check('quote2 discount = 10% of subtotal', q2.discount_cents, Math.round(expectedNightly * 0.1))
check('quote2 extra guests 2 x 1500 x 8', q2.extra_guest_cents, 24000)
const taxable2 = expectedNightly - q2.discount_cents + 24000 + 5000
check('quote2 total', q2.total_cents, taxable2 + Math.round(taxable2 * 0.1))
check('quote2 deposit+balance = total', q2.deposit_cents + q2.balance_cents, q2.total_cents)

// One overridden night changes the total by exactly the difference: the Friday
// drops from 22000 to 15000.
const plainWeek = buildQuote({ checkIn: '2026-07-01', checkOut: '2026-07-08', adults: 2 }, settings, periods, '2026-01-01')
const pricedWeek = buildQuote({ checkIn: '2026-07-01', checkOut: '2026-07-08', adults: 2 }, settings, periods, '2026-01-01', overrides)
check('an override moves the nightly subtotal', plainWeek.nightly_subtotal_cents - pricedWeek.nightly_subtotal_cents, 7000)

// --- rule violations --------------------------------------------------------
function expectError(name: string, fn: () => unknown, code: string) {
  try {
    fn()
  } catch (error) {
    if (error instanceof QuoteError && error.code === code) {
      console.log(`ok   ${name} -> ${code}`)
    } else {
      failures++
      console.log(`FAIL ${name}: got ${error}`)
    }
    return
  }
  failures++
  console.log(`FAIL ${name}: no error thrown`)
}
expectError('min nights', () => buildQuote({ checkIn: '2026-03-02', checkOut: '2026-03-03', adults: 2 }, settings, periods, '2026-01-01'), 'min_nights')
expectError('season min nights', () => buildQuote({ checkIn: '2026-07-01', checkOut: '2026-07-04', adults: 2 }, settings, periods, '2026-01-01'), 'min_nights')
expectError('too many guests', () => buildQuote({ checkIn: '2026-03-02', checkOut: '2026-03-06', adults: 4, children: 3 }, settings, periods, '2026-01-01'), 'max_guests')
expectError('too soon', () => buildQuote({ checkIn: '2026-01-01', checkOut: '2026-01-05', adults: 2 }, settings, periods, '2026-01-01'), 'too_soon')
expectError('too far', () => buildQuote({ checkIn: '2029-01-01', checkOut: '2029-01-05', adults: 2 }, settings, periods, '2026-01-01'), 'too_far')
expectError('inverted range', () => buildQuote({ checkIn: '2026-03-05', checkOut: '2026-03-02', adults: 2 }, settings, periods, '2026-01-01'), 'invalid_range')

// --- automatic balance collection -------------------------------------------
const plan = (over: Partial<Parameters<typeof planBalanceCharge>[0]>, now = '2026-03-01') =>
  planBalanceCharge({
    outstanding_cents: 50000,
    balance_due_date: '2026-06-17',
    has_card_on_file: true,
    auto_charge_balance: true,
    ...over
  }, now)

check('balance charge waits for the due date', plan({}), { status: 'scheduled', next_attempt_at: '2026-06-17T09:00:00.000Z' })
check('nothing owed, nothing scheduled', plan({ outstanding_cents: 0 }), { status: 'not_due', next_attempt_at: null })
check('no card on file falls back to the host', plan({ has_card_on_file: false }), { status: 'manual', next_attempt_at: null })
check('auto charge off falls back to the host', plan({ auto_charge_balance: false }), { status: 'manual', next_attempt_at: null })
// Booked less than balance_due_days_before the stay: the rest is due at once.
check('due date already past charges today', plan({ balance_due_date: '2026-02-20' }), { status: 'scheduled', next_attempt_at: '2026-03-01T09:00:00.000Z' })
check('no due date charges today', plan({ balance_due_date: null }), { status: 'scheduled', next_attempt_at: '2026-03-01T09:00:00.000Z' })

// --- cancellation policies --------------------------------------------------
const moderate = { tiers: normaliseTiers([{ days_before: 14, refund_pct: 100 }, { days_before: 7, refund_pct: 50 }]) }

check('tiers come back most generous first', normaliseTiers([{ days_before: 7, refund_pct: 50 }, { days_before: 14, refund_pct: 100 }]).map(t => t.days_before), [14, 7])
check('junk tiers are dropped', normaliseTiers('nope'), [])
check('a refund over 100% is clamped', normaliseTiers([{ days_before: 3, refund_pct: 500 }])[0]!.refund_pct, 100)

// Check-in 2026-07-01: 20 days out clears the top tier, 10 the second, 3 neither.
check('well ahead of check-in -> full refund', tierFor(moderate.tiers, '2026-07-01', '2026-06-11')?.refund_pct, 100)
check('exactly on the boundary still qualifies', tierFor(moderate.tiers, '2026-07-01', '2026-06-17')?.refund_pct, 100)
check('one day inside the boundary drops a tier', tierFor(moderate.tiers, '2026-07-01', '2026-06-18')?.refund_pct, 50)
check('past the last tier -> nothing', tierFor(moderate.tiers, '2026-07-01', '2026-06-28'), null)
check('after check-in -> nothing', tierFor(moderate.tiers, '2026-07-01', '2026-07-02'), null)

const refund = (paid: number, on: string) => refundFor({ amount_paid_cents: paid, check_in: '2026-07-01', policy: moderate }, on)
check('full refund of what was paid', refund(30000, '2026-06-01').refund_cents, 30000)
check('half refund rounds down', refund(30001, '2026-06-20').refund_cents, 15000)
check('no tier means no money back', refund(30000, '2026-06-30').refund_cents, 0)
check('an empty ladder is never refundable', refundFor({ amount_paid_cents: 30000, check_in: '2026-07-01', policy: { tiers: [] } }, '2026-01-01').refund_cents, 0)
check('nothing paid, nothing back', refund(0, '2026-06-01').refund_cents, 0)

// --- iCal round trip --------------------------------------------------------
const ics = buildIcs({
  name: 'Bonaire; Patacona, test',
  domain: 'bonairepatacona.com',
  events: [
    { uid: 'booking-1', summary: 'Reserved', start: '2026-07-04', end: '2026-07-11' },
    { uid: 'blocked-2', summary: 'Mantenimiento, largo: un texto bastante largo para forzar el plegado de linea RFC 5545', start: '2026-08-01', end: '2026-08-03' }
  ]
})
check('ics uses CRLF', ics.includes('\r\n'), true)
check('ics folds long lines', ics.split('\r\n').every(l => Buffer.byteLength(l, 'utf8') <= 75), true)
const round = parseIcs(ics)
check('round trip count', round.length, 2)
check('round trip dates', [round[0]!.start, round[0]!.end], ['2026-07-04', '2026-07-11'])
check('round trip summary', round[0]!.summary, 'Reserved')
check('round trip escaped summary', round[1]!.summary, 'Mantenimiento, largo: un texto bastante largo para forzar el plegado de linea RFC 5545')

// A real Airbnb-shaped feed
const airbnb = [
  'BEGIN:VCALENDAR', 'PRODID:-//Airbnb Inc//Hosting Calendar 1.0.0//EN', 'CALSCALE:GREGORIAN', 'VERSION:2.0',
  'BEGIN:VEVENT', 'DTEND;VALUE=DATE:20260720', 'DTSTART;VALUE=DATE:20260715',
  'UID:1a2b3c@airbnb.com', 'SUMMARY:Reserved', 'DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMXYZ',
  'END:VEVENT',
  'BEGIN:VEVENT', 'DTEND;VALUE=DATE:20260805', 'DTSTART;VALUE=DATE:20260801',
  'UID:zzz@airbnb.com', 'SUMMARY:Airbnb (Not available)', 'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')
const parsed = parseIcs(airbnb)
check('airbnb feed parsed', parsed.length, 2)
check('airbnb first range', [parsed[0]!.uid, parsed[0]!.start, parsed[0]!.end], ['1a2b3c@airbnb.com', '2026-07-15', '2026-07-20'])
check('airbnb second summary', parsed[1]!.summary, 'Airbnb (Not available)')

// Booking.com style with a datetime DTSTART and a folded line
const bookingcom = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nDTSTART:20260901T140000Z\r\nDTEND:20260905T100000Z\r\nUID:bk-9\r\nSUMMARY:CLOSED - Booking\r\n .com reservation\r\nEND:VEVENT\r\nEND:VCALENDAR'
const bk = parseIcs(bookingcom)
check('booking.com datetime -> date', [bk[0]!.start, bk[0]!.end], ['2026-09-01', '2026-09-05'])
check('booking.com unfolded summary', bk[0]!.summary, 'CLOSED - Booking.com reservation')

// Malformed input must not throw
check('garbage returns empty', parseIcs('not a calendar at all'), [])
check('event without UID skipped', parseIcs('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260101\r\nDTEND;VALUE=DATE:20260102\r\nEND:VEVENT\r\nEND:VCALENDAR'), [])

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
