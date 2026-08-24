/**
 * POST /api/quote  { check_in, check_out, adults, children }
 *
 * Full price breakdown for a candidate stay, plus whether the dates are still
 * free. Used live by the booking widget; nothing is written.
 */
import { isIsoDate, today } from '~~/server/utils/dates'
import { isRangeAvailable } from '~~/server/utils/availability'
import { getCancellationPolicy, getRateOverrides, getRatePeriods, getSettings } from '~~/server/utils/supabase'
import { QuoteError, buildQuote } from '~~/server/utils/pricing'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    check_in?: string
    check_out?: string
    adults?: number
    children?: number
  }>(event)

  if (!isIsoDate(body?.check_in) || !isIsoDate(body?.check_out)) {
    throw createError({ statusCode: 400, statusMessage: 'check_in and check_out must be YYYY-MM-DD' })
  }

  const [settings, periods, overrides] = await Promise.all([getSettings(), getRatePeriods(), getRateOverrides()])

  let quote
  try {
    quote = buildQuote(
      {
        checkIn: body.check_in,
        checkOut: body.check_out,
        adults: Number(body.adults ?? 2),
        children: Number(body.children ?? 0)
      },
      settings,
      periods,
      today(),
      overrides
    )
  } catch (error) {
    if (error instanceof QuoteError) {
      throw createError({
        statusCode: 422,
        statusMessage: error.message,
        data: { code: error.code, ...error.details }
      })
    }
    throw error
  }

  const [available, cancellation] = await Promise.all([
    isRangeAvailable(quote.check_in, quote.check_out),
    getCancellationPolicy()
  ])

  return { ...quote, available, cancellation }
})
