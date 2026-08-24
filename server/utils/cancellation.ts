/**
 * Cancellation policies.
 *
 * A policy is a refund ladder, ordered most generous first: "cancel at least
 * `days_before` days before check-in and you get `refund_pct` of what you have
 * paid back". The first tier the guest still qualifies for wins; falling off
 * the end of the ladder means no refund.
 *
 * Pure on purpose — no database, no Stripe — so the rules are testable and the
 * same numbers come out wherever they are needed.
 */
import { nightsBetween } from './dates'

export interface RefundTier {
  /** Cancel this many whole days before check-in (or earlier) to qualify. */
  days_before: number
  refund_pct: number
}

export interface CancellationPolicy {
  code: string
  name: string
  tiers: RefundTier[]
  notes: string
}

export const NON_REFUNDABLE: CancellationPolicy = {
  code: 'non_refundable',
  name: 'No reembolsable',
  tiers: [],
  notes: ''
}

/** Drops malformed tiers and puts the survivors in the order they are read. */
export function normaliseTiers(input: unknown): RefundTier[] {
  if (!Array.isArray(input)) return []

  return input
    .map(tier => ({
      days_before: Math.max(0, Math.trunc(Number((tier as RefundTier)?.days_before))),
      refund_pct: Math.min(100, Math.max(0, Number((tier as RefundTier)?.refund_pct)))
    }))
    .filter(tier => Number.isFinite(tier.days_before) && Number.isFinite(tier.refund_pct))
    .sort((a, b) => b.days_before - a.days_before)
}

/** Whole days between the cancellation and check-in; negative once it started. */
export function daysBeforeCheckIn(checkIn: string, on: string): number {
  return nightsBetween(on, checkIn)
}

/** The tier that applies, or null when the guest gets nothing back. */
export function tierFor(tiers: RefundTier[], checkIn: string, on: string): RefundTier | null {
  const remaining = daysBeforeCheckIn(checkIn, on)
  if (remaining < 0) return null
  return normaliseTiers(tiers).find(tier => remaining >= tier.days_before) ?? null
}

export interface RefundOutcome {
  refund_pct: number
  refund_cents: number
  days_before: number
}

/**
 * What a guest gets back if they cancel on `on`. Rounded down to the cent so a
 * rounding error can never refund more than was actually paid.
 */
export function refundFor(input: {
  amount_paid_cents: number
  check_in: string
  policy: Pick<CancellationPolicy, 'tiers'>
}, on: string): RefundOutcome {
  const tier = tierFor(input.policy.tiers, input.check_in, on)
  const pct = tier?.refund_pct ?? 0
  const paid = Math.max(0, input.amount_paid_cents)

  return {
    refund_pct: pct,
    refund_cents: Math.min(paid, Math.floor((paid * pct) / 100)),
    days_before: daysBeforeCheckIn(input.check_in, on)
  }
}

/** Reads a policy out of the jsonb snapshot stored on a booking. */
export function policyFromSnapshot(value: unknown): CancellationPolicy {
  const raw = (value ?? {}) as Partial<CancellationPolicy>
  if (!raw.code) return NON_REFUNDABLE

  return {
    code: raw.code,
    name: raw.name ?? raw.code,
    tiers: normaliseTiers(raw.tiers),
    notes: raw.notes ?? ''
  }
}
