<script setup lang="ts">
/**
 * Month grid showing everything that occupies the apartment, whatever its
 * origin: direct bookings, manual blocks and imported channel events, together
 * with what each night costs.
 *
 * Dates are edited by selecting cells — click, drag or shift-click — and then
 * acting on the whole run at once: block it, open it, or price it by hand.
 * When app_settings.availability_mode is 'closed' the grid also shows what is
 * on sale at all: nothing, except the ranges opened here.
 */
defineI18nRoute(false)
definePageMeta({ layout: 'admin', middleware: 'admin' })

interface Block {
  source_id: string
  kind: 'booking' | 'blocked' | 'external'
  channel: string
  start_date: string
  end_date: string
  label: string
  reference: string | null
  status: string | null
  total_cents: number | null
  currency: string | null
  event_kind: 'reservation' | 'closed' | null
  link: string | null
  assume_reservations: boolean | null
}

interface OpenPeriod {
  id: string
  start_date: string
  end_date: string
  note: string | null
}

interface RateDay {
  day: string
  nightly_cents: number
  min_nights: number
  available: boolean
  overridden: boolean
  note: string | null
}

const supabase = useDb()
const toast = useToast()

const cursor = ref(todayIso().slice(0, 7)) // YYYY-MM
const showBlockModal = ref(false)
const showOpenModal = ref(false)
const showBulkModal = ref(false)
const busy = ref(false)
const newBlock = reactive({ start_date: '', end_date: '', reason: '' })
const newOpen = reactive({ start_date: '', end_date: '', note: '' })

const monthStart = computed(() => `${cursor.value}-01`)
const monthEnd = computed(() => {
  const [year, month] = cursor.value.split('-').map(Number)
  return toIsoDate(new Date(Date.UTC(year!, month!, 1)))
})

// Six-week grid starting on the Monday before the 1st. Everything is loaded for
// the whole grid, so the leading and trailing days are not blank.
const gridStart = computed(() => {
  const first = new Date(`${monthStart.value}T00:00:00Z`)
  return addDays(monthStart.value, -((first.getUTCDay() + 6) % 7)) // Monday = 0
})
const gridEnd = computed(() => addDays(gridStart.value, 42)) // exclusive

const { data: blocks, refresh: refreshBlocks, pending } = await useAsyncData<Block[]>(
  'admin-calendar',
  async () => {
    const { data } = await supabase
      .from('calendar_blocks')
      .select('*')
      .lt('start_date', gridEnd.value)
      .gt('end_date', gridStart.value)
    return (data ?? []) as Block[]
  },
  { watch: [cursor] }
)

const { data: house } = await useAsyncData('admin-calendar-house', async () => {
  const { data } = await supabase
    .from('app_settings').select('availability_mode, currency').eq('id', 1).single()
  return (data ?? { availability_mode: 'open', currency: 'EUR' }) as {
    availability_mode: 'open' | 'closed'
    currency: string
  }
})

const mode = computed(() => house.value?.availability_mode ?? 'open')
const currency = computed(() => house.value?.currency ?? 'EUR')

const { data: openPeriods, refresh: refreshOpen } = await useAsyncData<OpenPeriod[]>(
  'admin-calendar-open',
  async () => {
    const { data } = await supabase
      .from('open_periods')
      .select('*')
      .lt('start_date', gridEnd.value)
      .gt('end_date', gridStart.value)
    return (data ?? []) as OpenPeriod[]
  },
  { watch: [cursor] }
)

const { data: rates, refresh: refreshRates } = await useAsyncData<RateDay[]>(
  'admin-calendar-rates',
  async () => {
    const { data } = await supabase.rpc('rate_calendar', {
      p_from: gridStart.value,
      p_to: addDays(gridEnd.value, -1)
    })
    return (data ?? []) as RateDay[]
  },
  { watch: [cursor] }
)

async function refreshAll() {
  await Promise.all([refreshBlocks(), refreshOpen(), refreshRates()])
}

/** date -> the block occupying that night, if any */
const occupancy = computed(() => {
  const map = new Map<string, Block>()
  for (const block of blocks.value ?? []) {
    for (const night of eachNight(block.start_date, block.end_date)) map.set(night, block)
  }
  return map
})

/** date -> the open period that puts it on sale, if any */
const onSale = computed(() => {
  const map = new Map<string, OpenPeriod>()
  for (const period of openPeriods.value ?? []) {
    for (const night of eachNight(period.start_date, period.end_date)) map.set(night, period)
  }
  return map
})

const rateByDay = computed(() => new Map((rates.value ?? []).map(r => [r.day, r])))

// --- selection ---------------------------------------------------------------
// A set of days rather than a single range: the host can pick, say, every
// weekend of a month and price them all at once. Everything accumulates — a
// click toggles one night, a drag toggles a whole run, Shift extends from the
// last anchor — and the selection is only ever dropped on purpose, with Esc or
// the × in the toolbar.
const selectedDays = ref(new Set<string>())
const anchor = ref<string | null>(null)
const dragFocus = ref<string | null>(null)
const dragging = ref(false)
const dragRemoves = ref(false)

