import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  deleteAccount,
  deleteKey,
  getAccount,
  listKeys,
  openBillingPortal,
  removeAvatar,
  setAvatar,
  saveKey,
  type Account,
  type KeyStatus,
} from './api'
import { authEnabled, signOut, supabase } from './auth'
import Avatar from './Avatar'
import ModelOptions from './ModelOptions'
import { billingReturn } from './nav'
import { avatarFromFile, loadProfile, type Profile } from './profile'
import { loadTheme, saveTheme, type Theme } from './theme'
import { goToCheckout } from './upgrade'
import styles from './Settings.module.css'
import { logOut, useCanvasStore, type SettingsSection } from './store'

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'account', label: 'Account' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'keys', label: 'API keys' },
  { id: 'billing', label: 'Billing' },
]

const HELP: Record<string, { placeholder: string; where: string; url: string }> = {
  anthropic: {
    placeholder: 'sk-ant-…',
    where: 'Claude Console → API Keys',
    url: 'https://console.anthropic.com/settings/keys',
  },
  google: {
    placeholder: 'Your Gemini API key',
    where: 'Google AI Studio → Get API key',
    url: 'https://aistudio.google.com/apikey',
  },
  openai: {
    placeholder: 'sk-…',
    where: 'OpenAI Platform → API keys',
    url: 'https://platform.openai.com/api-keys',
  },
}

// The settings window (sidebar → Settings): a list of sections on the left,
// the open one on the right.
function Settings() {
  const { section, openSettings, closeSettings } = useCanvasStore(
    useShallow((s) => ({ section: s.settings, openSettings: s.openSettings, closeSettings: s.closeSettings })),
  )

  useEffect(() => {
    if (!section) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettings()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [section, closeSettings])

  if (!section) return null
  const title = SECTIONS.find((s) => s.id === section)?.label

  return (
    <div
      className={styles.backdrop}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) closeSettings()
      }}
    >
      <div className={styles.window} role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <nav className={styles.nav}>
          <p className={styles.navLabel}>Settings</p>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`${styles.navItem} ${s.id === section ? styles.navCurrent : ''}`}
              onClick={() => openSettings(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className={styles.content}>
          <button type="button" className={styles.close} onClick={closeSettings} aria-label="Close" title="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
            </svg>
          </button>
          <h2 id="settings-title" className={styles.title}>
            {title}
          </h2>
          {section === 'general' && <General />}
          {section === 'account' && <Account />}
          {section === 'privacy' && <Privacy />}
          {section === 'keys' && <Keys />}
          {section === 'billing' && <Billing />}
        </div>
      </div>
    </div>
  )
}

function General() {
  const { models, model, setModel } = useCanvasStore(
    useShallow((s) => ({ models: s.models, model: s.model, setModel: s.setModel })),
  )
  const usable = models.filter((m) => m.available)
  const [theme, setTheme] = useState<Theme>(loadTheme)

  return (
    <>
      <div className={styles.row}>
        <div>
          <p className={styles.rowTitle}>Appearance</p>
          <p className={styles.rowHint}>System follows your computer's light or dark setting.</p>
        </div>
        <select
          className={styles.select}
          value={theme}
          onChange={(e) => {
            const next = e.target.value as Theme
            setTheme(next)
            saveTheme(next)
          }}
          aria-label="Appearance"
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>
      <div className={styles.row}>
        <div>
          <p className={styles.rowTitle}>Model</p>
          <p className={styles.rowHint}>Used for new prompts. You can change it for any reply.</p>
        </div>
        {usable.length === 0 ? (
          <span className={styles.muted}>Add an API key first</span>
        ) : (
          <select
            className={styles.select}
            value={model ?? ''}
            onChange={(e) => setModel(e.target.value)}
            aria-label="Model"
          >
            <ModelOptions models={models} />
          </select>
        )}
      </div>
    </>
  )
}

function Account() {
  const [email, setEmail] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void supabase?.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null))
  }, [])

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await deleteAccount()
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
      return
    }
    await signOut()
    // A fresh start: the landing page, or locally an empty canvas.
    window.location.assign('/')
  }

  return (
    <>
      <Picture />
      <div className={styles.row}>
        <div>
          <p className={styles.rowTitle}>Email</p>
          <p className={styles.rowHint}>{authEnabled ? (email ?? '…') : 'Local development user'}</p>
        </div>
        {authEnabled && (
          <button type="button" className={styles.secondary} onClick={logOut}>
            Log out
          </button>
        )}
      </div>
      <div className={styles.row}>
        <div>
          <p className={styles.rowTitle}>Delete account</p>
          <p className={styles.rowHint}>
            {confirming
              ? "This deletes every canvas, card and saved key, and can't be undone."
              : 'Deletes your account, every canvas and your saved keys.'}
          </p>
          {error && <p className={styles.error}>{error}</p>}
        </div>
        {confirming ? (
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button type="button" className={styles.danger} disabled={busy} onClick={() => void remove()}>
              {busy ? 'Deleting…' : 'Delete forever'}
            </button>
          </div>
        ) : (
          <button type="button" className={styles.danger} onClick={() => setConfirming(true)}>
            Delete
          </button>
        )}
      </div>
    </>
  )
}

