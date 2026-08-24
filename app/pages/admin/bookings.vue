<script setup lang="ts">
defineI18nRoute(false)
definePageMeta({ layout: 'admin', middleware: 'admin' })

interface Booking {
  id: string
  reference: string
  status: string
  source: string
  check_in: string
  check_out: string
  adults: number
  children: number
  guest_name: string
  guest_email: string
  guest_phone: string | null
  notes: string | null
  currency: string
  total_cents: number
  amount_paid_cents: number
  balance_cents: number
  balance_due_date: string | null
  balance_payment_url: string | null
  balance_charge_status: string
  balance_next_attempt_at: string | null
  balance_last_error: string | null
  stripe_payment_method_id: string | null
  security_deposit_cents: number
  cancellation_policy: { code?: string, name?: string } | null
  refunded_cents: number
  created_at: string
}

const supabase = useDb()
const { authFetch } = useAdminApi()
const toast = useToast()

const statusFilter = ref('all')
const search = ref('')
const selected = ref<Booking | null>(null)
const busy = ref(false)
const showManual = ref(false)
const showDamages = ref(false)

const statusOptions = [
  { label: 'Todas', value: 'all' },
  { label: 'Pendientes', value: 'pending' },
  { label: 'Confirmadas', value: 'confirmed' },
  { label: 'Completadas', value: 'completed' },
  { label: 'Canceladas', value: 'cancelled' },
  { label: 'Caducadas', value: 'expired' }
]

const { data: bookings, refresh, pending } = await useAsyncData<Booking[]>(
  'admin-bookings',
  async () => {
    let query = supabase.from('bookings').select('*').order('check_in', { ascending: false }).limit(300)
    if (statusFilter.value !== 'all') query = query.eq('status', statusFilter.value)
    const { data } = await query
    return (data ?? []) as Booking[]
  },
  { watch: [statusFilter] }
)

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (!term) return bookings.value ?? []
  return (bookings.value ?? []).filter(b =>
    b.guest_name.toLowerCase().includes(term)
    || b.guest_email.toLowerCase().includes(term)
    || b.reference.toLowerCase().includes(term)
  )
})

const statusColor = (status: string) => ({
  confirmed: 'success',
  completed: 'success',
  pending: 'warning',
  cancelled: 'error',
  expired: 'neutral'
}[status] ?? 'neutral') as 'success' | 'warning' | 'error' | 'neutral'

const { data: settings } = await useAsyncData('admin-bookings-settings', async () => {
  const { data } = await supabase
    .from('app_settings').select('security_deposit_mode').eq('id', 1).single()
  return data as { security_deposit_mode: 'none' | 'card_on_file' } | null
})

/** A card is only on file when the guest paid through Stripe with one saved. */
const canChargeCard = (booking: Booking) =>
  settings.value?.security_deposit_mode === 'card_on_file' && Boolean(booking.stripe_payment_method_id)

// --- automatic balance collection -------------------------------------------
const chargeColor = (status: string) => ({
  scheduled: 'info',
  processing: 'info',
  succeeded: 'success',
  requires_action: 'warning',
  failed: 'error'
}[status] ?? 'neutral') as 'success' | 'warning' | 'error' | 'info' | 'neutral'

function chargeLabel(booking: Booking): string {
  switch (booking.balance_charge_status) {
    case 'scheduled':
      return booking.balance_next_attempt_at
        ? `Se cobrará solo el ${formatDate(booking.balance_next_attempt_at.slice(0, 10))}`
        : 'Cobro automático programado'
    case 'processing':
      return 'Cobrándose ahora'
    case 'succeeded':
      return 'Cobrado con la tarjeta guardada'
    case 'requires_action':
      return 'El banco pide autenticación: hay que enviar el enlace de pago'
    case 'failed':
      return 'El cobro automático no salió: hay que enviar el enlace de pago'
    case 'manual':
      return 'Sin tarjeta guardada: el resto se cobra a mano'
    default:
      return 'Nada pendiente'
  }
}

// --- manual booking ---------------------------------------------------------
const manual = reactive({
  check_in: '',
  check_out: '',
  guest_name: '',
  guest_email: '',
  guest_phone: '',
  adults: 2,
  children: 0,
  source: 'manual',
  total: '',
  paid: '',
  notes: ''
})

