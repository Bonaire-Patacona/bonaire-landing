<script setup lang="ts">
defineI18nRoute(false)
definePageMeta({ layout: 'admin', middleware: 'admin' })

interface Property {
  id: string
  slug: string
  name: string
  active: boolean
  is_default: boolean
  published: boolean
  created_at: string
}

const { authFetch } = useAdminApi()
const toast = useToast()
const { refresh: refreshPropertyContext } = useAdminProperty()
const creating = ref(false)
const formOpen = ref(false)
const slugEdited = ref(false)
const form = reactive({ name: '', slug: '' })

const { data: properties, refresh, pending } = await useAsyncData(
  'admin-properties',
  () => authFetch<Property[]>('/api/admin/properties')
)

function slugify(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function updateName(value: string) {
  if (!slugEdited.value) form.slug = slugify(value)
}

async function createProperty() {
  if (form.name.trim().length < 2 || !form.slug) return
  creating.value = true
  try {
    await authFetch<Property>('/api/admin/properties', {
      method: 'POST',
      body: { name: form.name.trim(), slug: form.slug }
    })
    toast.add({ title: 'Propiedad creada', color: 'success' })
    form.name = ''
    form.slug = ''
    slugEdited.value = false
    formOpen.value = false
    await refresh()
    await refreshPropertyContext()
  } catch (error) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({
      title: 'No se ha podido crear la propiedad',
      description: err.data?.statusMessage,
      color: 'error'
    })
  } finally {
    creating.value = false
  }
}

useSeoMeta({ title: 'Propiedades · Administración', robots: 'noindex, nofollow' })
</script>

<template>
  <UDashboardPanel id="admin-properties">
    <template #header>
      <UDashboardNavbar title="Propiedades">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-plus"
            @click="formOpen = !formOpen"
          >
            Nueva propiedad
          </UButton>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-6">
        <UCard v-if="formOpen">
          <template #header>
            <h2 class="font-semibold text-highlighted">
              Nueva propiedad
            </h2>
          </template>
          <form
            class="grid gap-4 sm:grid-cols-2"
            @submit.prevent="createProperty"
          >
            <UFormField
              label="Nombre"
              required
            >
              <UInput
                v-model="form.name"
                class="w-full"
                placeholder="Apartamento del puerto"
                autofocus
                @update:model-value="updateName"
              />
            </UFormField>
            <UFormField
              label="Identificador URL"
              required
              hint="Solo minúsculas, números y guiones"
            >
              <UInput
                v-model="form.slug"
                class="w-full"
                placeholder="apartamento-del-puerto"
                @update:model-value="slugEdited = true"
              />
            </UFormField>
            <div class="flex justify-end gap-2 sm:col-span-2">
              <UButton
                color="neutral"
                variant="ghost"
                @click="formOpen = false"
              >
                Cancelar
              </UButton>
              <UButton
                type="submit"
                :loading="creating"
                :disabled="form.name.trim().length < 2 || !form.slug"
              >
                Crear propiedad
              </UButton>
            </div>
          </form>
        </UCard>

        <div
          v-if="pending"
          class="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          <USkeleton
            v-for="item in 3"
            :key="item"
            class="h-40"
          />
        </div>

        <div
          v-else
          class="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          <UCard
            v-for="property in properties"
            :key="property.id"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <h2 class="truncate font-semibold text-highlighted">
                    {{ property.name }}
                  </h2>
                  <UBadge
                    v-if="property.is_default"
                    size="sm"
                    variant="subtle"
                  >
                    Predeterminada
                  </UBadge>
                  <UBadge
                    v-if="!property.active"
                    size="sm"
                    color="neutral"
                    variant="subtle"
                  >
                    Inactiva
                  </UBadge>
                  <UBadge
                    v-if="!property.published"
                    size="sm"
                    color="warning"
                    variant="subtle"
                  >
                    Borrador
                  </UBadge>
                </div>
                <p class="mt-1 text-sm text-muted">
                  {{ property.slug }}
                </p>
              </div>
              <UIcon
                name="i-lucide-house"
                class="size-6 shrink-0 text-primary"
              />
            </div>
            <template #footer>
              <div class="grid grid-cols-2 gap-2">
                <UButton
                  :to="`/admin/properties/${property.id}`"
                  icon="i-lucide-settings"
                  block
                >
                  Gestionar
                </UButton>
                <UButton
                  :to="`/allotjament/${property.slug}`"
                  target="_blank"
                  color="neutral"
                  variant="subtle"
                  icon="i-lucide-external-link"
                  block
                  :disabled="!property.published"
                >
                  Ver ficha
                </UButton>
              </div>
            </template>
          </UCard>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
