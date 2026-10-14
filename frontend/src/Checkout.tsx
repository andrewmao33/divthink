import {
  loadStripe,
  type StripeCheckoutLoadActionsSuccess,
  type StripeCheckoutSession,
  type StripePaymentElement,
} from '@stripe/stripe-js'
import { useEffect, useRef, useState } from 'react'
import { startCheckout } from './api'
import styles from './Checkout.module.css'

const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string

// Stripe draws the payment fields in its own frame; this makes them look like
// the rest of the app (index.css tokens).
const APPEARANCE = {
  theme: 'night' as const,
  variables: {
    colorPrimary: '#edecec',
    colorBackground: '#1d1b18',
    colorText: '#edecec',
    colorTextSecondary: '#bab8b1',
    colorDanger: '#f08a8a',
    fontFamily: '"Inter Tight", system-ui, sans-serif',
    borderRadius: '7px',
  },
}
const FONTS = [{ cssSrc: 'https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500&display=swap' }]

// Upgrading to Pro: our own screen, with Stripe's payment fields on the left
// and the plan on the right. Card details go from Stripe's fields straight to
// Stripe. `onComplete` runs once the payment has gone through.
function Checkout({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const fields = useRef<HTMLDivElement>(null)
  const [actions, setActions] = useState<StripeCheckoutLoadActionsSuccess | null>(null)
  const [session, setSession] = useState<StripeCheckoutSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)

  useEffect(() => {
    let cancelled = false
    let element: StripePaymentElement | null = null
    void (async () => {
      try {
        const stripe = await loadStripe(publishableKey)
        if (!stripe) throw new Error("Couldn't load Stripe. Check your connection and try again.")
        const checkout = stripe.initCheckoutElementsSdk({
          clientSecret: startCheckout().then((r) => r.client_secret),
          elementsOptions: { appearance: APPEARANCE, fonts: FONTS },
        })
        checkout.on('change', (next) => {
          if (!cancelled) setSession(next)
        })
        element = checkout.createPaymentElement({ layout: { type: 'accordion', defaultCollapsed: false } })
        if (fields.current) element.mount(fields.current)
        const loaded = await checkout.loadActions()
        if (cancelled) return
        if (loaded.type === 'error') throw new Error(loaded.error.message)
        setActions(loaded.actions)
        setSession(loaded.actions.getSession())
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Something went wrong.')
      }
    })()
    return () => {
      cancelled = true
      element?.destroy()
    }
  }, [])

  // Escape closes this screen only, not the settings window underneath: caught
  // first (capture) and kept from reaching the settings window's own handler.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      if (!paying) onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose, paying])

  async function pay() {
    if (!actions) return
    setPaying(true)
    setError(null)
    // Cards confirm here; a method that has to visit its bank leaves and comes
    // back to Billing (the session's return address).
    const result = await actions.confirm({ redirect: 'if_required' })
    if (result.type === 'success') {
      onComplete()
      return
    }
    setError(result.error.message)
    setPaying(false)
  }

  const total = session?.total.total.amount ?? '$8.00'

  return (
    <div className={styles.backdrop}>
      <div className={styles.window} role="dialog" aria-modal="true" aria-labelledby="checkout-title">
        <div className={styles.pay}>
          <div className={styles.header}>
            <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Back" disabled={paying}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M10 3L5 8l5 5" />
              </svg>
            </button>
            <h2 id="checkout-title" className={styles.title}>
              Checkout
            </h2>
          </div>
          <p className={styles.label}>Pay with</p>
          <div ref={fields} className={styles.fields} />
          {!actions && !error && <p className={styles.muted}>Loading…</p>}
        </div>

        <div className={styles.summary}>
          <button type="button" className={`${styles.iconButton} ${styles.close}`} onClick={onClose} aria-label="Close" disabled={paying}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
            </svg>
          </button>
          <p className={styles.plan}>Pro</p>
          <p className={styles.price}>
            $8<span className={styles.per}>/month</span>
          </p>
          <p className={styles.muted}>Unlimited canvases and cards. Renews monthly until you cancel.</p>

          <div className={styles.lines}>
            <div className={styles.line}>
              <span>Plan price</span>
              <span>$8.00/month</span>
            </div>
            <div className={`${styles.line} ${styles.strong}`}>
              <span>Due today</span>
              <span>{total}</span>
            </div>
          </div>

          <p className={styles.agree}>
            By subscribing you agree to the{' '}
            <a href="/terms" target="_blank" rel="noopener noreferrer">
              Terms of Service
            </a>{' '}
            and{' '}
            <a href="/privacy" target="_blank" rel="noopener noreferrer">
              Privacy Policy
            </a>
            . Pro renews every month until you cancel, which you can do anytime in Settings → Billing;
            it lasts until the end of the month you paid for. Payments are not refunded.
          </p>

          {error && <p className={styles.error}>{error}</p>}
          <button
            type="button"
            className={styles.subscribe}
            disabled={!actions || !session?.canConfirm || paying}
            onClick={() => void pay()}
          >
            {paying ? 'Processing…' : 'Subscribe & pay'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default Checkout
