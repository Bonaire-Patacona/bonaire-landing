<script setup>
useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' }
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' }
  ],
  htmlAttrs: {
    lang: 'en'
  }
})

const title = 'Bonaire Patacona Apartment'
const description = 'Beach, pool, A/C, padel, terrace, parking. Patacona beach, Valencia, Spain'

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
  ogImage: 'https://ui.nuxt.com/assets/templates/nuxt/starter-light.png',
  twitterImage: 'https://ui.nuxt.com/assets/templates/nuxt/starter-light.png',
  twitterCard: 'summary_large_image'
})
</script>

<template>
  <UApp>
    <UHeader>
      <template #left>
        <NuxtLink to="/">
          <AppLogo class="w-auto h-6 shrink-0" />
        </NuxtLink>
      </template>

      <template #right>
        <UButton
          to="#cta"
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
    </UHeader>

    <UMain>
      <NuxtPage />
    </UMain>

    <USeparator icon="fa6-brands:airbnb" />

    <UFooter>
      <template #left>
        <p class="text-sm text-muted">
          Bonaire Patacona © {{ new Date().getFullYear() }}
        </p>
      </template>

      <!-- <template #right>
      </template> -->
    </UFooter>
  </UApp>
</template>
