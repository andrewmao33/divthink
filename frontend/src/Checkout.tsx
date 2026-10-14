import { loadStripe, type StripeEmbeddedCheckout } from '@stripe/stripe-js'
import { useEffect, useRef, useState } from 'react'
import { startCheckout } from './api'
import styles from './Settings.module.css'

const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string

// Stripe allows one embedded Checkout on a page at a time, and both creating
// and destroying one are asynchronous, so each waits for the last to finish.
let queue: Promise<void> = Promise.resolve()

// Stripe's payment form, inside Settings → Billing. Card details go from this
// frame straight to Stripe. `onComplete` runs once the payment has gone through.
function Checkout({ onComplete }: { onComplete: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const finished = useRef(onComplete)
  useEffect(() => {
    finished.current = onComplete
  })

  useEffect(() => {
    let cancelled = false
    let checkout: StripeEmbeddedCheckout | null = null
    queue = queue.then(async () => {
      if (cancelled) return
      try {
        const stripe = await loadStripe(publishableKey)
        if (!stripe) throw new Error("Couldn't load Stripe. Check your connection and try again.")
        const created = await stripe.createEmbeddedCheckoutPage({
          fetchClientSecret: async () => (await startCheckout()).client_secret,
          onComplete: () => finished.current(),
        })
        if (cancelled || !host.current) {
          created.destroy()
          return
        }
        checkout = created
        created.mount(host.current)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Something went wrong.')
      }
    })
    return () => {
      cancelled = true
      queue = queue.then(() => checkout?.destroy())
    }
  }, [])

  return (
    <>
      {error && <p className={styles.error}>{error}</p>}
      <div ref={host} className={styles.checkout} />
    </>
  )
}

export default Checkout
