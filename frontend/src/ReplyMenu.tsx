import { useEffect, useRef } from 'react'
import styles from './ReplyMenu.module.css'

type Props = {
  x: number
  y: number
  onBranch: () => void
  onCopy: () => void
  onClose: () => void
}

const MENU_WIDTH = 160
const MENU_HEIGHT = 84

// Right-click menu for text highlighted in a reply (design.md, "Interactions").
function ReplyMenu({ x, y, onBranch, onCopy, onClose }: Props) {
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
  const left = Math.min(x, window.innerWidth - MENU_WIDTH - 8)
  const top = Math.min(y, window.innerHeight - MENU_HEIGHT - 8)

  return (
    <div ref={menuRef} className={styles.menu} style={{ left, top }} role="menu">
      <button type="button" role="menuitem" className={styles.item} onClick={onBranch}>
        Branch
      </button>
      <button type="button" role="menuitem" className={styles.item} onClick={onCopy}>
        Copy
      </button>
    </div>
  )
}

export default ReplyMenu
