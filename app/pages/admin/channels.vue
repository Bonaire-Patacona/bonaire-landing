<script setup lang="ts">
/**
 * Two-way channel sync.
 *   Outbound: the .ics URL below is imported by Airbnb / Booking.com.
 *   Inbound:  each feed added here is pulled every 30 minutes.
 */
defineI18nRoute(false)
definePageMeta({ layout: 'admin', middleware: 'admin' })

interface Feed {
  id: string
  name: string
  channel: string
  url: string
  active: boolean
  last_synced_at: string | null
  last_status: string | null
  last_error: string | null
  events_count: number
}

const supabase = useDb()
const { authFetch } = useAdminApi()
const toast = useToast()

const busy = ref(false)
const syncing = ref(false)
const showForm = ref(false)
const form = reactive({ name: '', channel: 'airbnb', url: '', active: true })

const { data: feeds, refresh, pending } = await useAsyncData<Feed[]>('admin-feeds', async () => {
  const { data } = await supabase.from('ical_feeds').select('*').order('name')
  return (data ?? []) as Feed[]
})

const { data: overview, refresh: refreshOverview } = await useAsyncData(
  'admin-export-url',
  () => authFetch<{ ical_export_url: string }>('/api/admin/overview')
)

const exportUrl = computed(() => overview.value?.ical_export_url ?? '')

const channelOptions = [
  { label: 'Airbnb', value: 'airbnb' },
  { label: 'Booking.com', value: 'booking' },
  { label: 'Vrbo', value: 'vrbo' },
  { label: 'Otro', value: 'other' }
]

async function copyExportUrl() {
  await navigator.clipboard?.writeText(exportUrl.value)
  toast.add({ title: 'URL copiada', color: 'success' })
}

async function addFeed() {
  if (!form.name.trim() || !/^https?:\/\//.test(form.url.trim())) {
    toast.add({ title: 'Necesitas un nombre y una URL válida', color: 'error' })
    return
  }
  busy.value = true
  const { error } = await supabase.from('ical_feeds').insert({
    name: form.name.trim(),
    channel: form.channel,
    url: form.url.trim(),
    active: form.active
  })
  busy.value = false

  if (error) {
    toast.add({ title: 'No se pudo añadir', description: error.message, color: 'error' })
    return
  }
  showForm.value = false
  Object.assign(form, { name: '', channel: 'airbnb', url: '', active: true })
  await refresh()
  await syncNow()
}

async function removeFeed(feed: Feed) {
  if (!confirm(`¿Eliminar "${feed.name}"? También se borrarán sus bloqueos importados.`)) return
  const { error } = await supabase.from('ical_feeds').delete().eq('id', feed.id)
  if (error) {
    toast.add({ title: 'No se pudo eliminar', description: error.message, color: 'error' })
    return
  }
  await refresh()
}

async function toggleFeed(feed: Feed) {
  await supabase.from('ical_feeds').update({ active: !feed.active }).eq('id', feed.id)
  await refresh()
}

async function syncNow() {
  syncing.value = true
  try {
    const result = await authFetch<{ synced: number }>('/api/admin/sync-channels', { method: 'POST' })
    toast.add({ title: `${result.synced} calendario(s) sincronizado(s)`, color: 'success' })
    await refresh()
  } catch {
    toast.add({ title: 'La sincronización ha fallado', color: 'error' })
  } finally {
    syncing.value = false
  }
}

async function rotateToken() {
  if (!confirm('Al rotar el token, la URL actual deja de funcionar y tendrás que volver a pegarla en Airbnb y Booking.com. ¿Continuar?')) return
  busy.value = true
  try {
    await authFetch('/api/admin/rotate-ical-token', { method: 'POST' })
    await refreshOverview()
    toast.add({ title: 'Token rotado. Actualiza la URL en cada canal.', color: 'warning' })
  } finally {
    busy.value = false
  }
}

useSeoMeta({ title: 'Canales · Bonaire Patacona', robots: 'noindex, nofollow' })
</script>

