import { init, NimiqProviderError, getHostFiat, getHostNetwork, requestDeviceIdentifier, type NimiqProvider } from '@nimiq/mini-app-sdk'

/**
 * The subset of the Nimiq Pay provider Holdfast uses. Holdfast never holds keys
 * or funds: every money movement is a transaction the user signs in Nimiq Pay.
 */
export interface Wallet {
  listAccounts(): Promise<string[]>
  getBalance(address: string): Promise<number>
  /** Sign a text message with the wallet key. Proves ownership; moves no funds. */
  sign(message: string): Promise<{ publicKey: string; signature: string }>
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
    listAccounts: () => p.listAccounts(),
    getBalance: (a) => p.getBalance(a),
    sign: (message) => p.sign(message),
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
 * Anonymous per-device ID from Nimiq Pay (it asks the user the first time).
 * Resolves to null if the user declines or the host does not support it.
 */
export async function deviceIdentifier(reason: string): Promise<string | null> {
  try {
    const id = await requestDeviceIdentifier({ reason })
    return typeof id === 'string' && /^[0-9a-f]{64}$/i.test(id) ? id : null
  } catch {
    return null
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
