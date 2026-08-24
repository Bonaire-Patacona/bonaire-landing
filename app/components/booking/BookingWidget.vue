<script setup lang="ts">
/**
 * Public booking widget: pick dates -> see the real price -> pay the deposit.
 *
 * Nothing here decides money. The calendar shows what the server published, the
 * summary shows what /api/quote returned, and the confirm button hands over to
 * a Stripe Checkout session created server-side.
 */
import type { DateRange } from 'reka-ui'
import { calendarDateToIso, isoToCalendarDate, useBookingEngine } from '~/composables/useBookingEngine'

const props = withDefaults(defineProps<{
  /** Prefill from the URL, e.g. /reservar?check_in=2026-07-04&check_out=2026-07-11 */
  initialCheckIn?: string
  initialCheckOut?: string
}>(), { initialCheckIn: undefined, initialCheckOut: undefined })

const { t, locale } = useI18n()
const localePath = useLocalePath()
const toast = useToast()

const {
  availability,
  quote,
  quoteError,
  loadingAvailability,
  loadingQuote,
  loadAvailability,
  fetchQuote,
  isDateUnavailable
} = useBookingEngine()

// shallowRef, not ref: DateValue instances carry private fields that Vue's deep
// unwrapping would strip, and the calendar replaces the whole range anyway.
const range = shallowRef<DateRange | null>(
  props.initialCheckIn && props.initialCheckOut
    ? { start: isoToCalendarDate(props.initialCheckIn), end: isoToCalendarDate(props.initialCheckOut) }
    : null
)
const adults = ref(2)
const children = ref(0)
const submitting = ref(false)
const showGuestForm = ref(false)

const guest = reactive({
  guest_name: '',
  guest_email: '',
  guest_phone: '',
  guest_country: '',
  notes: '',
  accepts_terms: false
})

const checkIn = computed(() => (range.value?.start ? calendarDateToIso(range.value.start) : null))
const checkOut = computed(() => (range.value?.end ? calendarDateToIso(range.value.end) : null))
const maxGuests = computed(() => availability.value?.max_guests ?? 4)
const currency = computed(() => quote.value?.currency ?? availability.value?.currency ?? 'EUR')
const localeTag = computed(() => `${locale.value}-${locale.value === 'en' ? 'GB' : locale.value.toUpperCase()}`)

const money = (cents: number) => formatMoney(cents, currency.value, localeTag.value)
const day = (iso: string | null) => (iso ? formatDate(iso, localeTag.value) : '')

const minCalendarDate = computed(() =>
  isoToCalendarDate(addDays(todayIso(), availability.value?.advance_notice_days ?? 1))
)
const maxCalendarDate = computed(() => isoToCalendarDate(addDays(todayIso(), 540)))

const canSubmit = computed(() =>
  Boolean(quote.value?.available)
  && guest.guest_name.trim().length > 1
  && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(guest.guest_email.trim())
  && guest.accepts_terms
  && !submitting.value
)

await loadAvailability()

// Re-price whenever the stay or the party changes.
watch([checkIn, checkOut, adults, children], async () => {
  if (!checkIn.value || !checkOut.value || checkIn.value >= checkOut.value) {
    quote.value = null
    return
  }
  await fetchQuote({
    checkIn: checkIn.value,
    checkOut: checkOut.value,
    adults: adults.value,
    children: children.value
  })
}, { immediate: true })

// Keep the party size within what the apartment sleeps.
watch([adults, children, maxGuests], () => {
  if (adults.value + children.value > maxGuests.value) {
    children.value = Math.max(0, maxGuests.value - adults.value)
  }
})

const quoteErrorMessage = computed(() => {
  if (!quoteError.value) return null
  const key = `booking.errors.${quoteError.value.code}`
  const translated = t(key)
  return translated === key ? quoteError.value.message : translated
})

