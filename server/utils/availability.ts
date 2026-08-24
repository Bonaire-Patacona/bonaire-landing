import { assertNoDbError, serviceClient } from './supabase'

export interface CalendarBlock {
  source_id: string
  kind: 'booking' | 'blocked' | 'external'
  channel: string
  start_date: string
  end_date: string
  label: string
}

/**
 * Authoritative availability check. Runs in Postgres (public.is_range_available)
 * so the answer is computed from the same snapshot the insert will see — no
 * read-then-write race between two guests picking the same week.
 */
export async function isRangeAvailable(
  checkIn: string,
  checkOut: string,
  excludeBookingId?: string
): Promise<boolean> {
  const { data, error } = await serviceClient().rpc('is_range_available', {
    p_check_in: checkIn,
    p_check_out: checkOut,
    p_exclude_booking: excludeBookingId ?? null
  })
  assertNoDbError(error, 'checking availability')
  return data === true
}

export async function getUnavailableDays(from: string, to: string): Promise<string[]> {
  const { data, error } = await serviceClient().rpc('unavailable_days', {
    p_from: from,
    p_to: to
  })
  assertNoDbError(error, 'loading unavailable days')
  return ((data ?? []) as Array<{ day: string }>).map(row => row.day)
}

export async function getCalendarBlocks(from: string, to: string): Promise<CalendarBlock[]> {
  const { data, error } = await serviceClient()
    .from('calendar_blocks')
    .select('*')
    .lt('start_date', to)
    .gt('end_date', from)
    .order('start_date')
  assertNoDbError(error, 'loading calendar blocks')
  return (data ?? []) as CalendarBlock[]
}

/** Releases holds that were never paid and closes stays that already ended. */
export async function runHousekeeping(): Promise<{ expired: number, completed: number }> {
  const supabase = serviceClient()
  const [{ data: expired, error: expiredError }, { data: completed, error: completedError }]
    = await Promise.all([
      supabase.rpc('expire_stale_holds'),
      supabase.rpc('complete_past_bookings')
    ])

  assertNoDbError(expiredError, 'expiring stale holds')
  assertNoDbError(completedError, 'completing past bookings')

  return { expired: Number(expired ?? 0), completed: Number(completed ?? 0) }
}
