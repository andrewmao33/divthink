import { useEffect, useState } from 'react'
import { authEnabled, supabase, type Session } from './auth'
import Canvas from './Canvas'
import SignIn from './SignIn'
import { resetCanvas } from './store'

function App() {
  // undefined: still checking for an existing sign-in.
  const [session, setSession] = useState<Session | null | undefined>(authEnabled ? undefined : null)

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!next) resetCanvas() // signed out, possibly in another tab
      setSession(next)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  if (!authEnabled) return <Canvas /> // local development without sign-in
  if (session === undefined) return null
  return session ? <Canvas /> : <SignIn />
}

export default App
