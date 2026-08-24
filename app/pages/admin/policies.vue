<script setup lang="ts">
/**
 * Cancellation policies: a refund ladder each, ordered most generous first.
 * One of them is the one new bookings are sold under; every booking keeps a
 * frozen copy of it, so editing a policy never rewrites terms already agreed.
 */
defineI18nRoute(false)
definePageMeta({ layout: 'admin', middleware: 'admin' })

interface RefundTier {
  days_before: number
  refund_pct: number
}

interface Policy {
  id: string
  code: string
  name: string
  builtin: boolean
  tiers: RefundTier[]
  notes: string
  active: boolean
  sort_order: number
}

const supabase = useDb()
const toast = useToast()

const busy = ref(false)
const showForm = ref(false)
const editing = ref<Policy | null>(null)

const form = reactive({
  name: '',
  notes: '',
  active: true,
  tiers: [] as RefundTier[]
})

const { data: policies, refresh, pending } = await useAsyncData<Policy[]>(
  'admin-policies',
  async () => {
    const { data } = await supabase.from('cancellation_policies').select('*').order('sort_order')
    return (data ?? []) as Policy[]
  }
)

const { data: settings, refresh: refreshSettings } = await useAsyncData('admin-policies-settings', async () => {
  const { data } = await supabase
    .from('app_settings').select('cancellation_policy_code').eq('id', 1).single()
  return data as { cancellation_policy_code: string } | null
})

const activeCode = computed(() => settings.value?.cancellation_policy_code ?? '')

/** Human summary of a ladder, in the host's language rather than the guest's. */
function describe(policy: Policy): string {
  if (!policy.tiers.length) return 'Sin reembolso en ningún caso'
  return policy.tiers
    .map(tier => tier.days_before > 0
      ? `${tier.refund_pct}% hasta ${tier.days_before} días antes`
      : `${tier.refund_pct}% hasta la entrada`)
    .join(' · ')
}

function openCreate() {
  editing.value = null
  Object.assign(form, { name: '', notes: '', active: true, tiers: [{ days_before: 14, refund_pct: 100 }] })
  showForm.value = true
}

function openEdit(policy: Policy) {
  editing.value = policy
  Object.assign(form, {
    name: policy.name,
    notes: policy.notes,
    active: policy.active,
    tiers: policy.tiers.map(tier => ({ ...tier }))
  })
  showForm.value = true
}

function addTier() {
  form.tiers.push({ days_before: 0, refund_pct: 0 })
}

function removeTier(index: number) {
  form.tiers.splice(index, 1)
}

/** A stable, readable code for a policy the host invents. */
function slugify(name: string): string {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    .slice(0, 40) || `policy_${Date.now()}`
}

async function save() {
  if (!form.name.trim()) {
    toast.add({ title: 'La política necesita un nombre', color: 'error' })
    return
  }

  // Most generous first is what the refund lookup assumes, so sort on the way in
  // instead of trusting the order the rows were typed in.
  const tiers = form.tiers
    .map(tier => ({
      days_before: Math.max(0, Math.trunc(Number(tier.days_before) || 0)),
      refund_pct: Math.min(100, Math.max(0, Math.trunc(Number(tier.refund_pct) || 0)))
    }))
    .sort((a, b) => b.days_before - a.days_before)

  busy.value = true
  const payload = { name: form.name.trim(), notes: form.notes.trim(), active: form.active, tiers }
  const { error } = editing.value
    ? await supabase.from('cancellation_policies').update(payload).eq('id', editing.value.id)
    : await supabase.from('cancellation_policies').insert({
        ...payload,
        code: slugify(form.name),
        builtin: false,
        sort_order: 100
      })
  busy.value = false

  if (error) {
    toast.add({ title: 'No se pudo guardar', description: error.message, color: 'error' })
    return
  }
  toast.add({ title: 'Política guardada', color: 'success' })
  showForm.value = false
  await refresh()
}

async function apply(policy: Policy) {
  busy.value = true
  const { error } = await supabase
    .from('app_settings').update({ cancellation_policy_code: policy.code }).eq('id', 1)
  busy.value = false

  if (error) {
    toast.add({ title: 'No se pudo aplicar', description: error.message, color: 'error' })
    return
  }
  toast.add({
    title: `Las reservas nuevas usarán «${policy.name}»`,
    description: 'Las reservas ya hechas mantienen la política que aceptaron.',
    color: 'success'
  })
  await refreshSettings()
}

async function remove(policy: Policy) {
  if (policy.code === activeCode.value) {
    toast.add({ title: 'No se puede borrar la política en uso', color: 'error' })
    return
  }
  if (!confirm(`¿Eliminar «${policy.name}»?`)) return

  const { error } = await supabase.from('cancellation_policies').delete().eq('id', policy.id)
  if (error) {
    toast.add({ title: 'No se pudo eliminar', description: error.message, color: 'error' })
    return
  }
  await refresh()
}

