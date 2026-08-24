<script setup lang="ts">
const { t } = useI18n()
const localePath = useLocalePath()

const items = computed(() => [{
  label: t('menu.home'),
  icon: 'fa6-solid:house',
  to: localePath('/')
}, {
  label: t('menu.guia'),
  icon: 'fa6-solid:book',
  to: localePath('/guia')
}, {
  label: t('menu.book'),
  icon: 'fa6-solid:calendar-check',
  to: localePath('/reservar')
}])
</script>

<template>
  <div>
    <UHeader>
      <template #left>
        <NuxtLink :to="localePath('/')">
          <AppLogo class="w-auto h-14 shrink-0 p-1" />
        </NuxtLink>
      </template>
      <UNavigationMenu :items="items" />
      <template #right>
        <UButton
          :to="localePath('/reservar')"
          size="md"
          color="primary"
          variant="solid"
          class="ml-4"
        >
          {{ $t('cta.bookNow') }}
        </UButton>
        <UColorModeButton />
        <LanguageSwitcher />
      </template>
      <template #body>
        <UNavigationMenu
          :items="items"
          orientation="vertical"
          class="-mx-2.5"
        />
      </template>
    </UHeader>

    <UMain>
      <slot />
    </UMain>

    <USeparator icon="fa6-brands:airbnb" />

    <UFooter>
      <template #left>
        <p class="text-sm text-muted">
          Bonaire Patacona © {{ new Date().getFullYear() }}
        </p>
      </template>

      <template #right>
        <LanguageSwitcher />
      </template>
    </UFooter>
  </div>
</template>
