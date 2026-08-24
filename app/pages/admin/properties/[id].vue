<script setup lang="ts">
defineI18nRoute(false)
definePageMeta({ layout: 'admin', middleware: 'admin' })

const route = useRoute()
const id = computed(() => String(route.params.id))
const supabase = useDb()
const toast = useToast()
const { authFetch } = useAdminApi()
const { selectProperty, refresh: refreshContext } = useAdminProperty()
const tab = ref('content')
const saving = ref(false)
const translating = ref(false)
const uploadingImage = ref(false)

interface Policy { id: string, code: string, name: string }
interface Image { id: string, url: string, alt: string, is_cover: boolean, sort_order: number }
interface Feature { id: string, name: string, description: string, icon: string }
interface Review { id: string, author: string, quote: string, rating: number, source: string, active: boolean }
interface Assignment { id: string, name: string, start_date: string, end_date: string, priority: number, policy_id: string, cancellation_policies: Policy }
interface Translation {
  locale: string
  name: string
  short_description: string
  description: string
  features: Array<{ id: string, name: string, description: string }>
  reviews: Array<{ id: string, quote: string }>
  origin: 'ai' | 'manual'
  source_hash: string
  updated_at: string
}

const localeOptions = [
  { label: 'English', value: 'en' }, { label: 'Español', value: 'es' },
  { label: 'Català', value: 'ca' }, { label: 'Français', value: 'fr' },
  { label: 'Deutsch', value: 'de' }, { label: 'Italiano', value: 'it' },
  { label: 'Nederlands', value: 'nl' }, { label: 'Svenska', value: 'sv' }
]
const featureIconNames = [
  'air-vent', 'alarm-clock', 'armchair', 'baby', 'badge-check', 'bath', 'bed-double', 'bed-single',
  'bike', 'binoculars', 'blend', 'book-open', 'briefcase-medical', 'building', 'bus', 'cable',
  'car', 'chef-hat', 'circle-parking', 'circle-power', 'coffee', 'concierge-bell', 'cooking-pot',
  'credit-card', 'crown', 'dog', 'door-open', 'dumbbell', 'elevator', 'fan', 'fire-extinguisher',
  'flame', 'flower-2', 'gamepad-2', 'heater', 'house', 'key-round', 'lamp-floor', 'landmark',
  'languages', 'laptop', 'leaf', 'lock-keyhole', 'luggage', 'map-pin', 'microwave', 'monitor',
  'mountain-snow', 'music', 'parking-meter', 'paw-print', 'person-standing', 'plug-zap', 'radio',
  'refrigerator', 'route', 'sailboat', 'school', 'shower-head', 'shield-check', 'ship-wheel',
  'shopping-basket', 'sofa', 'sparkles', 'square-parking', 'sun', 'sun-medium', 'swatch-book',
  'thermometer-sun', 'trees', 'tv', 'umbrella', 'utensils', 'vault', 'vegan', 'washing-machine',
  'waves', 'wifi', 'wine', 'wind', 'accessibility', 'circle-check', 'clock-3', 'cigarette-off',
  'eye', 'heart', 'info', 'moon', 'phone', 'shirt', 'speaker', 'star', 'stroller', 'warehouse'
]
const featureIconOptions = featureIconNames.map((name) => {
  const value = `i-lucide-${name}`
  return { label: name.replaceAll('-', ' '), value, icon: value }
})

