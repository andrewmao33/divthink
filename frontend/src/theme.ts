import { useSyncExternalStore } from 'react'

// Light or dark, for the app and the public pages alike. "system" follows the
// computer's own setting and changes with it. The choice is kept in this
// browser only: Settings → General picks any of the three, the footer's switch
// picks light or dark.
//
// index.html applies the saved choice before anything draws, so a light page
// never opens dark first; this file keeps it in step afterwards.

export type Theme = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'divthink.theme'

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

export function loadTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // Storage blocked: fall back to the system setting.
  }
  return 'system'
}

export function saveTheme(theme: Theme) {
  try {
    if (theme === 'system') window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Still applied for this visit.
  }
  applyTheme()
}

// What is on screen now: the choice, with "system" worked out.
function shown(): 'light' | 'dark' {
  const theme = loadTheme()
  return theme === 'light' || (theme === 'system' && !darkQuery.matches) ? 'light' : 'dark'
}

export function applyTheme() {
  const theme = shown()
  document.documentElement.dataset.theme = theme
  // The colour phones give the browser bar: the page's own background.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'light' ? '#f4efe6' : '#1d1b18')
  listeners.forEach((listener) => listener())
}

// On "system", follow the computer when it switches (e.g. at sunset).
darkQuery.addEventListener('change', applyTheme)

/** Light or dark as shown now, re-rendering when it changes. */
export function useShownTheme() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, shown)
}
