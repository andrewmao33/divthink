import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { deleteAccount, deleteKey, listKeys, saveKey, type KeyStatus } from './api'
import { authEnabled, signOut, supabase } from './auth'
import styles from './Settings.module.css'
import { logOut, useCanvasStore, type SettingsSection } from './store'

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'account', label: 'Account' },
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

  return (
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
          {usable.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      )}
    </div>
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

function Billing() {
  return (
    <p className={styles.intro}>
      Divthink is free. Replies are charged by Anthropic or Google to your own API key, so usage and
      spending show up in the{' '}
      <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener noreferrer">
        Claude Console
      </a>{' '}
      or{' '}
      <a href="https://aistudio.google.com/usage" target="_blank" rel="noopener noreferrer">
        Google AI Studio
      </a>
      .
    </p>
  )
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.'
}

export default Settings
