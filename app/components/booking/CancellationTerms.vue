<script setup lang="ts">
/**
 * Renders a cancellation policy from its refund ladder, so the guest reads it
 * in their own language without anyone translating free text: only the tiers
 * are stored, the sentences come from the locale files.
 */
export interface RefundTier {
  days_before: number
  refund_pct: number
}

export interface CancellationTermsPolicy {
  code: string
  name: string
  tiers: RefundTier[]
  notes: string
}

const props = defineProps<{
  policy: CancellationTermsPolicy | null
  /** Bigger, boxed version for the confirmation page. */
  boxed?: boolean
}>()

const { t, te } = useI18n()

/** Built-in policies are translated; a policy the host invented is not. */
const policyName = computed(() => {
  const key = `booking.cancellation.policies.${props.policy?.code}`
  return te(key) ? t(key) : (props.policy?.name ?? '')
})

const lines = computed(() =>
  (props.policy?.tiers ?? []).map(tier =>
    tier.days_before <= 0
      ? t('booking.cancellation.tierSameDay', { pct: tier.refund_pct })
      : t('booking.cancellation.tier', { pct: tier.refund_pct, days: tier.days_before })
  )
)
</script>

<template>
  <div
    v-if="policy"
    class="text-xs text-muted"
    :class="boxed ? 'rounded-lg border border-default p-3' : ''"
  >
    <p class="font-medium text-toned">
      {{ $t('booking.cancellation.title') }}: {{ policyName }}
    </p>
    <ul
      v-if="lines.length"
      class="mt-1 list-disc ps-4 space-y-0.5"
    >
      <li
        v-for="line in lines"
        :key="line"
      >
        {{ line }}
      </li>
    </ul>
    <p
      v-else
      class="mt-1"
    >
      {{ $t('booking.cancellation.none') }}
    </p>
    <p
      v-if="policy.notes"
      class="mt-2 whitespace-pre-line"
    >
      {{ policy.notes }}
    </p>
  </div>
</template>
