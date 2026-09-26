import { useEffect, useRef } from 'react'
import styles from './ContextMenu.module.css'

export type MenuItem = { label: string; onClick: () => void; danger?: boolean }

type Props = {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

const MENU_WIDTH = 160
const ITEM_HEIGHT = 30
const MENU_PADDING = 8
const SCREEN_MARGIN = 8

// Right-click menu, both for text highlighted in a reply (Branch/Copy) and for a
// box itself (Delete). See design.md, "Interactions".
function ContextMenu({ x, y, items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on a click elsewhere, Escape, scrolling/zooming, or resizing.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as globalThis.Node)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('wheel', onClose, { passive: true })
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('wheel', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  // Keep the menu on screen near the window edges.
  const height = items.length * ITEM_HEIGHT + MENU_PADDING
  const left = Math.min(x, window.innerWidth - MENU_WIDTH - SCREEN_MARGIN)
  const top = Math.min(y, window.innerHeight - height - SCREEN_MARGIN)

  return (
    <div ref={menuRef} className={styles.menu} style={{ left, top }} role="menu">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={[styles.item, item.danger && styles.danger].filter(Boolean).join(' ')}
          onClick={item.onClick}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export default ContextMenu
