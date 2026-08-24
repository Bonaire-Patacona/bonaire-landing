<script setup lang="ts">
const supabase = useSupabaseClient()
const { data: profile } = useAdminProfile()

const links = [[{
  label: 'Panel',
  icon: 'i-lucide-layout-dashboard',
  to: '/admin'
}, {
  label: 'Reservas',
  icon: 'i-lucide-calendar-check',
  to: '/admin/bookings'
}, {
  label: 'Calendario',
  icon: 'i-lucide-calendar-days',
  to: '/admin/calendar'
}, {
  label: 'Precios',
  icon: 'i-lucide-euro',
  to: '/admin/rates'
}, {
  label: 'Canales',
  icon: 'i-lucide-refresh-cw',
  to: '/admin/channels'
}, {
  label: 'Ajustes',
  icon: 'i-lucide-settings',
  to: '/admin/settings'
}], [{
  label: 'Ver la web',
  icon: 'i-lucide-external-link',
  to: '/',
  target: '_blank'
}]]

async function signOut() {
  await supabase.auth.signOut()
  await navigateTo('/admin/login')
}
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar
      collapsible
      resizable
      :ui="{ footer: 'border-t border-default' }"
    >
      <template #header="{ collapsed }">
        <NuxtLink
          to="/admin"
          class="flex items-center gap-2"
        >
          <LogoSquare class="h-8 w-auto shrink-0" />
          <span
            v-if="!collapsed"
            class="font-semibold text-highlighted truncate"
          >Bonaire Patacona</span>
        </NuxtLink>
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu
          :items="links[0]"
          :collapsed="collapsed"
          orientation="vertical"
        />
        <UNavigationMenu
          :items="links[1]"
          :collapsed="collapsed"
          orientation="vertical"
          class="mt-auto"
        />
      </template>

      <template #footer="{ collapsed }">
        <div class="flex w-full items-center gap-2">
          <UAvatar
            :alt="profile?.email ?? 'Admin'"
            size="sm"
          />
          <div
            v-if="!collapsed"
            class="min-w-0 flex-1"
          >
            <p class="truncate text-sm font-medium text-highlighted">
              {{ profile?.full_name || profile?.email }}
            </p>
          </div>
          <UButton
            icon="i-lucide-log-out"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Cerrar sesión"
            @click="signOut"
          />
        </div>
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
