import { getStakeTotals, fetchValidators, chainAvailable, type StakerInfo, type Validator } from './lib/chain'
import { getPrices, type PriceState } from './lib/prices'
import { loadState, saveState, type StoreState } from './lib/store'
import { hostFiat, type Wallet } from './lib/wallet'
import { toNim } from './lib/format'

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
  /** Fiat currencies shown next to NIM: USD and NGN always, plus the host's currency. */
  fiats: string[]
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
  fiats: (() => {
    const base = ['usd', 'ngn']
    const h = hostFiat()
    return h && !base.includes(h) ? [...base, h] : base
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
  ctx.wallet = wallet
  ctx.accounts = await wallet.listAccounts()
  ctx.address = ctx.accounts[0] ?? null
  if (ctx.address) ctx.state = loadState(ctx.address)
  wallet.onAccountsChanged((accounts) => {
    ctx.accounts = accounts
    void refreshChain()
  })
  emit(true)
  void refreshChain()
}

export async function refreshChain(): Promise<void> {
  const w = ctx.wallet
  if (!w || !ctx.accounts.length) return
  const [stake, balances] = await Promise.all([
    chainAvailable() ? getStakeTotals(ctx.accounts) : Promise.resolve(null),
    Promise.all(ctx.accounts.map((a) => w.getBalance(a).catch(() => null))),
  ])
  ctx.stake = stake
  const known = balances.filter((b): b is number => b !== null)
  ctx.walletBalance = known.length ? known.reduce((a, b) => a + b, 0) : null
  emit()
}

export async function refreshPrices(): Promise<void> {
  ctx.prices = await getPrices()
  emit()
}

export async function loadValidators(): Promise<void> {
  if (ctx.validatorsLoaded) return
  ctx.validators = await fetchValidators()
  ctx.validatorsLoaded = true
  emit()
}

export function fiatValues(luna: number): { currency: string; value: number }[] {
  const rates = ctx.prices?.rates
  if (!rates) return []
  return ctx.fiats.filter((f) => rates[f]).map((f) => ({ currency: f, value: toNim(luna) * rates[f]! }))
}
