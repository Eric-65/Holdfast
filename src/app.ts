import { getStakeTotals, fetchCheers, fetchValidators, chainAvailable, setChainNetwork, type Cheer, type StakerInfo, type Validator } from './lib/chain'
import { getPrices, type PriceState } from './lib/prices'
import { activeGoal, baselineUnknown, loadState, replaceGoal, saveState, withChainBaseline, type StoreState } from './lib/store'
import { hostFiat, hostNetwork, type Wallet } from './lib/wallet'
import { toNim } from './lib/format'
import type { OwnProfile, PublicStats } from './lib/api'

setChainNetwork(hostNetwork())

/**
 * unknown: not checked yet. unavailable: this deployment has no profile service.
 * signed_out: the wallet has not signed in on this device. ready: profile loaded.
 */
export type ProfileStatus = 'unknown' | 'unavailable' | 'signed_out' | 'ready'

export interface AppCtx {
  wallet: Wallet | null
  accounts: string[]
  address: string | null
  state: StoreState
  stake: StakerInfo | null
  walletBalance: number | null
  prices: PriceState | null
  validators: Validator[]
  validatorsLoaded: boolean
  /** Currencies shown next to NIM: USDT and NGN always, plus the host's currency (never plain USD). */
  fiats: string[]
  /** Whether this deployment has the profile service. null until checked. */
  apiAvailable: boolean | null
  profile: OwnProfile | null
  profileStatus: ProfileStatus
  /** The invite this visitor arrived with, once its code has been checked. */
  invite: { code: string; name: string } | null
  /** The "X invited you" message shows until this time (ms), then clears. 0 = not showing. */
  inviteBannerUntil: number
  /** Cheers this wallet has received on-chain (newest first). null = not loaded or unreadable. */
  cheers: Cheer[] | null
  /** Public usage numbers. null until loaded. */
  stats: PublicStats | null
  /** When the goals were last backed up to the profile (ms), 0 = not yet on this visit. */
  syncedAt: number
}

export const ctx: AppCtx = {
  wallet: null,
  accounts: [],
  address: null,
  state: { version: 1, goals: [], stakerCreated: false },
  stake: null,
  walletBalance: null,
  prices: null,
  validators: [],
  validatorsLoaded: false,
  apiAvailable: null,
  profile: null,
  profileStatus: 'unknown',
  invite: null,
  inviteBannerUntil: 0,
  cheers: null,
  stats: null,
  syncedAt: 0,
  fiats: (() => {
    const base = ['usdt', 'ngn']
    const h = hostFiat()
    return h && h !== 'usd' && !base.includes(h) ? [...base, h] : base
  })(),
}

/** force=true for user-driven changes; background refreshes pass false and may be deferred. */
type Listener = (force: boolean) => void
const listeners = new Set<Listener>()
export const onChange = (l: Listener) => listeners.add(l)
export const emit = (force = false) => listeners.forEach((l) => l(force))

/** Called after every saved change to the goals (used to back them up to the profile). */
type CommitListener = () => void
const commitListeners = new Set<CommitListener>()
export const onCommit = (l: CommitListener) => commitListeners.add(l)

export function commit(state: StoreState, opts: { quiet?: boolean } = {}): void {
  ctx.state = { ...state, updatedAt: Date.now() }
  if (ctx.address) saveState(ctx.address, ctx.state)
  commitListeners.forEach((l) => l())
  // quiet: a background correction, so don't interrupt someone typing.
  emit(!opts.quiet)
}

export async function attachWallet(wallet: Wallet): Promise<void> {
  // Only treat the wallet as connected once it has actually shared an address.
  const accounts = await wallet.listAccounts()
  if (!Array.isArray(accounts) || !accounts[0]) throw new Error('Nimiq Pay did not share a wallet address')
  ctx.wallet = wallet
  ctx.accounts = accounts
  ctx.address = accounts[0]
  ctx.state = loadState(ctx.address)
  ctx.cheers = null
  wallet.onAccountsChanged((next) => {
    ctx.accounts = next
    // Nimiq Pay replaced the balance address; the old reading no longer applies.
    balanceFetchedAt = 0
    void refreshChain()
  })
  emit(true)
  void refreshChain()
}

/** Staked amounts from the blockchain (only when an RPC endpoint is configured). */
export async function refreshChain(): Promise<void> {
  if (!ctx.wallet || !ctx.accounts.length || !chainAvailable()) return
  // Keep the last good reading if the network doesn't answer this time.
  const stake = await getStakeTotals(ctx.accounts)
  if (stake) ctx.stake = stake
  const goal = activeGoal(ctx.state)
  if (ctx.stake && goal && baselineUnknown(goal)) {
    const fixed = withChainBaseline(goal, ctx.stake.balance)
    if (fixed !== goal) return commit(replaceGoal(ctx.state, fixed), { quiet: true })
  }
  emit()
}

const CHEERS_FRESH_MS = 60_000
let cheersFetchedAt = 0
/** Cheers received by this wallet, at most once a minute unless `force`. */
export async function refreshCheers(force = false): Promise<void> {
  const address = ctx.address
  if (!address || (!force && Date.now() - cheersFetchedAt < CHEERS_FRESH_MS)) return
  cheersFetchedAt = Date.now()
  const cheers = await fetchCheers(address)
  if (address !== ctx.address) return
  if (cheers === null && ctx.cheers !== null) return // keep what we have on a temporary failure
  ctx.cheers = cheers
  emit()
}

const BALANCE_FRESH_MS = 60_000
const BALANCE_RETRY_MS = 5 * 60_000
let balanceFetchedAt = 0
let balanceRetryAt = 0
let balanceInFlight = false

/**
 * Spendable NIM, for the "Wallet: X NIM" hint on the lock form. It is only a hint, so Holdfast
 * asks sparingly: one lookup, only when the goal screen needs it, at most once a minute. Nimiq Pay
 * shows its own "Error getting balance" message whenever a lookup fails, so after a failure
 * Holdfast waits five minutes before asking again instead of repeating the error.
 * `changed` = a transaction just went through, so a recent reading is out of date.
 */
export async function refreshBalance(changed = false): Promise<void> {
  const w = ctx.wallet
  const now = Date.now()
  if (!w || !ctx.accounts.length || balanceInFlight || now < balanceRetryAt) return
  if (!changed && now - balanceFetchedAt < BALANCE_FRESH_MS) return
  // Nimiq Pay keeps spendable NIM at the second address (its payment contract) when there is one.
  const address = ctx.accounts[1] ?? ctx.accounts[0]!
  balanceInFlight = true
  try {
    const balance = await w.getBalance(address)
    balanceFetchedAt = Date.now()
    if (typeof balance === 'number' && balance !== ctx.walletBalance) {
      ctx.walletBalance = balance
      emit()
    }
  } catch {
    balanceRetryAt = Date.now() + BALANCE_RETRY_MS
  } finally {
    balanceInFlight = false
  }
}

export async function refreshPrices(): Promise<void> {
  ctx.prices = await getPrices()
  emit()
}

/** `retry` asks again when an earlier attempt came back empty (for example while offline). */
export async function loadValidators(retry = false): Promise<void> {
  if (ctx.validatorsLoaded && !(retry && !ctx.validators.length)) return
  ctx.validators = await fetchValidators()
  ctx.validatorsLoaded = true
  emit()
}

export function fiatValues(luna: number): { currency: string; value: number }[] {
  const rates = ctx.prices?.rates
  if (!rates) return []
  return ctx.fiats.filter((f) => rates[f]).map((f) => ({ currency: f, value: toNim(luna) * rates[f]! }))
}
