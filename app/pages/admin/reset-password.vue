<script setup lang="ts">
defineI18nRoute(false)
definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const toast = useToast()

const password = ref('')
const confirm = ref('')
const loading = ref(false)

const valid = computed(() => password.value.length >= 10 && password.value === confirm.value)

async function save() {
  loading.value = true
  const { error } = await supabase.auth.updateUser({ password: password.value })
  loading.value = false

  toast.add({
    title: error ? 'No se pudo cambiar la contraseña' : 'Contraseña actualizada',
    description: error?.message,
    color: error ? 'error' : 'success'
  })

  if (!error) await navigateTo('/admin')
}

useSeoMeta({ title: 'Nueva contraseña', robots: 'noindex, nofollow' })
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-muted p-4">
    <UCard class="w-full max-w-sm">
      <template #header>
        <h1 class="font-semibold text-highlighted">
          Elige una contraseña nueva
        </h1>
      </template>

      <form
        class="flex flex-col gap-4"
        @submit.prevent="save"
      >
        <UFormField
          label="Contraseña"
          hint="Mínimo 10 caracteres"
          required
        >
          <UInput
            v-model="password"
            type="password"
            autocomplete="new-password"
            class="w-full"
          />
        </UFormField>
        <UFormField
          label="Repite la contraseña"
          required
        >
          <UInput
            v-model="confirm"
            type="password"
            autocomplete="new-password"
            class="w-full"
          />
        </UFormField>
        <UButton
          type="submit"
          block
          :loading="loading"
          :disabled="!valid"
        >
          Guardar
        </UButton>
      </form>
    </UCard>
  </div>
</template>
