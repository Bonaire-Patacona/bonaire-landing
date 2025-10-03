<script setup>
import mainImage from 'assets/images/collage.jpg'

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
  ogImage: mainImage,
  twitterImage: mainImage,
  twitterCard: 'summary_large_image'
})
</script>

<template>
  <UApp>
    <UHeader>
      <template #left>
        <NuxtLink to="/">
          <AppLogo class="w-auto h-14 shrink-0 p-1" />
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

      <template #right>
        <LanguageSwitcher />
      </template>
    </UFooter>
  </UApp>
</template>