async function createManual() {
  busy.value = true
  try {
    await authFetch('/api/admin/bookings/manual', {
      method: 'POST',
      body: {
        ...manual,
        total_cents: manual.total ? toCents(manual.total) : undefined,
        amount_paid_cents: manual.paid ? toCents(manual.paid) : 0
      }
    })
    toast.add({ title: 'Reserva creada', color: 'success' })
    showManual.value = false
    await refresh()
  } catch (error) {
    toast.add({
      title: 'No se pudo crear la reserva',
      description: (error as { data?: { statusMessage?: string } }).data?.statusMessage,
      color: 'error'
    })
  } finally {
    busy.value = false
  }
}

// --- actions on an existing booking ------------------------------------------
async function createBalanceLink(booking: Booking) {
  busy.value = true
  try {
    const result = await authFetch<{ url: string }>(`/api/admin/bookings/${booking.id}/balance-link`, {
      method: 'POST'
    })
    await navigator.clipboard?.writeText(result.url).catch(() => {})
    toast.add({ title: 'Enlace de pago creado y copiado', color: 'success' })
    await refresh()
    selected.value = null
  } catch (error) {
    toast.add({
      title: 'No se pudo crear el enlace',
      description: (error as { data?: { statusMessage?: string } }).data?.statusMessage,
      color: 'error'
    })
  } finally {
    busy.value = false
  }
}

// --- damage deposit ----------------------------------------------------------
const damages = reactive({ amount: '', reason: '' })

function openDamages(booking: Booking) {
  damages.amount = String(fromCents(booking.security_deposit_cents || 0))
  damages.reason = ''
  showDamages.value = true
}

async function chargeDamages(booking: Booking) {
  const amountCents = toCents(damages.amount)
  if (amountCents <= 0) {
    toast.add({ title: 'El importe tiene que ser mayor que cero', color: 'error' })
    return
  }
  if (!confirm(`¿Cobrar ${formatMoney(amountCents, booking.currency)} a la tarjeta guardada?`)) return

  busy.value = true
  try {
    await authFetch(`/api/admin/bookings/${booking.id}/security-deposit`, {
      method: 'POST',
      body: { amount_cents: amountCents, reason: damages.reason }
    })
    toast.add({ title: 'Cargo realizado', color: 'success' })
    showDamages.value = false
    await refresh()
  } catch (error) {
    toast.add({
      title: 'La tarjeta rechazó el cargo',
      description: (error as { data?: { statusMessage?: string } }).data?.statusMessage,
      color: 'error'
    })
  } finally {
    busy.value = false
  }
}

interface RefundPreview {
  policy: { code: string, name: string }
  amount_paid_cents: number
  currency: string
  refund_pct: number
  refund_cents: number
  days_before: number
}

/**
 * Asks the server what the policy on the booking says before anything is
 * refunded, so the host confirms a number rather than a guess.
 */
async function cancelBooking(booking: Booking, refund: boolean) {
  busy.value = true
  let question = '¿Cancelar la reserva sin reembolso?'

  try {
    if (refund) {
      const preview = await authFetch<RefundPreview>(`/api/admin/bookings/${booking.id}/cancel`, {
        method: 'POST',
        body: { dry_run: true }
      })
      question = preview.refund_cents > 0
        ? `La política «${preview.policy.name}» devuelve el ${preview.refund_pct}% `
        + `(${formatMoney(preview.refund_cents, preview.currency)} de `
        + `${formatMoney(preview.amount_paid_cents, preview.currency)}). ¿Cancelar y reembolsar?`
        : `La política «${preview.policy.name}» no da derecho a reembolso a `
          + `${preview.days_before} día(s) de la entrada. ¿Cancelar igualmente sin devolver nada?`
    }
  } catch {
    question = '¿Cancelar y reembolsar según la política?'
  }

  if (!confirm(question)) {
    busy.value = false
    return
  }

  try {
    await authFetch(`/api/admin/bookings/${booking.id}/cancel`, {
      method: 'POST',
      body: { refund, reason: 'Cancelada desde el panel' }
    })
    toast.add({ title: 'Reserva cancelada', color: 'success' })
    await refresh()
    selected.value = null
  } catch (error) {
    toast.add({
      title: 'No se pudo cancelar',
      description: (error as { data?: { statusMessage?: string } }).data?.statusMessage,
      color: 'error'
    })
  } finally {
    busy.value = false
  }
}

useSeoMeta({ title: 'Reservas · Bonaire Patacona', robots: 'noindex, nofollow' })
</script>

