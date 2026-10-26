import { useEffect, type ReactNode } from 'react'
import { onLinkClick } from './nav'
import { saveTheme, useShownTheme } from './theme'
import { useGetStarted } from './useGetStarted'
import styles from './SiteShell.module.css'

export type Page = 'home' | 'method' | 'pricing' | 'faq' | 'privacy' | 'terms'

// The menu, top-left on every page. All four are parts of the home page: the
// top of it, then sections further down. The footer repeats all but the first.
const PAGES: { page: Page; href: string; label: string }[] = [
  { page: 'home', href: '/', label: 'Divthink' },
  { page: 'method', href: '/#method', label: 'Method' },
  { page: 'pricing', href: '/#pricing', label: 'Pricing' },
  { page: 'faq', href: '/#faq', label: 'FAQ' },
]

// The frame around every public page: the menu top-left, "Sign in"
// top-right and the footer stay put, and the page itself goes in between.
// `bare` keeps only the ground (colours and grain), for pages that stand on
// their own: signing in, picking a plan.
function SiteShell({ current, bare, children }: { current?: Page; bare?: boolean; children?: ReactNode }) {
  const { logIn } = useGetStarted()
  const theme = useShownTheme()

  // These pages scroll, unlike the canvas (index.html, "site-dark"). index.html
  // guesses which before anything loads; this makes it certain while one of
  // these pages is on screen.
  useEffect(() => {
    document.documentElement.classList.add('site-dark')
    return () => document.documentElement.classList.remove('site-dark')
  }, [])

  if (bare) {
    return (
      <div className={styles.page}>
        <div className={styles.backdrop} />
        <div className={styles.sheet}>{children}</div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      {/* What shows in the gap when the page bounces past its top or bottom. */}
      <div className={styles.backdrop} />

      {/* The menu and "Sign in" are fixed to the window, not part of what
          scrolls, so they hold still even while the page bounces. */}
      <div className={styles.pinned}>
        <div className={styles.frame}>
          <nav className={styles.menu} aria-label="Main">
            <a className={styles.markLink} href="/" onClick={onLinkClick} aria-label="Home">
              <img className={styles.mark} src="/logo.svg" alt="" />
            </a>
            <ul className={styles.menuList}>
              {PAGES.map(({ page, href, label }) => (
                <li key={page}>
                  <a
                    className={styles.menuLink}
                    href={href}
                    onClick={onLinkClick}
                    aria-current={current === page ? 'page' : undefined}
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className={styles.between} />

          {/* Signing in and signing up are the same step (Google or an emailed
              code), so one button covers both. */}
          <div className={styles.corner}>
            <button type="button" className={styles.signIn} onClick={logIn}>
              Sign in
            </button>
          </div>
        </div>
      </div>

      <div className={styles.sheet}>
        <div className={styles.frame}>
          <div className={styles.menuSpace} />

          <div className={styles.content}>
            <main className={styles.main}>{children}</main>

            <footer className={styles.footer}>
              <div className={styles.footerLinks}>
                <a className={styles.footerMark} href="/" onClick={onLinkClick}>
                  <img className={styles.mark} src="/logo.svg" alt="" />
                  Divthink
                </a>
                <ul>
                  {PAGES.slice(1).map(({ page, href, label }) => (
                    <li key={page}>
                      <a href={href} onClick={onLinkClick}>
                        {label}
                      </a>
                    </li>
                  ))}
                </ul>
                <ul>
                  <li>
                    {/* Google's sign-in consent screen requires the policy to be linked from the home page. */}
                    <a href="/privacy" onClick={onLinkClick}>
                      Privacy Policy
                    </a>
                  </li>
                  <li>
                    <a href="/terms" onClick={onLinkClick}>
                      Terms of Service
                    </a>
                  </li>
                </ul>
              </div>
              <div className={styles.bottom}>
                <p className={styles.copyright}>© Divthink {new Date().getFullYear()}</p>
                {/* Shows what it switches to. */}
                <button
                  type="button"
                  className={styles.theme}
                  aria-label={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
                  title={theme === 'dark' ? 'Light' : 'Dark'}
                  onClick={() => saveTheme(theme === 'dark' ? 'light' : 'dark')}
                >
                  {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
                </button>
              </div>
            </footer>
          </div>

          <div className={styles.cornerSpace} />
        </div>
      </div>
    </div>
  )
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
      <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" />
    </svg>
  )
}

export default SiteShell