const dragRun = computed(() => {
  if (!dragging.value || !anchor.value || !dragFocus.value) return []
  const [from, to] = anchor.value <= dragFocus.value
    ? [anchor.value, dragFocus.value]
    : [dragFocus.value, anchor.value]
  return eachNight(from, addDays(to, 1))
})

/** What the toolbar acts on: the committed set plus whatever is under the cursor. */
const selection = computed(() => {
  const days = new Set(selectedDays.value)
  for (const day of dragRun.value) {
    if (dragRemoves.value) days.delete(day)
    else days.add(day)
  }
  return [...days].sort()
})

const selectionSet = computed(() => new Set(selection.value))
const isSelected = (date: string) => selectionSet.value.has(date)

/** The selection cut into contiguous [start, end) ranges — what a block is. */
const runs = computed(() => {
  const out: Array<{ start: string, end: string }> = []
  for (const day of selection.value) {
    const last = out.at(-1)
    if (last && last.end === day) last.end = addDays(day, 1)
    else out.push({ start: day, end: addDays(day, 1) })
  }
  return out
})

const selectionLabel = computed(() => {
  const ranges = runs.value
  if (!ranges.length) return ''
  if (ranges.length === 1) {
    return `${formatDate(ranges[0]!.start)} → ${formatDate(addDays(ranges[0]!.end, -1))}`
  }
  return `${ranges.length} tramos`
})

function startSelection(date: string, event: PointerEvent) {
  // Shift extends the last run instead of starting a new one.
  if (event.shiftKey && anchor.value) {
    dragFocus.value = date
    dragRemoves.value = false
    dragging.value = true
    commitDrag()
    return
  }

  // Starting on a night that is already picked takes it (or the run) away
  // again, so a single click is a plain toggle.
  dragRemoves.value = selectedDays.value.has(date)
  anchor.value = date
  dragFocus.value = date
  dragging.value = true
}

function extendSelection(date: string) {
  if (dragging.value) dragFocus.value = date
}

function commitDrag() {
  if (!dragging.value) return
  // Read the live selection before dropping the drag, or the run is lost.
  selectedDays.value = new Set(selection.value)
  dragging.value = false
  dragFocus.value = null
}

function clearSelection() {
  selectedDays.value = new Set()
  anchor.value = null
  dragFocus.value = null
  dragging.value = false
}

function onEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') clearSelection()
}

onMounted(() => {
  window.addEventListener('pointerup', commitDrag)
  window.addEventListener('keydown', onEscape)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerup', commitDrag)
  window.removeEventListener('keydown', onEscape)
})

// --- acting on the selection --------------------------------------------------
/**
 * Runs a write, reports it and reloads the grid. PromiseLike rather than
 * Promise: a PostgREST query builder is thenable but not an actual Promise.
 */
async function run(label: string, work: () => PromiseLike<{ error: { message: string } | null }>) {
  busy.value = true
  const { error } = await work()
  busy.value = false

  if (error) {
    toast.add({ title: `No se pudo ${label}`, description: error.message, color: 'error' })
    return false
  }
  await refreshAll()
  return true
}

async function blockSelection() {
  if (!runs.value.length) return
  const ok = await run('bloquear', () =>
    supabase.from('blocked_dates').insert(
      runs.value.map(range => ({ start_date: range.start, end_date: range.end }))
    )
  )
  if (ok) {
    toast.add({ title: `${selection.value.length} noche(s) bloqueadas`, color: 'success' })
    clearSelection()
  }
}

async function openSelection() {
  if (!runs.value.length) return
  const ok = await run('abrir', () =>
    supabase.from('open_periods').insert(
      runs.value.map(range => ({ start_date: range.start, end_date: range.end }))
    )
  )
  if (ok) {
    toast.add({ title: `${selection.value.length} noche(s) abiertas`, color: 'success' })
    clearSelection()
  }
}

/**
 * Cuts [start, end) out of every row of `table` that overlaps it, putting back
 * whatever stuck out on either side. Deleting the whole row would silently
 * unblock dates the host never selected.
 */
async function subtractRange(table: 'blocked_dates' | 'open_periods', start: string, end: string) {
  const { data: rows, error } = await supabase
    .from(table).select('*').lt('start_date', end).gt('end_date', start)
  if (error) return { error }

  for (const row of (rows ?? []) as Array<Record<string, string>>) {
    const { error: deleteError } = await supabase.from(table).delete().eq('id', row.id)
    if (deleteError) return { error: deleteError }

    const label = table === 'blocked_dates'
      ? { reason: row.reason ?? null }
      : { note: row.note ?? null }

    const leftovers = [
      ...(row.start_date! < start ? [{ start_date: row.start_date!, end_date: start, ...label }] : []),
      ...(row.end_date! > end ? [{ start_date: end, end_date: row.end_date!, ...label }] : [])
    ]
    if (leftovers.length) {
      const { error: insertError } = await supabase.from(table).insert(leftovers)
      if (insertError) return { error: insertError }
    }
  }
  return { error: null }
}