// The profile picture: Google's (or the initial) until one is uploaded here.
function Picture() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [custom, setCustom] = useState(false) // a picture uploaded here, rather than the default
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  async function refresh() {
    const account = await getAccount().catch(() => null)
    setCustom(Boolean(account?.avatar))
    setProfile(await loadProfile(account))
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function change(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await refresh()
    } catch (e) {
      setError(messageOf(e))
    }
    setBusy(false)
  }

  return (
    <div className={styles.row}>
      <div className={styles.picture}>
        <Avatar name={profile?.name ?? ''} picture={profile?.picture ?? null} size={44} />
        <div>
          <p className={styles.rowTitle}>Profile picture</p>
          <p className={styles.rowHint}>{custom ? 'Uploaded here.' : 'From your Google account, or your initial.'}</p>
          {error && <p className={styles.error}>{error}</p>}
        </div>
      </div>
      <div className={styles.actions}>
        {custom && (
          <button type="button" className={styles.secondary} disabled={busy} onClick={() => void change(removeAvatar)}>
            Remove
          </button>
        )}
        <button type="button" className={styles.secondary} disabled={busy} onClick={() => fileInput.current?.click()}>
          {busy ? 'Saving…' : 'Upload'}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = '' // picking the same file again still counts as a change
            if (file) void change(async () => setAvatar(await avatarFromFile(file)))
          }}
        />
      </div>
    </div>
  )
}

// A summary of the privacy policy (/privacy), which stays the full version.
function Privacy() {
  return (
    <>
      <p className={styles.intro}>
        Divthink keeps only what it needs to run your canvases, and sends your conversations only to
        the AI provider you pick. The{' '}
        <a href="/privacy" target="_blank" rel="noreferrer">
          Privacy Policy
        </a>{' '}
        has the details.
      </p>
      <details className={styles.disclosure} open>
        <summary>How your data is protected</summary>
        <ul>
          <li>Your API keys are encrypted before they are saved, decrypted only to write a reply, and never sent back to your browser.</li>
          <li>Everything travels encrypted, and the database accepts connections only from the Divthink server.</li>
          <li>Other people who use Divthink can't see your canvases.</li>
          <li>Divthink never sees your password or card details: Google or an emailed code signs you in, and Stripe handles payments.</li>
        </ul>
      </details>
      <details className={styles.disclosure} open>
        <summary>How your data is used</summary>
        <ul>
          <li>Your prompts, the thread above them and any attached files go to Anthropic, Google or OpenAI, whichever model you pick, under your own API key and their terms.</li>
          <li>Your canvases, files and the details of each reply are stored so you can come back to them.</li>
          <li>Page visits are counted anonymously by Cloudflare, without cookies and without linking them to your account.</li>
          <li>Your data is never sold and never used for advertising.</li>
        </ul>
      </details>
      <details className={styles.disclosure} open>
        <summary>Deleting your data</summary>
        <ul>
          <li>Delete any canvas from the sidebar, or any card that nothing continues from.</li>
          <li>Remove a saved key under API keys.</li>
          <li>Delete your account under Account. Every canvas, file and key goes with it, straight away.</li>
        </ul>
      </details>
    </>
  )
}

