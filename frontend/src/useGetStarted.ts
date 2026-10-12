import { useState } from 'react'
import { authEnabled, signInWithGoogle, supabase } from './auth'

// What every "Get started" link does: sign in with Google, or go straight to
// the app for someone who already is.
export function useGetStarted() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setBusy(true)
    setError(null)
    // Already signed in (or local development without sign-in): go to the app.
    const session = supabase ? (await supabase.auth.getSession()).data.session : null
    if (!authEnabled || session) {
      window.location.assign('/')
      return
    }
    // On success the browser leaves for Google and comes back signed in.
    const message = await signInWithGoogle()
    if (message) {
      setError(message)
      setBusy(false)
    }
  }

  return { busy, error, start: () => void start() }
}
