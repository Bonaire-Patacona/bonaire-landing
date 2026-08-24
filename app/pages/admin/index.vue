<script setup lang="ts">
defineI18nRoute(false)
definePageMeta({ layout: 'admin', middleware: 'admin' })

interface Overview {
  currency: string
  stripe_ready: boolean
  ical_export_url: string
  pending_count: number
  upcoming_count: number
  month_revenue_cents: number
  month_collected_cents: number
  upcoming: Array<{
    id: string
    reference: string
    guest_name: string
    check_in: string
    check_out: string
    status: string
    total_cents: number
    currency: string
    source: string
  }>
  feeds: Array<{
    id: string
    name: string
    channel: string
    active: boolean
    last_synced_at: string | null
    last_status: string | null
    last_error: string | null
    events_count: number
  }>
}

const { authFetch } = useAdminApi()
const toast = useToast()
const syncing = ref(false)

const { data, refresh, pending } = await useAsyncData('admin-overview', () =>
  authFetch<Overview>('/api/admin/overview'))

const money = (cents: number) => formatMoney(cents, data.value?.currency ?? 'EUR')

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

useSeoMeta({ title: 'Panel · Bonaire Patacona', robots: 'noindex, nofollow' })
</script>

<template>
  <UDashboardPanel id="admin-home">
    <template #header>
      <UDashboardNavbar title="Panel">
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
            Sincronizar canales
          </UButton>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-6">
        <UAlert
          v-if="data && !data.stripe_ready"
          color="warning"
          variant="subtle"
          icon="i-lucide-credit-card"
          title="Stripe no está configurado"
          description="Sin STRIPE_SECRET_KEY el motor acepta reservas pero no puede cobrar el depósito."
        />

        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <UCard
            v-for="stat in [
              { label: 'Pendientes de pago', value: data?.pending_count ?? 0, icon: 'i-lucide-hourglass' },
              { label: 'Llegadas (30 días)', value: data?.upcoming_count ?? 0, icon: 'i-lucide-plane-landing' },
              { label: 'Facturado este mes', value: money(data?.month_revenue_cents ?? 0), icon: 'i-lucide-euro' },
              { label: 'Cobrado este mes', value: money(data?.month_collected_cents ?? 0), icon: 'i-lucide-wallet' }
            ]"
            :key="stat.label"
          >
            <div class="flex items-center gap-3">
              <UIcon
                :name="stat.icon"
                class="size-8 text-primary shrink-0"
              />
              <div class="min-w-0">
                <p class="text-xs text-muted truncate">
                  {{ stat.label }}
                </p>
                <p class="text-xl font-semibold text-highlighted">
                  {{ stat.value }}
                </p>
              </div>
            </div>
          </UCard>
        </div>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="font-semibold text-highlighted">
                Próximas estancias
              </h2>
              <UButton
                to="/admin/bookings"
                variant="link"
                size="xs"
              >
                Ver todas
              </UButton>
            </div>
          </template>

          <USkeleton
            v-if="pending"
            class="h-32 w-full"
          />
          <p
            v-else-if="!data?.upcoming?.length"
            class="text-sm text-muted"
          >
            No hay reservas próximas.
          </p>
          <div
            v-else
            class="divide-y divide-default"
          >
            <div
              v-for="booking in data.upcoming"
              :key="booking.id"
              class="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div class="min-w-0">
                <p class="font-medium text-highlighted truncate">
                  {{ booking.guest_name }}
                </p>
                <p class="text-xs text-muted">
                  {{ booking.reference }} · {{ formatDate(booking.check_in) }} → {{ formatDate(booking.check_out) }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <UBadge
                  variant="subtle"
                  color="neutral"
                  size="sm"
                >
                  {{ booking.source }}
                </UBadge>
                <UBadge
                  :color="booking.status === 'confirmed' ? 'success' : 'warning'"
                  variant="subtle"
                  size="sm"
                >
                  {{ booking.status }}
                </UBadge>
                <span class="font-medium">{{ formatMoney(booking.total_cents, booking.currency) }}</span>
              </div>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-semibold text-highlighted">
              Estado de los canales
            </h2>
          </template>

          <p
            v-if="!data?.feeds?.length"
            class="text-sm text-muted"
          >
            Todavía no has conectado ningún calendario.
            <ULink to="/admin/channels">
              Conectar Airbnb o Booking.com
            </ULink>
          </p>
          <div
            v-else
            class="divide-y divide-default"
          >
            <div
              v-for="feed in data.feeds"
              :key="feed.id"
              class="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div class="min-w-0">
                <p class="font-medium text-highlighted truncate">
                  {{ feed.name }}
                </p>
                <p class="text-xs text-muted">
                  {{ feed.last_synced_at ? `Última sincronización: ${new Date(feed.last_synced_at).toLocaleString('es-ES')}` : 'Nunca sincronizado' }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <UBadge
                  variant="subtle"
                  size="sm"
                >
                  {{ feed.events_count }} bloqueos
                </UBadge>
                <UBadge
                  :color="feed.last_status === 'ok' ? 'success' : feed.last_status === 'error' ? 'error' : 'neutral'"
                  variant="subtle"
                  size="sm"
                >
                  {{ feed.last_status ?? 'pendiente' }}
                </UBadge>
              </div>
            </div>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