async function releaseSelection() {
  if (!runs.value.length) return
  const ok = await run('liberar las fechas', async () => {
    for (const range of runs.value) {
      const blocked = await subtractRange('blocked_dates', range.start, range.end)
      if (blocked.error) return blocked

      if (mode.value === 'closed') {
        const opened = await subtractRange('open_periods', range.start, range.end)
        if (opened.error) return opened
      }
    }
    return { error: null }
  })
  if (ok) {
    toast.add({
      title: mode.value === 'closed' ? 'Fechas cerradas de nuevo' : 'Bloqueos retirados',
      color: 'success'
    })
    clearSelection()
  }
}

// --- bulk edit of the selected nights ----------------------------------------
// The form shows what these nights are worth and saves exactly that: a field
// with a value becomes an override, an empty one drops back to the season or
// the base rate. No hidden "leave it as it was".
const bulk = reactive({ nightly: '', minNights: '', note: '' })

/**
 * What the selected nights currently span, when they do not all agree. Shown as
 * the placeholder of the field that could not be filled in, so the spread is
 * visible without a warning box.
 */
const spread = reactive({ nightly: '', minNights: '' })

function selectedRates(): RateDay[] {
  return selection.value.map(day => rateByDay.value.get(day)).filter(Boolean) as RateDay[]
}

/**
 * The value the whole selection already shares, or null when the nights differ.
 * Prefilling from just the first night would quietly flatten the rest.
 */
function sharedValue<T>(read: (rate: RateDay) => T): T | null {
  const rates = selectedRates()
  if (!rates.length) return null

  const first = read(rates[0]!)
  return rates.every(rate => read(rate) === first) ? first : null
}

/** "165 € – 214,50 €" across the selection, or '' when they all match. */
function spreadOf(read: (rate: RateDay) => number, format: (value: number) => string): string {
  const values = selectedRates().map(read)
  if (!values.length) return ''

  const low = Math.min(...values)
  const high = Math.max(...values)
  return low === high ? '' : `${format(low)} – ${format(high)}`
}

function openBulkModal() {
  const cents = sharedValue(rate => rate.nightly_cents)
  const minNights = sharedValue(rate => rate.min_nights)
  const note = sharedValue(rate => rate.note)

  bulk.nightly = cents === null ? '' : String(fromCents(cents))
  bulk.minNights = minNights === null ? '' : String(minNights)
  bulk.note = note ?? ''

  // Blank now means "back to the rate card", so a field left blank because the
  // nights disagree says what they actually span.
  spread.nightly = spreadOf(rate => rate.nightly_cents, value => formatMoney(value, currency.value))
  spread.minNights = spreadOf(rate => rate.min_nights, value => `${value}`)

  showBulkModal.value = true
}

async function saveBulk() {
  const days = selection.value
  if (!days.length) return

  const cents = bulk.nightly.trim() ? toCents(bulk.nightly) : null
  const minNights = bulk.minNights.trim() ? Math.trunc(Number(bulk.minNights)) : null
  const note = bulk.note.trim()

  if (cents !== null && cents <= 0) {
    toast.add({ title: 'El precio tiene que ser mayor que cero', color: 'error' })
    return
  }
  if (minNights !== null && minNights < 1) {
    toast.add({ title: 'La estancia mínima tiene que ser de al menos una noche', color: 'error' })
    return
  }

  // Nothing left to pin down: drop the overrides so the season and the base
  // rate take over again. The table would reject an empty row anyway, and a
  // note on its own has nothing to annotate.
  if (cents === null && minNights === null) {
    const cleared = await run('restaurar la tarifa', () =>
      supabase.from('rate_overrides').delete().in('day', days)
    )
    if (cleared) {
      toast.add({ title: `${days.length} noche(s) vuelven a la tarifa`, color: 'success' })
      showBulkModal.value = false
      clearSelection()
    }
    return
  }

  const rows = days.map(day => ({
    day,
    nightly_cents: cents,
    min_nights: minNights,
    note: note || null
  }))

  const ok = await run('guardar los precios', () =>
    supabase.from('rate_overrides').upsert(rows, { onConflict: 'day' })
  )
  if (ok) {
    toast.add({ title: `${rows.length} noche(s) actualizadas`, color: 'success' })
    showBulkModal.value = false
    clearSelection()
  }
}

async function resetPrice() {
  const days = selection.value
  if (!days.length) return
  const ok = await run('restaurar el precio', () =>
    supabase.from('rate_overrides').delete().in('day', days)
  )
  if (ok) {
    toast.add({ title: 'Vuelve a mandar la tarifa', color: 'success' })
    showBulkModal.value = false
    clearSelection()
  }
}

// --- the grid -----------------------------------------------------------------
const WEEKS = 6
const LANE_HEIGHT_REM = 1.6
const LANES_TOP_REM = 2

