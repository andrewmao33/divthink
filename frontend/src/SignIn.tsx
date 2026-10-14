import { useEffect, useRef, useState, type FormEvent } from 'react'
import { sendEmailCode, signInWithGoogle, verifyEmailCode } from './auth'
import { onLinkClick } from './nav'
import SiteShell from './SiteShell'
import styles from './SignIn.module.css'

// How long before another code can be sent to the same address.
const RESEND_WAIT_S = 60

// Signing in and signing up, which are the same step: Google, or a code sent
// to an email address. Once signed in, App shows the canvas in place of this.
function SignIn() {
  const [email, setEmail] = useState('')
  // The address a code went to; null while it is still being asked for.
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'google' | 'send' | 'verify' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wait, setWait] = useState(0)
  const codeInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (wait <= 0) return
    const timer = setTimeout(() => setWait(wait - 1), 1000)
    return () => clearTimeout(timer)
  }, [wait])

  useEffect(() => {
    if (sentTo) codeInput.current?.focus()
  }, [sentTo])

  async function google() {
    setBusy('google')
    setError(null)
    // On success the browser leaves for Google and comes back signed in.
    const message = await signInWithGoogle()
    if (message) {
      setError(message)
      setBusy(null)
    }
  }

  async function send(address: string) {
    setBusy('send')
    setError(null)
    const message = await sendEmailCode(address)
    setBusy(null)
    if (message) {
      setError(message)
      return
    }
    setSentTo(address)
    setCode('')
    setWait(RESEND_WAIT_S)
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    if (!sentTo) return
    setBusy('verify')
    setError(null)
    // On success the sign-in arrives through App's listener and the canvas
    // replaces this page; nothing more to do here.
    const message = await verifyEmailCode(sentTo, code)
    if (message) {
      setError(message)
      setBusy(null)
    }
  }

  return (
    <SiteShell current="sign-in">
      <section className={styles.page}>
        {sentTo === null ? (
          <>
            <h1 className={styles.title}>Sign in to Divthink</h1>
            <p className={styles.note}>New here? Signing in creates your account.</p>

            <button type="button" className={styles.google} onClick={() => void google()} disabled={busy !== null}>
              <GoogleMark />
              {busy === 'google' ? 'Redirecting…' : 'Continue with Google'}
            </button>

            <div className={styles.or} aria-hidden="true">
              <span>or</span>
            </div>

            <form
              className={styles.form}
              onSubmit={(e) => {
                e.preventDefault()
                void send(email.trim())
              }}
            >
              <label className={styles.label} htmlFor="sign-in-email">
                Email
              </label>
              <input
                id="sign-in-email"
                className={styles.input}
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <button type="submit" className={styles.primary} disabled={busy !== null || !email.trim()}>
                {busy === 'send' ? 'Sending…' : 'Email me a code'}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className={styles.title}>Check your email</h1>
            <p className={styles.note}>
              We sent a sign-in code to <strong className={styles.address}>{sentTo}</strong>.
            </p>

            <form className={styles.form} onSubmit={(e) => void verify(e)}>
              <label className={styles.label} htmlFor="sign-in-code">
                Code
              </label>
              <input
                ref={codeInput}
                id="sign-in-code"
                className={`${styles.input} ${styles.code}`}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={10}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                required
              />
              <button type="submit" className={styles.primary} disabled={busy !== null || code.length < 6}>
                {busy === 'verify' ? 'Checking…' : 'Sign in'}
              </button>
            </form>

            <div className={styles.links}>
              <button
                type="button"
                className={styles.link}
                onClick={() => void send(sentTo)}
                disabled={busy !== null || wait > 0}
              >
                {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
              </button>
              <button
                type="button"
                className={styles.link}
                onClick={() => {
                  setSentTo(null)
                  setError(null)
                }}
                disabled={busy !== null}
              >
                Use a different email
              </button>
            </div>
          </>
        )}

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <p className={styles.fine}>
          By signing in you agree to the{' '}
          <a href="/terms" onClick={onLinkClick}>
            terms of service
          </a>{' '}
          and{' '}
          <a href="/privacy" onClick={onLinkClick}>
            privacy policy
          </a>
          .
        </p>
      </section>
    </SiteShell>
  )
}

// Google's "G", which its sign-in buttons are expected to carry.
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}

export default SignIn