function Keys() {
  const loadModels = useCanvasStore((s) => s.loadModels)
  const [keys, setKeys] = useState<KeyStatus[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listKeys().then(
      (list) => {
        if (!cancelled) setKeys(list)
      },
      (e: unknown) => {
        if (!cancelled) setError(messageOf(e))
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  async function refresh() {
    setKeys(await listKeys())
    void loadModels() // the model picker enables providers with a key
  }

  return (
    <>
      <p className={styles.intro}>
        Divthink uses your own keys. They're encrypted on the server, never shown again, and only used
        to write your replies.
      </p>
      {error && <p className={styles.error}>{error}</p>}
      {keys === null && !error ? (
        <p className={styles.muted}>Loading…</p>
      ) : (
        keys?.map((status) => <KeyRow key={status.provider} status={status} onChange={refresh} />)
      )}
    </>
  )
}

function KeyRow({ status, onChange }: { status: KeyStatus; onChange: () => Promise<void> }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const help = HELP[status.provider]

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      setValue('')
      await onChange()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={styles.keyRow}>
      <div className={styles.keyHeader}>
        <span className={styles.rowTitle}>{status.label}</span>
        <span className={status.configured ? styles.saved : styles.muted}>
          {status.configured ? 'Saved' : 'Not set'}
        </span>
      </div>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault()
          const key = value.trim()
          if (key) void run(() => saveKey(status.provider, key))
        }}
      >
        <input
          type="password"
          className={styles.input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={status.configured ? 'Replace with a new key' : help?.placeholder}
          autoComplete="off"
          spellCheck={false}
          aria-label={`${status.label} API key`}
        />
        <button type="submit" className={styles.primary} disabled={busy || !value.trim()}>
          {busy ? 'Checking…' : 'Save'}
        </button>
        {status.configured && (
          <button
            type="button"
            className={styles.secondary}
            disabled={busy}
            onClick={() => void run(() => deleteKey(status.provider))}
          >
            Remove
          </button>
        )}
      </form>
      {help && (
        <p className={styles.help}>
          Get one: <a href={help.url} target="_blank" rel="noopener noreferrer">{help.where}</a>
        </p>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </section>
  )
}

const PLAN_OPTIONS: { id: Account['plan']; label: string; price: string; points: string[] }[] = [
  { id: 'free', label: 'Free', price: '$0', points: ['Your own API key', '5 canvases', '50 cards per canvas'] },
  { id: 'pro', label: 'Pro', price: '$8 a month', points: ['Your own API key', 'Unlimited canvases', 'Unlimited cards'] },
  {
    id: 'pro_max',
    label: 'Pro Max',
    price: '$20 a month',
    points: ['No API key needed', 'Model use included', 'Unlimited canvases and cards'],
  },
]

function Billing() {
  const [account, setAccount] = useState<Account | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Just paid: Stripe tells the server a moment later, so the plan is checked
  // again a few times until it shows.
  const [waiting, setWaiting] = useState(billingReturn === 'success')

  useEffect(() => {
    let cancelled = false
    let tries = 0
    async function load() {
      try {
        const a = await getAccount()
        if (cancelled) return
        setAccount(a)
        if (waiting && a.plan === 'free' && tries++ < 10) setTimeout(() => void load(), 2000)
        else setWaiting(false)
      } catch (e) {
        if (!cancelled) setError(messageOf(e))
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [waiting])

  async function upgrade() {
    setBusy(true)
    setError(null)
    try {
      await goToCheckout() // the browser leaves for Stripe
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }

  async function manage() {
    setBusy(true)
    setError(null)
    try {
      window.location.assign((await openBillingPortal()).url)
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }

  if (!account) return error ? <p className={styles.error}>{error}</p> : <p className={styles.muted}>Loading…</p>


  return (
    <>
      {waiting && <p className={styles.intro}>Payment received. Switching you to Pro…</p>}
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.row}>
        <p className={styles.rowTitle}>Plan</p>
        <div className={styles.actions}>
          <span className={styles.value}>{account.plan_label}</span>
          {account.has_subscription && account.payments_enabled && account.plan !== 'free' && (
            <button type="button" className={styles.secondary} disabled={busy} onClick={() => void manage()}>
              Manage subscription
            </button>
          )}
        </div>
      </div>
      <div className={styles.row}>
        <p className={styles.rowTitle}>Canvases</p>
        <span className={styles.value}>
          {account.canvas_limit === null ? account.canvases : `${account.canvases} of ${account.canvas_limit}`}
        </span>
      </div>
      <div className={styles.row}>
        <p className={styles.rowTitle}>Cards per canvas</p>
        <span className={styles.value}>
          {account.card_limit === null ? 'Unlimited' : `Up to ${account.card_limit}`}
        </span>
      </div>
      <div className={styles.row}>
        <div>
          <p className={styles.rowTitle}>Spent this month</p>
          <p className={styles.rowHint}>
            Charged by Anthropic, Google or OpenAI to your own API key. An estimate from their list prices.
          </p>
        </div>
        <span className={styles.value}>${account.month_cost_usd.toFixed(2)}</span>
      </div>

      <div className={styles.plans}>
        {PLAN_OPTIONS.map((option) => (
          <section
            key={option.id}
            className={`${styles.plan} ${option.id === account.plan ? styles.planCurrent : ''}`}
          >
            <p className={styles.rowTitle}>{option.label}</p>
            <p className={styles.planPrice}>{option.price}</p>
            <ul className={styles.planPoints}>
              {option.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            {option.id === account.plan ? (
              <span className={styles.muted}>Current plan</span>
            ) : option.id === 'pro_max' ? (
              <span className={styles.muted}>Coming soon</span>
            ) : (
              option.id === 'pro' &&
              account.plan === 'free' && (
                <button
                  type="button"
                  className={styles.primary}
                  disabled={!account.payments_enabled || busy}
                  title={account.payments_enabled ? undefined : 'Payments are coming soon'}
                  onClick={() => void upgrade()}
                >
                  Upgrade
                </button>
              )
            )}
          </section>
        ))}
      </div>
    </>
  )
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.'
}

export default Settings