useSeoMeta({ title: 'Cancelaciones · Bonaire Patacona', robots: 'noindex, nofollow' })
</script>

<template>
  <UDashboardPanel id="admin-policies">
    <template #header>
      <UDashboardNavbar title="Cancelaciones">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-plus"
            @click="openCreate"
          >
            Nueva política
          </UButton>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-6 max-w-3xl">
        <UAlert
          color="neutral"
          variant="subtle"
          icon="i-lucide-info"
          title="Cómo se lee una política"
          description="Cada tramo dice cuánto se devuelve si se cancela con esa antelación mínima. Gana el primer tramo al que el huésped todavía llega; si no llega a ninguno, no hay reembolso. El huésped la ve traducida a su idioma."
        />

        <USkeleton
          v-if="pending"
          class="h-48 w-full"
        />

        <div
          v-else
          class="flex flex-col gap-3"
        >
          <UCard
            v-for="policy in policies"
            :key="policy.id"
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="font-semibold text-highlighted">
                    {{ policy.name }}
                  </h3>
                  <UBadge
                    v-if="policy.code === activeCode"
                    color="success"
                    variant="subtle"
                  >
                    En uso
                  </UBadge>
                  <UBadge
                    v-if="policy.builtin"
                    color="neutral"
                    variant="subtle"
                  >
                    Predefinida
                  </UBadge>
                  <UBadge
                    v-if="!policy.active"
                    color="warning"
                    variant="subtle"
                  >
                    Inactiva
                  </UBadge>
                </div>
                <p class="mt-1 text-sm text-muted">
                  {{ describe(policy) }}
                </p>
                <p
                  v-if="policy.notes"
                  class="mt-1 text-xs text-dimmed whitespace-pre-line"
                >
                  {{ policy.notes }}
                </p>
              </div>

              <div class="flex shrink-0 gap-2">
                <UButton
                  v-if="policy.code !== activeCode"
                  size="sm"
                  variant="subtle"
                  :loading="busy"
                  @click="apply(policy)"
                >
                  Aplicar
                </UButton>
                <UButton
                  icon="i-lucide-pencil"
                  size="sm"
                  color="neutral"
                  variant="ghost"
                  aria-label="Editar"
                  @click="openEdit(policy)"
                />
                <UButton
                  v-if="!policy.builtin"
                  icon="i-lucide-trash-2"
                  size="sm"
                  color="neutral"
                  variant="ghost"
                  aria-label="Eliminar"
                  @click="remove(policy)"
                />
              </div>
            </div>
          </UCard>
        </div>
      </div>

      <UModal
        v-model:open="showForm"
        :title="editing ? 'Editar política' : 'Nueva política'"
        description="Los tramos se ordenan solos, del más generoso al menos."
      >
        <template #body>
          <div class="flex flex-col gap-4">
            <UFormField
              label="Nombre"
              required
            >
              <UInput
                v-model="form.name"
                class="w-full"
              />
            </UFormField>

            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium text-highlighted">Tramos de reembolso</span>
                <UButton
                  icon="i-lucide-plus"
                  size="xs"
                  variant="ghost"
                  @click="addTier"
                >
                  Añadir
                </UButton>
              </div>

              <p
                v-if="!form.tiers.length"
                class="text-xs text-muted"
              >
                Sin tramos: la reserva no es reembolsable en ningún momento.
              </p>

              <div
                v-for="(tier, index) in form.tiers"
                :key="index"
                class="flex items-end gap-2"
              >
                <UFormField
                  label="Devolver (%)"
                  class="flex-1"
                >
                  <UInputNumber
                    v-model="tier.refund_pct"
                    :min="0"
                    :max="100"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  label="Si cancela con (días)"
                  class="flex-1"
                >
                  <UInputNumber
                    v-model="tier.days_before"
                    :min="0"
                    class="w-full"
                  />
                </UFormField>
                <UButton
                  icon="i-lucide-trash-2"
                  color="neutral"
                  variant="ghost"
                  aria-label="Quitar tramo"
                  @click="removeTier(index)"
                />
              </div>
            </div>

            <UFormField
              label="Condiciones adicionales"
              hint="Se muestran tal cual, sin traducir"
            >
              <UTextarea
                v-model="form.notes"
                :rows="3"
                class="w-full"
              />
            </UFormField>

            <UFormField label="Disponible">
              <USwitch
                v-model="form.active"
                label="Se puede aplicar"
              />
            </UFormField>
          </div>
        </template>
        <template #footer>
          <div class="flex justify-end gap-2 w-full">
            <UButton
              color="neutral"
              variant="ghost"
              @click="showForm = false"
            >
              Cancelar
            </UButton>
            <UButton
              :loading="busy"
              @click="save"
            >
              Guardar
            </UButton>
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