<template>
  <UDashboardPanel id="admin-bookings">
    <template #header>
      <UDashboardNavbar title="Reservas">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-plus"
            @click="showManual = true"
          >
            Reserva manual
          </UButton>
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar>
        <template #left>
          <USelect
            v-model="statusFilter"
            :items="statusOptions"
            value-key="value"
            class="w-44"
          />
        </template>
        <template #right>
          <UInput
            v-model="search"
            icon="i-lucide-search"
            placeholder="Buscar por nombre, email o referencia"
            class="w-72"
          />
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <USkeleton
        v-if="pending"
        class="h-64 w-full"
      />

      <p
        v-else-if="!filtered.length"
        class="text-sm text-muted"
      >
        No hay reservas que coincidan.
      </p>

      <div
        v-else
        class="overflow-x-auto"
      >
        <table class="w-full text-sm">
          <thead class="text-left text-muted border-b border-default">
            <tr>
              <th class="py-2 pr-4 font-medium">
                Referencia
              </th>
              <th class="py-2 pr-4 font-medium">
                Huésped
              </th>
              <th class="py-2 pr-4 font-medium">
                Fechas
              </th>
              <th class="py-2 pr-4 font-medium">
                Origen
              </th>
              <th class="py-2 pr-4 font-medium">
                Estado
              </th>
              <th class="py-2 pr-4 font-medium text-right">
                Total
              </th>
              <th class="py-2 pr-4 font-medium text-right">
                Pendiente
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr
              v-for="booking in filtered"
              :key="booking.id"
              class="cursor-pointer hover:bg-elevated/50"
              @click="selected = booking"
            >
              <td class="py-2 pr-4 font-mono text-xs">
                {{ booking.reference }}
              </td>
              <td class="py-2 pr-4">
                <p class="font-medium text-highlighted">
                  {{ booking.guest_name }}
                </p>
                <p class="text-xs text-muted">
                  {{ booking.guest_email }}
                </p>
              </td>
              <td class="py-2 pr-4 whitespace-nowrap">
                {{ formatDate(booking.check_in) }} → {{ formatDate(booking.check_out) }}
              </td>
              <td class="py-2 pr-4">
                <UBadge
                  variant="subtle"
                  color="neutral"
                  size="sm"
                >
                  {{ booking.source }}
                </UBadge>
              </td>
              <td class="py-2 pr-4">
                <UBadge
                  :color="statusColor(booking.status)"
                  variant="subtle"
                  size="sm"
                >
                  {{ booking.status }}
                </UBadge>
              </td>
              <td class="py-2 pr-4 text-right">
                {{ formatMoney(booking.total_cents, booking.currency) }}
              </td>
              <td class="py-2 pr-4 text-right">
                {{ formatMoney(booking.total_cents - booking.amount_paid_cents, booking.currency) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Detail -->
      <USlideover
        :open="Boolean(selected)"
        :title="selected?.reference"
        @update:open="value => !value && (selected = null)"
      >
        <template #body>
          <div
            v-if="selected"
            class="flex flex-col gap-4 text-sm"
          >
            <div>
              <p class="text-lg font-semibold text-highlighted">
                {{ selected.guest_name }}
              </p>
              <p class="text-muted">
                {{ selected.guest_email }}
              </p>
              <p
                v-if="selected.guest_phone"
                class="text-muted"
              >
                {{ selected.guest_phone }}
              </p>
            </div>

            <UBadge
              :color="statusColor(selected.status)"
              variant="subtle"
              class="self-start"
            >
              {{ selected.status }}
            </UBadge>

            <USeparator />

            <dl class="grid grid-cols-2 gap-3">
              <div>
                <dt class="text-muted text-xs">
                  Entrada
                </dt>
                <dd>{{ formatDate(selected.check_in) }}</dd>
              </div>
              <div>
                <dt class="text-muted text-xs">
                  Salida
                </dt>
                <dd>{{ formatDate(selected.check_out) }}</dd>
              </div>
              <div>
                <dt class="text-muted text-xs">
                  Huéspedes
                </dt>
                <dd>{{ selected.adults + selected.children }}</dd>
              </div>
              <div>
                <dt class="text-muted text-xs">
                  Origen
                </dt>
                <dd>{{ selected.source }}</dd>
              </div>
              <div>
                <dt class="text-muted text-xs">
                  Total
                </dt>
                <dd>{{ formatMoney(selected.total_cents, selected.currency) }}</dd>
              </div>
              <div>
                <dt class="text-muted text-xs">
                  Cobrado
                </dt>
                <dd>{{ formatMoney(selected.amount_paid_cents, selected.currency) }}</dd>
              </div>
              <div v-if="selected.refunded_cents > 0">
                <dt class="text-muted text-xs">
                  Reembolsado
                </dt>
                <dd>{{ formatMoney(selected.refunded_cents, selected.currency) }}</dd>
              </div>
              <div v-if="selected.cancellation_policy?.name">
                <dt class="text-muted text-xs">
                  Cancelación
                </dt>
                <dd>{{ selected.cancellation_policy.name }}</dd>
              </div>
            </dl>

            <UAlert
              v-if="selected.notes"
              color="neutral"
              variant="subtle"
              icon="i-lucide-message-square"
              :description="selected.notes"
            />

            <UAlert
              v-if="selected.total_cents > selected.amount_paid_cents"
              :color="chargeColor(selected.balance_charge_status)"
              variant="subtle"
              icon="i-lucide-credit-card"
              :title="chargeLabel(selected)"
              :description="selected.balance_last_error ?? undefined"
            />

            <UAlert
              v-if="selected.balance_payment_url"
              color="info"
              variant="subtle"
              icon="i-lucide-link"
              title="Enlace de pago pendiente"
              :description="selected.balance_payment_url"
            />

            <USeparator />

            <div class="flex flex-col gap-2">
              <UButton
                v-if="selected.total_cents > selected.amount_paid_cents"
                icon="i-lucide-credit-card"
                :loading="busy"
                block
                @click="createBalanceLink(selected)"
              >
                Crear enlace para el importe pendiente
              </UButton>
              <UButton
                v-if="canChargeCard(selected)"
                color="neutral"
                variant="subtle"
                icon="i-lucide-shield"
                :loading="busy"
                block
                @click="openDamages(selected)"
              >
                Cobrar daños a la tarjeta guardada
              </UButton>
              <UButton
                v-if="!['cancelled', 'expired'].includes(selected.status)"
                color="warning"
                variant="subtle"
                icon="i-lucide-x"
                :loading="busy"
                block
                @click="cancelBooking(selected, false)"
              >
                Cancelar sin reembolso
              </UButton>
              <UButton
                v-if="!['cancelled', 'expired'].includes(selected.status) && selected.amount_paid_cents > 0"
                color="error"
                variant="subtle"
                icon="i-lucide-undo-2"
                :loading="busy"
                block
                @click="cancelBooking(selected, true)"
              >
                Cancelar y reembolsar
              </UButton>
            </div>
          </div>
        </template>
      </USlideover>

      <!-- Damage deposit -->
      <UModal
        v-model:open="showDamages"
        title="Cobrar daños"
        description="Se cobra a la tarjeta con la que se pagó la reserva. No hay ningún importe retenido."
      >
        <template #body>
          <div class="flex flex-col gap-3">
            <UFormField
              label="Importe (€)"
              required
            >
              <UInput
                v-model="damages.amount"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Concepto"
              hint="Aparece en el extracto del huésped"
            >
              <UInput
                v-model="damages.reason"
                placeholder="Rotura de la mesa de la terraza"
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
              @click="showDamages = false"
            >
              Cancelar
            </UButton>
            <UButton
              v-if="selected"
              color="error"
              :loading="busy"
              @click="chargeDamages(selected)"
            >
              Cobrar
            </UButton>
          </div>
        </template>
      </UModal>

      <!-- Manual booking -->
      <UModal
        v-model:open="showManual"
        title="Nueva reserva manual"
      >
        <template #body>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField
              label="Entrada"
              required
            >
              <UInput
                v-model="manual.check_in"
                type="date"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Salida"
              required
            >
              <UInput
                v-model="manual.check_out"
                type="date"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Nombre"
              required
              class="sm:col-span-2"
            >
              <UInput
                v-model="manual.guest_name"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Email">
              <UInput
                v-model="manual.guest_email"
                type="email"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Teléfono">
              <UInput
                v-model="manual.guest_phone"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Adultos">
              <UInputNumber
                v-model="manual.adults"
                :min="1"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Niños">
              <UInputNumber
                v-model="manual.children"
                :min="0"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Origen"
            >
              <USelect
                v-model="manual.source"
                :items="[
                  { label: 'Manual / directo', value: 'manual' },
                  { label: 'Airbnb', value: 'airbnb' },
                  { label: 'Booking.com', value: 'booking' },
                  { label: 'Vrbo', value: 'vrbo' },
                  { label: 'Otro', value: 'other' }
                ]"
                value-key="value"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Total (€)"
              hint="Vacío = tarifa del calendario"
            >
              <UInput
                v-model="manual.total"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Ya cobrado (€)">
              <UInput
                v-model="manual.paid"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Notas"
              class="sm:col-span-2"
            >
              <UTextarea
                v-model="manual.notes"
                :rows="2"
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
              @click="showManual = false"
            >
              Cancelar
            </UButton>
            <UButton
              :loading="busy"
              @click="createManual"
            >
              Crear
            </UButton>
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
