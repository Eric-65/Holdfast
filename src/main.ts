import './style.css'
import { checkApi, claimPendingInvite, loadInvite, loadProfile, refreshProfile, refreshStats, restoreOrBackup, scheduleBackup } from './account'
import { attachWallet, ctx, onChange, onCommit, refreshChain, refreshCheers, refreshPrices } from './app'
import { captureInviteCode, wasWelcomed } from './lib/identity'
import { decodeKeeper } from './lib/share'
import { initTheme, syncToggle, toggleTheme } from './lib/theme'
import { connectNimiqPay, errorMessage, insideNimiqPay, isUserRejection } from './lib/wallet'
import { html, toast } from './ui'
import { header } from './views/common'
import { renderKeeper } from './views/keeper'
import { renderConnectFailed, renderConnecting, renderHome, renderLanding } from './views/saver'
import { openWelcomeSheet, renderBoard, renderProfile, tabBar } from './views/social'

const root = document.getElementById('app')!
initTheme()
// Every change to the goals is backed up to the profile (when signed in), so it survives a new
// phone and the Goalkeeper's link stays live.
onCommit(() => scheduleBackup())
// An invite link lands as ?ref=CODE. Remember the code now; it is used when the profile is created.
const arrivedByInvite = captureInviteCode() !== null

/** outside: normal browser. connecting: waiting on Nimiq Pay. failed: it declined or didn't answer. */
let conn: 'outside' | 'connecting' | 'failed' = insideNimiqPay() ? 'connecting' : 'outside'
let connError = ''
const CONNECT_TIMEOUT_MS = 20_000

// Views re-render often, so the header controls use one delegated listener.
document.addEventListener('click', (e) => {
  const target = e.target as Element
  if (target.closest?.('.theme-toggle')) toggleTheme()
  // The logo always leads back to the first page, at the top. When the visitor is already
  // there the address does not change, so scroll up explicitly.
  if (target.closest?.('.brand')) window.scrollTo({ top: 0, behavior: 'smooth' })
})
new MutationObserver(() => document.querySelectorAll<HTMLButtonElement>('.theme-toggle').forEach(syncToggle)).observe(root, {
  childList: true,
})

/** Draw the current screen, then the bottom navigation for connected wallets. */
function route(): void {
  const tab = renderRoute()
  const social = !!ctx.wallet && ctx.apiAvailable === true
  document.body.classList.toggle('has-tabs', social && tab !== null)
  if (social && tab) root.insertAdjacentHTML('beforeend', tabBar(tab).html)
}

function renderRoute(): 'goal' | 'board' | 'me' | null {
  const hash = location.hash.replace(/^#/, '')
  const keep = hash.match(/^\/keep\/([A-Za-z0-9_-]+)/)
  if (keep) {
    const payload = decodeKeeper(keep[1]!)
    if (payload) renderKeeper(root, payload)
    else
      root.innerHTML = html`${header()}<main class="page center-page"><h2>That Goalkeeper link looks broken</h2>
        <p class="muted">Ask your friend to share it again.</p><a class="btn btn-secondary" href="#/">Open Holdfast</a></main>`.html
    return null
  }
  // The leaderboard is public: it works with or without a wallet.
  if (hash.startsWith('/board') && ctx.apiAvailable !== false) return renderBoard(root), 'board'
  if (ctx.wallet) {
    if (hash.startsWith('/me') && ctx.apiAvailable !== false) return renderProfile(root), 'me'
    return renderHome(root), 'goal'
  }
  if (conn === 'connecting') renderConnecting(root)
  else if (conn === 'failed') renderConnectFailed(root, connError, () => void connect())
  else renderLanding(root)
  return null
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
window.addEventListener('hashchange', () => {
  route()
  window.scrollTo(0, 0)
  // Opening the profile or the leaderboard shows current referral counts and rank.
  if (/^#\/(me|board)/.test(location.hash)) void refreshProfile()
})
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
    void startAccount()
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

/** Once the wallet is connected: restore the profile, or offer to create one (once per wallet). */
async function startAccount(): Promise<void> {
  await Promise.all([loadProfile(), loadInvite(arrivedByInvite)])
  void restoreOrBackup()
  // Already has a profile but no inviter yet: an invite link opened now still counts.
  const inviter = await claimPendingInvite()
  if (inviter) toast(`🎉 ${inviter} is now your inviter`, 'success')
  const address = ctx.address
  if (!address || ctx.profileStatus !== 'signed_out' || wasWelcomed(address)) return
  if (location.hash.startsWith('#/keep/') || document.querySelector('.sheet-backdrop')) return
  openWelcomeSheet()
}

async function boot(): Promise<void> {
  route()
  void refreshPrices()
  void loadInvite(arrivedByInvite)
  // Friends opening a Goalkeeper link don't need to connect a wallet up front.
  if (location.hash.startsWith('#/keep/')) {
    if (conn === 'connecting') conn = 'outside'
    return
  }
  if (conn === 'connecting') return connect()
  void checkApi()
  void refreshStats()
  // Outside Nimiq Pay the landing page shows at once. If the wallet turns up late, connect then.
  const late = await connectNimiqPay(10_000)
  if (late && !ctx.wallet) void connect()
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && ctx.wallet) {
    void refreshChain()
    void refreshPrices()
    void refreshCheers()
    void refreshProfile(15_000)
  }
})

void boot()
