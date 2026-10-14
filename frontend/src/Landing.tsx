import { useEffect, useState } from 'react'
import Canvas from './Canvas'
import { onLinkClick, scrollToSection } from './nav'
import SiteShell, { type Page } from './SiteShell'
import { useGetStarted } from './useGetStarted'
import styles from './Landing.module.css'

// The page's sections in order, and the menu item each one lights up. The hero
// and the demo both belong to "Divthink", the top of the page.
const SECTIONS: { id: string; page: Page }[] = [
  { id: 'top', page: 'home' },
  { id: 'demo', page: 'home' },
  { id: 'method', page: 'method' },
  { id: 'pricing', page: 'pricing' },
  { id: 'faq', page: 'faq' },
]

const METHOD: [string, string][] = [
  [
    'Branch from any passage',
    'Reply from any earlier card to take the conversation somewhere else, or highlight part of a reply and ask about exactly that. The line you were on carries on.',
  ],
  [
    'Keep threads side by side',
    'Branches and separate threads stay open at once, laid out in space where you can see them all, not buried in scrollback.',
  ],
  [
    'Merge them back',
    'Pick two or more cards and ask one question across them. The model gets their shared history once, then each branch on its own.',
  ],
  [
    'Pick the model per reply',
    'Answer one branch with Claude and the next with Gemini. Attach images or PDFs, and let a reply search the web.',
  ],
]

type PricingPlan = {
  name: string
  price: string
  action: 'start' | 'pro' | null // null: not available yet
  actionLabel: string
  lead: string // "Everything in Free, and:"
  headline: string // the one big thing this plan gives
  sub: string
  points: string[]
  note?: string
}

const PRICING: PricingPlan[] = [
  {
    name: 'Free',
    price: '$0',
    action: 'start',
    actionLabel: 'Get started',
    lead: 'Get started with:',
    headline: '5 canvases',
    sub: 'with up to 50 cards each',
    points: ['Branch, merge and keep threads side by side', 'Claude and Gemini, picked per reply', 'Web search, images and PDFs'],
    note: 'Model use is billed by your provider, to your own API key.',
  },
  {
    name: 'Pro',
    price: '$8',
    action: 'pro',
    actionLabel: 'Get Pro',
    lead: 'Everything in Free, and:',
    headline: 'Unlimited',
    sub: 'canvases and cards',
    points: ['No limit on how many canvases you keep', 'No limit on cards in a canvas', 'Cancel anytime'],
    note: 'Model use is billed by your provider, to your own API key.',
  },
  {
    name: 'Pro Max',
    price: '$20',
    action: null,
    actionLabel: 'Coming soon',
    lead: 'Everything in Pro, and:',
    headline: 'No API key',
    sub: 'model use included',
    points: ['Start a canvas the moment you sign in', 'A monthly allowance of model use', 'Bring your own key for more'],
  },
]

// Read by the canvas after sign-in: "Get Pro" should land on Billing, not just
// the canvas. Session storage survives the sign-in, including Google's redirect.
const AFTER_SIGN_IN_KEY = 'divthink.after-sign-in'

const FAQ: [string, string][] = [
  [
    'Which models can I use?',
    'Claude Sonnet 5, Claude Opus 5 and Gemini 3.6 Flash. You choose the model each time you send a prompt.',
  ],
  [
    'Do I need an API key?',
    'Yes. After signing in you add an Anthropic key, a Google key, or both. A model is available once its provider has a key.',
  ],
  [
    'Is my API key safe?',
    'Keys are encrypted before they are stored and decrypted only to generate your replies. A saved key is never shown again and never sent back to your browser.',
  ],
  [
    'What is sent to the AI provider?',
    'Your prompt, the earlier messages in that thread, and any files attached to them. Other threads on the canvas are not included unless you merge them in.',
  ],
  [
    'Who can see my canvases?',
    'Only you. Other people who use Divthink cannot see them, and your data is never sold or used for advertising.',
  ],
  [
    'Can I delete my data?',
    'You can delete a whole canvas, or any card that nothing continues from, and remove a saved key at any time. To delete your account and everything in it, go to Settings → Account.',
  ],
]