const { data, refresh, pending } = await useAsyncData(`property-${id.value}`, async () => {
  const [property, settings, policies, periods, images, features, reviews, translations] = await Promise.all([
    supabase.from('properties').select('*').eq('id', id.value).single(),
    supabase.from('app_settings').select('cancellation_policy_code').eq('property_id', id.value).single(),
    supabase.from('cancellation_policies').select('id, code, name').eq('active', true).order('sort_order'),
    supabase.from('property_policy_periods').select('*, cancellation_policies(id, code, name)').eq('property_id', id.value).order('start_date'),
    supabase.from('property_images').select('*').eq('property_id', id.value).order('sort_order'),
    supabase.from('property_features').select('*').eq('property_id', id.value).order('sort_order'),
    supabase.from('property_reviews').select('*').eq('property_id', id.value).order('sort_order'),
    supabase.from('property_translations').select('*').eq('property_id', id.value).order('locale')
  ])
  if (property.error) throw property.error
  return {
    property: property.data,
    settings: settings.data,
    policies: (policies.data ?? []) as Policy[],
    periods: (periods.data ?? []) as unknown as Assignment[],
    images: (images.data ?? []) as Image[],
    features: (features.data ?? []) as Feature[],
    reviews: (reviews.data ?? []) as Review[],
    translations: (translations.data ?? []) as Translation[]
  }
})

watchEffect(() => {
  if (data.value?.property) selectProperty(id.value)
})

const propertyForm = reactive({
  name: '', slug: '', short_description: '', description: '', address: '', city: '', country: '',
  bedrooms: 1, bathrooms: 1, beds: 1, floor_area_m2: null as number | null,
  licence_number: '', source_locale: 'es', published: false, active: true
})
watchEffect(() => {
  if (!data.value?.property) return
  const property = data.value.property
  for (const key of Object.keys(propertyForm) as Array<keyof typeof propertyForm>) {
    if (key in property) (propertyForm[key] as unknown) = property[key]
  }
})

const targetLocales = computed(() => localeOptions.filter(locale => locale.value !== propertyForm.source_locale))
const selectedTranslationLocale = ref('en')
const selectedTranslation = computed(() => data.value?.translations.find(row => row.locale === selectedTranslationLocale.value))
const translationForm = reactive<{
  name: string
  short_description: string
  description: string
  features: Array<{ id: string, name: string, description: string }>
  reviews: Array<{ id: string, quote: string }>
}>({ name: '', short_description: '', description: '', features: [], reviews: [] })
watch(targetLocales, (locales) => {
  if (!locales.some(locale => locale.value === selectedTranslationLocale.value)) {
    selectedTranslationLocale.value = locales[0]?.value ?? 'en'
  }
}, { immediate: true })
watch([selectedTranslationLocale, () => data.value?.translations], () => {
  const translation = selectedTranslation.value
  const translatedFeatures = new Map((translation?.features ?? []).map(item => [item.id, item]))
  const translatedReviews = new Map((translation?.reviews ?? []).map(item => [item.id, item]))
  Object.assign(translationForm, {
    name: translation?.name ?? '',
    short_description: translation?.short_description ?? '',
    description: translation?.description ?? '',
    features: (data.value?.features ?? []).map((feature) => {
      const translated = translatedFeatures.get(feature.id)
      return { id: feature.id, name: translated?.name ?? feature.name, description: translated?.description ?? feature.description }
    }),
    reviews: (data.value?.reviews ?? []).map((review) => {
      const translated = translatedReviews.get(review.id)
      return { id: review.id, quote: translated?.quote ?? review.quote }
    })
  })
}, { immediate: true })

async function saveTranslation() {
  saving.value = true
  try {
    await authFetch(`/api/admin/properties/${id.value}/translations`, {
      method: 'PUT',
      body: { locale: selectedTranslationLocale.value, ...translationForm }
    })
    toast.add({ title: 'Traducción manual guardada', color: 'success' })
    await refresh()
  } catch (error) {
    toast.add({ title: 'No se pudo guardar la traducción', description: error instanceof Error ? error.message : '', color: 'error' })
  } finally {
    saving.value = false
  }
}

