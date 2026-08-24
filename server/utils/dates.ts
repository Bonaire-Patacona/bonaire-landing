/**
 * Date helpers for the booking engine.
 *
 * Every date in the domain is a plain calendar day (`YYYY-MM-DD`), never a
 * timestamp: a stay from the 4th to the 7th is the same stay in any timezone.
 * Ranges are half-open — `[check_in, check_out)` — so the checkout day is free
 * for the next guest.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && toIsoDate(d) === value
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`)
}

export function addDays(value: string, days: number): string {
  const d = parseIsoDate(value)
  d.setUTCDate(d.getUTCDate() + days)
  return toIsoDate(d)
}

export function today(): string {
  return toIsoDate(new Date())
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  const ms = parseIsoDate(checkOut).getTime() - parseIsoDate(checkIn).getTime()
  return Math.round(ms / 86_400_000)
}

/** Every night actually slept in, i.e. check-in inclusive, check-out exclusive. */
export function eachNight(checkIn: string, checkOut: string): string[] {
  const out: string[] = []
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) out.push(d)
  return out
}

/** ISO weekday, Monday = 1 … Sunday = 7. */
export function isoWeekday(value: string): number {
  const day = parseIsoDate(value).getUTCDay()
  return day === 0 ? 7 : day
}

/** Friday and Saturday nights are the "weekend" for pricing purposes. */
export function isWeekendNight(value: string): boolean {
  const dow = isoWeekday(value)
  return dow === 5 || dow === 6
}

export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd
}
