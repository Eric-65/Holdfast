import './style.css'
import { attachWallet, ctx, onChange, refreshChain, refreshPrices } from './app'
import { decodeKeeper } from './lib/share'
import { connectNimiqPay, createDemoWallet, insideNimiqPay } from './lib/wallet'
import { html } from './ui'
import { header } from './views/common'
import { renderKeeper } from './views/keeper'
import { renderConnecting, renderHome, renderLanding } from './views/saver'

const root = document.getElementById('app')!
let connecting = true

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

let scheduled = false
let deferred = false
onChange((force) => {
  // Background refreshes must not wipe what the user is typing or an open sheet; retry on blur.
  const typing = document.activeElement instanceof HTMLInputElement && !!document.activeElement.value
  if (!force && (typing || document.querySelector('.sheet-backdrop'))) {
    deferred = true
    return
  }
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(() => {
    scheduled = false
    route()
  })
})
window.addEventListener('hashchange', route)
document.addEventListener('focusout', () => {
  if (!deferred) return
  setTimeout(() => {
    if (deferred && !(document.activeElement instanceof HTMLInputElement) && !document.querySelector('.sheet-backdrop')) {
      deferred = false
      route()
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
