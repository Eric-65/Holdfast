import { config } from './config'

export interface StakerInfo {
  address: string
  /** Active stake, in luna. */
  balance: number
  delegation: string | null
  inactiveBalance: number
  inactiveFrom: number | null
  retiredBalance: number
  /** Whether the address is a staker at all (a staker must exist before stake can be added). */
  exists: boolean
}

export interface Validator {
  address: string
  name: string
  fee: number | null
  payoutType: string | null
  score: number | null
  logo: string | null
}

export type Net = 'mainnet' | 'testnet'
let defaultNet: Net = 'mainnet'
/** The network the wallet runs on. Set once at start-up from Nimiq Pay. */
export const setChainNetwork = (net: Net): void => {
  defaultNet = net
}

/**
 * Holdfast reads the blockchain through its own API (a read-only relay to a public Nimiq RPC
 * server), because public RPC servers don't accept requests from web pages. This turns false if
 * the site has no API (for example a static-only host); VITE_NIMIQ_RPC_URL then still works.
 */
let relayOk = true

/** Until this time (ms), blockchain reads skip the CDN cache, so a transaction just sent shows up. */
let freshUntil = 0
export const readFreshFor = (ms: number): void => {
  freshUntil = Math.max(freshUntil, Date.now() + ms)
}

const timeout = (ms: number): AbortSignal | undefined =>
  typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined

/** An error reported by the RPC server itself (it answered), as opposed to no answer at all. */
export class ChainAnswerError extends Error {}

/**
 * VITE_NIMIQ_RPC_URL lets the app call an RPC server straight from the phone. Most public servers
 * don't allow that (browsers block it, CORS), so after the first failed call Holdfast uses its own
 * relay for the rest of the visit.
 */
let directOk = true
/** Why the last blockchain read failed, for the goal screen's details. */
export let lastChainError = ''

let rpcId = 1
async function rpc<T>(method: string, params: string[], net: Net = defaultNet): Promise<T> {
  if (config.rpcUrl && directOk) {
    try {
      const res = await fetch(config.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
        signal: timeout(10_000),
      })
      const json = await res.json()
      if (json.error) throw new ChainAnswerError(json.error.data || json.error.message || 'RPC error')
      // Albatross RPC wraps results as { data, metadata }.
      return (json.result && 'data' in json.result ? json.result.data : json.result) as T
    } catch (err) {
      if (err instanceof ChainAnswerError) throw err
      directOk = false // blocked or unreachable from the phone: use the relay from now on
    }
  }
  if (!relayOk) throw new Error('No blockchain access')
  const q = new URLSearchParams({ a: 'rpc', m: method, net })
  if (params[0] !== undefined) q.set('p', params[0])
  if (Date.now() < freshUntil) q.set('t', String(Date.now()))
  const res = await fetch(`${config.apiBase}/api/hf?${q}`, { headers: { Accept: 'application/json' }, signal: timeout(10_000) })
  const json = (await res.json().catch(() => null)) as { result?: unknown; error?: unknown; message?: string } | null
  if (!json || (!('result' in json) && !('error' in json))) {
    // A static host answers with its HTML page or a bare 404: there is no relay here. A passing
    // gateway error (a 502/504 page) is not a reason to stop trying.
    if (looksLikeStaticHost(res, json)) relayOk = false
    throw new Error('Blockchain relay unavailable')
  }
  if (typeof json.error === 'string') throw new Error(json.message || json.error)
  if (json.error) {
    const e = json.error as { data?: string; message?: string }
    throw new ChainAnswerError(e.data || e.message || 'RPC error')
  }
  return json.result as T
}

/** True for the answer of a host without the API: a 404, or a successful HTML/non-JSON page. */
export function looksLikeStaticHost(res: { status: number; ok: boolean }, json: unknown): boolean {
  return res.status === 404 || (res.ok && json === null)
}

/** Whether Holdfast can read the blockchain (directly or through its relay). */
export const chainAvailable = (): boolean => !!config.rpcUrl || relayOk

/** Returns staker info, a zeroed record if the address is not a staker, or null if unknown (no RPC / error). */
export async function getStaker(address: string, net: Net = defaultNet): Promise<StakerInfo | null> {
  if (!chainAvailable()) return null
  try {
    const s = await rpc<Record<string, unknown> | null>('getStakerByAddress', [address.replace(/\s/g, '')], net)
    return normalizeStaker(address, s)
  } catch (e) {
    const msg = String((e as Error).message || e)
    // The server answered that this address doesn't stake (Nimiq Pay's second address usually
    // doesn't): that is a reading of zero, not a failure.
    if (e instanceof ChainAnswerError && isNotAStaker(msg)) return normalizeStaker(address, null)
    lastChainError = msg.slice(0, 160)
    return null
  }
}

/** Messages RPC servers use for "this address has no stake". */
export function isNotAStaker(message: string): boolean {
  // "Method not found" means the server can't answer at all: that is a failed read, never zero stake.
  if (/method|rpc|internal|timeout|unavailable/i.test(message)) return false
  return /not\s*found|no\s*staker|not\s*a\s*staker|does\s*not\s*exist|doesn't\s*exist|unknown\s*(staker|account)|no\s*such/i.test(message)
}

export function normalizeStaker(address: string, s: Record<string, unknown> | null): StakerInfo {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    address,
    balance: n(s?.balance),
    delegation: typeof s?.delegation === 'string' ? (s.delegation as string) : null,
    inactiveBalance: n(s?.inactiveBalance),
    inactiveFrom: typeof s?.inactiveFrom === 'number' ? (s.inactiveFrom as number) : null,
    retiredBalance: n(s?.retiredBalance),
    exists: s !== null && typeof s === 'object',
  }
}

