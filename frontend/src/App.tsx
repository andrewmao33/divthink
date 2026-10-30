import { useEffect, useState } from 'react'
import { authEnabled, supabase, type Session } from './auth'
import Canvas from './Canvas'
import Landing from './Landing'
import { currentPath, navigate } from './nav'
import Plans from './Plans'
import { firstStop } from './upgrade'
import Privacy from './Privacy'
import Terms from './Terms'
import SignIn from './SignIn'
import { resetCanvas } from './store'

function App() {
  // undefined: still checking for an existing sign-in.
  const [session, setSession] = useState<Session | null | undefined>(authEnabled ? undefined : null)

  // Which page is showing. Follows the address bar: nav.ts changes it without a
  // reload, and the back and forward buttons change it too.
  const [path, setPath] = useState(currentPath)

  useEffect(() => {
    const onChange = () => setPath(currentPath())
    window.addEventListener('popstate', onChange)
    return () => window.removeEventListener('popstate', onChange)
  }, [])

  // The account whose first stop (checkout, the plans, or the canvas) has been
  // decided. Until then nothing shows, so the canvas doesn't flash first.
  const userId = session?.user.id ?? null
  const [routedFor, setRoutedFor] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void firstStop(userId).then((stop) => {
      if (cancelled || stop === 'checkout') return // leaving for Stripe
      if (stop && currentPath() !== stop) navigate(stop)
      setRoutedFor(userId)
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!next) resetCanvas() // signed out, possibly in another tab
      setSession(next)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // Readable signed in or out. /privacy.html is the policy's old address, which
  // Google's sign-in consent screen may still link to.
  if (path === '/privacy' || path === '/privacy.html') return <Privacy />
  if (path === '/terms') return <Terms />
  // Local development without sign-in.
  if (!authEnabled) return path === '/plans' ? <Plans userId="dev" /> : <Canvas />
  if (session === undefined) return null
  // Signed in, the canvas shows at any address, /sign-in included; it puts
  // its own address in the bar.
  if (session) {
    if (routedFor !== session.user.id) return null
    return path === '/plans' ? <Plans userId={session.user.id} /> : <Canvas />
  }
  if (path === '/sign-up') return <SignIn mode="sign-up" />
  if (path === '/sign-in') return <SignIn mode="log-in" />
  return <Landing />
}

export default App
