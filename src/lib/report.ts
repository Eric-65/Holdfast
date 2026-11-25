import { APP_VERSION } from '../../api/_lib/version'
import { api } from './api'
import { config } from './config'

declare const __APP_COMMIT__: string
/** The commit this build was made from ("local" outside Vercel). */
export const BUILD_COMMIT: string = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'local'
export const BUILD = `${APP_VERSION}+${BUILD_COMMIT}`

const MAX_PER_VISIT = 10
const sent = new Set<string>()

/** Only the route, never goal ids or the contents of a Goalkeeper link. */
const screen = () => location.hash.split('/').slice(0, 2).join('/') || '#/'

/** Send one error to the builder's error list. Never throws; at most 10 different errors per visit. */
export function reportError(message: string): void {
  const text = message.trim().slice(0, 300)
  if (!text || sent.size >= MAX_PER_VISIT || sent.has(text)) return
  // Browser noise that says nothing about Holdfast.
  if (/ResizeObserver loop|^Script error\.?$/i.test(text)) return
  sent.add(text)
  try {
    void fetch(`${config.apiBase}/api/hf?a=report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, screen: screen(), version: BUILD }),
      keepalive: true,
    }).catch(() => undefined)
  } catch {
    /* reporting must never cause an error itself */
  }
}

/** Report uncaught errors and unhandled promise rejections. */
export function installErrorReporting(): void {
  window.addEventListener('error', (e) => {
    const where = e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''
    reportError(`${e.message || 'Error'}${where}`)
  })
  // Anything the Content-Security-Policy blocks (for example inside Nimiq Pay's WebView).
  document.addEventListener('securitypolicyviolation', (e) => {
    reportError(`CSP blocked ${e.effectiveDirective || e.violatedDirective}: ${e.blockedURI || 'inline'}`)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    reportError(`Unhandled: ${r instanceof Error ? `${r.name}: ${r.message}` : String(r)}`)
  })
}

let checkedAt = 0
/** If a newer build is live, offer to reload. Checks at most every 5 minutes. */
export async function checkForUpdate(): Promise<void> {
  if (BUILD_COMMIT === 'local' || Date.now() - checkedAt < 5 * 60_000) return
  checkedAt = Date.now()
  try {
    const { version } = await api.version()
    if (version && version !== 'local' && version !== BUILD_COMMIT) showUpdateBar()
  } catch {
    /* no API on this host, or offline: nothing to offer */
  }
}

function showUpdateBar(): void {
  if (document.getElementById('update-bar')) return
  const bar = document.createElement('button')
  bar.id = 'update-bar'
  bar.type = 'button'
  bar.className = 'update-bar'
  bar.textContent = 'Update available — tap to reload'
  bar.addEventListener('click', () => location.reload())
  document.body.appendChild(bar)
}
