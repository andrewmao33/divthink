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

// Signing in with a code sent by email: the first call sends it, the second
// checks it. Signing up creates the account on first use, as Google sign-in
// does; logging in only works for an account that exists. Each resolves to an
// error to show, or null.
export const NO_ACCOUNT = 'There’s no account with that email.'

export async function sendEmailCode(email: string, createAccount: boolean): Promise<string | null> {
  if (!supabase) return null
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: createAccount } })
  if (!error) return null
  // What Supabase says when logging in names an address with no account.
  if (error.code === 'otp_disabled' || /signups not allowed/i.test(error.message)) return NO_ACCOUNT
  if (error.status === 429) return 'Too many codes asked for. Wait a minute, then try again.'
  if (error.code === 'email_address_invalid') return "That doesn't look like an email address."
  return error.message
}

export async function verifyEmailCode(email: string, code: string): Promise<string | null> {
  if (!supabase) return null
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
  if (!error) return null
  if (error.status === 429) return 'Too many tries. Wait a minute, then try again.'
  return "That code didn't work. It may have expired: check it, or send a new one."
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut()
}
