import { init, NimiqProviderError, getHostFiat, getHostNetwork, type NimiqProvider } from '@nimiq/mini-app-sdk'

/**
 * The subset of the Nimiq Pay provider Holdfast uses. Holdfast never holds keys
 * or funds: every money movement is a transaction the user signs in Nimiq Pay.
 */
export interface Wallet {
  readonly mode: 'nimiq-pay' | 'demo'
  listAccounts(): Promise<string[]>
  getBalance(address: string): Promise<number>
  sendBasicTransactionWithData(tx: { recipient: string; value: number; data: string }): Promise<string>
  sendNewStakerTransaction(tx: { delegation: string; value: number }): Promise<string>
  sendStakeTransaction(tx: { value: number }): Promise<string>
  sendSetActiveStakeTransaction(tx: { newActiveBalance: number }): Promise<string>
  sendRetireStakeTransaction(tx: { retireStake: number }): Promise<string>
  sendRemoveStakeTransaction(tx: { value: number }): Promise<string>
  onAccountsChanged(cb: (accounts: string[]) => void): void
}

export const hostFiat = (): string | undefined => getHostFiat()?.toLowerCase()
export const hostNetwork = (): 'mainnet' | 'testnet' => getHostNetwork() ?? 'mainnet'

export function isUserRejection(err: unknown): boolean {
  const e = NimiqProviderError.from(err) ?? (err as { type?: string; code?: number; message?: string })
  const t = `${e?.type ?? ''} ${e?.message ?? ''}`.toLowerCase()
  return e?.code === 4001 || /reject|denied|cancel|declin|abort/.test(t)
}

export function errorMessage(err: unknown): string {
  const e = NimiqProviderError.from(err)
  if (e) return e.message || e.type
  if (err instanceof Error) return err.message
  return String(err)
}

function wrap(p: NimiqProvider): Wallet {
  return {
    mode: 'nimiq-pay',
    listAccounts: () => p.listAccounts(),
    getBalance: (a) => p.getBalance(a),
    sendBasicTransactionWithData: (tx) => p.sendBasicTransactionWithData(tx),
    sendNewStakerTransaction: (tx) => p.sendNewStakerTransaction(tx),
    sendStakeTransaction: (tx) => p.sendStakeTransaction(tx),
    sendSetActiveStakeTransaction: (tx) => p.sendSetActiveStakeTransaction(tx),
    sendRetireStakeTransaction: (tx) => p.sendRetireStakeTransaction(tx),
    sendRemoveStakeTransaction: (tx) => p.sendRemoveStakeTransaction(tx),
    onAccountsChanged: (cb) => void p.on('accountsChanged', cb),
  }
}

/**
 * Demo wallet for trying Holdfast in a normal browser. It is clearly labelled in the UI,
 * keeps a fake balance in memory and never touches a real network.
 */
export function createDemoWallet(): Wallet {
  const address = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
  let balance = 5_000 * 100_000
  const fakeHash = () => Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')
  const confirm = async (label: string) => {
    await new Promise((r) => setTimeout(r, 350))
    if (!window.confirm(`[Demo wallet]\n${label}\n\nApprove this simulated transaction?`))
      throw Object.assign(new Error('User rejected the request'), { code: 4001, type: 'USER_REJECTED' })
    return fakeHash()
  }
  const nim = (l: number) => (l / 100_000).toLocaleString('en-US')
  return {
    mode: 'demo',
    listAccounts: async () => [address],
    getBalance: async () => balance,
    sendBasicTransactionWithData: async (tx) => {
      const h = await confirm(`Send ${nim(tx.value)} NIM to ${tx.recipient}\nMessage: ${tx.data}`)
      return h
    },
    sendNewStakerTransaction: async (tx) => {
      const h = await confirm(`Stake ${nim(tx.value)} NIM with validator ${tx.delegation}`)
      balance -= tx.value
      return h
    },
    sendStakeTransaction: async (tx) => {
      const h = await confirm(`Add ${nim(tx.value)} NIM to your stake`)
      balance -= tx.value
      return h
    },
    sendSetActiveStakeTransaction: (tx) => confirm(`Set active stake to ${nim(tx.newActiveBalance)} NIM`),
    sendRetireStakeTransaction: (tx) => confirm(`Retire ${nim(tx.retireStake)} NIM of inactive stake`),
    sendRemoveStakeTransaction: async (tx) => {
      const h = await confirm(`Return ${nim(tx.value)} NIM from staking to your wallet`)
      balance += tx.value
      return h
    },
    onAccountsChanged: () => {},
  }
}

/** Connect to Nimiq Pay; resolves to null when not running inside the host. */
export async function connectNimiqPay(timeout = 4_000): Promise<Wallet | null> {
  try {
    const provider = await init({ timeout })
    return wrap(provider)
  } catch {
    return null
  }
}

/** True when the page is (very likely) running inside Nimiq Pay. */
export const insideNimiqPay = (): boolean => typeof window !== 'undefined' && (!!window.nimiq || !!window.nimiqPay)
