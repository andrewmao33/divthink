import { useEffect, useState } from 'react'
import { authEnabled, supabase, type Session } from './auth'
import Canvas from './Canvas'
import Landing from './Landing'
import { currentPath } from './nav'
import Privacy from './Privacy'
import Terms from './Terms'
import SignIn from './SignIn'
import { resetCanvas } from './store'

// A public canvas, readable with no account: divthink.com/?demo=<session id>
const demoId = new URLSearchParams(window.location.search).get('demo')

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
  if (demoId) return <Canvas demoId={demoId} /> // public canvas, no sign-in
  if (!authEnabled) return <Canvas /> // local development without sign-in
  if (session === undefined) return null
  // Signed in, the canvas shows at any address, /sign-in included; it puts
  // its own address in the bar.
  if (session) return <Canvas />
  return path === '/sign-in' ? <SignIn /> : <Landing />
}

export default App
