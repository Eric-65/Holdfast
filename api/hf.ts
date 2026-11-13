import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { cleanNet, fetchCheers, httpTransport, relay, rpcUrlFor, type RpcTransport } from './_lib/chain.js'
import { ApiError, authenticate, claimInvite, createChallenge, inviteInfo, leaderboard, login, ownProfile, rateLimit, setName, type RequestContext } from './_lib/core.js'
import { getState, publicGoal, publicStats, syncState } from './_lib/goals.js'
import { storeFromEnv, type Store } from './_lib/store.js'

/**
 * Holdfast API: one serverless function, routed by ?a=<action>.
 *   GET  leaderboard | invite&code=X | stats | goal&addr=X&id=Y | me (signed in) | state (signed in)
 *        rpc&m=METHOD&p=PARAM&net=mainnet|testnet | cheers&addr=X&net=...  (read-only blockchain, no database needed)
 *   POST challenge | login | name (signed in) | claim (signed in) | sync (signed in)
 */
type Req = IncomingMessage & { body?: unknown }
/** Goal backups are the largest requests: up to a dozen goals with their recent activity. */
const MAX_BODY = 64 * 1024

async function readJson(req: Req): Promise<Record<string, unknown>> {
  let raw: unknown = req.body
  if (raw === undefined) {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += (chunk as Buffer).length
      if (size > MAX_BODY) throw new ApiError(413, 'too_large', 'Request too large.')
      chunks.push(chunk as Buffer)
    }
    raw = Buffer.concat(chunks).toString('utf8')
  }
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8')
  if (typeof raw === 'string') {
    if (raw.length > MAX_BODY) throw new ApiError(413, 'too_large', 'Request too large.')
    try {
      raw = raw ? JSON.parse(raw) : {}
    } catch {
      throw new ApiError(400, 'bad_json', 'Malformed request.')
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError(400, 'bad_json', 'Malformed request.')
  return raw as Record<string, unknown>
}

const header = (req: Req, name: string): string | undefined => {
  const v = req.headers[name]
  return Array.isArray(v) ? v[0] : v
}

/** The part of an IP that stays the same for one connection: all of IPv4, the /64 of IPv6. */
export function networkOf(ip: string): string {
  const clean = ip.replace(/^\[|\]$/g, '').replace(/^::ffff:/i, '').toLowerCase()
  if (!clean.includes(':')) return clean
  const [head = '', tail = ''] = clean.split('::')
  const groups = head.split(':').filter(Boolean)
  const missing = 8 - groups.length - tail.split(':').filter(Boolean).length
  const full = clean.includes('::') ? [...groups, ...Array(Math.max(0, missing)).fill('0'), ...tail.split(':').filter(Boolean)] : groups
  return full.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')
}

export function createHandler(
  getStore: () => Store | null,
  transport: RpcTransport = httpTransport,
  env: Record<string, string | undefined> = process.env,
) {
  return async function handler(req: Req, res: ServerResponse): Promise<void> {
    const send = (status: number, body: unknown, cache = 'no-store') => {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', cache)
      res.end(JSON.stringify(body))
    }
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      // A link copied out of a chat app can arrive with its '&' encoded as %26
      // (?a=rpc%26m=getBlockNumber). Read those extra parameters as if they were separate.
      const first = url.searchParams.get('a') ?? ''
      if (first.includes('&') || first.includes('=')) {
        const extra = new URLSearchParams(`a=${first}`)
        url.searchParams.delete('a')
        extra.forEach((v, k) => url.searchParams.set(k, v))
      }
      const action = url.searchParams.get('a') ?? ''
      const ip = (header(req, 'x-forwarded-for') ?? req.socket?.remoteAddress ?? 'unknown').split(',')[0]!.trim()
      const country = header(req, 'x-vercel-ip-country')
      const store = getStore()
      const context = (s: Store): RequestContext => ({
        store: s,
        now: Date.now(),
        country: country && /^[A-Z]{2}$/.test(country) ? country : null,
        ipKey: createHash('sha256').update(ip).digest('hex').slice(0, 24),
        netKey: createHash('sha256').update(`net:${networkOf(ip)}`).digest('hex').slice(0, 24),
        requireUniqueDevice: env.HF_REQUIRE_UNIQUE_DEVICE === '1',
      })

      // Blockchain reads work even without the profile database.
      // A one-word health check: is this version live, and does the blockchain relay answer?
      if (req.method === 'GET' && action === 'health') {
        let block: number | null = null
        let chain = 'ok'
        try {
          const r = await relay(transport, { method: 'getBlockNumber', param: null, net: cleanNet(url.searchParams.get('net')) }, env)
          const body = r.body as { result?: unknown; error?: { message?: string } }
          if (typeof body.result === 'number') block = body.result
          else chain = body.error?.message ?? 'no answer'
        } catch (err) {
          chain = err instanceof Error ? err.message : 'no answer'
        }
        return send(200, { ok: block !== null, version: (env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 7), relay: chain, block, database: !!store, rpcServer: rpcUrlFor(cleanNet(url.searchParams.get('net')), env) })
      }

      if (req.method === 'GET' && (action === 'rpc' || action === 'cheers')) {
        if (store) {
          const c = context(store)
          try {
            await rateLimit(c, `rpc:${c.ipKey}`, 300, 300)
          } catch (err) {
            // Over the limit: refuse. Database unreachable: read the chain anyway, so saving,
            // locking and safe withdrawals keep working.
            if (err instanceof ApiError) throw err
          }
        }
        const net = cleanNet(url.searchParams.get('net'))
        if (action === 'cheers') return send(200, await fetchCheers(transport, url.searchParams.get('addr'), net, env), 'public, s-maxage=30, max-age=15')
        const r = await relay(transport, { method: url.searchParams.get('m'), param: url.searchParams.get('p'), net }, env)
        return send(200, r.body, `public, s-maxage=${r.cacheS}, max-age=${Math.min(5, r.cacheS)}`)
      }

      if (!store) throw new ApiError(503, 'not_configured', 'Profiles are not set up on this deployment yet.')
      const ctx = context(store)
      const signedIn = () => authenticate(ctx, header(req, 'authorization'))

      if (req.method === 'GET') {
        if (action === 'leaderboard') return send(200, await leaderboard(ctx), 'public, s-maxage=10, max-age=5')
        if (action === 'stats') return send(200, await publicStats(ctx), 'public, s-maxage=30, max-age=15')
        if (action === 'invite') return send(200, await inviteInfo(ctx, url.searchParams.get('code')))
        if (action === 'goal') return send(200, await publicGoal(ctx, url.searchParams.get('addr'), url.searchParams.get('id')), 'public, s-maxage=5, max-age=5')
        if (action === 'me') return send(200, { profile: await ownProfile(ctx, await signedIn()) })
        if (action === 'state') return send(200, await getState(ctx, await signedIn()))
      } else if (req.method === 'POST') {
        const body = await readJson(req)
        if (action === 'challenge') return send(200, await createChallenge(ctx, body))
        if (action === 'login') return send(200, await login(ctx, body))
        if (action === 'name') return send(200, { profile: await setName(ctx, await signedIn(), body) })
        if (action === 'claim') return send(200, await claimInvite(ctx, await signedIn(), body))
        if (action === 'sync') return send(200, await syncState(ctx, await signedIn(), body))
      }
      throw new ApiError(404, 'not_found', 'Unknown request.')
    } catch (err) {
      if (err instanceof ApiError) return send(err.status, { error: err.code, message: err.message })
      console.error('holdfast api error', err)
      send(500, { error: 'server_error', message: 'Something went wrong. Please try again.' })
    }
  }
}

let cached: Store | null | undefined
export default createHandler(() => (cached === undefined ? (cached = storeFromEnv()) : cached))
