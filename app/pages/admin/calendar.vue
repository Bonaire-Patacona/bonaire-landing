<script setup lang="ts">
/**
 * Month grid showing everything that occupies the apartment, whatever its
 * origin: direct bookings, manual blocks and imported channel events.
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

const supabase = useDb()
const toast = useToast()

const cursor = ref(todayIso().slice(0, 7)) // YYYY-MM
const showBlockModal = ref(false)
const busy = ref(false)
const newBlock = reactive({ start_date: '', end_date: '', reason: '' })

const monthStart = computed(() => `${cursor.value}-01`)
const monthEnd = computed(() => {
  const [year, month] = cursor.value.split('-').map(Number)
  return toIsoDate(new Date(Date.UTC(year!, month!, 1)))
})

const { data: blocks, refresh, pending } = await useAsyncData<Block[]>(
  'admin-calendar',
  async () => {
    const { data } = await supabase
      .from('calendar_blocks')
      .select('*')
      .lt('start_date', monthEnd.value)
      .gt('end_date', monthStart.value)
    return (data ?? []) as Block[]
  },
  { watch: [cursor] }
)

/** date -> the block occupying that night, if any */
const occupancy = computed(() => {
  const map = new Map<string, Block>()
  for (const block of blocks.value ?? []) {
    for (const night of eachNight(block.start_date, block.end_date)) {
      if (night >= monthStart.value && night < monthEnd.value) map.set(night, block)
    }
  }
  return map
})

/** Six-week grid starting on the Monday before the 1st. */
const grid = computed(() => {
  const first = new Date(`${monthStart.value}T00:00:00Z`)
  const offset = (first.getUTCDay() + 6) % 7 // Monday = 0
  const start = addDays(monthStart.value, -offset)
  return Array.from({ length: 42 }, (_, i) => {
    const date = addDays(start, i)
    return {
      date,
      inMonth: date >= monthStart.value && date < monthEnd.value,
      block: occupancy.value.get(date) ?? null
    }
  })
})

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
}

async function createBlock() {
  if (!newBlock.start_date || !newBlock.end_date || newBlock.end_date <= newBlock.start_date) {
    toast.add({ title: 'Las fechas no son válidas', color: 'error' })
    return
  }
  busy.value = true
  const { error } = await supabase.from('blocked_dates').insert({
    start_date: newBlock.start_date,
    end_date: newBlock.end_date,
    reason: newBlock.reason || null
  })
  busy.value = false

  if (error) {
    toast.add({ title: 'No se pudo bloquear', description: error.message, color: 'error' })
    return
  }
  toast.add({ title: 'Fechas bloqueadas', color: 'success' })
  showBlockModal.value = false
  Object.assign(newBlock, { start_date: '', end_date: '', reason: '' })
  await refresh()
}

async function removeBlock(block: Block) {
  if (block.kind !== 'blocked') return
  if (!confirm('¿Eliminar este bloqueo?')) return
  const { error } = await supabase.from('blocked_dates').delete().eq('id', block.source_id)
  if (error) {
    toast.add({ title: 'No se pudo eliminar', description: error.message, color: 'error' })
    return
  }
  await refresh()
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
          <div class="grid grid-cols-7 gap-1">
            <div
              v-for="cell in grid"
              :key="cell.date"
              class="min-h-20 rounded-md border border-default p-1 text-xs"
              :class="[cell.inMonth ? '' : 'opacity-40', cell.block ? kindColor(cell.block.kind) : '']"
            >
              <div class="flex items-start justify-between">
                <span class="font-medium">{{ Number(cell.date.slice(8)) }}</span>
                <UButton
                  v-if="cell.block?.kind === 'blocked'"
                  icon="i-lucide-trash-2"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  aria-label="Eliminar bloqueo"
                  @click="removeBlock(cell.block)"
                />
              </div>
              <p
                v-if="cell.block"
                class="mt-1 truncate"
                :title="cell.block.label"
              >
                {{ cell.block.label }}
              </p>
            </div>
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
          </div>
        </div>
      </div>

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
