import { useEffect, useState } from 'react'
import { choosePlanFree, getAccount, type Account } from './api'
import { onLinkClick } from './nav'
import PlanCards, { type PlanButton } from './PlanCards'
import { goToCheckout, leavePlans, rememberPlanChosen, type PlanCard } from './upgrade'
import { useCanvasStore } from './store'
import SiteShell from './SiteShell'
import styles from './Plans.module.css'

// Picking a plan: once after signing up, and whenever Upgrade is pressed in the
// app. Pro leaves for Stripe's checkout page; Free goes on to the canvas.
function Plans({ userId }: { userId: string }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [busy, setBusy] = useState<'free' | 'pro' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getAccount().then(
      (a) => {
        if (!cancelled) setAccount(a)
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Something went wrong.')
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  async function free() {
    setBusy('free')
    setError(null)
    try {
      await choosePlanFree()
      rememberPlanChosen(userId)
      leavePlans()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setBusy(null)
    }
  }

  async function pro() {
    setBusy('pro')
    setError(null)
    try {
      await goToCheckout() // the browser leaves for Stripe
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setBusy(null)
    }
  }

  function button(plan: PlanCard): PlanButton {
    if (!account) return { label: '…', disabled: true }
    if (plan.id === account.plan) return { label: 'Current plan', disabled: true }
    if (plan.id === 'pro_max') return { label: 'Coming soon', disabled: true }
    if (plan.id === 'pro') {
      if (account.plan !== 'free') return { label: 'Included', disabled: true }
      if (!account.payments_enabled) return { label: 'Coming soon', disabled: true }
      return { label: busy === 'pro' ? 'Opening checkout…' : 'Get Pro', bright: true, disabled: busy !== null, onClick: () => void pro() }
    }
    // Free, while on a paid plan: cancelling happens in Stripe's portal.
    return {
      label: 'Manage in Settings',
      onClick: () => {
        leavePlans()
        useCanvasStore.getState().openSettings('billing')
      },
    }
  }

  const firstTime = account !== null && !account.plan_chosen && account.plan === 'free'

  return (
    <SiteShell bare>
      <div className={styles.column}>
        <header className={styles.top}>
          {/* Leaving the plans shown after signing up is choosing Free, so they
              aren't shown again; otherwise it just goes back. */}
          <button
            type="button"
            className={styles.back}
            disabled={busy !== null}
            onClick={firstTime ? () => void free() : leavePlans}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M11 7H3M6.5 3.5L3 7l3.5 3.5" />
            </svg>
            Back
          </button>
          <img className={styles.mark} src="/logo.svg" alt="Divthink" />
        </header>

        <h1 className={styles.title}>{firstTime ? 'Welcome. Pick a plan' : 'Plans'}</h1>
        <p className={styles.note}>
          Every plan uses your own Anthropic or Google key for the models. Pro removes the limits on
          canvases and cards.
        </p>

        {error && <p className={styles.error}>{error}</p>}

        <PlanCards className={styles.cards} button={button} />

        {account?.plan === 'free' && (
          <button type="button" className={styles.free} disabled={busy !== null} onClick={() => void free()}>
            {busy === 'free' ? 'One moment…' : 'Continue with Free'}
          </button>
        )}

        <p className={styles.finePrint}>
          Prices in US dollars. Pro renews monthly and you can cancel anytime from Settings → Billing;
          it lasts until the end of the month you paid for. See the{' '}
          <a href="/terms" onClick={onLinkClick}>
            Terms of Service
          </a>
          .
        </p>
      </div>
    </SiteShell>
  )
}

export default Plans
