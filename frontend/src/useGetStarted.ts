import { authEnabled, supabase } from './auth'
import { navigate } from './nav'

// What every "Get started" and "Sign in" link does: the sign-in page, or
// straight to the app for someone who is already signed in.
export function useGetStarted() {
  async function start() {
    // Already signed in (or local development without sign-in): go to the app.
    const session = supabase ? (await supabase.auth.getSession()).data.session : null
    if (!authEnabled || session) window.location.assign('/')
    else navigate('/sign-in')
  }

  return { start: () => void start() }
}