const weeks = computed(() =>
  Array.from({ length: WEEKS }, (_, week) => ({
    index: week,
    days: Array.from({ length: 7 }, (_, offset) => {
      const date = addDays(gridStart.value, week * 7 + offset)
      const block = occupancy.value.get(date) ?? null
      const open = onSale.value.get(date) ?? null
      return {
        date,
        inMonth: date >= monthStart.value && date < monthEnd.value,
        block,
        rate: rateByDay.value.get(date) ?? null,
        // Not on sale at all: nothing occupies it, the host simply has not
        // opened it. Only ever true in 'closed' mode.
        closed: !block && !open && mode.value === 'closed',
        openLabel: open && !block && mode.value === 'closed' ? (open.note ?? 'Abierto') : null
      }
    })
  }))
)

/**
 * What actually gets drawn, after untangling the channels.
 *
 * Two feeds reporting the same fortnight are one unavailable stretch, not two
 * pills, and a channel closing dates because it imported our own calendar adds
 * nothing at all — that stay is already on the board as our booking.
 */
interface DisplayBlock {
  key: string
  kind: 'booking' | 'blocked' | 'external'
  channel: string
  channels: string[]
  start_date: string
  end_date: string
  label: string
  reference: string | null
  status: string | null
  total_cents: number | null
  currency: string | null
  reservation: boolean
  /** true when the feed said it outright, false when we assumed it. */
  declared: boolean
  link: string | null
}

/** The feed said so, in as many words. */
const declaresReservation = (block: Block) => block.event_kind === 'reservation'

/**
 * Counts as a reservation on the board. Either the feed said so, or the feed
 * cannot say and its channel is configured to treat everything it closes as a
 * booking of its own (Booking.com, by default) — see
 * ical_feeds.treat_closed_as_reservation.
 */
const countsAsReservation = (block: Block) =>
  declaresReservation(block) || (block.kind === 'external' && block.assume_reservations === true)

const displayBlocks = computed<DisplayBlock[]>(() => {
  const all = blocks.value ?? []
  const own = all.filter(block => block.kind !== 'external')
  const external = all.filter(block => block.kind === 'external')

  const result: DisplayBlock[] = own.map(block => ({
    key: `${block.kind}-${block.source_id}`,
    kind: block.kind,
    channel: block.channel,
    channels: [block.channel],
    start_date: block.start_date,
    end_date: block.end_date,
    label: block.label,
    reference: block.reference,
    status: block.status,
    total_cents: block.total_cents,
    currency: block.currency,
    reservation: block.kind === 'booking',
    declared: true,
    link: null
  }))

  // A channel block sitting inside one of our own stays is that stay coming
  // back to us through the export. Nothing to show.
  const echoes = (block: Block) =>
    own.some(mine => mine.start_date <= block.start_date && mine.end_date >= block.end_date)

  const remaining = external
    .filter(block => !echoes(block))
    .sort((a, b) => a.start_date.localeCompare(b.start_date))

  // Merge whatever overlaps into one stretch: the channels mirror each other,
  // and Booking.com splits a single stay into several events.
  let current: Block[] = []
  const flush = () => {
    if (!current.length) return
    result.push(mergeExternal(current))
    current = []
  }

  for (const block of remaining) {
    const end = current.reduce((latest, b) => (b.end_date > latest ? b.end_date : latest), '')
    if (current.length && block.start_date < end) current.push(block)
    else {
      flush()
      current = [block]
    }
  }
  flush()

  return result
})

function mergeExternal(group: Block[]): DisplayBlock {
  const start = group.reduce((min, b) => (b.start_date < min ? b.start_date : min), group[0]!.start_date)
  const end = group.reduce((max, b) => (b.end_date > max ? b.end_date : max), group[0]!.end_date)
  const channels = [...new Set(group.map(b => b.channel))]

  // A feed that names the reservation outright beats one that is only assumed
  // to be reporting its own bookings: the same stay mirrored onto Booking.com
  // should still read as the Airbnb reservation it is.
  const booked = group.find(declaresReservation) ?? group.find(countsAsReservation)

  return {
    key: `external-${group.map(b => b.source_id).join('-')}`,
    kind: 'external',
    channel: booked?.channel ?? channels[0]!,
    channels,
    start_date: start,
    end_date: end,
    // 'CLOSED - Not available' is no use as a title once we have decided it is
    // a booking, so an assumed reservation is named after nothing at all.
    label: booked ? (declaresReservation(booked) ? booked.label : 'Reserva') : 'No disponible',
    reference: null,
    status: null,
    total_cents: null,
    currency: null,
    reservation: Boolean(booked),
    declared: Boolean(booked && declaresReservation(booked)),
    link: booked?.link ?? null
  }
}

interface PillSegment {
  key: string
  block: DisplayBlock
  left: number
  width: number
  lane: number
  roundStart: boolean
  roundEnd: boolean
}

/**
 * A stay drawn the way it is actually used: it starts halfway through the
 * arrival day and ends halfway through the departure day, so the changeover
 * day visibly belongs to both guests and back-to-back bookings do not look
 * like a double booking.
 *
 * Positions are in columns (0–7) and turned into percentages by the template.
 * Anything crossing a Sunday is cut and continues on the next row, square on
 * the cut edge and rounded only where the stay really begins or ends.
 */
