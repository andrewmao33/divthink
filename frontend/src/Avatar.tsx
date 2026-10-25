import { useState } from 'react'
import styles from './Avatar.module.css'

// A round profile picture, or the name's first letter when there is none (or it
// fails to load).
function Avatar({ name, picture, size = 28 }: { name: string; picture: string | null; size?: number }) {
  const [failed, setFailed] = useState<string | null>(null)
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) }
  if (picture && failed !== picture) {
    return (
      <img
        className={styles.avatar}
        style={style}
        src={picture}
        alt=""
        // Google's picture links refuse requests that carry another site as referrer.
        referrerPolicy="no-referrer"
        onError={() => setFailed(picture)}
      />
    )
  }
  return (
    <span className={`${styles.avatar} ${styles.initial}`} style={style} aria-hidden="true">
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

export default Avatar
