import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { getAccount, listSessions, renameSession, type Account, type Session } from './api'
import { authEnabled } from './auth'
import Avatar from './Avatar'
import ContextMenu, { type MenuItem } from './ContextMenu'
import { loadProfile, type Profile } from './profile'
import styles from './Sidebar.module.css'
import { openPlans } from './upgrade'
import { logOut, useCanvasStore } from './store'

// The bar in the top-left corner, naming the open canvas, and the drawer it
// opens: your other canvases and the account actions. Closed until asked for,
// because the canvas is the point.
function Sidebar({ children }: { children: React.ReactNode }) {
  const { session, unsaved, loadSession, newSession, openSettings, renameCanvas, deleteCanvas } = useCanvasStore(
    useShallow((s) => ({
      deleteCanvas: s.deleteCanvas,
      session: s.session,
      unsaved: s.unsaved,
      loadSession: s.loadSession,
      newSession: s.newSession,
      openSettings: s.openSettings,
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
  // The plan and picture, for the account button at the bottom. Fetched each
  // time the drawer opens, so a fresh upgrade or a new picture shows.
  const [account, setAccount] = useState<Account | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  // The menu above the account button.
  const [accountOpen, setAccountOpen] = useState(false)
  const accountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    getAccount()
      .catch(() => null) // leave the plan out rather than show a wrong one
      .then(async (a) => {
        const p = await loadProfile(a)
        if (cancelled) return
        setAccount(a)
        setProfile(p)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  // The account menu closes on a click anywhere outside it, and with the drawer.
  useEffect(() => {
    if (!accountOpen) return
    const onPointerDown = (e: PointerEvent) => {
      if (!accountRef.current?.contains(e.target as globalThis.Node)) setAccountOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [accountOpen])

  useEffect(() => {
    if (!open) setAccountOpen(false)
  }, [open])

  // A choice in the account menu closes the menu and the drawer, then acts.
  function pick(action: () => void) {
    setAccountOpen(false)
    setOpen(false)
    action()
  }

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
      if (e.key !== 'Escape' || menu || renaming) return
      if (accountOpen) setAccountOpen(false)
      else setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, menu, renaming, accountOpen])

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
            {unsaved ? (
              // Nothing to rename until the first prompt saves it.
              <span className={styles.canvasName}>New canvas</span>
            ) : draft === null ? (
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

            <div className={styles.footer} ref={accountRef}>
              {accountOpen && (
                <div className={styles.accountMenu} role="menu">
                  {profile?.email && <p className={styles.accountEmail}>{profile.email}</p>}
                  <MenuButton icon={<GearIcon />} label="Settings" onClick={() => pick(() => openSettings())} />
                  {account?.plan === 'free' && (
                    <MenuButton icon={<UpgradeIcon />} label="Upgrade plan" onClick={() => pick(openPlans)} />
                  )}
                  {authEnabled && (
                    <>
                      <div className={styles.accountDivider} />
                      <MenuButton icon={<LogOutIcon />} label="Log out" onClick={logOut} />
                    </>
                  )}
                </div>
              )}
              <button
                type="button"
                className={styles.accountButton}
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                onClick={() => setAccountOpen((v) => !v)}
              >
                <Avatar name={profile?.name ?? ''} picture={profile?.picture ?? null} size={26} />
                <span className={styles.accountName}>{profile?.name ?? ''}</span>
                {account && <span className={styles.accountPlan}>· {account.plan_label}</span>}
                <svg className={styles.chevron} width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d={accountOpen ? 'M3 7.5l3-3 3 3' : 'M3 4.5l3 3 3-3'} />
                </svg>
              </button>
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

function MenuButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.accountItem} role="menuitem" onClick={onClick}>
      {icon}
      {label}
    </button>
  )
}

// Line icons for the account menu, 16px, drawn in the text colour.
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

function GearIcon() {
  return (
    <Icon>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
    </Icon>
  )
}

function UpgradeIcon() {
  return (
    <Icon>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 11V5M5.5 7.5L8 5l2.5 2.5" />
    </Icon>
  )
}

function LogOutIcon() {
  return (
    <Icon>
      <path d="M6.5 2.5h-3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3M10.5 11L13.5 8l-3-3M13.5 8H6" />
    </Icon>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default Sidebar
