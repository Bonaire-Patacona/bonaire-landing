<template>
  <div class="m-auto max-w-5xl px-4">
    <UPage>
      <UPageHeader
        :title="$t('guia.title')"
        :description="$t('guia.description')"
      />
      <UButton
        href="https://www.airbnb.cat/s/guidebooks?refinement_paths%5B%5D=%2Fguidebooks%2F5658506&s=67&unique_share_id=88c6fd38-23f2-447e-942e-d5d40309cf13"
        target="_blank"
        rel="noopener"
        size="lg"
        icon="fa6-brands:airbnb"
        color="primary"
        variant="solid"
        class="mx-auto"
      >
        {{ $t('guia.airbnb') }}
      </UButton>
    </UPage>
  </div>
</template>