async function submit() {
  if (!canSubmit.value || !checkIn.value || !checkOut.value) return
  submitting.value = true

  try {
    const response = await $fetch<{
      reference: string
      checkout_url: string | null
      requires_manual_confirmation: boolean
    }>('/api/bookings', {
      method: 'POST',
      body: {
        check_in: checkIn.value,
        check_out: checkOut.value,
        adults: adults.value,
        children: children.value,
        guest_name: guest.guest_name.trim(),
        guest_email: guest.guest_email.trim(),
        guest_phone: guest.guest_phone.trim(),
        guest_country: guest.guest_country.trim(),
        notes: guest.notes.trim(),
        locale: locale.value
      }
    })

    if (response.checkout_url) {
      // Leaves the SPA for Stripe's hosted page.
      window.location.href = response.checkout_url
      return
    }

    await navigateTo(localePath(`/reserva/${response.reference}`))
  } catch (error) {
    const err = error as { data?: { statusMessage?: string, data?: { code?: string } } }
    const code = err.data?.data?.code
    toast.add({
      title: t('booking.errors.title'),
      description: code ? t(`booking.errors.${code}`) : (err.data?.statusMessage ?? t('booking.errors.unknown')),
      color: 'error',
      icon: 'i-lucide-circle-alert'
    })
    if (code === 'unavailable' || code === 'closed') await loadAvailability()
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
    <!-- Calendar + party size -->
    <UCard>
      <template #header>
        <div class="flex items-center justify-between gap-4">
          <h2 class="font-semibold text-highlighted">
            {{ $t('booking.selectDates') }}
          </h2>
          <UBadge
            v-if="availability"
            variant="subtle"
            color="neutral"
          >
            {{ $t('booking.checkInOut', { in: availability.checkin_time, out: availability.checkout_time }) }}
          </UBadge>
        </div>
      </template>

      <div class="flex flex-col gap-6">
        <USkeleton
          v-if="loadingAvailability"
          class="h-72 w-full"
        />
        <UCalendar
          v-else
          v-model="range"
          range
          :number-of-months="2"
          :min-value="minCalendarDate"
          :max-value="maxCalendarDate"
          :is-date-unavailable="isDateUnavailable"
          fixed-weeks
          class="w-fit mx-auto"
        />

        <p class="text-xs text-muted text-center">
          {{ $t('booking.calendarHint') }}
        </p>

        <USeparator />

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="$t('booking.adults')">
            <UInputNumber
              v-model="adults"
              :min="1"
              :max="maxGuests"
              class="w-full"
            />
          </UFormField>
          <UFormField
            :label="$t('booking.children')"
            :hint="$t('booking.maxGuests', { n: maxGuests })"
          >
            <UInputNumber
              v-model="children"
              :min="0"
              :max="Math.max(0, maxGuests - adults)"
              class="w-full"
            />
          </UFormField>
        </div>
      </div>
    </UCard>

    <!-- Price summary -->
    <div class="flex flex-col gap-4">
      <UCard>
        <template #header>
          <h2 class="font-semibold text-highlighted">
            {{ $t('booking.summary') }}
          </h2>
        </template>

        <div
          v-if="!checkIn || !checkOut"
          class="text-sm text-muted"
        >
          {{ $t('booking.pickDatesFirst') }}
        </div>

        <USkeleton
          v-else-if="loadingQuote"
          class="h-40 w-full"
        />

        <UAlert
          v-else-if="quoteErrorMessage"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :description="quoteErrorMessage"
        />

        <div
          v-else-if="quote"
          class="flex flex-col gap-3 text-sm"
        >
          <UAlert
            v-if="!quote.available"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-x"
            :description="$t('booking.errors.unavailable')"
          />

          <p class="text-muted">
            {{ day(quote.check_in) }} → {{ day(quote.check_out) }} ·
            {{ $t('booking.nights', quote.nights) }} ·
            {{ $t('booking.guests', quote.guests) }}
          </p>

          <div class="flex justify-between">
            <span>{{ $t('booking.nightsSubtotal', { n: quote.nights }) }}</span>
            <span>{{ money(quote.nightly_subtotal_cents) }}</span>
          </div>
          <div
            v-if="quote.discount_cents > 0"
            class="flex justify-between text-success"
          >
            <span>{{ $t(`booking.discount.${quote.discount_label}`, { pct: quote.discount_pct }) }}</span>
            <span>-{{ money(quote.discount_cents) }}</span>
          </div>
          <div
            v-if="quote.extra_guest_cents > 0"
            class="flex justify-between"
          >
            <span>{{ $t('booking.extraGuests') }}</span>
            <span>{{ money(quote.extra_guest_cents) }}</span>
          </div>
          <div
            v-if="quote.cleaning_fee_cents > 0"
            class="flex justify-between"
          >
            <span>{{ $t('booking.cleaningFee') }}</span>
            <span>{{ money(quote.cleaning_fee_cents) }}</span>
          </div>
          <div
            v-if="quote.tax_cents > 0"
            class="flex justify-between"
          >
            <span>{{ $t('booking.taxes') }}</span>
            <span>{{ money(quote.tax_cents) }}</span>
          </div>

          <USeparator />

          <div class="flex justify-between font-semibold text-base text-highlighted">
            <span>{{ $t('booking.total') }}</span>
            <span>{{ money(quote.total_cents) }}</span>
          </div>

          <div class="rounded-lg bg-elevated p-3 flex flex-col gap-1">
            <div class="flex justify-between font-medium">
              <span>{{ $t('booking.payNow') }}</span>
              <span>{{ money(quote.deposit_cents) }}</span>
            </div>
            <div
              v-if="quote.balance_cents > 0"
              class="flex justify-between text-muted text-xs"
            >
              <span>{{ $t('booking.payLater', { date: day(quote.balance_due_date) }) }}</span>
              <span>{{ money(quote.balance_cents) }}</span>
            </div>
            <p
              v-if="quote.security_deposit_cents > 0"
              class="text-xs text-muted"
            >
              {{ $t('booking.securityDeposit', { amount: money(quote.security_deposit_cents) }) }}
            </p>
          </div>

          <BookingCancellationTerms :policy="quote.cancellation" />

          <UButton
            v-if="!showGuestForm"
            block
            size="lg"
            :disabled="!quote.available"
            @click="showGuestForm = true"
          >
            {{ $t('booking.continue') }}
          </UButton>
        </div>
      </UCard>

      <!-- Guest details -->
      <UCard v-if="showGuestForm && quote?.available">
        <template #header>
          <h2 class="font-semibold text-highlighted">
            {{ $t('booking.yourDetails') }}
          </h2>
        </template>

        <div class="flex flex-col gap-3">
          <UFormField
            :label="$t('booking.fullName')"
            required
          >
            <UInput
              v-model="guest.guest_name"
              autocomplete="name"
              class="w-full"
            />
          </UFormField>
          <UFormField
            :label="$t('booking.email')"
            required
          >
            <UInput
              v-model="guest.guest_email"
              type="email"
              autocomplete="email"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="$t('booking.phone')">
            <UInput
              v-model="guest.guest_phone"
              type="tel"
              autocomplete="tel"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="$t('booking.country')">
            <UInput
              v-model="guest.guest_country"
              autocomplete="country-name"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="$t('booking.notes')">
            <UTextarea
              v-model="guest.notes"
              :rows="3"
              class="w-full"
            />
          </UFormField>

          <UCheckbox
            v-model="guest.accepts_terms"
            :label="$t('booking.acceptTerms')"
          />

          <UButton
            block
            size="lg"
            icon="i-lucide-lock"
            :loading="submitting"
            :disabled="!canSubmit"
            @click="submit"
          >
            {{ $t('booking.payDeposit', { amount: money(quote.deposit_cents) }) }}
          </UButton>

          <p class="text-xs text-muted text-center">
            {{ $t('booking.stripeNotice') }}
          </p>
        </div>
      </UCard>
    </div>
  </div>
</template>