async function runTranslation(locales?: string[], overwrite = false) {
  if (overwrite && selectedTranslation.value?.origin === 'manual' && !window.confirm('Esta acción sustituirá la revisión manual de este idioma. ¿Continuar?')) return
  translating.value = true
  try {
    const result = await authFetch<{ translated: string[], skipped: string[] }>(`/api/admin/properties/${id.value}/translate`, {
      method: 'POST', body: { locales, overwrite }
    })
    toast.add({
      title: result.translated.length ? `${result.translated.length} idiomas traducidos` : 'No hay idiomas pendientes',
      description: result.skipped.length ? 'Las traducciones existentes no se han modificado.' : undefined,
      color: 'success'
    })
    await refresh()
  } catch (error) {
    toast.add({ title: 'No se pudo traducir', description: error instanceof Error ? error.message : '', color: 'error' })
  } finally {
    translating.value = false
  }
}

const imageForm = reactive({ alt: '' })
const imageFile = ref<File | null>(null)
const imageInputKey = ref(0)
const featureForm = reactive({ name: '', description: '', icon: 'i-lucide-circle-check' })
const reviewForm = reactive({ author: '', quote: '', rating: 5, source: 'direct' })
const periodForm = reactive({ name: '', policy_id: '', start_date: '', end_date: '', priority: 0 })
const policyOptions = computed(() => (data.value?.policies ?? []).map(policy => ({ label: policy.name, value: policy.id })))
const defaultPolicyCode = computed(() => data.value?.settings?.cancellation_policy_code)

async function saveProperty() {
  saving.value = true
  const { error } = await supabase.from('properties').update({ ...propertyForm }).eq('id', id.value)
  saving.value = false
  toast.add({ title: error ? 'No se pudo guardar' : 'Propiedad guardada', description: error?.message, color: error ? 'error' : 'success' })
  if (!error) {
    await refresh()
    await refreshContext()
  }
}

async function setDefaultPolicy(code: string) {
  const { error } = await supabase.from('app_settings').update({ cancellation_policy_code: code }).eq('property_id', id.value)
  toast.add({ title: error ? 'No se pudo aplicar' : 'Política predeterminada actualizada', color: error ? 'error' : 'success' })
  if (!error) await refresh()
}

async function addPeriod() {
  if (!periodForm.name || !periodForm.policy_id || !periodForm.start_date || periodForm.end_date < periodForm.start_date) return
  const { error } = await supabase.from('property_policy_periods').insert({ ...periodForm, property_id: id.value })
  if (!error) Object.assign(periodForm, { name: '', policy_id: '', start_date: '', end_date: '', priority: 0 })
  toast.add({ title: error ? 'No se pudo crear' : 'Política de temporada creada', description: error?.message, color: error ? 'error' : 'success' })
  if (!error) await refresh()
}

function selectImage(event: Event) {
  imageFile.value = (event.target as HTMLInputElement).files?.[0] ?? null
}
async function addImage() {
  if (!imageFile.value) return
  uploadingImage.value = true
  const body = new FormData()
  body.append('file', imageFile.value)
  body.append('alt', imageForm.alt)
  try {
    await authFetch(`/api/admin/properties/${id.value}/images`, { method: 'POST', body })
    imageFile.value = null
    imageForm.alt = ''
    imageInputKey.value++
    toast.add({ title: 'Fotografía subida', color: 'success' })
    await refresh()
  } catch (error) {
    toast.add({ title: 'No se pudo subir la fotografía', description: error instanceof Error ? error.message : '', color: 'error' })
  } finally {
    uploadingImage.value = false
  }
}
async function removeImage(imageId: string) {
  try {
    await authFetch(`/api/admin/properties/${id.value}/images/${imageId}`, { method: 'DELETE' })
    await refresh()
  } catch (error) {
    toast.add({ title: 'No se pudo eliminar', description: error instanceof Error ? error.message : '', color: 'error' })
  }
}
async function makeCover(image: Image) {
  await supabase.from('property_images').update({ is_cover: false }).eq('property_id', id.value)
  await supabase.from('property_images').update({ is_cover: true }).eq('id', image.id)
  await refresh()
}
async function addFeature() {
  if (!featureForm.name) return
  const { error } = await supabase.from('property_features').insert({ ...featureForm, property_id: id.value, sort_order: data.value?.features.length ?? 0 })
  if (!error) Object.assign(featureForm, { name: '', description: '', icon: 'i-lucide-circle-check' })
  if (!error) await refresh()
}
async function addReview() {
  if (!reviewForm.author || !reviewForm.quote) return
  const { error } = await supabase.from('property_reviews').insert({ ...reviewForm, property_id: id.value, sort_order: data.value?.reviews.length ?? 0 })
  if (!error) Object.assign(reviewForm, { author: '', quote: '', rating: 5, source: 'direct' })
  if (!error) await refresh()
}
async function remove(table: 'property_features' | 'property_reviews' | 'property_policy_periods', rowId: string) {
  const { error } = await supabase.from(table).delete().eq('id', rowId)
  if (error) toast.add({ title: 'No se pudo eliminar', description: error.message, color: 'error' })
  else await refresh()
}

