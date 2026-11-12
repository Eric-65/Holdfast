import { getStakeTotals, fetchValidators, chainAvailable, type StakerInfo, type Validator } from './lib/chain'
import { getPrices, type PriceState } from './lib/prices'
import { loadState, saveState, type StoreState } from './lib/store'
import { hostFiat, type Wallet } from './lib/wallet'
import { toNim } from './lib/format'
import type { OwnProfile } from './lib/api'

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

export function commit(state: StoreState): void {
  ctx.state = state
  if (ctx.address) saveState(ctx.address, state)
  emit(true)
}

export async function attachWallet(wallet: Wallet): Promise<void> {
  // Only treat the wallet as connected once it has actually shared an address.
  const accounts = await wallet.listAccounts()
  if (!Array.isArray(accounts) || !accounts[0]) throw new Error('Nimiq Pay did not share a wallet address')
  ctx.wallet = wallet
  ctx.accounts = accounts
  ctx.address = accounts[0]
  ctx.state = loadState(ctx.address)
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
  ctx.stake = await getStakeTotals(ctx.accounts)
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
