import { useEffect, type ReactNode } from 'react'
import { onLinkClick } from './nav'
import { useGetStarted } from './useGetStarted'
import styles from './SiteShell.module.css'

const GITHUB_URL = 'https://github.com/andrewmao33/divthink'

export type Page = 'home' | 'method' | 'pricing' | 'faq' | 'privacy'

// The menu, top-left on every page. All four are parts of the home page: the
// top of it, then sections further down. The footer repeats all but the first.
const PAGES: { page: Page; href: string; label: string }[] = [
  { page: 'home', href: '/', label: 'Divthink' },
  { page: 'method', href: '/#method', label: 'Method' },
  { page: 'pricing', href: '/#pricing', label: 'Pricing' },
  { page: 'faq', href: '/#faq', label: 'FAQ' },
]

// The frame around every public page: the menu top-left, "Get started"
// top-right and the footer stay put, and the page itself goes in between.
function SiteShell({ current, children }: { current: Page; children?: ReactNode }) {
  const { busy, error, start } = useGetStarted()

  // The window behind the page is light for the canvas and dark for these pages
  // (index.html, "site-dark"). index.html guesses which before anything loads;
  // this makes it certain while one of these pages is on screen.
  useEffect(() => {
    document.documentElement.classList.add('site-dark')
    return () => document.documentElement.classList.remove('site-dark')
  }, [])

  return (
    <div className={styles.page}>
      <div className={styles.frame}>
        <nav className={styles.menu} aria-label="Main">
          <img className={styles.mark} src="/logo.svg" alt="" />
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

        <div className={styles.content}>
          <main className={styles.main}>{children}</main>

          <footer className={styles.footer}>
            <div className={styles.footerLinks}>
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
                  <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener">
                    GitHub
                    <span className={styles.external} aria-hidden="true">
                      ↗
                    </span>
                  </a>
                </li>
              </ul>
              <ul>
                <li>
                  {/* Google's sign-in consent screen requires the policy to be linked from the home page. */}
                  <a href="/privacy" onClick={onLinkClick}>
                    Privacy Policy
                  </a>
                </li>
              </ul>
            </div>
            <p className={styles.copyright}>© Divthink {new Date().getFullYear()}</p>
          </footer>
        </div>

        <div className={styles.corner}>
          <button type="button" className={styles.start} onClick={start} disabled={busy}>
            {busy ? 'Redirecting…' : 'Get started'}
          </button>
          {error && <p className={styles.error}>{error}</p>}
        </div>
      </div>
    </div>
  )
}

export default SiteShell
