import { ApiError } from './core.js'
import { normalizeAddress } from './crypto.js'

/**
 * Read-only access to the Nimiq blockchain, through a public RPC server. The app calls this
 * instead of an RPC server directly, so it works without a browser-friendly (CORS) RPC endpoint.
 * Only a few read methods are allowed; nothing here can move funds.
 */
export type Net = 'mainnet' | 'testnet'
export const cleanNet = (v: unknown): Net => (v === 'testnet' ? 'testnet' : 'mainnet')

export function rpcUrlFor(net: Net, env: Record<string, string | undefined> = process.env): string {
  return net === 'testnet'
    ? env.NIMIQ_TESTNET_RPC_URL || 'https://rpc.nimiq-testnet.com'
    : env.NIMIQ_RPC_URL || 'https://rpc.nimiqwatch.com'
}

/** Sends one JSON-RPC request and returns the parsed JSON response. Replaceable in tests. */
export type RpcTransport = (url: string, body: unknown) => Promise<unknown>

const RPC_TIMEOUT_MS = 8000

export const httpTransport: RpcTransport = async (url, body) => {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    })
  } catch {
    throw new ApiError(502, 'chain_unavailable', 'The Nimiq network could not be reached. Please try again.')
  }
  const json = await res.json().catch(() => null)
  if (!json) throw new ApiError(502, 'chain_unavailable', 'The Nimiq network could not be reached. Please try again.')
  return json
}

let rpcId = 1

/** Albatross RPC wraps results as { data, metadata }. Errors come back as { error: { message } }. */
export async function callRpc<T>(transport: RpcTransport, url: string, method: string, params: unknown[]): Promise<T> {
  const json = (await transport(url, { jsonrpc: '2.0', id: rpcId++, method, params })) as {
    result?: unknown
    error?: { message?: string; data?: unknown }
  }
  if (json?.error) {
    const detail = typeof json.error.data === 'string' ? json.error.data : json.error.message
    throw new RpcError(String(detail || 'RPC error'))
  }
  const r = json?.result as { data?: unknown } | undefined
  return (r && typeof r === 'object' && 'data' in r ? r.data : r) as T
}

/** An error the RPC server itself reported (for example "staker not found"). */
export class RpcError extends Error {}

const compact = (address: string) => address.replace(/\s/g, '')

/**
 * The allow-listed read methods: name, how to check its one parameter, and how long a CDN may
 * cache the answer.
 */
const METHODS: Record<string, { param: (p: string | null) => unknown[] | null; cacheS: number }> = {
  getBlockNumber: { param: () => [], cacheS: 5 },
  getStakerByAddress: {
    param: (p) => {
      const a = normalizeAddress(p)
      return a ? [compact(a)] : null
    },
    cacheS: 10,
  },
  getTransactionByHash: { param: (p) => (p && /^[0-9a-f]{64}$/i.test(p) ? [p.toLowerCase()] : null), cacheS: 30 },
}

export interface RelayRequest {
  method: string | null
  param: string | null
  net: Net
}

/** Answers in JSON-RPC shape ({ result } or { error }) so the app handles it like a direct RPC call. */
export async function relay(
  transport: RpcTransport,
  req: RelayRequest,
  env: Record<string, string | undefined> = process.env,
): Promise<{ body: unknown; cacheS: number }> {
  const spec = req.method ? METHODS[req.method] : undefined
  if (!spec || !req.method) throw new ApiError(400, 'bad_method', 'That blockchain request is not allowed.')
  const params = spec.param(req.param)
  if (!params) throw new ApiError(400, 'bad_param', 'That blockchain request is malformed.')
  try {
    const result = await callRpc<unknown>(transport, rpcUrlFor(req.net, env), req.method, params)
    return { body: { result }, cacheS: spec.cacheS }
  } catch (err) {
    if (err instanceof RpcError) return { body: { error: { message: err.message } }, cacheS: spec.cacheS }
    throw err
  }
}

// ---------- Cheers ----------

export const CHEER_PREFIX = 'Holdfast cheer: '

export interface Cheer {
  /** Shortened sender address. */
  from: string
  luna: number
  message: string
  /** Block time (ms). */
  at: number
  hash: string
}

/** Decode transaction data (hex) to text; null if it is not hex or not valid UTF-8. */
export function hexToText(hex: unknown): string | null {
  if (typeof hex !== 'string' || !hex || hex.length % 2 || !/^[0-9a-f]+$/i.test(hex)) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(hex, 'hex'))
  } catch {
    return null
  }
}

const shortAddr = (a: string) => `${a.slice(0, 9)}…${a.slice(-4)}`

/** Pick the Holdfast cheers sent to `address` out of an RPC transaction list. Newest first. */
export function parseCheers(address: string, txs: unknown): Cheer[] {
  const me = compact(address).toUpperCase()
  const out: Cheer[] = []
  for (const raw of Array.isArray(txs) ? txs : []) {
    const tx = raw as Record<string, unknown>
    const to = normalizeAddress(tx.to)
    const from = normalizeAddress(tx.from)
    if (!to || !from || compact(to) !== me) continue
    const text = hexToText(tx.recipientData) ?? hexToText(tx.data)
    if (!text?.startsWith(CHEER_PREFIX)) continue
    const luna = Number(tx.value)
    const hash = typeof tx.hash === 'string' ? tx.hash : ''
    if (!Number.isFinite(luna) || luna <= 0 || !hash) continue
    out.push({
      from: shortAddr(from),
      luna,
      message: text.slice(CHEER_PREFIX.length).slice(0, 48),
      at: Number(tx.timestamp) || 0,
      hash,
    })
  }
  return out.sort((a, b) => b.at - a.at)
}

/** Cheers sent to a wallet, read from its transaction history on the Nimiq blockchain. */
export async function fetchCheers(
  transport: RpcTransport,
  rawAddress: unknown,
  net: Net,
  env: Record<string, string | undefined> = process.env,
): Promise<{ cheers: Cheer[] }> {
  const address = normalizeAddress(rawAddress)
  if (!address) throw new ApiError(400, 'bad_address', 'That is not a valid Nimiq address.')
  const url = rpcUrlFor(net, env)
  let txs: unknown
  try {
    // Parameters: address, max results, start-at hash (none).
    txs = await callRpc<unknown>(transport, url, 'getTransactionsByAddress', [compact(address), 100, null])
  } catch (err) {
    if (!(err instanceof RpcError)) throw err
    try {
      // Some servers only accept the two required parameters.
      txs = await callRpc<unknown>(transport, url, 'getTransactionsByAddress', [compact(address), 100])
    } catch (again) {
      if (again instanceof RpcError) return { cheers: [] }
      throw again
    }
  }
  return { cheers: parseCheers(address, txs).slice(0, 50) }
}
