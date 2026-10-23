import { authEnabled, supabase } from './auth'
import { navigate } from './nav'
import { checkoutAfterSignIn } from './upgrade'

// What every "Get started" and "Sign in" link does: the sign-up or log-in
// page, or straight to the app for someone who is already signed in. `forPro`
// ("Get Pro") goes on to Stripe's checkout once signed in.
export function useGetStarted() {
  async function start(page: '/sign-up' | '/sign-in', forPro = false) {
    checkoutAfterSignIn(forPro)
    // Already signed in (or local development without sign-in): go to the app.
    const session = supabase ? (await supabase.auth.getSession()).data.session : null
    if (!authEnabled || session) window.location.assign('/')
    else navigate(page)
  }

  return {
    start: () => void start('/sign-up'),
    startPro: () => void start('/sign-up', true),
    logIn: () => void start('/sign-in'),
  }
}
