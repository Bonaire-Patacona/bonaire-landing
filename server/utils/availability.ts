import { assertNoDbError, serviceClient } from './supabase'

export interface CalendarBlock {
  property_id: string
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
  propertyId: string,
  checkIn: string,
  checkOut: string,
  excludeBookingId?: string
): Promise<boolean> {
  const { data, error } = await serviceClient().rpc('is_range_available', {
    p_property_id: propertyId,
    p_check_in: checkIn,
    p_check_out: checkOut,
    p_exclude_booking: excludeBookingId ?? null
  })
  assertNoDbError(error, 'checking availability')
  return data === true
}

/**
 * Is the property on sale at all on those dates? Separate from
 * isRangeAvailable() on purpose: this is the host's sales policy
 * (app_settings.availability_mode + public.open_periods), and the back office
 * is allowed to book straight over it.
 */
export async function isRangeOpen(propertyId: string, from: string, to: string): Promise<boolean> {
  const { data, error } = await serviceClient().rpc('is_range_open', {
    p_property_id: propertyId,
    p_from: from,
    p_to: to
  })
  assertNoDbError(error, 'checking the opening calendar')
  return data === true
}

export async function getUnavailableDays(propertyId: string, from: string, to: string): Promise<string[]> {
  const { data, error } = await serviceClient().rpc('unavailable_days', {
    p_property_id: propertyId,
    p_from: from,
    p_to: to
  })
  assertNoDbError(error, 'loading unavailable days')
  return ((data ?? []) as Array<{ day: string }>).map(row => row.day)
}

export async function getCalendarBlocks(propertyId: string, from: string, to: string): Promise<CalendarBlock[]> {
  const { data, error } = await serviceClient()
    .from('calendar_blocks')
    .select('*')
    .eq('property_id', propertyId)
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