const modules = [
  { label: 'Ajustes y reservas', description: 'Capacidad, reglas, depósitos y cobros', icon: 'i-lucide-settings', to: '/admin/settings' },
  { label: 'Temporadas y precios', description: 'Tarifa base, temporadas y mínimos', icon: 'i-lucide-euro', to: '/admin/rates' },
  { label: 'Calendario', description: 'Disponibilidad, bloqueos y precios diarios', icon: 'i-lucide-calendar-days', to: '/admin/calendar' },
  { label: 'Fuentes de reservas', description: 'Airbnb, Booking.com, Vrbo e iCal', icon: 'i-lucide-refresh-cw', to: '/admin/channels' },
  { label: 'Reservas', description: 'Huéspedes, pagos y reservas manuales', icon: 'i-lucide-calendar-check', to: '/admin/bookings' }
]
</script>

<template>
  <UDashboardPanel id="admin-property-detail">
    <template #header>
      <UDashboardNavbar :title="data?.property?.name ?? 'Propiedad'">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            to="/admin/properties"
            color="neutral"
            variant="ghost"
            icon="i-lucide-arrow-left"
          >
            Propiedades
          </UButton>
          <UButton
            v-if="data?.property"
            :to="`/allotjament/${data.property.slug}`"
            target="_blank"
            variant="subtle"
            icon="i-lucide-external-link"
          >
            Ver ficha
          </UButton>
        </template>
      </UDashboardNavbar>
    </template>
    <template #body>
      <USkeleton
        v-if="pending"
        class="h-96"
      />
      <div
        v-else-if="data"
        class="flex flex-col gap-6"
      >
        <div class="flex flex-wrap gap-2">
          <UButton
            v-for="item in [{ v: 'content', l: 'Contenido' }, { v: 'translations', l: 'Idiomas' }, { v: 'media', l: 'Fotos y servicios' }, { v: 'reviews', l: 'Opiniones' }, { v: 'policies', l: 'Políticas' }, { v: 'operations', l: 'Operación' }]"
            :key="item.v"
            :variant="tab === item.v ? 'solid' : 'subtle'"
            @click="tab = item.v"
          >
            {{ item.l }}
          </UButton>
        </div>

        <UCard v-if="tab === 'content'">
          <template #header>
            <h2 class="font-semibold">
              Ficha comercial
            </h2>
          </template>
          <div class="grid gap-4 md:grid-cols-2">
            <UFormField
              label="Idioma original"
              description="Escribe el contenido en este idioma; la IA generará el resto."
            >
              <USelect
                v-model="propertyForm.source_locale"
                :items="localeOptions"
                class="w-full"
              />
            </UFormField>
            <div />
            <UFormField label="Nombre">
              <UInput
                v-model="propertyForm.name"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Slug">
              <UInput
                v-model="propertyForm.slug"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Descripción corta"
              class="md:col-span-2"
            >
              <UInput
                v-model="propertyForm.short_description"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Descripción"
              class="md:col-span-2"
            >
              <UTextarea
                v-model="propertyForm.description"
                :rows="6"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Dirección">
              <UInput
                v-model="propertyForm.address"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Ciudad">
              <UInput
                v-model="propertyForm.city"
                class="w-full"
              />
            </UFormField>
            <UFormField label="País">
              <UInput
                v-model="propertyForm.country"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Licencia">
              <UInput
                v-model="propertyForm.licence_number"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Dormitorios">
              <UInput
                v-model.number="propertyForm.bedrooms"
                type="number"
              />
            </UFormField>
            <UFormField label="Baños">
              <UInput
                v-model.number="propertyForm.bathrooms"
                type="number"
                step="0.5"
              />
            </UFormField>
            <UFormField label="Camas">
              <UInput
                v-model.number="propertyForm.beds"
                type="number"
              />
            </UFormField>
            <UFormField label="Superficie m²">
              <UInput
                v-model.number="propertyForm.floor_area_m2"
                type="number"
              />
            </UFormField>
            <UCheckbox
              v-model="propertyForm.published"
              label="Publicada en la web"
            />
            <UCheckbox
              v-model="propertyForm.active"
              label="Activa para reservas"
            />
          </div>
          <template #footer>
            <div class="flex justify-end">
              <UButton
                :loading="saving"
                @click="saveProperty"
              >
                Guardar ficha
              </UButton>
            </div>
          </template>
        </UCard>

        <UCard v-if="tab === 'translations'">
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 class="font-semibold">
                  Traducciones de la ficha
                </h2>
                <p class="text-sm text-muted">
                  La IA completa idiomas pendientes o desactualizados. Las revisiones manuales no se sustituyen.
                </p>
              </div>
              <UButton
                icon="i-lucide-languages"
                :loading="translating"
                @click="runTranslation()"
              >
                Actualizar traducciones con IA
              </UButton>
            </div>
          </template>
          <div class="grid gap-5 lg:grid-cols-[14rem_1fr]">
            <div class="flex flex-col gap-2">
              <UButton
                v-for="localeItem in targetLocales"
                :key="localeItem.value"
                :variant="selectedTranslationLocale === localeItem.value ? 'soft' : 'ghost'"
                color="neutral"
                class="justify-between"
                @click="selectedTranslationLocale = localeItem.value"
              >
                {{ localeItem.label }}
                <UBadge
                  v-if="data.translations.some(row => row.locale === localeItem.value)"
                  size="xs"
                  :color="data.translations.find(row => row.locale === localeItem.value)?.origin === 'manual' ? 'success' : 'info'"
                  variant="subtle"
                >
                  {{ data.translations.find(row => row.locale === localeItem.value)?.origin === 'manual' ? 'Manual' : 'IA' }}
                </UBadge>
                <UBadge
                  v-else
                  size="xs"
                  color="neutral"
                  variant="subtle"
                >
                  Pendiente
                </UBadge>
              </UButton>
            </div>
            <div class="space-y-4">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p class="text-sm text-muted">
                  {{ selectedTranslation?.origin === 'manual' ? 'Revisión manual protegida frente a la traducción masiva.' : selectedTranslation ? 'Traducción generada por IA; puedes editarla.' : 'Este idioma todavía no tiene traducción.' }}
                </p>
                <UButton
                  size="sm"
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-refresh-cw"
                  :loading="translating"
                  @click="runTranslation([selectedTranslationLocale], true)"
                >
                  {{ selectedTranslation ? 'Regenerar con IA' : 'Traducir con IA' }}
                </UButton>
              </div>
              <UFormField label="Nombre público">
                <UInput
                  v-model="translationForm.name"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Descripción corta">
                <UInput
                  v-model="translationForm.short_description"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Descripción">
                <UTextarea
                  v-model="translationForm.description"
                  :rows="8"
                  class="w-full"
                />
              </UFormField>
              <div
                v-if="translationForm.features.length"
                class="space-y-3 border-t border-default pt-4"
              >
                <div>
                  <h3 class="font-medium">
                    Características y servicios
                  </h3>
                  <p class="text-sm text-muted">
                    El icono es común a todos los idiomas; el nombre y la descripción se traducen.
                  </p>
                </div>
                <div
                  v-for="(feature, index) in translationForm.features"
                  :key="feature.id"
                  class="grid gap-2 rounded-lg border border-default p-3 md:grid-cols-2"
                >
                  <UInput
                    v-model="translationForm.features[index]!.name"
                    placeholder="Nombre traducido"
                  />
                  <UInput
                    v-model="translationForm.features[index]!.description"
                    placeholder="Descripción traducida"
                  />
                </div>
              </div>
              <div
                v-if="translationForm.reviews.length"
                class="space-y-3 border-t border-default pt-4"
              >
                <div>
                  <h3 class="font-medium">
                    Opiniones
                  </h3>
                  <p class="text-sm text-muted">
                    El autor, la puntuación y la fuente se conservan; solo se traduce el texto.
                  </p>
                </div>
                <UTextarea
                  v-for="(review, index) in translationForm.reviews"
                  :key="review.id"
                  v-model="translationForm.reviews[index]!.quote"
                  :rows="3"
                  placeholder="Opinión traducida"
                  class="w-full"
                />
              </div>
              <div class="flex justify-end">
                <UButton
                  :loading="saving"
                  @click="saveTranslation"
                >
                  Guardar revisión manual
                </UButton>
              </div>
            </div>
          </div>
        </UCard>

        <template v-if="tab === 'media'">
          <UCard>
            <template #header>
              <h2 class="font-semibold">
                Fotografías
              </h2>
            </template>
            <div class="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <label class="flex cursor-pointer items-center gap-2 rounded-md border border-default px-3 py-2 text-sm">
                <UIcon
                  name="i-lucide-upload"
                  class="size-5 text-muted"
                />
                <span class="truncate">{{ imageFile?.name ?? 'Seleccionar imagen' }}</span>
                <input
                  :key="imageInputKey"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  class="sr-only"
                  @change="selectImage"
                >
              </label>
              <UInput
                v-model="imageForm.alt"
                placeholder="Texto alternativo"
              /><UButton
                :disabled="!imageFile"
                :loading="uploadingImage"
                icon="i-lucide-cloud-upload"
                @click="addImage"
              >
                Subir a Storage
              </UButton>
            </div>
            <p class="mt-2 text-xs text-muted">
              JPG, PNG, WebP o AVIF · máximo 15 MB. El archivo queda guardado en Supabase Storage.
            </p>
            <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div
                v-for="image in data.images"
                :key="image.id"
                class="overflow-hidden rounded-lg border border-default"
              >
                <img
                  :src="image.url"
                  :alt="image.alt"
                  class="h-32 w-full object-cover"
                ><div class="flex justify-between p-2">
                  <UButton
                    size="xs"
                    :variant="image.is_cover ? 'solid' : 'ghost'"
                    @click="makeCover(image)"
                  >
                    Portada
                  </UButton><UButton
                    size="xs"
                    color="error"
                    variant="ghost"
                    icon="i-lucide-trash"
                    @click="removeImage(image.id)"
                  />
                </div>
              </div>
            </div>
          </UCard>
          <UCard>
            <template #header>
              <h2 class="font-semibold">
                Servicios y características
              </h2>
            </template>
            <div class="grid gap-2 md:grid-cols-4">
              <UInput
                v-model="featureForm.name"
                placeholder="Wifi"
              /><UInput
                v-model="featureForm.description"
                placeholder="Descripción"
              /><USelectMenu
                v-model="featureForm.icon"
                :items="featureIconOptions"
                value-key="value"
                :search-input="{ placeholder: 'Buscar icono…' }"
                placeholder="Seleccionar icono"
                class="w-full"
              /><UButton @click="addFeature">
                Añadir
              </UButton>
            </div>
            <div class="mt-4 grid gap-3 md:grid-cols-2">
              <div
                v-for="feature in data.features"
                :key="feature.id"
                class="flex items-center gap-3 rounded-lg border border-default p-3"
              >
                <UIcon
                  :name="feature.icon"
                  class="size-6 text-primary"
                /><div class="flex-1">
                  <p class="font-medium">
                    {{ feature.name }}
                  </p><p class="text-sm text-muted">
                    {{ feature.description }}
                  </p>
                </div><UButton
                  color="error"
                  variant="ghost"
                  icon="i-lucide-trash"
                  @click="remove('property_features', feature.id)"
                />
              </div>
            </div>
          </UCard>
        </template>

        <UCard v-if="tab === 'reviews'">
          <template #header>
            <h2 class="font-semibold">
              Opiniones
            </h2>
          </template>
          <div class="grid gap-2 md:grid-cols-5">
            <UInput
              v-model="reviewForm.author"
              placeholder="Autor"
            /><UInput
              v-model="reviewForm.quote"
              placeholder="Opinión"
              class="md:col-span-2"
            /><UInput
              v-model.number="reviewForm.rating"
              type="number"
              min="0"
              max="5"
              step="0.5"
            /><UButton @click="addReview">
              Añadir
            </UButton>
          </div>
          <div class="mt-4 space-y-3">
            <div
              v-for="review in data.reviews"
              :key="review.id"
              class="flex gap-3 rounded-lg border border-default p-4"
            >
              <div class="flex-1">
                <p class="font-medium">
                  {{ review.author }} · {{ review.rating }}/5
                </p><p class="text-sm text-muted">
                  {{ review.quote }}
                </p>
              </div><UButton
                color="error"
                variant="ghost"
                icon="i-lucide-trash"
                @click="remove('property_reviews', review.id)"
              />
            </div>
          </div>
        </UCard>

        <template v-if="tab === 'policies'">
          <UCard>
            <template #header>
              <h2 class="font-semibold">
                Política predeterminada
              </h2>
            </template>
            <USelect
              :model-value="defaultPolicyCode"
              :items="data.policies.map(p => ({ label: p.name, value: p.code }))"
              class="max-w-md"
              @update:model-value="value => value && setDefaultPolicy(String(value))"
            />
          </UCard>
          <UCard>
            <template #header>
              <h2 class="font-semibold">
                Políticas por temporada
              </h2>
            </template>
            <div class="grid gap-2 md:grid-cols-6">
              <UInput
                v-model="periodForm.name"
                placeholder="Verano"
              /><USelect
                v-model="periodForm.policy_id"
                :items="policyOptions"
              /><UInput
                v-model="periodForm.start_date"
                type="date"
              /><UInput
                v-model="periodForm.end_date"
                type="date"
              /><UInput
                v-model.number="periodForm.priority"
                type="number"
              /><UButton @click="addPeriod">
                Añadir
              </UButton>
            </div>
            <div class="mt-4 space-y-2">
              <div
                v-for="period in data.periods"
                :key="period.id"
                class="flex items-center gap-3 rounded-lg border border-default p-3"
              >
                <div class="flex-1">
                  <p class="font-medium">
                    {{ period.name }} · {{ period.cancellation_policies.name }}
                  </p><p class="text-sm text-muted">
                    {{ period.start_date }} → {{ period.end_date }} · prioridad {{ period.priority }}
                  </p>
                </div><UButton
                  color="error"
                  variant="ghost"
                  icon="i-lucide-trash"
                  @click="remove('property_policy_periods', period.id)"
                />
              </div>
            </div>
          </UCard>
        </template>

        <div
          v-if="tab === 'operations'"
          class="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          <UCard
            v-for="module in modules"
            :key="module.to"
          >
            <div class="flex gap-3">
              <UIcon
                :name="module.icon"
                class="size-8 text-primary"
              /><div>
                <h3 class="font-semibold">
                  {{ module.label }}
                </h3><p class="text-sm text-muted">
                  {{ module.description }}
                </p>
              </div>
            </div><template #footer>
              <UButton
                :to="`${module.to}?property=${id}`"
                block
              >
                Gestionar
              </UButton>
            </template>
          </UCard>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
