import { useState } from 'react'
import { signInWithGoogle } from './auth'
import styles from './SignIn.module.css'

function SignIn() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setBusy(true)
    setError(null)
    // On success the browser goes to Google and comes back signed in.
    const message = await signInWithGoogle()
    if (message) {
      setError(message)
      setBusy(false)
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>divthink</h1>
        <p className={styles.tagline}>
          Branch, explore, and merge conversations with AI on an open canvas.
        </p>
        <button type="button" className={styles.button} onClick={() => void start()} disabled={busy}>
          {busy ? 'Redirecting…' : 'Continue with Google'}
        </button>
        {error && <p className={styles.error}>{error}</p>}
        <p className={styles.note}>After signing in, add your own Anthropic or Google API key.</p>
      </div>
    </main>
  )
}

export default SignIn
