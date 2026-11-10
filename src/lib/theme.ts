export type Theme = 'light' | 'dark'

const KEY = 'holdfast.theme'
const media = () => window.matchMedia?.('(prefers-color-scheme: dark)')

/** The theme the user picked, or null to follow the device setting. */
export function storedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

export const systemTheme = (): Theme => (media()?.matches ? 'dark' : 'light')
export const currentTheme = (): Theme => (document.documentElement.dataset.theme as Theme) || systemTheme()

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme === 'dark' ? '#14162e' : '#f4f5fa')
  document.querySelectorAll<HTMLButtonElement>('.theme-toggle').forEach(syncToggle)
}

export function syncToggle(btn: HTMLButtonElement): void {
  const dark = currentTheme() === 'dark'
  btn.setAttribute('aria-pressed', String(dark))
  btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme')
  btn.title = btn.getAttribute('aria-label')!
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark'
  try {
    localStorage.setItem(KEY, next)
  } catch {
    /* storage unavailable: theme still applies for this session */
  }
  // Animate colors only for a user-initiated switch, not on first paint.
  const root = document.documentElement
  root.classList.add('theme-anim')
  applyTheme(next)
  window.setTimeout(() => root.classList.remove('theme-anim'), 400)
  return next
}

/** Apply the saved or device theme and follow device changes until the user picks one. */
export function initTheme(): void {
  applyTheme(storedTheme() ?? systemTheme())
  media()?.addEventListener?.('change', () => {
    if (!storedTheme()) applyTheme(systemTheme())
  })
}