const weekSegments = computed<PillSegment[][]>(() => {
  const columnOf = (day: string) => nightsBetween(gridStart.value, day)
  const sorted = [...displayBlocks.value].sort((a, b) => a.start_date.localeCompare(b.start_date))

  return Array.from({ length: WEEKS }, (_, week) => {
    const rowStart = week * 7
    const rowEnd = rowStart + 7
    const laneEnds: number[] = []
    const segments: PillSegment[] = []

    for (const block of sorted) {
      const startX = columnOf(block.start_date) + 0.5
      const endX = columnOf(block.end_date) + 0.5
      const left = Math.max(startX, rowStart)
      const right = Math.min(endX, rowEnd)
      if (right <= left) continue

      // Overlapping stays (a channel block over a manual one) stack instead of
      // hiding each other.
      let lane = laneEnds.findIndex(end => end <= left)
      if (lane === -1) {
        lane = laneEnds.length
        laneEnds.push(right)
      } else {
        laneEnds[lane] = right
      }

      segments.push({
        key: `${block.key}-${week}`,
        block,
        left: left - rowStart,
        width: right - left,
        lane,
        roundStart: startX >= rowStart,
        roundEnd: endX <= rowEnd
      })
    }
    return segments
  })
})

/** Tall enough for the day number, the deepest pill stack and the price. */
function rowMinHeight(week: number): string {
  const lanes = Math.max(1, ...weekSegments.value[week]!.map(segment => segment.lane + 1))
  return `${LANES_TOP_REM + lanes * LANE_HEIGHT_REM + 1.5}rem`
}

function pillStyle(segment: PillSegment) {
  return {
    left: `${(segment.left / 7) * 100}%`,
    width: `${(segment.width / 7) * 100}%`,
    top: `${LANES_TOP_REM + segment.lane * LANE_HEIGHT_REM}rem`
  }
}

/**
 * Where a stay came from, in one glance. Third-party colours are their brands,
 * so they stay put; a direct booking wears the house colour and follows the
 * theme.
 */
interface Appearance {
  bg: string
  icon: string
  /** How the legend introduces it. */
  name: string
  /** The platform on its own, for badges and tooltips. */
  label: string
}

const CHANNELS: Record<string, Appearance> = {
  direct: { bg: 'bg-primary', icon: 'i-lucide-globe', name: 'Reserva directa', label: 'Directa' },
  airbnb: { bg: 'bg-airbnb', icon: 'i-simple-icons-airbnb', name: 'Reserva de Airbnb', label: 'Airbnb' },
  booking: { bg: 'bg-blue-800', icon: 'i-simple-icons-bookingdotcom', name: 'Reserva de Booking.com', label: 'Booking.com' },
  vrbo: { bg: 'bg-sky-600', icon: 'i-lucide-house', name: 'Reserva de Vrbo', label: 'Vrbo' },
  manual: { bg: 'bg-neutral-500', icon: 'i-lucide-wrench', name: 'Bloqueo manual', label: 'Manual' },
  other: { bg: 'bg-slate-500', icon: 'i-lucide-link', name: 'Reserva de otro canal', label: 'Otro canal' }
}

/**
 * Dates a channel merely closed — usually because it imported our calendar and
 * mirrored back a stay that is already on the board. Deliberately unbranded: a
 * Booking.com logo on these would claim a Booking.com reservation, and their
 * feed never says that. Which channels reported it is in the tooltip and the
 * dialog, where it cannot be mistaken for a booking.
 */
const SYNCED_CLOSED: Appearance = {
  bg: 'bg-slate-400 dark:bg-slate-600',
  icon: 'i-lucide-refresh-cw',
  name: 'Cerrado por sincronización',
  label: 'Cerrado'
}

function channelOf(channel: string) {
  return CHANNELS[channel] ?? CHANNELS.other!
}

/** Only a confirmed reservation gets to wear a platform's colours. */
function appearanceOf(block: DisplayBlock): Appearance {
  if (block.kind === 'external' && !block.reservation) return SYNCED_CLOSED
  return channelOf(block.channel)
}

/** A hold that nobody has paid for yet is not the same as a confirmed stay. */
const isPending = (block: DisplayBlock) => block.status === 'pending'

function pillTitle(block: DisplayBlock): string {
  const where = block.kind === 'external' && !block.reservation
    ? `${SYNCED_CLOSED.name}: ${block.channels.map(channel => channelOf(channel).label).join(' + ')}`
    : channelOf(block.channel).name
  return `${block.label} · ${where} · ${block.start_date} → ${block.end_date}`
}

// --- opening a pill ----------------------------------------------------------
const inspecting = ref<DisplayBlock | null>(null)

/**
 * Our own bookings live in /admin/bookings, where every action on them already
 * is; anything imported has no detail worth a page, so it opens in place.
 */
function inspectBlock(block: DisplayBlock) {
  if (block.kind === 'booking' && block.reference) {
    navigateTo(`/admin/bookings?ref=${block.reference}`)
    return
  }
  inspecting.value = block
}

