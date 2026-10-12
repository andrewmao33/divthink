// Moving between the site's own pages, and between sections of the home page,
// without reloading. A reload repaints the whole window, which shows as a
// flash; this just swaps what App renders and scrolls to the right place.
import type { MouseEvent } from 'react'

export function currentPath(): string {
  return window.location.pathname.replace(/\/$/, '') || '/'
}

// `to` is a path with an optional section, e.g. "/privacy" or "/#pricing".
export function navigate(to: string): void {
  const url = new URL(to, window.location.href)
  const samePage = (url.pathname.replace(/\/$/, '') || '/') === currentPath()
  if (!samePage || url.hash !== window.location.hash) {
    window.history.pushState(null, '', url.pathname + url.hash)
    // pushState fires no event of its own; App listens for this one.
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
  // Glide within a page; jump when the page itself changed. Wait for the new
  // page to be on screen first, or the section isn't there to scroll to.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => scrollToSection(url.hash, samePage ? 'smooth' : 'auto')),
  )
}

// Scrolls to the section a hash names ("#pricing"), or to the top without one.
export function scrollToSection(hash: string, behavior: ScrollBehavior = 'auto'): void {
  const section = hash.length > 1 ? document.getElementById(hash.slice(1)) : null
  if (section) section.scrollIntoView({ behavior, block: 'start' })
  else window.scrollTo({ top: 0, behavior })
}

// For <a href> links to our own pages: handle a plain click here, and leave
// new-tab clicks (cmd, ctrl, middle button) to the browser.
export function onLinkClick(event: MouseEvent<HTMLAnchorElement>): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  const url = new URL(event.currentTarget.href)
  navigate(url.pathname + url.hash)
}
