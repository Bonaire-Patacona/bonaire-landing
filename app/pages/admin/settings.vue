<script setup lang="ts">
/**
 * The single row in app_settings: base price, fees, stay rules, discounts and
 * the deposit policy. Everything the pricing engine reads lives here.
 */
defineI18nRoute(false)
definePageMeta({ layout: 'admin', middleware: 'admin' })

const supabase = useDb()
const toast = useToast()
const saving = ref(false)

interface Settings {
  id: number
  property_name: string
  contact_email: string | null
  currency: string
  base_nightly_cents: number
  weekend_uplift_pct: number
  cleaning_fee_cents: number
  tax_pct: number
  guests_included: number
  extra_guest_fee_cents: number
  max_guests: number
  min_nights: number
  max_nights: number
  advance_notice_days: number
  booking_window_days: number
  turnover_days: number
  checkin_time: string
  checkout_time: string
  weekly_discount_pct: number
  monthly_discount_pct: number
  deposit_type: 'percent' | 'fixed' | 'full'
  deposit_percent: number
  deposit_fixed_cents: number
  balance_due_days_before: number
  security_deposit_cents: number
  hold_minutes: number
  cancellation_policy: string
}

const { data: settings } = await useAsyncData<Settings>('admin-settings', async () => {
  const { data } = await supabase.from('app_settings').select('*').eq('id', 1).single()
  return data as unknown as Settings
})

// Money fields are edited in euros and stored in cents.
const form = reactive({
  property_name: '',
  contact_email: '',
  currency: 'EUR',
  base_nightly: '0',
  weekend_uplift_pct: 0,
  cleaning_fee: '0',
  tax_pct: 0,
  guests_included: 2,
  extra_guest_fee: '0',
  max_guests: 4,
  min_nights: 2,
  max_nights: 30,
  advance_notice_days: 1,
  booking_window_days: 540,
  turnover_days: 0,
  checkin_time: '16:00',
  checkout_time: '11:00',
  weekly_discount_pct: 0,
  monthly_discount_pct: 0,
  deposit_type: 'percent' as Settings['deposit_type'],
  deposit_percent: 30,
  deposit_fixed: '0',
  balance_due_days_before: 14,
  security_deposit: '0',
  hold_minutes: 30,
  cancellation_policy: ''
})

watchEffect(() => {
  const s = settings.value
  if (!s) return
  Object.assign(form, {
    property_name: s.property_name,
    contact_email: s.contact_email ?? '',
    currency: s.currency,
    base_nightly: String(fromCents(s.base_nightly_cents)),
    weekend_uplift_pct: Number(s.weekend_uplift_pct),
    cleaning_fee: String(fromCents(s.cleaning_fee_cents)),
    tax_pct: Number(s.tax_pct),
    guests_included: s.guests_included,
    extra_guest_fee: String(fromCents(s.extra_guest_fee_cents)),
    max_guests: s.max_guests,
    min_nights: s.min_nights,
    max_nights: s.max_nights,
    advance_notice_days: s.advance_notice_days,
    booking_window_days: s.booking_window_days,
    turnover_days: s.turnover_days,
    checkin_time: s.checkin_time,
    checkout_time: s.checkout_time,
    weekly_discount_pct: Number(s.weekly_discount_pct),
    monthly_discount_pct: Number(s.monthly_discount_pct),
    deposit_type: s.deposit_type,
    deposit_percent: Number(s.deposit_percent),
    deposit_fixed: String(fromCents(s.deposit_fixed_cents)),
    balance_due_days_before: s.balance_due_days_before,
    security_deposit: String(fromCents(s.security_deposit_cents)),
    hold_minutes: s.hold_minutes,
    cancellation_policy: s.cancellation_policy
  })
})

const depositPreview = computed(() => {
  const nights = 7
  const total = toCents(form.base_nightly) * nights + toCents(form.cleaning_fee)
  const deposit = form.deposit_type === 'full'
    ? total
    : form.deposit_type === 'fixed'
      ? Math.min(toCents(form.deposit_fixed), total)
      : Math.round((total * form.deposit_percent) / 100)
  return { total, deposit, balance: total - deposit }
})

async function save() {
  saving.value = true
  const { error } = await supabase.from('app_settings').update({
    property_name: form.property_name.trim(),
    contact_email: form.contact_email.trim() || null,
    currency: form.currency.trim().toUpperCase(),
    base_nightly_cents: toCents(form.base_nightly),
    weekend_uplift_pct: form.weekend_uplift_pct,
    cleaning_fee_cents: toCents(form.cleaning_fee),
    tax_pct: form.tax_pct,
    guests_included: form.guests_included,
    extra_guest_fee_cents: toCents(form.extra_guest_fee),
    max_guests: form.max_guests,
    min_nights: form.min_nights,
    max_nights: form.max_nights,
    advance_notice_days: form.advance_notice_days,
    booking_window_days: form.booking_window_days,
    turnover_days: form.turnover_days,
    checkin_time: form.checkin_time,
    checkout_time: form.checkout_time,
    weekly_discount_pct: form.weekly_discount_pct,
    monthly_discount_pct: form.monthly_discount_pct,
    deposit_type: form.deposit_type,
    deposit_percent: form.deposit_percent,
    deposit_fixed_cents: toCents(form.deposit_fixed),
    balance_due_days_before: form.balance_due_days_before,
    security_deposit_cents: toCents(form.security_deposit),
    hold_minutes: form.hold_minutes,
    cancellation_policy: form.cancellation_policy
  }).eq('id', 1)

  saving.value = false

  toast.add({
    title: error ? 'No se pudo guardar' : 'Ajustes guardados',
    description: error?.message,
    color: error ? 'error' : 'success'
  })
}

