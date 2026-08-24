/**
 * Guards every /admin route. Runs on the client (the admin area is `ssr: false`),
 * and is only the first line of defence — the database enforces the same rule
 * through RLS, and /api/admin/* re-checks it server-side.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const user = useSupabaseUser()

  if (!user.value) {
    return navigateTo({ path: '/admin/login', query: { redirect: to.fullPath } })
  }

  const supabase = useDb()
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.value.id)
    .single()

  if ((profile as { role?: string } | null)?.role !== 'admin') {
    return navigateTo({ path: '/admin/login', query: { denied: '1' } })
  }
})
