import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { listSessions, renameSession, type Session } from './api'
import { authEnabled, signOut } from './auth'
import ContextMenu, { type MenuItem } from './ContextMenu'
import styles from './Sidebar.module.css'
import { resetCanvas, useCanvasStore } from './store'

// The bar in the top-left corner, naming the open canvas, and the drawer it
// opens: your other canvases and the account actions. Closed until asked for,
// because the canvas is the point.
function Sidebar({ children }: { children: React.ReactNode }) {
  const { session, loadSession, newSession, openKeys, renameCanvas, deleteCanvas } = useCanvasStore(
    useShallow((s) => ({
      deleteCanvas: s.deleteCanvas,
      session: s.session,
      loadSession: s.loadSession,
      newSession: s.newSession,
      openKeys: s.openKeys,
      renameCanvas: s.renameCanvas,
    })),
  )
  const [open, setOpen] = useState(false)
  // The canvas's name being edited in place; null while it is just being shown.
  const [draft, setDraft] = useState<string | null>(null)
  // The menu behind a row's dots, and the row being renamed in place.
  const [menu, setMenu] = useState<{ id: string; x: number; y: number; items: MenuItem[] } | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)

  function openMenu(target: Session, x: number, y: number) {
    const at = { id: target.id, x, y }
    setMenu({
      ...at,
      items: [
        {
          label: 'Rename',
          onClick: () => {
            setMenu(null)
            setRenaming({ id: target.id, title: target.title })
          },
        },
        {
          label: 'Delete',
          danger: true,
          // Deleting can't be undone, so the first press only asks: the menu
          // stays where it is and offers the real thing.
          onClick: () =>
            setMenu({
              ...at,
              items: [
                { label: 'Delete forever', danger: true, onClick: () => void remove(target.id) },
                { label: 'Cancel', onClick: () => setMenu(null) },
              ],
            }),
        },
      ],
    })
  }

  async function remove(id: string) {
    setMenu(null)
    if (await deleteCanvas(id)) setSessions((list) => list?.filter((s) => s.id !== id) ?? null)
  }

  function finishRename() {
    if (!renaming) return
    const { id } = renaming
    const title = renaming.title.split(/\s+/).join(' ').trim()
    setRenaming(null)
    if (title === sessions?.find((s) => s.id === id)?.title) return
    setSessions((list) => list?.map((s) => (s.id === id ? { ...s, title } : s)) ?? null)
    // The open canvas is renamed through the store, so the bar changes with it.
    if (id === session?.id) renameCanvas(title)
    else renameSession(id, title).catch(() => setFailed(true))
  }
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [failed, setFailed] = useState(false)

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

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      // One thing at a time: a menu or a rename in the drawer closes first.
      if (e.key === 'Escape' && !menu && !renaming) setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, menu, renaming])

  return (
    <div className={styles.shell}>
      {children}

      <div className={styles.bar}>
        <button
          type="button"
          className={styles.menuButton}
          onClick={() => setOpen(true)}
          aria-label="Canvases and settings"
          title="Canvases and settings"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 4h12M2 8h12M2 12h12" />
          </svg>
        </button>
        <img className={styles.mark} src="/logo.svg" alt="" />
        <span className={styles.brand}>Divthink</span>
        {session && (
          <>
            <span className={styles.slash}>/</span>
            {draft === null ? (
              <button
                type="button"
                className={styles.canvasName}
                onClick={() => setDraft(session.title)}
                title="Rename this canvas"
              >
                {session.title || 'Untitled canvas'}
              </button>
            ) : (
              <input
                className={styles.canvasInput}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  renameCanvas(draft)
                  setDraft(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') setDraft(null)
                }}
                maxLength={200}
                aria-label="Canvas name"
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
              />
            )}
          </>
        )}
      </div>

      {open && (
        <>
          <div className={styles.scrim} onClick={() => setOpen(false)} />
          <aside className={styles.drawer}>
            {/* The same button and name as the bar, in the same place, so the
                pointer that opened the drawer rests on the button that closes
                it and not on anything that does something. */}
            <div className={styles.drawerHeader}>
              <button
                type="button"
                className={styles.menuButton}
                onClick={() => setOpen(false)}
                aria-label="Close"
                title="Close"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M2 4h12M2 8h12M2 12h12" />
                </svg>
              </button>
              <img className={styles.mark} src="/logo.svg" alt="" />
              <span className={styles.brand}>Divthink</span>
            </div>

            <button
              type="button"
              className={styles.newCanvas}
              onClick={() => {
                setOpen(false)
                void newSession()
              }}
            >
              + New canvas
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
                  {sessions.map((s) =>
                    renaming?.id === s.id ? (
                      <li key={s.id}>
                        <input
                          className={styles.renameInput}
                          value={renaming.title}
                          onChange={(e) => setRenaming({ id: s.id, title: e.target.value })}
                          onBlur={finishRename}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur()
                            if (e.key === 'Escape') setRenaming(null)
                          }}
                          maxLength={200}
                          aria-label="Canvas name"
                          autoFocus
                          onFocus={(e) => e.currentTarget.select()}
                        />
                      </li>
                    ) : (
                      <li
                        key={s.id}
                        className={`${styles.row} ${menu?.id === s.id ? styles.rowOpen : ''}`}
                      >
                        <button
                          type="button"
                          className={`${styles.item} ${s.id === session?.id ? styles.current : ''}`}
                          onClick={() => {
                            setOpen(false)
                            if (s.id !== session?.id) void loadSession(s.id)
                          }}
                        >
                          <span className={styles.itemTitle}>{s.title || 'Untitled canvas'}</span>
                          <span className={styles.date}>{formatDate(s.updated_at)}</span>
                        </button>
                        <button
                          type="button"
                          className={styles.dots}
                          onClick={(e) => {
                            const box = e.currentTarget.getBoundingClientRect()
                            openMenu(s, box.left, box.bottom + 4)
                          }}
                          aria-label={`Options for ${s.title || 'Untitled canvas'}`}
                          title="Rename or delete"
                        >
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                            <circle cx="3.5" cy="8" r="1.25" />
                            <circle cx="8" cy="8" r="1.25" />
                            <circle cx="12.5" cy="8" r="1.25" />
                          </svg>
                        </button>
                      </li>
                    ),
                  )}
                </ul>
              )}
            </div>

            <div className={styles.footer}>
              <button
                type="button"
                className={styles.footerItem}
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
                  className={styles.footerItem}
                  onClick={() => {
                    resetCanvas()
                    // Back to the plain address: the canvas in it isn't theirs to see any more.
                    window.history.replaceState(null, '', '/')
                    void signOut()
                  }}
                >
                  Sign out
                </button>
              )}
            </div>
          </aside>
          {menu && (
            <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
          )}
        </>
      )}
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default Sidebar
