<template>
  <div>
    <UPageHero
      :title="$t('site.title')"
      :description="$t('site.subtitle')"
      :image="{ src: '@/assets/images/collage.jpeg', alt: 'Bonaire Patacona' }"
      :links="[{
        label: $t('cta.bookNow'),
        to: '#cta',
        trailingIcon: 'i-lucide-arrow-right',
        size: 'xl'
      }]"
    />

    <!-- Carousel Section -->
    <UPageSection class="pt-0">
      <UCarousel
        :images="[
          { src: '/assets/images/living-room.jpg', alt: 'Living room' },
          { src: '/assets/images/main-bedroom.jpg', alt: 'Main Bedroom' },
          { src: '/assets/images/twin-bedroom.jpg', alt: 'Twin-bed bedroom' },
          { src: '/assets/images/pool.jpg', alt: 'Pool' },
          { src: '/assets/images/beach-night.jpg', alt: 'Beach' },
          { src: '/assets/images/kitchen.jpg', alt: 'Kitchen' },
          { src: '/assets/images/bathroom.jpg', alt: 'Bathroom' }
        ]"
        :height="400"
        :options="{ loop: true, autoplay: true, autoplayTimeout: 5000 }"
      />
    </UPageSection>

    <!-- Features Section -->

    <UPageSection
      id="features"
      :title="$t('hero.title')"
      :description="$t('hero.description')"
      :features="[{
        title: $t('features.location.title'),
        description: $t('features.location.description'),
        icon: 'i-lucide-map-pin'
      }, {
        title: $t('features.beach.title'),
        description: $t('features.beach.description'),
        icon: 'i-lucide-beach'
      }, {
        title: $t('features.pool.title'),
        description: $t('features.pool.description'),
        icon: 'i-lucide-swimming-pool'
      }, {
        title: $t('features.wifi.title'),
        description: $t('features.wifi.description'),
        icon: 'i-lucide-wifi'
      }, {
        title: $t('features.terrace.title'),
        description: $t('features.terrace.description'),
        icon: 'i-lucide-sun'
      }, {
        title: $t('features.parking.title'),
        description: $t('features.parking.description'),
        icon: 'i-lucide-car'
      }]"
    />

    <UPageSection>
      <UPageCTA
        id="cta"
        :title="$t('cta.title')"
        description=""
        variant="subtle"
        :links="[{
          label: $t('cta.airbnb'),
          to: 'https://airbnb.es/h/bonaire-patacona',
          target: '_blank',
          trailingIcon: 'i-lucide-arrow-right',
          color: 'primary'
        }, {
          label: $t('cta.booking'),
          to: 'https://www.booking.com/hotel/es/patacona-playa-piscina-wifi-terraza-bonaire.es.html?aid=356980&label=gog235jc-10CAsoRkIrcGF0YWNvbmEtcGxheWEtcGlzY2luYS13aWZpLXRlcnJhemEtYm9uYWlyZUgEWANoRogBAZgBM7gBB8gBDdgBA-gBAfgBAYgCAagCAbgC26DfxgbAAgHSAiQzMTFlMDI5Yi1iM2ZjLTRlMTgtYmU4My1lZTZkOTc3NGJkNjHYAgHgAgE&sid=21d5e448f7e4a52f547b06916a18b02e&dist=0&keep_landing=1&sb_price_type=total&type=total&',
          target: '_blank',
          trailingIcon: 'i-lucide-arrow-right',
          color: 'secondary'
        }]"
      />
    </UPageSection>
  </div>
</template>
