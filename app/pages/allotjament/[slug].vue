<script setup lang="ts">
defineI18nRoute(false)
const route = useRoute()
const { locale } = useI18n()
const slug = computed(() => String(route.params.slug))
interface PublicImage {
  id: string
  url: string
  alt: string
  is_cover: boolean
}
interface PublicFeature {
  id: string
  name: string
  description: string
  icon: string
}
interface PublicReview {
  id: string
  author: string
  quote: string
  rating: number
  source: string
}
interface PublicBooking {
  base_nightly_cents: number
  currency: string
  max_guests: number
}
interface PublicProperty {
  name: string
  slug: string
  short_description: string
  description: string
  bedrooms: number
  bathrooms: number
  beds: number
  floor_area_m2: number | null
  images: PublicImage[]
  features: PublicFeature[]
  reviews: PublicReview[]
  booking: PublicBooking
}
const { data: property } = await useFetch(`/api/properties/${slug.value}`, { query: { locale } })
if (!property.value) throw createError({ statusCode: 404, statusMessage: 'Property not found' })
const publicProperty = computed(() => property.value as unknown as PublicProperty | null)
const cover = computed(() => publicProperty.value?.images.find(image => image.is_cover) ?? publicProperty.value?.images[0])
const featureCards = computed(() => (publicProperty.value?.features ?? []).map(feature => ({ title: feature.name, description: feature.description, icon: feature.icon })))
useSeoMeta({
  title: () => property.value?.name,
  description: () => property.value?.short_description || property.value?.description,
  ogImage: () => cover.value?.url
})
</script>

<template>
  <div v-if="property">
    <UPageHero
      :title="property.name"
      :description="property.short_description"
      orientation="horizontal"
      :links="[{ label: 'Reservar', to: `/reservar?property=${property.slug}`, size: 'xl', trailingIcon: 'i-lucide-arrow-right' }]"
    >
      <img
        v-if="cover"
        :src="cover.url"
        :alt="cover.alt || property.name"
        class="max-h-[32rem] w-full rounded-xl object-cover shadow-xl"
      >
    </UPageHero>

    <UPageSection :ui="{ container: 'max-w-6xl py-8' }">
      <div class="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div>
          <p class="whitespace-pre-line text-lg text-muted">
            {{ property.description }}
          </p>
          <div class="mt-5 flex flex-wrap gap-2">
            <UBadge variant="subtle">
              {{ property.bedrooms }} dormitorios
            </UBadge>
            <UBadge variant="subtle">
              {{ property.bathrooms }} baños
            </UBadge>
            <UBadge variant="subtle">
              {{ property.beds }} camas
            </UBadge>
            <UBadge
              v-if="property.floor_area_m2"
              variant="subtle"
            >
              {{ property.floor_area_m2 }} m²
            </UBadge>
          </div>
        </div>
        <UCard>
          <p class="text-sm text-muted">
            Desde
          </p><p class="text-3xl font-semibold">
            {{ formatMoney(property.booking.base_nightly_cents, property.booking.currency) }}
          </p><p class="mt-2 text-sm text-muted">
            Hasta {{ property.booking.max_guests }} huéspedes
          </p><UButton
            :to="`/reservar?property=${property.slug}`"
            block
            class="mt-5"
          >
            Comprobar disponibilidad
          </UButton>
        </UCard>
      </div>
    </UPageSection>

    <UPageSection
      v-if="property.images.length > 1"
      title="Galería"
      :ui="{ container: 'max-w-6xl py-8' }"
    >
      <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
        <img
          v-for="image in property.images"
          :key="image.id"
          :src="image.url"
          :alt="image.alt || property.name"
          class="aspect-[4/3] w-full rounded-lg object-cover"
        >
      </div>
    </UPageSection>

    <UPageSection
      v-if="property.features.length"
      title="Servicios"
      :features="featureCards"
    />

    <UPageSection
      v-if="property.reviews.length"
      title="Opiniones"
      :ui="{ container: 'max-w-6xl py-8' }"
    >
      <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <UCard
          v-for="review in property.reviews"
          :key="review.id"
        >
          <p class="text-amber-500">
            ★ {{ review.rating }}/5
          </p><p class="mt-2">
            “{{ review.quote }}”
          </p><p class="mt-3 text-sm font-medium">
            {{ review.author }}
          </p><p class="text-xs text-muted">
            {{ review.source }}
          </p>
        </UCard>
      </div>
    </UPageSection>
  </div>
</template>