<template>
  <UDashboardPanel id="admin-channels">
    <template #header>
      <UDashboardNavbar title="Canales y sincronización">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-refresh-cw"
            variant="subtle"
            :loading="syncing"
            @click="syncNow"
          >
            Sincronizar ahora
          </UButton>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-6">
        <!-- Outbound -->
        <UCard>
          <template #header>
            <h2 class="font-semibold text-highlighted">
              1 · Exportar nuestro calendario
            </h2>
          </template>

          <div class="flex flex-col gap-3 text-sm">
            <p class="text-muted">
              Pega esta URL en <strong>Airbnb → Calendario → Disponibilidad → Sincronizar calendarios → Importar</strong>
              y en <strong>Booking.com → Extranet → Tarifas y disponibilidad → Sincronización de calendarios</strong>.
              Incluye las reservas directas y los bloqueos manuales; nunca los nombres de los huéspedes.
            </p>

            <div class="flex flex-wrap gap-2">
              <UInput
                :model-value="exportUrl"
                readonly
                class="flex-1 min-w-64 font-mono text-xs"
              />
              <UButton
                icon="i-lucide-copy"
                variant="subtle"
                @click="copyExportUrl"
              >
                Copiar
              </UButton>
              <UButton
                icon="i-lucide-rotate-ccw"
                variant="subtle"
                color="warning"
                :loading="busy"
                @click="rotateToken"
              >
                Rotar token
              </UButton>
            </div>
          </div>
        </UCard>

        <!-- Inbound -->
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="font-semibold text-highlighted">
                2 · Importar los calendarios de los canales
              </h2>
              <UButton
                icon="i-lucide-plus"
                size="sm"
                @click="showForm = true"
              >
                Añadir calendario
              </UButton>
            </div>
          </template>

          <USkeleton
            v-if="pending"
            class="h-32 w-full"
          />

          <p
            v-else-if="!feeds?.length"
            class="text-sm text-muted"
          >
            Añade aquí la URL .ics que te da cada canal para exportar su calendario.
            Se consultan automáticamente cada 30 minutos.
          </p>

          <div
            v-else
            class="divide-y divide-default"
          >
            <div
              v-for="feed in feeds"
              :key="feed.id"
              class="flex flex-wrap items-start justify-between gap-3 py-3"
              :class="feed.active ? '' : 'opacity-50'"
            >
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <p class="font-medium text-highlighted">
                    {{ feed.name }}
                  </p>
                  <UBadge
                    variant="subtle"
                    color="neutral"
                    size="sm"
                  >
                    {{ feed.channel }}
                  </UBadge>
                  <UBadge
                    :color="feed.last_status === 'ok' ? 'success' : feed.last_status === 'error' ? 'error' : 'neutral'"
                    variant="subtle"
                    size="sm"
                  >
                    {{ feed.last_status ?? 'pendiente' }}
                  </UBadge>
                </div>
                <p class="text-xs text-muted truncate font-mono">
                  {{ feed.url }}
                </p>
                <p class="text-xs text-muted">
                  {{ feed.events_count }} bloqueos ·
                  {{ feed.last_synced_at ? new Date(feed.last_synced_at).toLocaleString('es-ES') : 'nunca sincronizado' }}
                </p>
                <p
                  v-if="feed.last_error"
                  class="text-xs text-error mt-1"
                >
                  {{ feed.last_error }}
                </p>
              </div>
              <div class="flex gap-1">
                <UButton
                  :icon="feed.active ? 'i-lucide-eye' : 'i-lucide-eye-off'"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  :aria-label="feed.active ? 'Desactivar' : 'Activar'"
                  @click="toggleFeed(feed)"
                />
                <UButton
                  icon="i-lucide-trash-2"
                  size="xs"
                  variant="ghost"
                  color="error"
                  aria-label="Eliminar"
                  @click="removeFeed(feed)"
                />
              </div>
            </div>
          </div>
        </UCard>
      </div>

      <UModal
        v-model:open="showForm"
        title="Añadir calendario externo"
      >
        <template #body>
          <div class="flex flex-col gap-3">
            <UFormField
              label="Nombre"
              required
            >
              <UInput
                v-model="form.name"
                placeholder="Airbnb — Bonaire Patacona"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Canal"
              required
            >
              <USelect
                v-model="form.channel"
                :items="channelOptions"
                value-key="value"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="URL .ics"
              required
            >
              <UInput
                v-model="form.url"
                placeholder="https://www.airbnb.com/calendar/ical/..."
                class="w-full"
              />
            </UFormField>
            <UCheckbox
              v-model="form.active"
              label="Sincronizar automáticamente"
            />
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
              @click="addFeed"
            >
              Añadir y sincronizar
            </UButton>
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