useSeoMeta({ title: 'Ajustes · Bonaire Patacona', robots: 'noindex, nofollow' })
</script>

<template>
  <UDashboardPanel id="admin-settings">
    <template #header>
      <UDashboardNavbar title="Ajustes">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-save"
            :loading="saving"
            @click="save"
          >
            Guardar
          </UButton>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-6 max-w-3xl">
        <UCard>
          <template #header>
            <h2 class="font-semibold text-highlighted">
              Alojamiento
            </h2>
          </template>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="Nombre">
              <UInput
                v-model="form.property_name"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Email de contacto">
              <UInput
                v-model="form.contact_email"
                type="email"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Moneda">
              <UInput
                v-model="form.currency"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Huéspedes máximos">
              <UInputNumber
                v-model="form.max_guests"
                :min="1"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Hora de entrada">
              <UInput
                v-model="form.checkin_time"
                type="time"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Hora de salida">
              <UInput
                v-model="form.checkout_time"
                type="time"
                class="w-full"
              />
            </UFormField>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-semibold text-highlighted">
              Precios
            </h2>
          </template>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField
              label="Tarifa base por noche (€)"
              hint="Las temporadas la sustituyen"
            >
              <UInput
                v-model="form.base_nightly"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Recargo viernes y sábado (%)"
            >
              <UInputNumber
                v-model="form.weekend_uplift_pct"
                :min="0"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Limpieza (€)">
              <UInput
                v-model="form.cleaning_fee"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Impuestos (%)"
              hint="0 si ya están incluidos"
            >
              <UInputNumber
                v-model="form.tax_pct"
                :min="0"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Huéspedes incluidos">
              <UInputNumber
                v-model="form.guests_included"
                :min="1"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Huésped adicional por noche (€)">
              <UInput
                v-model="form.extra_guest_fee"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Descuento semanal (%)">
              <UInputNumber
                v-model="form.weekly_discount_pct"
                :min="0"
                :max="100"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Descuento mensual (%)">
              <UInputNumber
                v-model="form.monthly_discount_pct"
                :min="0"
                :max="100"
                class="w-full"
              />
            </UFormField>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-semibold text-highlighted">
              Depósitos y cobros
            </h2>
          </template>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField
              label="Qué se cobra al reservar"
              class="sm:col-span-2"
            >
              <USelect
                v-model="form.deposit_type"
                :items="[
                  { label: 'Un porcentaje del total', value: 'percent' },
                  { label: 'Un importe fijo', value: 'fixed' },
                  { label: 'El total', value: 'full' }
                ]"
                value-key="value"
                class="w-full"
              />
            </UFormField>
            <UFormField
              v-if="form.deposit_type === 'percent'"
              label="Porcentaje (%)"
            >
              <UInputNumber
                v-model="form.deposit_percent"
                :min="0"
                :max="100"
                class="w-full"
              />
            </UFormField>
            <UFormField
              v-if="form.deposit_type === 'fixed'"
              label="Importe fijo (€)"
            >
              <UInput
                v-model="form.deposit_fixed"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Resto a pagar (días antes)"
              hint="Se genera un enlace de pago"
            >
              <UInputNumber
                v-model="form.balance_due_days_before"
                :min="0"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Fianza reembolsable (€)"
              hint="Informativa; se gestiona en la llegada"
            >
              <UInput
                v-model="form.security_deposit"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Minutos de reserva bloqueada"
              hint="Tiempo para completar el pago"
            >
              <UInputNumber
                v-model="form.hold_minutes"
                :min="5"
                class="w-full"
              />
            </UFormField>
          </div>

          <UAlert
            class="mt-4"
            color="neutral"
            variant="subtle"
            icon="i-lucide-calculator"
            title="Ejemplo: 7 noches a tarifa base"
            :description="`Total ${formatMoney(depositPreview.total, form.currency)} · al reservar ${formatMoney(depositPreview.deposit, form.currency)} · resto ${formatMoney(depositPreview.balance, form.currency)}`"
          />
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-semibold text-highlighted">
              Reglas de estancia
            </h2>
          </template>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="Noches mínimas">
              <UInputNumber
                v-model="form.min_nights"
                :min="1"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Noches máximas">
              <UInputNumber
                v-model="form.max_nights"
                :min="1"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Antelación mínima (días)"
            >
              <UInputNumber
                v-model="form.advance_notice_days"
                :min="0"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Ventana de reserva (días)"
              hint="Hasta cuándo se puede reservar"
            >
              <UInputNumber
                v-model="form.booking_window_days"
                :min="1"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Días de margen entre estancias"
              hint="0 = permite entrada el día de salida"
            >
              <UInputNumber
                v-model="form.turnover_days"
                :min="0"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Política de cancelación"
              class="sm:col-span-2"
            >
              <UTextarea
                v-model="form.cancellation_policy"
                :rows="3"
                class="w-full"
              />
            </UFormField>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
