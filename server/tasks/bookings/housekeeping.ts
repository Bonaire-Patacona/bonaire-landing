/**
 * Nitro scheduled task — runs every 10 minutes (see nuxt.config.ts).
 * Releases holds nobody paid for and closes stays that already ended.
 */
import { runHousekeeping } from '~~/server/utils/availability'

export default defineTask({
  meta: {
    name: 'bookings:housekeeping',
    description: 'Expire unpaid holds and complete past stays'
  },
  async run() {
    const result = await runHousekeeping()
    if (result.expired || result.completed) {
      console.info(`[bookings:housekeeping] expired=${result.expired} completed=${result.completed}`)
    }
    return { result }
  }
})
