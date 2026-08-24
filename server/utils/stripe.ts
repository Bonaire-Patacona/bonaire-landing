import Stripe from 'stripe'

let stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (stripe) return stripe

  const key = useRuntimeConfig().stripeSecretKey
  if (!key) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Online payments are not configured (NUXT_STRIPE_SECRET_KEY)'
    })
  }

  stripe = new Stripe(key, { apiVersion: '2025-08-27.basil' })
  return stripe
}

export function isStripeConfigured(): boolean {
  return Boolean(useRuntimeConfig().stripeSecretKey)
}

/**
 * Stripe rejects zero-decimal mismatches, so amounts are passed through as the
 * integer minor units we already store. EUR is a two-decimal currency; if the
 * property ever prices in JPY this is the single place to special-case.
 */
export function toStripeAmount(cents: number): number {
  return Math.max(0, Math.round(cents))
}

export function formatMoney(cents: number, currency: string, locale = 'es-ES'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100)
}
