import { config } from './config'

export interface StakerInfo {
  address: string
  /** Active stake, in luna. */
  balance: number
  delegation: string | null
  inactiveBalance: number
  inactiveFrom: number | null
  retiredBalance: number
}

export interface Validator {
  address: string
  name: string
  fee: number | null
  payoutType: string | null
  score: number | null
  logo: string | null
}

let rpcId = 1
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  if (!config.rpcUrl) throw new Error('No RPC configured')
  const res = await fetch(config.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
  })
  const json = await res.json()
  if (json.error) throw new Error(json.error.data || json.error.message || 'RPC error')
  // Albatross RPC wraps results as { data, metadata }.
  return (json.result && 'data' in json.result ? json.result.data : json.result) as T
}

export const chainAvailable = (): boolean => !!config.rpcUrl

/** Returns staker info, a zeroed record if the address is not a staker, or null if unknown (no RPC / error). */
export async function getStaker(address: string): Promise<StakerInfo | null> {
  if (!chainAvailable()) return null
  try {
    const s = await rpc<Record<string, unknown> | null>('getStakerByAddress', [address.replace(/\s/g, '')])
    return normalizeStaker(address, s)
  } catch (e) {
    const msg = String((e as Error).message || e).toLowerCase()
    if (msg.includes('not found') || msg.includes('no staker') || msg.includes('does not exist'))
      return normalizeStaker(address, null)
    return null
  }
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
  }
}

/** Sum stake across all of a user's accounts (wallet + current HTLC). */
export async function getStakeTotals(addresses: string[]): Promise<StakerInfo | null> {
  const results = await Promise.all(addresses.map(getStaker))
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
  }
}

export async function getBlockNumber(): Promise<number | null> {
  if (!chainAvailable()) return null
  try {
    return await rpc<number>('getBlockNumber', [])
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
