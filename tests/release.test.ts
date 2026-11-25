// @vitest-environment node
import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, describe, expect, it } from 'vitest'
import { createHandler } from '../api/hf'
import { cleanScreen, isAdmin, scrubAddresses } from '../api/_lib/report'
import { MemoryStore } from '../api/_lib/store'
import { APP_VERSION } from '../api/_lib/version'

let store: MemoryStore
const ADMIN = 'admin-token-0123456789'
const handler = () => createHandler(() => store, async () => ({ result: 1 }), { HF_ADMIN_TOKEN: ADMIN, VERCEL_GIT_COMMIT_SHA: 'abcdef1234' })

/** Call the handler like Vercel does. */
async function run(h: ReturnType<typeof createHandler>, url: string, opts: { method?: string; body?: unknown; ip?: string } = {}) {
  let status = 0
  let body = ''
  const req = {
    url,
    method: opts.method ?? 'GET',
    headers: { 'x-forwarded-for': opts.ip ?? '1.2.3.4' },
    socket: {},
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  } as unknown as IncomingMessage
  const res = {
    set statusCode(v: number) {
      status = v
    },
    setHeader: () => undefined,
    end: (b: string) => (body = b),
  } as unknown as ServerResponse
  await h(req, res)
  return { status, json: JSON.parse(body) }
}

beforeEach(() => {
  store = new MemoryStore()
})

describe('release 1.0', () => {
  it('keeps the app version in step with package.json, and reports it', async () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(APP_VERSION).toBe(pkg.version)
    expect((await run(handler(), '/api/hf?a=version')).json).toEqual({ version: 'abcdef1', appVersion: APP_VERSION })
    expect((await run(handler(), '/api/hf?a=health')).json).toMatchObject({ version: 'abcdef1', appVersion: APP_VERSION })
  })

  it('stores error reports without addresses, keeps the last 300, and shows them only with the admin token', async () => {
    const h = handler()
    const sent = await run(h, '/api/hf?a=report', {
      method: 'POST',
      body: { message: 'TypeError: x is undefined for NQ52 A3QM 30EJ E58T FXHQ 1GMC UHSG 339R TA8T\u0000', screen: '#/goal/abc123def', version: '1.0.0+abc' },
    })
    expect(sent.json).toEqual({ ok: true })
    expect((await run(h, '/api/hf?a=report')).status).toBe(403)
    expect((await run(h, '/api/hf?a=report&token=wrong-token-0000000')).status).toBe(403)
    const list = (await run(h, `/api/hf?a=report&token=${ADMIN}`)).json
    expect(list.count).toBe(1)
    expect(list.reports[0]).toMatchObject({ message: 'TypeError: x is undefined for NQ…', screen: '#/goal', version: '1.0.0+abc' })
    expect(JSON.stringify(list)).not.toMatch(/A3QM|1\.2\.3\.4/)
    // Empty reports are refused; one browser can't flood the list.
    expect((await run(h, '/api/hf?a=report', { method: 'POST', body: { message: '  ' } })).status).toBe(400)
    let last = 0
    for (let i = 0; i < 25; i++) last = (await run(h, '/api/hf?a=report', { method: 'POST', body: { message: `e${i}` }, ip: '5.6.7.8' })).status
    expect(last).toBe(429)
    for (let i = 0; i < 400; i++) await store.pipeline([['LPUSH', 'reports', '{"message":"x"}'], ['LTRIM', 'reports', 0, 299]])
    expect((await run(h, `/api/hf?a=report&token=${ADMIN}`)).json.count).toBe(300)
  })

  it('cleans what a report can hold', () => {
    expect(scrubAddresses('to nq52a3qm30eje58tfxhq1gmcuhsg339rta8t now')).toBe('to NQ… now')
    expect(cleanScreen('#/keep/eyJhIjoiTlE1MiJ9')).toBe('#/keep')
    expect(cleanScreen('#/stats')).toBe('#/stats')
    expect(cleanScreen('javascript:alert(1)')).toBe('#/')
    expect(isAdmin('short', 'short')).toBe(false)
    expect(isAdmin(ADMIN, undefined)).toBe(false)
    expect(isAdmin(ADMIN, ADMIN)).toBe(true)
  })

  it('stats count referrals and profiles that joined in the last 7 days', async () => {
    const now = Date.now()
    await store.pipeline([
      ['ZADD', 'lb', 3, 'A'],
      ['ZADD', 'lb', 1, 'B'],
      ['ZADD', 'lb', 0, 'C'],
      ['HSET', 'u:A', 'createdAt', now - 30 * 86_400_000],
      ['HSET', 'u:B', 'createdAt', now - 2 * 86_400_000],
      ['HSET', 'u:C', 'createdAt', now - 3_600_000],
      ['SET', 'stats:users', 3],
    ])
    const stats = (await run(handler(), '/api/hf?a=stats')).json
    expect(stats).toMatchObject({ savers: 3, referrals: 4, joined7d: 2 })
  })
})

describe('security headers', () => {
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
  const all = vercel.headers.find((h: { source: string }) => h.source === '/(.*)').headers as { key: string; value: string }[]
  const get = (k: string) => all.find((h) => h.key === k)?.value ?? ''

  it('sets nosniff, referrer and permissions policies on every route', () => {
    expect(get('X-Content-Type-Options')).toBe('nosniff')
    expect(get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(get('Permissions-Policy')).toMatch(/camera=\(\).*microphone=\(\).*geolocation=\(\)/)
  })

  it('allows the inline theme script by its exact hash, and every host the app calls', async () => {
    const { createHash } = await import('node:crypto')
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!)
    const csp = get('Content-Security-Policy')
    for (const s of inline) expect(csp).toContain(`'sha256-${createHash('sha256').update(s).digest('base64')}'`)
    const { config } = await import('../src/lib/config')
    for (const url of [config.priceApiUrl, config.validatorsApiUrl]) expect(csp).toContain(new URL(url).origin)
    expect(csp).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/)
  })
})