/** Sum stake across all of a user's accounts (wallet + current HTLC). */
export async function getStakeTotals(addresses: string[], net: Net = defaultNet): Promise<StakerInfo | null> {
  if (!addresses.length) return null
  const results = await Promise.all(addresses.map((a) => getStaker(a, net)))
  if (results.some((r) => r === null)) return null
  const all = results as StakerInfo[]
  const primary = all.find((s) => s.balance + s.inactiveBalance + s.retiredBalance > 0) ?? all[0]
  if (!primary) return null
  return {
    address: primary.address,
    delegation: primary.delegation,
    inactiveFrom: primary.inactiveFrom,
    balance: all.reduce((a, s) => a + s.balance, 0),
    inactiveBalance: all.reduce((a, s) => a + s.inactiveBalance, 0),
    retiredBalance: all.reduce((a, s) => a + s.retiredBalance, 0),
    exists: all.some((s) => s.exists),
  }
}

/**
 * What the network says about a transaction. `found: false` = not on the chain (yet).
 * `executed: false` = included, but the network refused it, so nothing happened except the fee.
 * `executed: null` = the server didn't say. null overall = the network couldn't be asked.
 */
export async function getTransactionOutcome(hash: string, net: Net = defaultNet): Promise<{ found: boolean; executed: boolean | null } | null> {
  if (!chainAvailable() || !/^[0-9a-f]{64}$/i.test(hash)) return null
  try {
    const t = await rpc<Record<string, unknown> | null>('getTransactionByHash', [hash.toLowerCase()], net)
    if (!t) return { found: false, executed: null }
    return { found: true, executed: typeof t.executionResult === 'boolean' ? t.executionResult : null }
  } catch (e) {
    if (e instanceof ChainAnswerError && /not\s*found/i.test(String((e as Error).message))) return { found: false, executed: null }
    return null
  }
}

/** Addresses of the validators a new staker can delegate to, straight from the network. */
export async function getActiveValidatorAddresses(net: Net = defaultNet): Promise<string[]> {
  if (!chainAvailable()) return []
  try {
    const list = await rpc<unknown>('getActiveValidators', [], net)
    const out: string[] = []
    for (const v of Array.isArray(list) ? list : []) {
      const a = typeof v === 'string' ? v : (v as { address?: unknown })?.address
      if (typeof a === 'string') out.push(a)
    }
    return out
  } catch {
    return []
  }
}

export async function getBlockNumber(net: Net = defaultNet): Promise<number | null> {
  if (!chainAvailable()) return null
  try {
    return await rpc<number>('getBlockNumber', [], net)
  } catch {
    return null
  }
}

export interface Cheer {
  /** Shortened sender address. */
  from: string
  luna: number
  message: string
  /** Block time (ms). */
  at: number
  hash: string
  /** First 8 characters of the goal id the cheer was sent to, when the sender's link named one. */
  goal?: string
}

/**
 * Cheers a wallet has received, read from its public transaction history: payments whose message
 * starts with "Holdfast cheer:". null when the history can't be read right now.
 */
export async function fetchCheers(address: string, net: Net = defaultNet): Promise<Cheer[] | null> {
  if (!relayOk) return null
  try {
    const q = new URLSearchParams({ a: 'cheers', addr: address.replace(/\s/g, ''), net })
    if (Date.now() < freshUntil) q.set('t', String(Date.now()))
    const res = await fetch(`${config.apiBase}/api/hf?${q}`, { headers: { Accept: 'application/json' }, signal: timeout(12_000) })
    const json = (await res.json().catch(() => null)) as { cheers?: Cheer[] } | null
    return res.ok && Array.isArray(json?.cheers) ? json.cheers : null
  } catch {
    return null
  }
}

/** Parse the Nimiq validators API defensively; its shape has changed over time. */
export function parseValidators(json: unknown): Validator[] {
  const list: unknown[] = Array.isArray(json)
    ? json
    : Array.isArray((json as { validators?: unknown[] })?.validators)
      ? (json as { validators: unknown[] }).validators
      : []
  const out: Validator[] = []
  for (const raw of list) {
    const v = raw as Record<string, any>
    const address = typeof v?.address === 'string' ? v.address : null
    if (!address) continue
    const score = typeof v.score === 'number' ? v.score : typeof v.score?.total === 'number' ? v.score.total : null
    out.push({
      address,
      name: typeof v.name === 'string' && v.name ? v.name : 'Unnamed validator',
      fee: typeof v.fee === 'number' ? v.fee : null,
      payoutType: typeof v.payoutType === 'string' ? v.payoutType : null,
      score,
      logo: typeof v.logo === 'string' && /^(https:|data:image\/)/.test(v.logo) ? v.logo : null,
    })
  }
  // Pools that pay out (prefer restaking ones) first, then by score.
  const rank = (v: Validator) =>
    (v.payoutType === 'restake' ? 2 : v.payoutType && v.payoutType !== 'none' ? 1 : 0) * 10 + (v.score ?? 0)
  return out.sort((a, b) => rank(b) - rank(a))
}

export async function fetchValidators(): Promise<Validator[]> {
  try {
    const res = await fetch(config.validatorsApiUrl, { headers: { Accept: 'application/json' } })
    if (!res.ok) return []
    return parseValidators(await res.json())
  } catch {
    return []
  }
}
