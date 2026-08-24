<script setup lang="ts">
const { t } = useI18n()
const route = useRoute()

const initialCheckIn = computed(() => {
  const value = route.query.check_in
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
})
const initialCheckOut = computed(() => {
  const value = route.query.check_out
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
})

useSeoMeta({
  title: () => t('booking.pageTitle'),
  description: () => t('booking.pageDescription'),
  robots: 'noindex, follow'
})
</script>

<template>
  <UPageSection
    :title="$t('booking.pageTitle')"
    :description="$t('booking.pageDescription')"
    :ui="{ container: 'py-8 px-4 max-w-6xl' }"
  >
    <ClientOnly>
      <BookingWidget
        :initial-check-in="initialCheckIn"
        :initial-check-out="initialCheckOut"
      />
      <template #fallback>
        <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <USkeleton class="h-[28rem] w-full" />
          <USkeleton class="h-64 w-full" />
        </div>
      </template>
    </ClientOnly>
  </UPageSection>
</template>
