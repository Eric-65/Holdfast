import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ApiError, authenticate, createChallenge, inviteInfo, leaderboard, login, ownProfile, setName, type RequestContext } from './_lib/core.js'
import { storeFromEnv, type Store } from './_lib/store.js'

/**
 * Holdfast API: one serverless function, routed by ?a=<action>.
 *   GET  leaderboard | invite&code=X | me (signed in)
 *   POST challenge | login | name (signed in)
 */
type Req = IncomingMessage & { body?: unknown }
const MAX_BODY = 8 * 1024

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

export function createHandler(getStore: () => Store | null) {
  return async function handler(req: Req, res: ServerResponse): Promise<void> {
    const send = (status: number, body: unknown, cache = 'no-store') => {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', cache)
      res.end(JSON.stringify(body))
    }
    try {
      const store = getStore()
      if (!store) throw new ApiError(503, 'not_configured', 'Profiles are not set up on this deployment yet.')
      const url = new URL(req.url ?? '/', 'http://localhost')
      const action = url.searchParams.get('a') ?? ''
      const ip = (header(req, 'x-forwarded-for') ?? req.socket?.remoteAddress ?? 'unknown').split(',')[0]!.trim()
      const country = header(req, 'x-vercel-ip-country')
      const ctx: RequestContext = {
        store,
        now: Date.now(),
        country: country && /^[A-Z]{2}$/.test(country) ? country : null,
        ipKey: createHash('sha256').update(ip).digest('hex').slice(0, 24),
        requireUniqueDevice: process.env.HF_REQUIRE_UNIQUE_DEVICE === '1',
      }

      if (req.method === 'GET') {
        if (action === 'leaderboard') return send(200, await leaderboard(ctx), 'public, s-maxage=10, max-age=5')
        if (action === 'invite') return send(200, await inviteInfo(ctx, url.searchParams.get('code')))
        if (action === 'me') return send(200, { profile: await ownProfile(ctx, await authenticate(ctx, header(req, 'authorization'))) })
      } else if (req.method === 'POST') {
        const body = await readJson(req)
        if (action === 'challenge') return send(200, await createChallenge(ctx, body))
        if (action === 'login') return send(200, await login(ctx, body))
        if (action === 'name') return send(200, { profile: await setName(ctx, await authenticate(ctx, header(req, 'authorization')), body) })
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
