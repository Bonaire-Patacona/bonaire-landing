import { serviceClient } from './supabase'

// No 0/O/1/I: these codes get read out loud over the phone.
const ALPHABET = 'ACDEFGHJKLMNPQRSTUVWXYZ23456789'

function randomCode(length = 6): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return out
}

/** Human-friendly booking reference, e.g. BP-7KQ4XM. Retries on collision. */
export async function generateReference(): Promise<string> {
  const supabase = serviceClient()

  for (let attempt = 0; attempt < 8; attempt++) {
    const reference = `BP-${randomCode()}`
    const { data, error } = await supabase
      .from('bookings').select('id').eq('reference', reference).maybeSingle()

    if (error) {
      console.error('[reference] lookup failed:', error)
      break
    }
    if (!data) return reference
  }

  // Astronomically unlikely; fall back to something guaranteed unique.
  return `BP-${Date.now().toString(36).toUpperCase()}`
}
