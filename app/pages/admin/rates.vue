<script setup lang="ts">
/**
 * Rate card: the base price lives in Ajustes; this page manages the seasons
 * that override it. Highest priority wins on overlapping dates.
 */
defineI18nRoute(false)
definePageMeta({ layout: 'admin', middleware: 'admin' })

interface RatePeriod {
  id: string
  name: string
  start_date: string
  end_date: string
  nightly_cents: number
  min_nights: number | null
  weekend_uplift_pct: number | null
  priority: number
  active: boolean
}

const supabase = useDb()
const toast = useToast()

const busy = ref(false)
const showForm = ref(false)
const editing = ref<RatePeriod | null>(null)

const form = reactive({
  name: '',
  start_date: '',
  end_date: '',
  nightly: '',
  min_nights: '' as string | number,
  weekend_uplift_pct: '' as string | number,
  priority: 10,
  active: true
})

const { data: periods, refresh, pending } = await useAsyncData<RatePeriod[]>('admin-rates', async () => {
  const { data } = await supabase.from('rate_periods').select('*').order('start_date')
  return (data ?? []) as RatePeriod[]
})

const { data: settings } = await useAsyncData('admin-rates-settings', async () => {
  const { data } = await supabase.from('app_settings').select('*').eq('id', 1).single()
  return data as { currency: string, base_nightly_cents: number, min_nights: number } | null
})

function openCreate() {
  editing.value = null
  Object.assign(form, {
    name: '',
    start_date: '',
    end_date: '',
    nightly: '',
    min_nights: '',
    weekend_uplift_pct: '',
    priority: 10,
    active: true
  })
  showForm.value = true
}

function openEdit(period: RatePeriod) {
  editing.value = period
  Object.assign(form, {
    name: period.name,
    start_date: period.start_date,
    end_date: period.end_date,
    nightly: String(fromCents(period.nightly_cents)),
    min_nights: period.min_nights ?? '',
    weekend_uplift_pct: period.weekend_uplift_pct ?? '',
    priority: period.priority,
    active: period.active
  })
  showForm.value = true
}

async function save() {
  if (!form.name.trim() || !form.start_date || !form.end_date || form.end_date < form.start_date) {
    toast.add({ title: 'Revisa el nombre y las fechas', color: 'error' })
    return
  }

  busy.value = true
  const payload = {
    name: form.name.trim(),
    start_date: form.start_date,
    end_date: form.end_date,
    nightly_cents: toCents(form.nightly || '0'),
    min_nights: form.min_nights === '' ? null : Number(form.min_nights),
    weekend_uplift_pct: form.weekend_uplift_pct === '' ? null : Number(form.weekend_uplift_pct),
    priority: Number(form.priority),
    active: form.active
  }

  const { error } = editing.value
    ? await supabase.from('rate_periods').update(payload).eq('id', editing.value.id)
    : await supabase.from('rate_periods').insert(payload)

  busy.value = false

  if (error) {
    toast.add({ title: 'No se pudo guardar', description: error.message, color: 'error' })
    return
  }
  toast.add({ title: 'Temporada guardada', color: 'success' })
  showForm.value = false
  await refresh()
}

async function remove(period: RatePeriod) {
  if (!confirm(`¿Eliminar la temporada "${period.name}"?`)) return
  const { error } = await supabase.from('rate_periods').delete().eq('id', period.id)
  if (error) {
    toast.add({ title: 'No se pudo eliminar', description: error.message, color: 'error' })
    return
  }
  await refresh()
}

async function toggle(period: RatePeriod) {
  await supabase.from('rate_periods').update({ active: !period.active }).eq('id', period.id)
  await refresh()
}

useSeoMeta({ title: 'Precios · Bonaire Patacona', robots: 'noindex, nofollow' })
</script>

