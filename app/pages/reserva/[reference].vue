<script setup lang="ts">
/**
 * Guest-facing confirmation page. Stripe sends the guest back here after
 * paying; the booking is only shown as confirmed once the webhook has landed,
 * so the page polls briefly instead of trusting the `?paid=1` query.
 */
const route = useRoute()
const { t, locale } = useI18n()

const reference = computed(() => String(route.params.reference ?? '').toUpperCase())
const justPaid = computed(() => route.query.paid === '1')
const cancelled = computed(() => route.query.cancelled === '1')

interface BookingSummary {
  reference: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired' | 'completed'
  check_in: string
  check_out: string
  adults: number
  children: number
  currency: string
  nightly_subtotal_cents: number
  cleaning_fee_cents: number
  extra_guest_cents: number
  discount_cents: number
  tax_cents: number
  total_cents: number
  deposit_cents: number
  balance_cents: number
  amount_paid_cents: number
  security_deposit_cents: number
  balance_due_date: string | null
  checkin_time: string
  checkout_time: string
  cancellation: CancellationTerms
  refund_if_cancelled_now: { refund_pct: number, refund_cents: number, days_before: number } | null
  property_name: string
  contact_email: string | null
  guest_name: string
}

const { data: booking, refresh, error } = await useFetch<BookingSummary>(
  () => `/api/bookings/${reference.value}`,
  { key: () => `booking-${reference.value}` }
)

const localeTag = computed(() => `${locale.value}-${locale.value === 'en' ? 'GB' : locale.value.toUpperCase()}`)
const money = (cents: number) => formatMoney(cents, booking.value?.currency ?? 'EUR', localeTag.value)
const day = (iso: string | null) => (iso ? formatDate(iso, localeTag.value) : '')

const statusColor = computed(() => ({
  confirmed: 'success',
  completed: 'success',
  pending: 'warning',
  cancelled: 'error',
  expired: 'neutral'
}[booking.value?.status ?? 'pending'] as 'success' | 'warning' | 'error' | 'neutral'))

// The webhook usually lands within a second or two of the redirect.
let attempts = 0
let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  if (!justPaid.value) return
  timer = setInterval(async () => {
    attempts += 1
    if (booking.value?.status === 'confirmed' || attempts > 10) {
      clearInterval(timer)
      return
    }
    await refresh()
  }, 2000)
})

onBeforeUnmount(() => timer && clearInterval(timer))

useSeoMeta({
  title: () => t('booking.confirmation.title'),
  robots: 'noindex, nofollow'
})
</script>

<template>
  <UPageSection :ui="{ container: 'py-10 px-4 max-w-3xl' }">
    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-x"
      :title="$t('booking.confirmation.notFound')"
      :description="$t('booking.confirmation.notFoundHelp')"
    />

    <div
      v-else-if="booking"
      class="flex flex-col gap-6"
    >
      <UAlert
        v-if="cancelled && booking.status === 'pending'"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :title="$t('booking.confirmation.paymentCancelled')"
        :description="$t('booking.confirmation.paymentCancelledHelp')"
      />

      <UCard>
        <template #header>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="text-sm text-muted">
                {{ $t('booking.confirmation.reference') }}
              </p>
              <h1 class="text-2xl font-bold text-highlighted">
                {{ booking.reference }}
              </h1>
            </div>
            <UBadge
              :color="statusColor"
              variant="subtle"
              size="lg"
            >
              {{ $t(`booking.status.${booking.status}`) }}
            </UBadge>
          </div>
        </template>

        <div class="flex flex-col gap-4">
          <p
            v-if="booking.status === 'pending' && justPaid"
            class="text-sm text-muted"
          >
            <UIcon
              name="i-lucide-loader-circle"
              class="animate-spin mr-1"
            />
            {{ $t('booking.confirmation.awaitingPayment') }}
          </p>

          <div class="grid gap-4 sm:grid-cols-2 text-sm">
            <div>
              <p class="text-muted">
                {{ $t('booking.checkIn') }}
              </p>
              <p class="font-medium text-highlighted">
                {{ day(booking.check_in) }} · {{ booking.checkin_time }}
              </p>
            </div>
            <div>
              <p class="text-muted">
                {{ $t('booking.checkOut') }}
              </p>
              <p class="font-medium text-highlighted">
                {{ day(booking.check_out) }} · {{ booking.checkout_time }}
              </p>
            </div>
            <div>
              <p class="text-muted">
                {{ $t('booking.guestsLabel') }}
              </p>
              <p class="font-medium text-highlighted">
                {{ $t('booking.guests', booking.adults + booking.children) }}
              </p>
            </div>
            <div>
              <p class="text-muted">
                {{ $t('booking.property') }}
              </p>
              <p class="font-medium text-highlighted">
                {{ booking.property_name }}
              </p>
            </div>
          </div>

          <USeparator />

          <div class="flex flex-col gap-2 text-sm">
            <div class="flex justify-between">
              <span>{{ $t('booking.total') }}</span>
              <span class="font-semibold">{{ money(booking.total_cents) }}</span>
            </div>
            <div class="flex justify-between text-success">
              <span>{{ $t('booking.confirmation.paid') }}</span>
              <span>{{ money(booking.amount_paid_cents) }}</span>
            </div>
            <div
              v-if="booking.balance_cents > 0"
              class="flex justify-between text-muted"
            >
              <span>{{ $t('booking.payLater', { date: day(booking.balance_due_date) }) }}</span>
              <span>{{ money(booking.balance_cents) }}</span>
            </div>
            <p
              v-if="booking.security_deposit_cents > 0"
              class="text-xs text-muted"
            >
              {{ $t('booking.securityDeposit', { amount: money(booking.security_deposit_cents) }) }}
            </p>
          </div>

          <BookingCancellationTerms
            :policy="booking.cancellation"
            boxed
          />

          <p
            v-if="booking.refund_if_cancelled_now"
            class="text-xs text-muted"
          >
            {{ booking.refund_if_cancelled_now.refund_cents > 0
              ? $t('booking.cancellation.refundNow', { amount: money(booking.refund_if_cancelled_now.refund_cents) })
              : $t('booking.cancellation.noRefundNow') }}
          </p>
        </div>

        <template #footer>
          <p class="text-sm text-muted">
            {{ $t('booking.confirmation.help') }}
            <ULink
              v-if="booking.contact_email"
              :to="`mailto:${booking.contact_email}`"
            >
              {{ booking.contact_email }}
            </ULink>
          </p>
        </template>
      </UCard>
    </div>
  </UPageSection>
</template>
