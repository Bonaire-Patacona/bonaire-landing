import type { NitroFetchOptions } from 'nitropack'

/**
 * Thin wrapper around $fetch for /api/admin/* that attaches the Supabase access
 * token. The cookie alone would usually do, but the explicit header keeps the
 * calls working from any context (SSR probes, tools, a future mobile client).
 */
export function useAdminApi() {
  const supabase = useDb()
  const route = useRoute()

  async function authFetch<T>(url: string, options: NitroFetchOptions<string> = {}): Promise<T> {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    return $fetch<T>(url, {
      ...options,
      headers: {
        ...(options.headers as Record<string, string> | undefined),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(typeof route.query.property === 'string'
          ? { 'X-Property-Id': route.query.property }
          : {})
      }
    } as NitroFetchOptions<string>) as Promise<T>
  }

  return { authFetch }
}

/** The signed-in back-office profile, resolved once per page load. */
export function useAdminProfile() {
  const user = useSupabaseUser()
  const supabase = useDb()

  return useAsyncData('admin-profile', async () => {
    if (!user.value) return null
    const { data } = await supabase
      .from('profiles')
      .select('id, email, full_name, role')
      .eq('id', user.value.id)
      .single()
    return data as { id: string, email: string, full_name: string | null, role: string } | null
  }, { watch: [user] })
}
