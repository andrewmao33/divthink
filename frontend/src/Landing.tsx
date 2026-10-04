import { useState } from 'react'
import { signInWithGoogle } from './auth'
import DemoCanvas from './DemoCanvas'
import styles from './Landing.module.css'

const GITHUB_URL = 'https://github.com/andrewmao33/divthink'
// Set VITE_DEMO_SESSION_ID to a canvas flagged is_public (backend/scripts/make_demo.py).
const DEMO_ID = import.meta.env.VITE_DEMO_SESSION_ID as string | undefined

const HOW_IT_WORKS: [string, string][] = [
  [
    'Branch from any reply',
    'Highlight a passage and your follow-up starts a new thread from exactly that point. The thread you were on keeps going.',
  ],
  [
    'Follow threads side by side',
    'Several lines of thinking stay open at once, laid out in space rather than buried in scrollback.',
  ],
  [
    'Merge them back',
    'Select two threads and ask one question of both. The model receives the shared history once, then each branch on its own.',
  ],
]

function Landing() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signIn() {
    setBusy(true)
    setError(null)
    // On success the browser leaves for Google and comes back signed in.
    const message = await signInWithGoogle()
    if (message) {
      setError(message)
      setBusy(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.grid}>
          {/* Decoration only: invisible to screen readers, unclickable, behind
              the content. Five rules: the two frame edges, both edges of the
              text column, and one companion in the left gutter. */}
          <div aria-hidden="true" className={styles.rules}>
            <div className={`${styles.rule} ${styles.ruleLeft}`} />
            <div className={`${styles.rule} ${styles.ruleGutter}`} />
            <div className={`${styles.rule} ${styles.ruleTextStart}`} />
            <div className={`${styles.rule} ${styles.ruleTextEnd}`} />
            <div className={`${styles.rule} ${styles.ruleRight}`} />
          </div>

          <main className={styles.content}>
            {/* The hero is the product's own shape: boxes joined by connectors,
                the way a canvas looks. Static — the real, movable one is below. */}
            <section className={styles.hero}>
              <h1 className={styles.headingBox}>
                DivThink is a canvas for conversations that branch instead of scrolling.
              </h1>

              <span className={styles.connector} aria-hidden="true" />

              <div className={styles.bodyBox}>
                <p>
                  A normal chat is a single line. Every question you don't ask is a thread you
                  lose, and every tangent buries what came before it. DivThink keeps the whole
                  shape of the conversation on one canvas, so a passing idea can become its own
                  branch without costing you the thread you were already on.
                </p>
                <p>
                  Sign in with Google and bring your own Anthropic or Google API key. Your keys
                  are encrypted, used only to generate your replies, and never shown again.
                </p>
              </div>

              <div className={styles.actions}>
                <button type="button" className={styles.button} onClick={() => void signIn()} disabled={busy}>
                  {busy ? 'Redirecting…' : 'Continue with Google'}
                </button>
                <a
                  className={`${styles.button} ${styles.buttonOutline}`}
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  GitHub
                </a>
              </div>

              {error && <p className={styles.error}>{error}</p>}
            </section>

            {DEMO_ID && (
              <section className={styles.demo}>
                <p className={styles.sectionLabel}>Demo canvas</p>
                <DemoCanvas id={DEMO_ID} />
              </section>
            )}

            <section className={styles.how}>
              {HOW_IT_WORKS.map(([title, body], i) => (
                <div key={title} className={styles.step}>
                  <span className={styles.stepNumber}>{String(i + 1).padStart(2, '0')}</span>
                  <h2 className={styles.stepTitle}>{title}</h2>
                  <p className={styles.stepBody}>{body}</p>
                </div>
              ))}
            </section>

            <footer className={styles.footer}>
              <span>Andrew Mao</span>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener">
                GitHub
              </a>
              <a href="/privacy.html">Privacy</a>
            </footer>
          </main>
        </div>
      </div>
    </div>
  )
}

export default Landing