<template>
  <UDashboardPanel id="admin-rates">
    <template #header>
      <UDashboardNavbar title="Precios y temporadas">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-plus"
            @click="openCreate"
          >
            Nueva temporada
          </UButton>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-6">
        <UAlert
          color="neutral"
          variant="subtle"
          icon="i-lucide-info"
          :title="`Tarifa base: ${formatMoney(settings?.base_nightly_cents ?? 0, settings?.currency ?? 'EUR')} por noche`"
          description="Las temporadas sustituyen la tarifa base en sus fechas. Si dos temporadas se solapan, gana la de mayor prioridad. Por encima de todo esto manda el precio que fijes a mano en el Calendario. La tarifa base se cambia en Ajustes."
        />

        <USkeleton
          v-if="pending"
          class="h-48 w-full"
        />

        <p
          v-else-if="!periods?.length"
          class="text-sm text-muted"
        >
          Todavía no hay temporadas. Toda el año se cobra la tarifa base.
        </p>

        <div
          v-else
          class="overflow-x-auto"
        >
          <table class="w-full text-sm">
            <thead class="text-left text-muted border-b border-default">
              <tr>
                <th class="py-2 pr-4 font-medium">
                  Temporada
                </th>
                <th class="py-2 pr-4 font-medium">
                  Fechas
                </th>
                <th class="py-2 pr-4 font-medium text-right">
                  Por noche
                </th>
                <th class="py-2 pr-4 font-medium text-right">
                  Mín. noches
                </th>
                <th class="py-2 pr-4 font-medium text-right">
                  Prioridad
                </th>
                <th class="py-2 pr-4 font-medium" />
              </tr>
            </thead>
            <tbody class="divide-y divide-default">
              <tr
                v-for="period in periods"
                :key="period.id"
                :class="period.active ? '' : 'opacity-50'"
              >
                <td class="py-2 pr-4 font-medium text-highlighted">
                  {{ period.name }}
                </td>
                <td class="py-2 pr-4 whitespace-nowrap">
                  {{ formatDate(period.start_date) }} → {{ formatDate(period.end_date) }}
                </td>
                <td class="py-2 pr-4 text-right">
                  {{ formatMoney(period.nightly_cents, settings?.currency ?? 'EUR') }}
                </td>
                <td class="py-2 pr-4 text-right">
                  {{ period.min_nights ?? '—' }}
                </td>
                <td class="py-2 pr-4 text-right">
                  {{ period.priority }}
                </td>
                <td class="py-2 pr-4">
                  <div class="flex justify-end gap-1">
                    <UButton
                      :icon="period.active ? 'i-lucide-eye' : 'i-lucide-eye-off'"
                      size="xs"
                      variant="ghost"
                      color="neutral"
                      :aria-label="period.active ? 'Desactivar' : 'Activar'"
                      @click="toggle(period)"
                    />
                    <UButton
                      icon="i-lucide-pencil"
                      size="xs"
                      variant="ghost"
                      color="neutral"
                      aria-label="Editar"
                      @click="openEdit(period)"
                    />
                    <UButton
                      icon="i-lucide-trash-2"
                      size="xs"
                      variant="ghost"
                      color="error"
                      aria-label="Eliminar"
                      @click="remove(period)"
                    />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <UModal
        v-model:open="showForm"
        :title="editing ? 'Editar temporada' : 'Nueva temporada'"
      >
        <template #body>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField
              label="Nombre"
              required
              class="sm:col-span-2"
            >
              <UInput
                v-model="form.name"
                placeholder="Temporada alta 2027"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Desde"
              required
            >
              <UInput
                v-model="form.start_date"
                type="date"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Hasta (incluido)"
              required
            >
              <UInput
                v-model="form.end_date"
                type="date"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Precio por noche (€)"
              required
            >
              <UInput
                v-model="form.nightly"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Mínimo de noches"
              hint="Vacío = el general"
            >
              <UInput
                v-model="form.min_nights"
                type="number"
                min="1"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Recargo fin de semana (%)"
              hint="Vacío = el general"
            >
              <UInput
                v-model="form.weekend_uplift_pct"
                type="number"
                min="0"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Prioridad"
              hint="Gana la más alta"
            >
              <UInput
                v-model="form.priority"
                type="number"
                class="w-full"
              />
            </UFormField>
            <UFormField class="sm:col-span-2">
              <UCheckbox
                v-model="form.active"
                label="Activa"
              />
            </UFormField>
          </div>
        </template>
        <template #footer>
          <div class="flex justify-end gap-2 w-full">
            <UButton
              color="neutral"
              variant="ghost"
              @click="showForm = false"
            >
              Cancelar
            </UButton>
            <UButton
              :loading="busy"
              @click="save"
            >
              Guardar
            </UButton>
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
