import { getActiveValidatorAddresses, getBlockNumber, getStakeTotals, getTransactionOutcome, fetchCheers, fetchValidators, chainAvailable, readFreshFor, setChainNetwork, type Cheer, type StakerInfo, type Validator } from './lib/chain'
import { getPrices, type PriceState } from './lib/prices'
import { confirmLock, loadState, reconcileWithdrawal, rejectLock, replaceGoal, saveState, SETTLE_MS, withWalletBaseline, type StoreState } from './lib/store'
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
  /** True once a cheers request has finished (cheers stay null if it failed). */
  cheersChecked: boolean
  /** The latest block number and when it was read, to count down a withdrawal's cool-down. */
  chainBlock: { n: number; at: number } | null
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
  chainBlock: null,
  cheersChecked: false,
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
/**
 * Read stake from the blockchain. Returns this reading, or null if the network did not answer.
 * On a failed read the last good reading stays on screen (ctx.stake), but callers that are about
 * to send a transaction must use the return value, never ctx.stake, so they never act on an old
 * number.
 */
/**
 * Right after a lock or withdrawal the network may still answer with the stake from before it
 * (the block isn't in yet, or a cached answer). Until a reading shows the change, the screen keeps
 * the expected number and such a reading doesn't count as fresh, so a withdrawal never acts on it.
 */
let expected: { balance: number; dir: 1 | -1; until: number } | null = null
const EXPECT_MS = 3 * 60_000
const LUNA_PER_NIM = 100_000

/** Call after Nimiq Pay sent a transaction that changes the active stake by `delta` luna. */
export function expectStakeChange(delta: number): void {
  if (!ctx.stake || !delta) return
  const balance = Math.max(0, ctx.stake.balance + delta)
  expected = { balance, dir: delta > 0 ? 1 : -1, until: Date.now() + EXPECT_MS }
  ctx.stake = { ...ctx.stake, balance }
  emit()
}

/** Stop waiting for a change (the transaction was refused). */
export function clearExpectedStake(): void {
  expected = null
}

/** Whether a reading already includes the change we're waiting for (rewards only ever add a little). */
export function readingShowsChange(reading: number, exp: { balance: number; dir: 1 | -1 }): boolean {
  return exp.dir > 0 ? reading >= exp.balance - 1 : reading <= exp.balance + LUNA_PER_NIM
}

export async function refreshChain(): Promise<StakerInfo | null> {
  if (!ctx.wallet || !ctx.accounts.length || !chainAvailable()) return null
  let stake = await getStakeTotals(ctx.accounts)
  if (stake && expected) {
    if (Date.now() > expected.until || readingShowsChange(stake.balance, expected)) expected = null
    else stake = null // an older answer: keep showing the expected number, and don't call it fresh
  }
  if (stake) ctx.stake = stake
  // The first settled reading tells how much of the stake belongs to no goal.
  if (stake) {
    let fixed = withWalletBaseline(ctx.state, stake.balance)
    // Withdrawals follow the blockchain: undo a retire that didn't happen, record steps that did.
    for (const g of fixed.goals) {
      if (g.status !== 'active' || !g.pendingUnlock) continue
      const matched = reconcileWithdrawal(g, stake)
      if (matched !== g) fixed = replaceGoal(fixed, matched)
    }
    // A withdrawal waiting for its cool-down needs the block number for the countdown.
    if (fixed.goals.some((g) => g.status === 'active' && g.pendingUnlock?.step === 'inactive')) await refreshBlock()
    if (fixed !== ctx.state) {
      commit(fixed, { quiet: true })
      return stake
    }
  }
  emit()
  return stake
}

const BLOCK_FRESH_MS = 60_000
/** The current block number, read at most once a minute. */
async function refreshBlock(): Promise<void> {
  if (ctx.chainBlock && Date.now() - ctx.chainBlock.at < BLOCK_FRESH_MS) return
  const n = await getBlockNumber()
  if (n !== null) ctx.chainBlock = { n, at: Date.now() }
}

