import './style.css'
import { attachWallet, ctx, onChange, refreshChain, refreshPrices } from './app'
import { decodeKeeper } from './lib/share'
import { initTheme, syncToggle, toggleTheme } from './lib/theme'
import { connectNimiqPay, createDemoWallet, errorMessage, insideNimiqPay, isUserRejection } from './lib/wallet'
import { html } from './ui'
import { header } from './views/common'
import { renderKeeper } from './views/keeper'
import { renderConnectFailed, renderConnecting, renderHome, renderLanding } from './views/saver'

const root = document.getElementById('app')!
initTheme()

/** outside: normal browser. connecting: waiting on Nimiq Pay. failed: it declined or didn't answer. */
let conn: 'outside' | 'connecting' | 'failed' = insideNimiqPay() ? 'connecting' : 'outside'
let connError = ''
const CONNECT_TIMEOUT_MS = 20_000
const startDemo = () => void attachWallet(createDemoWallet())

// Views re-render often, so the theme switch uses one delegated listener.
document.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest?.('.theme-toggle')
  if (btn) toggleTheme()
})
new MutationObserver(() => document.querySelectorAll<HTMLButtonElement>('.theme-toggle').forEach(syncToggle)).observe(root, {
  childList: true,
})

function route(): void {
  const hash = location.hash.replace(/^#/, '')
  const keep = hash.match(/^\/keep\/([A-Za-z0-9_-]+)/)
  if (keep) {
    const payload = decodeKeeper(keep[1]!)
    if (payload) return renderKeeper(root, payload)
    root.innerHTML = html`${header()}<main class="page center-page"><h2>That Goalkeeper link looks broken</h2>
      <p class="muted">Ask your friend to share it again.</p><a class="btn btn-secondary" href="#/">Open Holdfast</a></main>`.html
    return
  }
  if (ctx.wallet) return renderHome(root)
  if (conn === 'connecting') return renderConnecting(root)
  if (conn === 'failed') return renderConnectFailed(root, connError, () => void connect(), startDemo)
  renderLanding(root, startDemo)
}

type Field = HTMLInputElement | HTMLSelectElement
const fieldKey = (el: Field) => `${el.form?.id ?? ''}|${el.name}|${el instanceof HTMLInputElement && el.type === 'radio' ? el.value : ''}`

/** Re-render without losing what the user has typed or selected in the current view's forms. */
function rerenderPreservingForms(): void {
  const saved = new Map<string, string | boolean>()
  root.querySelectorAll<Field>('form input[name], form select[name]').forEach((el) => {
    const radio = el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')
    saved.set(fieldKey(el), radio ? (el as HTMLInputElement).checked : el.value)
  })
  const focused = document.activeElement
  const focusKey = focused instanceof HTMLInputElement || focused instanceof HTMLSelectElement ? fieldKey(focused) : null
  route()
  root.querySelectorAll<Field>('form input[name], form select[name]').forEach((el) => {
    const v = saved.get(fieldKey(el))
    if (v === undefined) return
    if (typeof v === 'boolean') (el as HTMLInputElement).checked = v
    else if (el instanceof HTMLSelectElement && ![...el.options].some((o) => o.value === v)) return
    else el.value = v
    // Let the view recompute hints (fiat conversions etc.) and show/hide dependent fields.
    if (typeof v === 'string' && v) el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
    if (fieldKey(el) === focusKey) el.focus()
  })
}

let scheduled = false
let pendingForce = false
let deferred = false
onChange((force) => {
  // Background refreshes wait while the user is typing or a sheet is open; retry on blur.
  const typing = document.activeElement instanceof HTMLInputElement && !!document.activeElement.value
  if (!force && (typing || document.querySelector('.sheet-backdrop'))) {
    deferred = true
    return
  }
  pendingForce ||= force
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(() => {
    scheduled = false
    const wasForced = pendingForce
    pendingForce = false
    // User actions (create goal, lock...) render fresh; background data keeps form input.
    if (wasForced) route()
    else rerenderPreservingForms()
  })
})
window.addEventListener('hashchange', route)
document.addEventListener('focusout', () => {
  if (!deferred) return
  setTimeout(() => {
    if (deferred && !(document.activeElement instanceof HTMLInputElement) && !document.querySelector('.sheet-backdrop')) {
      deferred = false
      rerenderPreservingForms()
    }
  }, 300)
})

let attempt = 0
/** Connect to the Nimiq Pay wallet. Always ends on a screen the user can act on, never an endless spinner. */
async function connect(): Promise<void> {
  const mine = ++attempt
  conn = 'connecting'
  route()
  const fail = (message: string) => {
    if (mine !== attempt || ctx.wallet) return
    conn = 'failed'
    connError = message
    route()
  }
  const timer = window.setTimeout(
    () => fail("Nimiq Pay didn't answer. If it showed a connection request, approve it, then try again."),
    CONNECT_TIMEOUT_MS,
  )
  try {
    const wallet = await connectNimiqPay(10_000)
    if (!wallet) return fail("Couldn't reach the Nimiq Pay wallet. Close Holdfast and open it again from Nimiq Pay.")
    // If the answer arrives after the timeout it still connects, unless a wallet is already attached.
    if (ctx.wallet) return
    await attachWallet(wallet)
  } catch (err) {
    fail(
      isUserRejection(err)
        ? 'You declined the connection. Holdfast needs your wallet address to track your goal.'
        : `Nimiq Pay reported a problem: ${errorMessage(err)}`,
    )
  } finally {
    window.clearTimeout(timer)
  }
}

async function boot(): Promise<void> {
  route()
  void refreshPrices()
  // Friends opening a Goalkeeper link don't need to connect a wallet up front.
  if (location.hash.startsWith('#/keep/')) {
    if (conn === 'connecting') conn = 'outside'
    return
  }
  if (conn === 'connecting') return connect()
  // Outside Nimiq Pay the landing page shows at once. If the wallet turns up late, connect then.
  const late = await connectNimiqPay(10_000)
  if (late && !ctx.wallet) void connect()
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && ctx.wallet) {
    void refreshChain()
    void refreshPrices()
  }
})

void boot()
