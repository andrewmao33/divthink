import { createClient, type Session } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

// Sign-in is on when Supabase is configured. Local development can run without it
// (the backend then uses a built-in dev user).
export const authEnabled = Boolean(url && publishableKey)
export const supabase = authEnabled ? createClient(url!, publishableKey!) : null

export type { Session }

// The current access token for API calls, refreshed by supabase-js when it expires.
export async function accessToken(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

export async function signInWithGoogle(): Promise<string | null> {
  if (!supabase) return null
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  })
  return error?.message ?? null
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut()
}