/** Best guess of the block number now: the last reading plus one block a second since. */
export function estimatedBlock(now = Date.now()): number | null {
  const b = ctx.chainBlock
  return b ? b.n + Math.floor((now - b.at) / 1000) : null
}

/** A reading straight from the network, skipping any cached answer. For use right before a transaction. */
export async function readLiveStake(): Promise<StakerInfo | null> {
  readFreshFor(5_000)
  return refreshChain()
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
  if (!ctx.cheersChecked) {
    ctx.cheersChecked = true
    if (cheers === null) emit()
  }
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

/**
 * Check recorded locks against the chain. A lock the network refused (included but failed) is
 * taken off its goal, since nothing was staked. If no address of this wallet is a staker at all,
 * no settled lock can have gone through, whatever the server says about single transactions.
 * Returns the locks undone in this run.
 */
let verifying = false
export async function verifyLocks(): Promise<{ count: number; luna: number }> {
  const none = { count: 0, luna: 0 }
  if (verifying || !ctx.wallet || !chainAvailable()) return none
  verifying = true
  try {
    const now = Date.now()
    const pending = ctx.state.goals
      .filter((g) => g.status === 'active')
      .flatMap((g) => g.events.filter((e) => e.type === 'lock' && e.tx && !e.ok).map((e) => ({ goal: g.id, tx: e.tx!, at: e.at })))
      .slice(-10)
    if (!pending.length) return none
    const stake = await getStakeTotals(ctx.accounts)
    let state = ctx.state
    let count = 0
    let luna = 0
    for (const p of pending) {
      const outcome = await getTransactionOutcome(p.tx)
      if (!outcome) continue // network unreachable: try again later
      const goal = state.goals.find((g) => g.id === p.goal)
      if (!goal) continue
      const settled = now - p.at > SETTLE_MS
      // A goal that has since been withdrawn can leave the wallet with no staker; that proves nothing.
      const withdrawnSince = goal.events.some((e) => (e.type === 'unlock' || e.type === 'release') && e.at >= p.at) || !!goal.pendingUnlock
      const refused = outcome.executed === false || (settled && outcome.found && stake !== null && !stake.exists && !withdrawnSince)
      if (refused) {
        const event = goal.events.find((e) => e.type === 'lock' && e.tx === p.tx)
        count++
        luna += event?.luna ?? 0
        state = replaceGoal(state, rejectLock(goal, p.tx, now))
      } else if (outcome.found && (outcome.executed === true || stake?.exists)) {
        state = replaceGoal(state, confirmLock(goal, p.tx))
        state = { ...state, stakerCreated: true }
      }
    }
    if (state !== ctx.state) {
      // Undone locks change what belongs to which goal: read the wallet baseline again.
      if (count) state = { ...state, walletBaselineFromChain: false, walletBaselineLuna: 0 }
      commit(state, { quiet: true })
    }
    return { count, luna }
  } finally {
    verifying = false
  }
}

export async function refreshPrices(): Promise<void> {
  ctx.prices = await getPrices()
  emit()
}

/** `retry` asks again when an earlier attempt came back empty (for example while offline). */
export async function loadValidators(retry = false): Promise<void> {
  if (ctx.validatorsLoaded && !(retry && !ctx.validators.length)) return
  // The validators API lists mainnet validators only. On testnet, ask the testnet itself, so a new
  // staker is never delegated to a validator that doesn't exist there.
  ctx.validators =
    hostNetwork() === 'testnet'
      ? (await getActiveValidatorAddresses('testnet')).map((address) => ({
          address,
          name: `Testnet validator ${address.replace(/\s/g, '').slice(-4)}`,
          fee: null,
          payoutType: null,
          score: null,
          logo: null,
        }))
      : await fetchValidators()
  ctx.validatorsLoaded = true
  emit()
}

export function fiatValues(luna: number): { currency: string; value: number }[] {
  const rates = ctx.prices?.rates
  if (!rates) return []
  return ctx.fiats.filter((f) => rates[f]).map((f) => ({ currency: f, value: toNim(luna) * rates[f]! }))
}