const monthLabel = computed(() =>
  new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${monthStart.value}T00:00:00Z`))
)

const weekdays = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

function shiftMonth(delta: number) {
  const [year, month] = cursor.value.split('-').map(Number)
  const next = new Date(Date.UTC(year!, month! - 1 + delta, 1))
  cursor.value = next.toISOString().slice(0, 7)
  clearSelection()
}

// --- the long-range modals ----------------------------------------------------
async function createBlock() {
  if (!newBlock.start_date || !newBlock.end_date || newBlock.end_date <= newBlock.start_date) {
    toast.add({ title: 'Las fechas no son válidas', color: 'error' })
    return
  }
  const ok = await run('bloquear', () =>
    supabase.from('blocked_dates').insert({
      start_date: newBlock.start_date,
      end_date: newBlock.end_date,
      reason: newBlock.reason || null
    })
  )
  if (ok) {
    toast.add({ title: 'Fechas bloqueadas', color: 'success' })
    showBlockModal.value = false
    Object.assign(newBlock, { start_date: '', end_date: '', reason: '' })
  }
}

async function createOpenPeriod() {
  if (!newOpen.start_date || !newOpen.end_date || newOpen.end_date <= newOpen.start_date) {
    toast.add({ title: 'Las fechas no son válidas', color: 'error' })
    return
  }
  const ok = await run('abrir', () =>
    supabase.from('open_periods').insert({
      start_date: newOpen.start_date,
      end_date: newOpen.end_date,
      note: newOpen.note || null
    })
  )
  if (ok) {
    toast.add({ title: 'Fechas abiertas', color: 'success' })
    showOpenModal.value = false
    Object.assign(newOpen, { start_date: '', end_date: '', note: '' })
  }
}

useSeoMeta({ title: 'Calendario · Bonaire Patacona', robots: 'noindex, nofollow' })
</script>

<template>
  <UDashboardPanel id="admin-calendar">
    <template #header>
      <UDashboardNavbar title="Calendario">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-calendar-check"
            color="success"
            variant="subtle"
            @click="showOpenModal = true"
          >
            Abrir fechas
          </UButton>
          <UButton
            icon="i-lucide-ban"
            variant="subtle"
            @click="showBlockModal = true"
          >
            Bloquear fechas
          </UButton>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-4">
        <UAlert
          v-if="mode === 'closed'"
          color="info"
          variant="subtle"
          icon="i-lucide-lock"
          title="Calendario cerrado por defecto"
          description="Solo se puede reservar dentro de los rangos abiertos. Se cambia en Ajustes → Disponibilidad."
        />

        <div class="flex items-center justify-between">
          <UButton
            icon="i-lucide-chevron-left"
            variant="ghost"
            color="neutral"
            aria-label="Mes anterior"
            @click="shiftMonth(-1)"
          />
          <h2 class="font-semibold text-highlighted capitalize">
            {{ monthLabel }}
          </h2>
          <UButton
            icon="i-lucide-chevron-right"
            variant="ghost"
            color="neutral"
            aria-label="Mes siguiente"
            @click="shiftMonth(1)"
          />
        </div>

        <USkeleton
          v-if="pending"
          class="h-96 w-full"
        />

        <div v-else>
          <div class="grid grid-cols-7 text-center text-xs text-muted mb-1">
            <div
              v-for="weekday in weekdays"
              :key="weekday"
            >
              {{ weekday }}
            </div>
          </div>

          <div class="select-none overflow-hidden rounded-lg border border-default">
            <div
              v-for="week in weeks"
              :key="week.index"
              class="relative grid grid-cols-7"
              :style="{ minHeight: rowMinHeight(week.index) }"
            >
              <button
                v-for="cell in week.days"
                :key="cell.date"
                type="button"
                class="flex flex-col border-b border-e border-default p-1 text-left text-xs last:border-e-0"
                :class="[
                  cell.inMonth ? '' : 'opacity-40',
                  cell.closed ? 'bg-elevated text-dimmed' : '',
                  isSelected(cell.date) ? 'bg-primary/10 ring-2 ring-inset ring-primary' : ''
                ]"
                :aria-pressed="isSelected(cell.date)"
                @pointerdown="startSelection(cell.date, $event)"
                @pointerenter="extendSelection(cell.date)"
              >
                <span class="font-medium">{{ Number(cell.date.slice(8)) }}</span>

                <span
                  v-if="cell.closed"
                  class="mt-0.5 truncate"
                >
                  Cerrado
                </span>
                <span
                  v-else-if="cell.openLabel"
                  class="mt-0.5 truncate text-success"
                  :title="cell.openLabel"
                >
                  {{ cell.openLabel }}
                </span>

                <span
                  v-if="cell.rate"
                  class="mt-auto tabular-nums"
                  :class="cell.rate.overridden ? 'font-semibold text-warning' : 'text-muted'"
                  :title="cell.rate.overridden ? cell.rate.note ?? 'Precio fijado a mano' : 'Tarifa calculada'"
                >
                  {{ formatMoney(cell.rate.nightly_cents, currency) }}
                </span>
              </button>

              <!--
                The pills sit above the cells, so they take the pointer and the
                selection is made on the free part of a day instead.
              -->
              <div class="pointer-events-none absolute inset-0">
                <button
                  v-for="segment in weekSegments[week.index]"
                  :key="segment.key"
                  type="button"
                  class="pointer-events-auto absolute flex h-6 items-center gap-1.5 overflow-hidden px-2 text-[11px] text-white shadow-sm transition hover:brightness-110"
                  :class="[
                    appearanceOf(segment.block).bg,
                    segment.roundStart ? 'rounded-s-full' : '',
                    segment.roundEnd ? 'rounded-e-full' : '',
                    isPending(segment.block) ? 'opacity-70 ring-1 ring-inset ring-white/50' : ''
                  ]"
                  :style="pillStyle(segment)"
                  :title="pillTitle(segment.block)"
                  @click="inspectBlock(segment.block)"
                >
                  <UIcon
                    :name="isPending(segment.block) ? 'i-lucide-clock' : appearanceOf(segment.block).icon"
                    class="size-3.5 shrink-0"
                  />
                  <span class="truncate font-medium">{{ segment.block.label }}</span>
                  <span
                    v-if="segment.block.total_cents"
                    class="ms-auto shrink-0 ps-2 tabular-nums"
                  >
                    {{ formatMoney(segment.block.total_cents, segment.block.currency ?? currency) }}
                  </span>
                </button>
              </div>
            </div>
          </div>

          <div class="mt-4 flex flex-wrap gap-4 text-xs text-muted">
            <span
              v-for="(style, code) in { ...CHANNELS, synced: SYNCED_CLOSED }"
              :key="code"
              class="flex items-center gap-1.5"
            >
              <span
                class="flex size-4 items-center justify-center rounded-full text-white"
                :class="style.bg"
              >
                <UIcon
                  :name="style.icon"
                  class="size-2.5"
                />
              </span>
              {{ style.name }}
            </span>
            <span
              v-if="mode === 'closed'"
              class="flex items-center gap-1"
            >
              <span class="size-3 rounded border border-dashed border-muted bg-elevated" /> Sin abrir
            </span>
            <span class="flex items-center gap-1">
              <span class="text-warning font-semibold">00 €</span> Precio fijado a mano
            </span>
          </div>

          <p class="mt-2 text-xs text-dimmed">
            Haz clic en cada noche para irlas sumando, arrastra para tramos enteros, Mayúsculas amplía y Esc deselecciona. Volver a marcar una noche la quita. Al pulsar una reserva se abren sus detalles.
          </p>
        </div>
      </div>

      <!-- Actions on the current selection -->
      <div
        v-if="selection.length"
        class="sticky bottom-4 mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-default bg-default/95 p-3 shadow-lg backdrop-blur"
      >
        <span class="text-sm font-medium text-highlighted">
          {{ selectionLabel }}
          <span class="text-muted font-normal">({{ selection.length }} noches)</span>
        </span>
        <div class="ms-auto flex flex-wrap gap-2">
          <UButton
            icon="i-lucide-euro"
            size="sm"
            variant="subtle"
            :loading="busy"
            @click="openBulkModal"
          >
            Editar {{ selection.length }} noches
          </UButton>
          <UButton
            v-if="mode === 'closed'"
            icon="i-lucide-calendar-check"
            size="sm"
            color="success"
            variant="subtle"
            :loading="busy"
            @click="openSelection"
          >
            Abrir
          </UButton>
          <UButton
            icon="i-lucide-ban"
            size="sm"
            color="neutral"
            variant="subtle"
            :loading="busy"
            @click="blockSelection"
          >
            Bloquear
          </UButton>
          <UButton
            icon="i-lucide-eraser"
            size="sm"
            color="neutral"
            variant="subtle"
            :loading="busy"
            @click="releaseSelection"
          >
            {{ mode === 'closed' ? 'Cerrar' : 'Desbloquear' }}
          </UButton>
          <UButton
            icon="i-lucide-x"
            size="sm"
            color="neutral"
            variant="ghost"
            aria-label="Quitar la selección"
            @click="clearSelection"
          />
        </div>
      </div>

      <UModal
        :open="Boolean(inspecting)"
        :title="inspecting?.label ?? ''"
        :description="inspecting ? `${formatDate(inspecting.start_date)} → ${formatDate(addDays(inspecting.end_date, -1))}` : ''"
        @update:open="inspecting = null"
      >
        <template #body>
          <div
            v-if="inspecting"
            class="flex flex-col gap-3 text-sm"
          >
            <div class="flex flex-wrap gap-2">
              <UBadge
                v-for="channel in inspecting.channels"
                :key="channel"
                color="neutral"
                variant="subtle"
                :icon="channelOf(channel).icon"
              >
                {{ channelOf(channel).label }}
              </UBadge>
            </div>

            <p
              v-if="inspecting.kind === 'external' && !inspecting.reservation"
              class="text-muted"
            >
              El canal solo dice que estas fechas no están disponibles, sin decir
              por qué.
            </p>
            <p
              v-else-if="inspecting.kind === 'external' && !inspecting.declared"
              class="text-muted"
            >
              Se cuenta como reserva del canal porque así está configurado:
              Booking.com exporta igual una reserva suya que un bloqueo manual,
              no lo dice en el calendario. Se cambia en Canales. Los datos del
              huésped están en su extranet.
            </p>
            <p
              v-else-if="inspecting.kind === 'external'"
              class="text-muted"
            >
              El canal confirma que es una reserva suya. Los datos del huésped
              solo están en su extranet.
            </p>
            <p
              v-else
              class="text-muted"
            >
              Bloqueo manual. Se quita seleccionando esas noches y pulsando
              «Desbloquear».
            </p>
          </div>
        </template>
        <template #footer>
          <div class="flex w-full justify-between gap-2">
            <UButton
              v-if="inspecting?.link"
              icon="i-lucide-external-link"
              variant="subtle"
              :to="inspecting.link"
              target="_blank"
              rel="noopener"
            >
              Abrir en el canal
            </UButton>
            <UButton
              class="ms-auto"
              color="neutral"
              variant="ghost"
              @click="inspecting = null"
            >
              Cerrar
            </UButton>
          </div>
        </template>
      </UModal>

      <!-- Bulk edit of the selected nights -->
      <UModal
        v-model:open="showBulkModal"
        :title="`Editar ${selection.length} noche(s)`"
        description="Se guarda lo que veas: un campo vacío vuelve a la temporada o a la tarifa base. Un precio fijado a mano manda sobre ambas y no lleva recargo de fin de semana."
      >
        <template #body>
          <div class="flex flex-col gap-3">
            <UFormField
              label="Precio por noche (€)"
              hint="En blanco: vuelve a la tarifa"
            >
              <UInput
                v-model="bulk.nightly"
                :placeholder="spread.nightly || 'Tarifa de temporada'"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Estancia mínima (noches)"
              hint="En blanco: vuelve a la tarifa"
            >
              <UInput
                v-model="bulk.minNights"
                :placeholder="spread.minNights || 'Mínimo de temporada'"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Nota"
              hint="Se ve en el desglose del huésped"
            >
              <UInput
                v-model="bulk.note"
                placeholder="Semana de Fallas"
                class="w-full"
              />
            </UFormField>

            <p
              v-if="spread.nightly || spread.minNights"
              class="text-xs text-dimmed"
            >
              El rango en gris es lo que valen ahora estas noches, que no
              coinciden entre sí. Lo que guardes se aplicará a todas por igual.
            </p>
            <p class="text-xs text-dimmed">
              Vaciando el precio y la estancia mínima, estas noches vuelven por
              completo a la tarifa: la nota se va con ellas.
            </p>
          </div>
        </template>
        <template #footer>
          <div class="flex justify-between gap-2 w-full">
            <UButton
              color="neutral"
              variant="ghost"
              :loading="busy"
              @click="resetPrice"
            >
              Volver a la tarifa
            </UButton>
            <div class="flex gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                @click="showBulkModal = false"
              >
                Cancelar
              </UButton>
              <UButton
                :loading="busy"
                @click="saveBulk"
              >
                Guardar
              </UButton>
            </div>
          </div>
        </template>
      </UModal>

      <UModal
        v-model:open="showOpenModal"
        title="Abrir fechas a la venta"
        description="Solo hace algo con el calendario cerrado por defecto. La salida no se incluye."
      >
        <template #body>
          <div class="flex flex-col gap-3">
            <UFormField
              label="Desde"
              required
            >
              <UInput
                v-model="newOpen.start_date"
                type="date"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Hasta (no incluido)"
              required
            >
              <UInput
                v-model="newOpen.end_date"
                type="date"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Nota">
              <UInput
                v-model="newOpen.note"
                placeholder="Verano 2026, puente de mayo…"
                class="w-full"
              />
            </UFormField>
          </div>
        </template>
        <template #footer>
          <div class="flex justify-end gap-2 w-full">
            <UButton
              color="neutral"
              variant="ghost"
              @click="showOpenModal = false"
            >
              Cancelar
            </UButton>
            <UButton
              color="success"
              :loading="busy"
              @click="createOpenPeriod"
            >
              Abrir
            </UButton>
          </div>
        </template>
      </UModal>

      <UModal
        v-model:open="showBlockModal"
        title="Bloquear fechas"
        description="La salida no se incluye, igual que en una reserva."
      >
        <template #body>
          <div class="flex flex-col gap-3">
            <UFormField
              label="Desde"
              required
            >
              <UInput
                v-model="newBlock.start_date"
                type="date"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Hasta (no incluido)"
              required
            >
              <UInput
                v-model="newBlock.end_date"
                type="date"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Motivo">
              <UInput
                v-model="newBlock.reason"
                placeholder="Mantenimiento, uso propio…"
                class="w-full"
              />
            </UFormField>
          </div>
        </template>
        <template #footer>
          <div class="flex justify-end gap-2 w-full">
            <UButton
              color="neutral"
              variant="ghost"
              @click="showBlockModal = false"
            >
              Cancelar
            </UButton>
            <UButton
              :loading="busy"
              @click="createBlock"
            >
              Bloquear
            </UButton>
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
