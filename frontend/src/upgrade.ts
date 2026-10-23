import { getAccount, startCheckout } from './api'
import { navigate } from './nav'

// The plans, as the pricing section and the plans page show them.
export type PlanCard = {
  id: 'free' | 'pro' | 'pro_max'
  name: string
  price: string
  lead: string // "Everything in Free, and:"
  headline: string // the one big thing this plan gives
  sub: string
  points: string[]
  note?: string
}

export const PLAN_CARDS: PlanCard[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    lead: 'Get started with:',
    headline: '5 canvases',
    sub: 'with up to 50 cards each',
    points: ['Branch, merge and keep threads side by side', 'Claude and Gemini, picked per reply', 'Web search, images and PDFs'],
    note: 'Model use is billed by your provider, to your own API key.',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$8',
    lead: 'Everything in Free, and:',
    headline: 'Unlimited',
    sub: 'canvases and cards',
    points: ['No limit on how many canvases you keep', 'No limit on cards in a canvas', 'Cancel anytime'],
    note: 'Model use is billed by your provider, to your own API key.',
  },
  {
    id: 'pro_max',
    name: 'Pro Max',
    price: '$20',
    lead: 'Everything in Pro, and:',
    headline: 'No API key',
    sub: 'model use included',
    points: ['Start a canvas the moment you sign in', 'A monthly allowance of model use', 'Bring your own key for more'],
  },
]

// Leaves for Stripe's checkout page. Throws (ApiError) if it can't start.
export async function goToCheckout(): Promise<void> {
  const { url } = await startCheckout()
  window.location.assign(url)
}

// Where "Continue" on the plans page goes back to: the canvas it was opened
// from, or the newest canvas after signing up.
let backTo = '/'

export function openPlans(): void {
  backTo = window.location.pathname
  navigate('/plans')
}

export function leavePlans(): void {
  navigate(backTo)
  backTo = '/'
}

// "Get Pro" on the home page, remembered across signing in (session storage
// survives Google's redirect) so it can go straight to checkout afterwards.
const AFTER_SIGN_IN_KEY = 'divthink.after-sign-in'

export function checkoutAfterSignIn(wanted: boolean): void {
  try {
    if (wanted) window.sessionStorage.setItem(AFTER_SIGN_IN_KEY, 'checkout')
    else window.sessionStorage.removeItem(AFTER_SIGN_IN_KEY)
  } catch {
    // Storage blocked: they'll see the plans instead, or the canvas.
  }
}

export function wantsCheckout(): boolean {
  try {
    return window.sessionStorage.getItem(AFTER_SIGN_IN_KEY) === 'checkout'
  } catch {
    return false
  }
}

// Read once: true if the sign-in that just happened came from "Get Pro".
export function takeCheckoutAfterSignIn(): boolean {
  const wanted = wantsCheckout()
  try {
    window.sessionStorage.removeItem(AFTER_SIGN_IN_KEY)
  } catch {
    // Nothing stored to remove.
  }
  return wanted
}

// Accounts known to have picked a plan, per browser, so the check below costs
// a request once rather than on every visit.
const chosenKey = (userId: string) => `divthink.plan-chosen.${userId}`

export function rememberPlanChosen(userId: string): void {
  try {
    window.localStorage.setItem(chosenKey(userId), '1')
  } catch {
    // Not remembered: the account is asked again, and answers the same.
  }
}

function planChosenHere(userId: string): boolean {
  try {
    return window.localStorage.getItem(chosenKey(userId)) === '1'
  } catch {
    return false
  }
}

// Where a signed-in visit starts: Stripe's checkout after "Get Pro", the plans
// for an account that hasn't picked one yet, or (null) the canvas.
export async function firstStop(userId: string): Promise<'checkout' | '/plans' | null> {
  if (takeCheckoutAfterSignIn()) {
    try {
      await goToCheckout()
      return 'checkout'
    } catch {
      return '/plans' // already on Pro, or Stripe is down: the plans page says which
    }
  }
  if (planChosenHere(userId)) return null
  try {
    const account = await getAccount()
    if (!account.plan_chosen && account.plan === 'free') return '/plans'
    rememberPlanChosen(userId)
  } catch {
    // Can't tell: the canvas, which works either way.
  }
  return null
}
