<template>
  <div>
    <UPageHero
      :class="[$colorMode.value === 'dark' ? 'hero-home dark' : 'hero-home']"
      :title="$t('site.title')"
      :description="$t('site.subtitle')"
      orientation="horizontal"
      :links="[{
        label: $t('cta.bookNow'),
        to: '#cta',
        trailingIcon: 'i-lucide-arrow-right',
        size: 'xl'
      }]"
    >
      <img
        src="/assets/images/collage.jpeg"
        alt="Bonaire Patacona"
        class="rounded-lg shadow-2xl ring ring-default"
      >
    </UPageHero>

    <!-- Carousel Section -->
    <UPageSection
      id="gallery"
      :title="$t('gallery.title')"
      :ui="{
        root: 'w-full',
        container: 'max-w-4xl mx-auto px-4 py-6',
        content: 'flex flex-col gap-6'
      }"
    >
      <UCarousel
        v-slot="{ item }"
        loop
        arrows
        dots
        :autoplay="{ delay: 3000 }"
        :items="items"
        :ui="{ item: 'basis-1/3' }"
      >
        <img
          :src="item"
          width="350"
          height="250"
          class="rounded-lg"
        >
      </UCarousel>
    </UPageSection>

    <!-- Features Section -->

    <UPageSection
      id="features"
      :ui="{ container: 'py-4 px-4' }"
      :title="$t('hero.title')"
      :description="$t('hero.description')"
      :features="[{
        title: $t('features.location.title'),
        description: $t('features.location.description'),
        icon: 'i-lucide-map-pin'
      }, {
        title: $t('features.pool.title'),
        description: $t('features.pool.description'),
        icon: 'icon-park-solid:swimming-ring'
      }, {
        title: $t('features.wifi.title'),
        description: $t('features.wifi.description'),
        icon: 'i-lucide-wifi'
      }, {
        title: $t('features.terrace.title'),
        description: $t('features.terrace.description'),
        icon: 'streamline-freehand:donation-charity-donate-heart-flower'
      }, {
        title: $t('features.parking.title'),
        description: $t('features.parking.description'),
        icon: 'i-lucide-car'
      }, {
        title: $t('features.padel.title'),
        description: $t('features.padel.description'),
        icon: 'streamline-flex:ball-solid'
      }]"
    />

    <UPageSection :ui="{ container: 'py-4 px-4' }">
      <UPageCTA
        id="cta"
        :title="$t('cta.title')"
        description=""
        variant="subtle"
        :links="[{
          label: $t('cta.airbnb'),
          to: 'https://airbnb.es/h/bonaire-patacona',
          target: '_blank',
          trailingIcon: 'fa6-brands:airbnb',
          color: 'airbnb'
        }, {
          label: $t('cta.booking'),
          to: 'https://www.booking.com/Share-b9tE4r',
          target: '_blank',
          trailingIcon: 'fa-brands:bootstrap',
          color: 'secondary'
        }]"
      />
    </UPageSection>
    <UPageSection
      id="testimonials"
      :title="$t('testimonials.title')"
      :description="$t('testimonials.placeholder')"
    >
      <TestimonialsComponent />
    </UPageSection>

    <!-- Big logo at the bottom right -->
    <UPageSection :ui="{ container: 'py-4 px-4 flex justify-end' }">
      <NuxtLink to="/">
        <AppLogo class="w-auto h-16 shrink-0" />
      </NuxtLink>
    </UPageSection>
  </div>
</template>

<script setup>
import livingRoom from '~/assets/images/living-room.jpg'
import livingRoom2 from '~/assets/images/living-room-2.jpg'
import mainBedroom from '~/assets/images/main-bedroom.jpg'
import kitchen from '~/assets/images/kitchen.jpg'
import twinBedroom from '~/assets/images/twin-bedroom.jpeg'
import pool from '~/assets/images/pool.jpg'
import padelCourts from '~/assets/images/padel-courts.jpg'
import beach from '~/assets/images/beach.jpeg'
import beachNight from '~/assets/images/beach-night.jpeg'
import beach2 from '~/assets/images/beach-2.jpeg'
import kids from '~/assets/images/kids.jpg'
import kids2 from '~/assets/images/kids-2.jpg'
import kids3 from '~/assets/images/kids-3.jpg'
import terrace from '~/assets/images/terrace.jpg'
import bathroom from '~/assets/images/bathroom.jpg'

import TestimonialsComponent from '~/components/TestimonialsComponent.vue'

const items = [
  livingRoom,
  livingRoom2,
  terrace,
  mainBedroom,
  twinBedroom,
  bathroom,
  kitchen,
  pool,
  padelCourts,
  kids,
  kids2,
  kids3,
  beach,
  beach2,
  beachNight
]
</script>

<style scoped>
.hero-home {
  background-image: linear-gradient(rgba(255, 255, 255, 0.8), rgba(255, 255, 255, 0.6)), url('/assets/images/beach-night.jpeg');
  background-size: cover;
  background-position: center;
}

.dark .hero-home {
  background-image: linear-gradient(rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0.6)), url('/assets/images/beach-night.jpeg');
}
</style>
