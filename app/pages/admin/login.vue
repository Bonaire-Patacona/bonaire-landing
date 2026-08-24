<script setup lang="ts">
defineI18nRoute(false)

definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const user = useSupabaseUser()
const route = useRoute()
const toast = useToast()

const email = ref('')
const password = ref('')
const loading = ref(false)
const errorMessage = ref<string | null>(
  route.query.denied === '1' ? 'Esta cuenta no tiene permisos de administrador.' : null
)

watchEffect(() => {
  if (user.value && !route.query.denied) {
    navigateTo(String(route.query.redirect ?? '/admin'))
  }
})

async function signIn() {
  loading.value = true
  errorMessage.value = null

  const { error } = await supabase.auth.signInWithPassword({
    email: email.value.trim(),
    password: password.value
  })

  loading.value = false

  if (error) {
    errorMessage.value = 'Email o contraseña incorrectos.'
    return
  }
  await navigateTo(String(route.query.redirect ?? '/admin'))
}

async function resetPassword() {
  if (!email.value.trim()) {
    errorMessage.value = 'Escribe tu email para recibir el enlace de recuperación.'
    return
  }
  const { error } = await supabase.auth.resetPasswordForEmail(email.value.trim(), {
    redirectTo: `${window.location.origin}/admin/reset-password`
  })
  toast.add({
    title: error ? 'No se pudo enviar el correo' : 'Revisa tu correo',
    description: error ? error.message : 'Te hemos enviado un enlace para restablecer la contraseña.',
    color: error ? 'error' : 'success'
  })
}

useSeoMeta({ title: 'Acceso · Bonaire Patacona', robots: 'noindex, nofollow' })
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-muted p-4">
    <UCard class="w-full max-w-sm">
      <template #header>
        <div class="flex flex-col items-center gap-2 text-center">
          <LogoSquare class="h-16 w-auto" />
          <h1 class="text-lg font-semibold text-highlighted">
            Panel de administración
          </h1>
        </div>
      </template>

      <form
        class="flex flex-col gap-4"
        @submit.prevent="signIn"
      >
        <UAlert
          v-if="errorMessage"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :description="errorMessage"
        />

        <UFormField
          label="Email"
          required
        >
          <UInput
            v-model="email"
            type="email"
            autocomplete="username"
            class="w-full"
          />
        </UFormField>

        <UFormField
          label="Contraseña"
          required
        >
          <UInput
            v-model="password"
            type="password"
            autocomplete="current-password"
            class="w-full"
          />
        </UFormField>

        <UButton
          type="submit"
          block
          :loading="loading"
        >
          Entrar
        </UButton>

        <UButton
          variant="link"
          color="neutral"
          size="xs"
          block
          @click="resetPassword"
        >
          He olvidado mi contraseña
        </UButton>
      </form>
    </UCard>
  </div>
</template>
