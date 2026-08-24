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
// Empty means "leave as it is", so a host raising the price of forty nights
// does not have to retype their minimum stay forty times.
const bulk = reactive({ nightly: '', minNights: '', note: '' })

function openBulkModal() {
  const first = selection.value[0] ? rateByDay.value.get(selection.value[0]) : null
  bulk.nightly = first ? String(fromCents(first.nightly_cents)) : ''
  bulk.minNights = ''
  bulk.note = ''
  showBulkModal.value = true
}

async function saveBulk() {
  const days = selection.value
  if (!days.length) return

  const cents = bulk.nightly.trim() ? toCents(bulk.nightly) : null
  const minNights = bulk.minNights.trim() ? Math.trunc(Number(bulk.minNights)) : null
  const note = bulk.note.trim()

  if (cents === null && minNights === null && !note) {
    toast.add({ title: 'No has cambiado nada', color: 'error' })
    return
  }
  if (cents !== null && cents <= 0) {
    toast.add({ title: 'El precio tiene que ser mayor que cero', color: 'error' })
    return
  }
  if (minNights !== null && minNights < 1) {
    toast.add({ title: 'La estancia mínima tiene que ser de al menos una noche', color: 'error' })
    return
  }

  busy.value = true
  // Merge with what is already there: a blank field must not wipe a value the
  // host set on an earlier pass.
  const { data: existing, error: readError } = await supabase
    .from('rate_overrides').select('*').in('day', days)

  if (readError) {
    busy.value = false
    toast.add({ title: 'No se pudo leer los precios', description: readError.message, color: 'error' })
    return
  }

  const previous = new Map(
    ((existing ?? []) as Array<{ day: string, nightly_cents: number | null, min_nights: number | null, note: string | null }>)
      .map(row => [row.day, row])
  )

  const rows = days
    .map((day) => {
      const prev = previous.get(day)
      return {
        day,
        nightly_cents: cents ?? prev?.nightly_cents ?? null,
        min_nights: minNights ?? prev?.min_nights ?? null,
        note: note || prev?.note || null
      }
    })
    // A row with neither a price nor a minimum stay carries nothing; the table
    // rejects it, and rightly so.
    .filter(row => row.nightly_cents !== null || row.min_nights !== null)

  busy.value = false
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
const grid = computed(() =>
  Array.from({ length: 42 }, (_, i) => {
    const date = addDays(gridStart.value, i)
    const block = occupancy.value.get(date) ?? null
    const open = onSale.value.get(date) ?? null
    const rate = rateByDay.value.get(date) ?? null
    return {
      date,
      inMonth: date >= monthStart.value && date < monthEnd.value,
      block,
      open,
      rate,
      // Not on sale at all: nothing occupies it, the host simply has not
      // opened it. Only ever true in 'closed' mode.
      closed: !block && !open && mode.value === 'closed'
    }
  })
)

const monthLabel = computed(() =>
  new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${monthStart.value}T00:00:00Z`))
)

const weekdays = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

const kindColor = (kind: string) => ({
  booking: 'bg-primary/20 text-primary',
  blocked: 'bg-neutral-500/20 text-toned',
  external: 'bg-airbnb/20 text-airbnb'
}[kind] ?? '')

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
          <div class="grid grid-cols-7 gap-1 text-center text-xs text-muted mb-1">
            <div
              v-for="weekday in weekdays"
              :key="weekday"
            >
              {{ weekday }}
            </div>
          </div>
          <div class="grid grid-cols-7 gap-1 select-none">
            <button
              v-for="cell in grid"
              :key="cell.date"
              type="button"
              class="min-h-20 rounded-md border p-1 text-xs text-left flex flex-col"
              :class="[
                cell.inMonth ? '' : 'opacity-40',
                cell.closed ? 'border-dashed border-muted bg-elevated text-dimmed' : 'border-default',
                cell.block ? kindColor(cell.block.kind) : '',
                isSelected(cell.date) ? 'ring-2 ring-primary ring-offset-1 ring-offset-default' : ''
              ]"
              :aria-pressed="isSelected(cell.date)"
              @pointerdown="startSelection(cell.date, $event)"
              @pointerenter="extendSelection(cell.date)"
            >
              <span class="font-medium">{{ Number(cell.date.slice(8)) }}</span>

              <span
                v-if="cell.block"
                class="mt-0.5 truncate"
                :title="cell.block.label"
              >
                {{ cell.block.label }}
              </span>
              <span
                v-else-if="cell.closed"
                class="mt-0.5 truncate"
              >
                Cerrado
              </span>
              <span
                v-else-if="cell.open && mode === 'closed'"
                class="mt-0.5 truncate text-success"
                :title="cell.open.note ?? 'Abierto'"
              >
                {{ cell.open.note ?? 'Abierto' }}
              </span>

              <span
                v-if="cell.rate"
                class="mt-auto pt-1 tabular-nums"
                :class="cell.rate.overridden ? 'font-semibold text-warning' : 'text-muted'"
                :title="cell.rate.overridden ? cell.rate.note ?? 'Precio fijado a mano' : 'Tarifa calculada'"
              >
                {{ formatMoney(cell.rate.nightly_cents, currency) }}
              </span>
            </button>
          </div>

          <div class="mt-4 flex flex-wrap gap-4 text-xs text-muted">
            <span class="flex items-center gap-1">
              <span class="size-3 rounded bg-primary/40" /> Reserva directa
            </span>
            <span class="flex items-center gap-1">
              <span class="size-3 rounded bg-airbnb/40" /> Canal externo
            </span>
            <span class="flex items-center gap-1">
              <span class="size-3 rounded bg-neutral-500/40" /> Bloqueo manual
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
            Haz clic en cada noche para irlas sumando, arrastra para tramos enteros, Mayúsculas amplía y Esc deselecciona. Volver a marcar una noche la quita.
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

      <!-- Bulk edit of the selected nights -->
      <UModal
        v-model:open="showBulkModal"
        :title="`Editar ${selection.length} noche(s)`"
        description="Lo que dejes en blanco se queda como está. El precio manda sobre la temporada y la tarifa base, y no se le suma el recargo de fin de semana."
      >
        <template #body>
          <div class="flex flex-col gap-3">
            <UFormField
              label="Precio por noche (€)"
              hint="En blanco: sin cambios"
            >
              <UInput
                v-model="bulk.nightly"
                placeholder="Sin cambios"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Estancia mínima (noches)"
              hint="En blanco: sin cambios"
            >
              <UInput
                v-model="bulk.minNights"
                placeholder="Sin cambios"
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
