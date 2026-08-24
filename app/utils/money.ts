/** All money crosses the wire as integer minor units; format only at the edge. */
export function formatMoney(cents: number, currency = 'EUR', locale?: string): string {
  return new Intl.NumberFormat(locale || 'es-ES', {
    style: 'currency',
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2
  }).format(cents / 100)
}

export function toCents(value: number | string): number {
  const amount = typeof value === 'string' ? Number(value.replace(',', '.')) : value
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100
}