// The signed-out home page: one long page of sections, which the menu scrolls
// between and follows.
function Landing() {
  const { start } = useGetStarted()
  const [current, setCurrent] = useState<Page>('home')

  // Arriving at an address that names a section (divthink.com/#pricing): the
  // browser looked for it before this page existed, so go there now.
  useEffect(() => {
    if (window.location.hash) scrollToSection(window.location.hash)
  }, [])

  // The menu follows the scroll: the current section is the last one whose top
  // has passed a line 40% of the way down the window.
  useEffect(() => {
    const update = () => {
      const line = window.innerHeight * 0.4
      let page: Page = 'home'
      for (const section of SECTIONS) {
        const element = document.getElementById(section.id)
        if (element && element.getBoundingClientRect().top <= line) page = section.page
      }
      setCurrent(page)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  return (
    <SiteShell current={current}>
      <section id="top" className={styles.hero}>
        <h1 className={styles.headline}>Conversations that branch instead of scrolling</h1>
        <p className={styles.lede}>
          Divthink lets you branch from any reply, keep threads side by side, and merge them back.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.action} onClick={start}>
            Get started
          </button>
          <a className={`${styles.action} ${styles.actionQuiet}`} href="/#method" onClick={onLinkClick}>
            Read the method
          </a>
        </div>
      </section>

      {/* The app itself, on a built-in example (demo.ts): click around it, drag
          the cards, type into it. Nothing leaves the browser. */}
      <section id="demo" className={styles.demo} aria-label="Interactive demo">
        <Canvas embedded />
      </section>

      <section id="method" className={`${styles.section} ${styles.wide}`}>
        <h2 className={styles.heading}>A conversation with more than one direction</h2>
        <p className={styles.intro}>
          A normal chat is a single line, and every tangent buries what came before it. On a
          canvas, each prompt and its reply is a card you can come back to.
        </p>
        <div className={`${styles.grid} ${styles.gridOfFour}`}>
          {METHOD.map(([title, body]) => (
            <div key={title} className={styles.cell}>
              <h3 className={styles.cellTitle}>{title}</h3>
              <p className={styles.cellBody}>{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className={`${styles.section} ${styles.wide}`}>
        <h2 className={styles.heading}>Pricing</h2>
        <p className={styles.intro}>
          Start free with your own Anthropic or Google key. Upgrade when you need more room.
        </p>
        <div className={styles.plans}>
          {PRICING.map((plan) => (
            <div key={plan.name} className={styles.plan}>
              <h3 className={styles.planName}>{plan.name}</h3>
              <p className={styles.planPrice}>
                {plan.price}
                <span className={styles.planPer}>/month</span>
              </p>
              <button
                type="button"
                className={`${styles.planButton} ${plan.action === 'pro' ? styles.planButtonBright : ''}`}
                disabled={plan.action === null}
                onClick={() => {
                  if (plan.action === 'pro') {
                    try {
                      window.sessionStorage.setItem(AFTER_SIGN_IN_KEY, 'billing')
                    } catch {
                      // Storage blocked: they'll land on the canvas instead.
                    }
                  }
                  start()
                }}
              >
                {plan.actionLabel}
              </button>
              <p className={styles.planLead}>{plan.lead}</p>
              <p className={styles.planHeadline}>{plan.headline}</p>
              <p className={styles.planSub}>{plan.sub}</p>
              <ul className={styles.planPoints}>
                {plan.points.map((point) => (
                  <li key={point}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                      <path d="M2.5 6.5l2.5 2.5 4.5-6" />
                    </svg>
                    {point}
                  </li>
                ))}
              </ul>
              {plan.note && <p className={styles.planNote}>{plan.note}</p>}
            </div>
          ))}
        </div>
        <p className={styles.finePrint}>
          Prices in US dollars. On Free and Pro, Anthropic or Google bill you directly for model
          use, at their own rates. Cancel Pro anytime: it lasts until the end of the month you
          paid for.
        </p>
      </section>

      <section id="faq" className={styles.section}>
        <h2 className={styles.heading}>Common questions</h2>
        <div className={styles.faq}>
          {/* <details> is the browser's own open-and-close: it works from the
              keyboard and is announced properly without any code here. */}
          {FAQ.map(([question, answer]) => (
            <details key={question} className={styles.question}>
              <summary>
                {question}
                <span className={styles.plus} aria-hidden="true" />
              </summary>
              <p className={styles.answer}>{answer}</p>
            </details>
          ))}
        </div>
      </section>
    </SiteShell>
  )
}

export default Landing
