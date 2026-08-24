<script setup>
import mainImage from 'assets/images/collage.jpg'
import * as locales from '@nuxt/ui/locale'

const siteUrl = 'https://bonairepatacona.com'
const { t, locale } = useI18n()
const route = useRoute()

const currentUrl = computed(() => new URL(route.fullPath, siteUrl).toString())
const seoTitle = computed(() => t(route.path.includes('/guia') ? 'seo.guideTitle' : 'seo.homeTitle'))
const seoDescription = computed(() => t(route.path.includes('/guia') ? 'seo.guideDescription' : 'seo.homeDescription'))
const localeHead = useLocaleHead({ addSeoAttributes: true })

useHead(() => ({
  htmlAttrs: {
    lang: locale.value,
    ...localeHead.value.htmlAttrs
  },
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    ...(localeHead.value.meta || [])
  ],
  link: [
    { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    { rel: 'canonical', href: currentUrl.value },
    ...(localeHead.value.link || [])
  ],
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'LodgingBusiness',
        'name': 'Bonaire Patacona',
        'description': seoDescription.value,
        'url': siteUrl,
        'image': new URL(mainImage, siteUrl).toString(),
        'address': {
          '@type': 'PostalAddress',
          'addressLocality': 'Alboraia',
          'addressRegion': 'Valencia',
          'addressCountry': 'ES'
        },
        'amenityFeature': [
          'Beach access',
          'Swimming pool',
          'Wi-Fi',
          'Air conditioning',
          'Terrace',
          'Private parking',
          'Padel courts'
        ].map(name => ({
          '@type': 'LocationFeatureSpecification',
          name,
          'value': true
        }))
      })
    }
  ]
}))

useSeoMeta({
  title: seoTitle,
  description: seoDescription,
  ogTitle: seoTitle,
  ogDescription: seoDescription,
  ogType: 'website',
  ogUrl: currentUrl,
  ogSiteName: 'Bonaire Patacona',
  ogImage: mainImage,
  ogImageAlt: () => t('seo.imageAlt'),
  twitterImage: mainImage,
  twitterTitle: seoTitle,
  twitterDescription: seoDescription,
  twitterCard: 'summary_large_image'
})
</script>

<template>
  <UApp :locale="locales[locale]">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
