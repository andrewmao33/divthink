import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { deleteKey, listKeys, saveKey, type KeyStatus } from './api'
import styles from './KeysDialog.module.css'
import { useCanvasStore } from './store'

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

// Users bring their own provider keys (menu → API keys).
function KeysDialog() {
  const { keysOpen, closeKeys, loadModels } = useCanvasStore(
    useShallow((s) => ({ keysOpen: s.keysOpen, closeKeys: s.closeKeys, loadModels: s.loadModels })),
  )
  const [keys, setKeys] = useState<KeyStatus[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!keysOpen) return
    let cancelled = false
    listKeys().then(
      (list) => {
        if (!cancelled) setKeys(list)
      },
      (e: unknown) => {
        if (!cancelled) setError(messageOf(e))
      },
    )
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeKeys()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      cancelled = true
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [keysOpen, closeKeys])

  if (!keysOpen) return null

  async function refresh() {
    setKeys(await listKeys())
    void loadModels() // the model picker enables providers with a key
  }

  return (
    <div
      className={styles.backdrop}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) closeKeys()
      }}
    >
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="keys-title">
        <h2 id="keys-title" className={styles.title}>
          API keys
        </h2>
        <p className={styles.intro}>
          divthink uses your own keys. They're encrypted on the server, never shown again, and only
          used to write your replies.
        </p>
        {error && <p className={styles.error}>{error}</p>}
        {keys === null && !error ? (
          <p className={styles.muted}>Loading…</p>
        ) : (
          keys?.map((status) => <KeyRow key={status.provider} status={status} onChange={refresh} />)
        )}
        <div className={styles.footer}>
          <button type="button" className={styles.secondary} onClick={closeKeys}>
            Done
          </button>
        </div>
      </div>
    </div>
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
    <section className={styles.row}>
      <div className={styles.rowHeader}>
        <span className={styles.provider}>{status.label}</span>
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

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.'
}

export default KeysDialog
