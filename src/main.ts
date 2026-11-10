import './style.css'
import { attachWallet, ctx, onChange, refreshChain, refreshPrices } from './app'
import { decodeKeeper } from './lib/share'
import { initTheme, syncToggle, toggleTheme } from './lib/theme'
import { connectNimiqPay, createDemoWallet, insideNimiqPay } from './lib/wallet'
import { html } from './ui'
import { header } from './views/common'
import { renderKeeper } from './views/keeper'
import { renderConnecting, renderHome, renderLanding } from './views/saver'

const root = document.getElementById('app')!
initTheme()
let connecting = true

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
  if (connecting) return renderConnecting(root)
  renderLanding(root, () => {
    void attachWallet(createDemoWallet())
  })
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

async function boot(): Promise<void> {
  route()
  void refreshPrices()
  const isKeeper = location.hash.startsWith('#/keep/')
  // Friends opening a Goalkeeper link don't need to connect a wallet up front.
  if (isKeeper) {
    connecting = false
    return
  }
  const wallet = await connectNimiqPay(insideNimiqPay() ? 10_000 : 2_500)
  connecting = false
  if (wallet) await attachWallet(wallet).catch(() => route())
  else route()
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && ctx.wallet) {
    void refreshChain()
    void refreshPrices()
  }
})

void boot()
