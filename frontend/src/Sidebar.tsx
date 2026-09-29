import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { listSessions, type Session } from './api'
import { authEnabled, signOut } from './auth'
import styles from './Sidebar.module.css'
import { resetCanvas, useCanvasStore } from './store'

const STORAGE_KEY = 'divthink.sidebar'

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'closed'
  } catch {
    return true // storage unavailable (private window): default to showing it
  }
}

function PanelIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1.5" y="2.5" width="13" height="11" />
      <line x1="6" y1="2.5" x2="6" y2="13.5" />
    </svg>
  )
}

function Sidebar({ children }: { children: React.ReactNode }) {
  const { session, loadSession, newSession, openKeys } = useCanvasStore(
    useShallow((s) => ({
      session: s.session,
      loadSession: s.loadSession,
      newSession: s.newSession,
      openKeys: s.openKeys,
    })),
  )
  const [open, setOpen] = useState(readOpen)
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, open ? 'open' : 'closed')
    } catch {
      // Storage unavailable; the choice just isn't remembered.
    }
  }, [open])

  // Refetched whenever the open canvas or its title changes, so a new canvas
  // appears immediately and a title set by the first prompt updates in place.
  useEffect(() => {
    let cancelled = false
    listSessions().then(
      (list) => {
        if (!cancelled) {
          setSessions(list)
          setFailed(false)
        }
      },
      () => {
        if (!cancelled) setFailed(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [session?.id, session?.title])

  return (
    <div className={styles.shell}>
      {open && (
        <aside className={styles.sidebar}>
          <div className={styles.header}>
            <span className={styles.brand}>
              <svg width="14" height="14" viewBox="0 0 32 32" aria-hidden="true">
                <rect x="5.5" y="5.5" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="3" />
              </svg>
              DivThink
            </span>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => setOpen(false)}
              title="Hide sidebar"
              aria-label="Hide sidebar"
            >
              <PanelIcon />
            </button>
          </div>

          <button type="button" className={styles.newCanvas} onClick={() => void newSession()}>
            New canvas
          </button>

          <div className={styles.listWrap}>
            <p className={styles.sectionLabel}>Canvases</p>
            {failed ? (
              <p className={styles.empty}>Couldn't load canvases.</p>
            ) : sessions === null ? (
              <p className={styles.empty}>Loading…</p>
            ) : sessions.length === 0 ? (
              <p className={styles.empty}>No canvases yet.</p>
            ) : (
              <ul className={styles.list}>
                {sessions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={`${styles.item} ${s.id === session?.id ? styles.current : ''}`}
                      onClick={() => {
                        if (s.id !== session?.id) void loadSession(s.id)
                      }}
                    >
                      <span className={styles.itemTitle}>{s.title || 'Untitled canvas'}</span>
                      <span className={styles.date}>{formatDate(s.updated_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={styles.footer}>
            <button type="button" className={styles.footerItem} onClick={openKeys}>
              API keys
            </button>
            {authEnabled && (
              <button
                type="button"
                className={styles.footerItem}
                onClick={() => {
                  resetCanvas()
                  void signOut()
                }}
              >
                Sign out
              </button>
            )}
          </div>
        </aside>
      )}

      <div className={styles.main}>
        {!open && (
          <button
            type="button"
            className={`${styles.iconButton} ${styles.reopen}`}
            onClick={() => setOpen(true)}
            title="Show sidebar"
            aria-label="Show sidebar"
          >
            <PanelIcon />
          </button>
        )}
        {children}
      </div>
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default Sidebar
