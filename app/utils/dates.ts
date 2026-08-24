/** Client-side mirror of the server date helpers (see server/utils/dates.ts). */

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function todayIso(): string {
  return toIsoDate(new Date())
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return toIsoDate(d)
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  const ms = new Date(`${checkOut}T00:00:00Z`).getTime() - new Date(`${checkIn}T00:00:00Z`).getTime()
  return Math.round(ms / 86_400_000)
}

export function formatDate(iso: string, locale = 'es-ES', opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat(locale, opts ?? { day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(`${iso}T00:00:00Z`))
}

export function eachNight(checkIn: string, checkOut: string): string[] {
  const out: string[] = []
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) out.push(d)
  return out
}
