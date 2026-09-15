import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { listSessions, type Session } from './api'
import { authEnabled, signOut } from './auth'
import styles from './CanvasMenu.module.css'
import { resetCanvas, useCanvasStore } from './store'

// Top-left: the open canvas's title; click for your canvases and "New canvas".
function CanvasMenu() {
  const { session, loadSession, newSession, openKeys } = useCanvasStore(
    useShallow((s) => ({
      session: s.session,
      loadSession: s.loadSession,
      newSession: s.newSession,
      openKeys: s.openKeys,
    })),
  )
  const [open, setOpen] = useState(false)
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [failed, setFailed] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // While open: fetch the list fresh, and close on a click elsewhere or Escape.
  useEffect(() => {
    if (!open) return
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
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as globalThis.Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      cancelled = true
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function open_(id: string) {
    setOpen(false)
    if (id !== session?.id) void loadSession(id)
  }

  return (
    <div ref={menuRef} className={styles.wrap}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className={styles.title}>{session ? titleOf(session) : 'Canvases'}</span>
        <span className={styles.caret} aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => {
              setOpen(false)
              void newSession()
            }}
          >
            New canvas
          </button>
          <div className={styles.divider} />
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
                    role="menuitem"
                    className={`${styles.item} ${s.id === session?.id ? styles.current : ''}`}
                    onClick={() => open_(s.id)}
                  >
                    <span className={styles.itemTitle}>{titleOf(s)}</span>
                    <span className={styles.date}>{formatDate(s.updated_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className={styles.divider} />
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => {
              setOpen(false)
              openKeys()
            }}
          >
            API keys
          </button>
          {authEnabled && (
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                setOpen(false)
                resetCanvas()
                void signOut()
              }}
            >
              Sign out
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function titleOf(session: Session): string {
  return session.title || 'Untitled canvas'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default CanvasMenu
