/**
 * Nitro scheduled task — runs hourly (see nuxt.config.ts).
 * Charges the balance of every booking that has reached its due date to the
 * card the guest left at booking time.
 */
import { chargeDueBalances } from '~~/server/utils/payments'

export default defineTask({
  meta: {
    name: 'payments:balance',
    description: 'Collect balances that have come due from the card on file'
  },
  async run() {
    const result = await chargeDueBalances()
    if (result.charged || result.failed) {
      console.info(`[payments:balance] charged=${result.charged} failed=${result.failed}`)
    }
    return { result }
  }
})
