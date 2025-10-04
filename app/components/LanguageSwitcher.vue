<template>
  <UDropdownMenu
    v-slot="{ open }"
    :modal="false"
    :items="[{
      label: 'English',
      to: switchLocalePath('en')
    }, {
      label: 'Español',
      to: switchLocalePath('es')
    }, {
      label: 'Català',
      to: switchLocalePath('ca')
    }]"
    :content="{ align: 'start' }"
    :ui="{ content: 'min-w-fit' }"
    size="xs"
  >
    <UButton
      :label="$i18n.locale.toUpperCase()"
      variant="subtle"
      trailing-icon="i-lucide-chevron-down"
      size="xs"
      class="-mb-[6px] font-semibold rounded-full truncate"
      :class="[open && 'bg-primary/15']"
      :ui="{
        trailingIcon: ['transition-transform duration-200', open ? 'rotate-180' : undefined].filter(Boolean).join(' ')
      }"
    />
  </UDropdownMenu>
</template>

<script setup>
const switchLocalePath = useSwitchLocalePath()
</script>
