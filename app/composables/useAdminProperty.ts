export interface AdminProperty {
  id: string
  slug: string
  name: string
  active: boolean
  is_default: boolean
}

/** Shared, persistent property context for every back-office screen. */
export function useAdminProperty() {
  const supabase = useDb()
  const route = useRoute()
  const selected = useCookie<string | null>('admin-property-id', {
    default: () => null,
    sameSite: 'lax'
  })

  const { data: properties, pending, refresh } = useAsyncData<AdminProperty[]>(
    'admin-property-context',
    async () => {
      const { data, error } = await supabase.from('properties')
        .select('id, slug, name, active, is_default')
        .eq('active', true)
        .order('name')
      if (error) throw error
      return (data ?? []) as AdminProperty[]
    },
    { default: () => [] }
  )

  const propertyId = computed(() => {
    const rows = properties.value ?? []
    const requested = typeof route.query.property === 'string' ? route.query.property : null
    if (requested && rows.some(property => property.id === requested)) return requested
    if (selected.value && rows.some(property => property.id === selected.value)) return selected.value
    return rows.find(property => property.is_default)?.id ?? rows[0]?.id ?? null
  })
  const property = computed(() => properties.value?.find(item => item.id === propertyId.value) ?? null)

  function selectProperty(id: string) {
    selected.value = id
  }

  return { properties, property, propertyId, pending, refresh, selectProperty }
}
