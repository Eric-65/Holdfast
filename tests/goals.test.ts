// @vitest-environment node
import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, describe, expect, it } from 'vitest'
import { createHandler } from '../api/hf'
import { fetchCheers, hexToText, parseCheers, relay, rpcUrlFor, type RpcTransport } from '../api/_lib/chain'
import type { RequestContext } from '../api/_lib/core'
import { addressFromPublicKey } from '../api/_lib/crypto'
import { cleanState, getState, publicGoal, publicStats, syncState } from '../api/_lib/goals'
import { MemoryStore } from '../api/_lib/store'

let store: MemoryStore
let now: number
const ctx = (over: Partial<RequestContext> = {}): RequestContext => ({
  store,
  now,
  country: null,
  ipKey: 'ip-' + Math.random().toString(36).slice(2),
  netKey: 'net',
  requireUniqueDevice: false,
  ...over,
})
const newAddress = () => addressFromPublicKey(randomBytes(32))
const hex = (s: string) => Buffer.from(s, 'utf8').toString('hex')

const goal = (over: Record<string, unknown> = {}) => ({
  id: 'abc123def',
  name: 'Rent buffer',
  emoji: '🏠',
  targetLuna: 500_00000,
  baselineLuna: 0,
  lockedLuna: 50_00000,
  savedLuna: 51_00000,
  createdAt: Date.UTC(2026, 10, 1),
  status: 'active',
  sealBrokenAt: null,
  reachedAt: null,
  pendingUnlock: null,
  validator: null,
  events: [
    { type: 'created', luna: 500_00000, at: Date.UTC(2026, 10, 1) },
    { type: 'lock', luna: 50_00000, at: Date.UTC(2026, 10, 2), tx: 'ab'.repeat(32) },
  ],
  ...over,
})

beforeEach(() => {
  store = new MemoryStore()
  now = Date.UTC(2026, 10, 13, 12)
  store.now = () => now
})

describe('goal backup', () => {
  it('saves a signed-in saver goals and gives them back for a new phone', async () => {
    const me = newAddress()
    const second = newAddress()
    await syncState(ctx(), me, { state: { goals: [goal()], stakerCreated: true, accounts: [second, me], network: 'mainnet' } })
    const { state } = await getState(ctx(), me)
    expect(state?.goals[0]?.name).toBe('Rent buffer')
    expect(state?.stakerCreated).toBe(true)
    // The signed-in address always comes first; the other Nimiq Pay address is kept.
    expect(state?.accounts).toEqual([me, second])
    expect(state?.updatedAt).toBe(now)
    expect((await getState(ctx(), newAddress())).state).toBeNull()
  })

  it('rejects malformed goals', () => {
    const me = newAddress()
    const bad = (g: Record<string, unknown>) => () => cleanState({ goals: [goal(g)] }, me, now)
    expect(bad({ id: 'x' })).toThrow()
    expect(bad({ name: '' })).toThrow()
    expect(bad({ targetLuna: -5 })).toThrow()
    expect(bad({ lockedLuna: 1.5 })).toThrow()
    expect(bad({ status: 'deleted' })).toThrow()
    expect(bad({ validator: 'NQ00 nope' })).toThrow()
    expect(() => cleanState({ goals: [goal(), goal({ id: 'other123' })] }, me, now)).not.toThrow() // several active goals are fine
    expect(() => cleanState({ goals: 'nope' }, me, now)).toThrow()
    // Unknown event types and bad hashes are dropped instead of failing the whole backup.
    const s = cleanState({ goals: [goal({ events: [{ type: 'hack', luna: 1, at: 1 }, { type: 'lock', luna: 5, at: now, tx: 'zz' }] })] }, me, now)
    expect(s.goals[0]!.events).toEqual([{ type: 'lock', luna: 5, at: now }])
  })

  it('shows a goal to its Goalkeeper by address and id, with the saver name', async () => {
    const me = newAddress()
    await store.cmd('HSET', `u:${me.replace(/\s/g, '')}`, 'name', 'Ada')
    await syncState(ctx(), me, { state: { goals: [goal()], accounts: [me] } })
    const r = await publicGoal(ctx(), me.replace(/\s/g, '').toLowerCase(), 'abc123def')
    expect(r.goal.lockedLuna).toBe(50_00000)
    expect(r.owner.name).toBe('Ada')
    expect(r.accounts).toEqual([me])
    await expect(publicGoal(ctx(), me, 'unknown99')).rejects.toMatchObject({ status: 404 })
    await expect(publicGoal(ctx(), 'nope', 'abc123def')).rejects.toMatchObject({ status: 400 })
  })

  it('counts savers, active goals and NIM locked', async () => {
    const [a, b] = [newAddress(), newAddress()]
    await store.cmd('SET', 'stats:users', 3)
    await syncState(ctx(), a, { state: { goals: [goal()] } })
    await syncState(ctx(), b, { state: { goals: [goal({ lockedLuna: 10_00000 })] } })
    expect(await publicStats(ctx())).toEqual({ savers: 3, activeGoals: 2, lockedLuna: 60_00000 })
    // Closing the goal takes it out of the totals.
    await syncState(ctx(), b, { state: { goals: [goal({ status: 'completed' })] } })
    expect(await publicStats(ctx())).toEqual({ savers: 3, activeGoals: 1, lockedLuna: 50_00000 })
  })
})

describe('blockchain relay', () => {
  const calls: { url: string; body: any }[] = []
  const fake =
    (answer: (body: any) => unknown): RpcTransport =>
    async (url, body) => {
      calls.push({ url, body })
      return answer(body)
    }
  beforeEach(() => {
    calls.length = 0
  })

  it('forwards allowed read methods and unwraps Albatross results', async () => {
    const me = newAddress()
    const t = fake(() => ({ result: { data: { balance: 5 }, metadata: {} } }))
    const r = await relay(t, { method: 'getStakerByAddress', param: me, net: 'mainnet' }, {})
    expect(r.body).toEqual({ result: { balance: 5 } })
    expect(calls[0]!.url).toBe('https://rpc.nimiqwatch.com')
    expect(calls[0]!.body.params).toEqual([me.replace(/\s/g, '')])
    expect(rpcUrlFor('testnet', { NIMIQ_TESTNET_RPC_URL: 'https://t.example' })).toBe('https://t.example')
  })

  it('passes RPC errors through and refuses anything else', async () => {
    const t = fake(() => ({ error: { message: 'Staker not found' } }))
    const r = await relay(t, { method: 'getStakerByAddress', param: newAddress(), net: 'mainnet' }, {})
    expect(r.body).toEqual({ error: { message: 'Staker not found' } })
    await expect(relay(t, { method: 'sendRawTransaction', param: 'ab', net: 'mainnet' }, {})).rejects.toMatchObject({ code: 'bad_method' })
    await expect(relay(t, { method: 'getStakerByAddress', param: 'nope', net: 'mainnet' }, {})).rejects.toMatchObject({ code: 'bad_param' })
  })

  it('finds Holdfast cheers in a wallet history', async () => {
    const me = newAddress()
    const friend = newAddress()
    const txs = [
      { hash: 'h1', from: friend, to: me, value: 10_00000, timestamp: 2000, recipientData: hex('Holdfast cheer: You got this!') },
      { hash: 'h2', from: friend, to: me, value: 3_00000, timestamp: 1000, recipientData: hex('rent') }, // not a cheer
      { hash: 'h3', from: me, to: friend, value: 1_00000, timestamp: 3000, recipientData: hex('Holdfast cheer: back') }, // sent, not received
      { hash: 'h4', from: friend, to: me, value: 5_00000, timestamp: 4000, recipientData: hex('Holdfast cheer: 💪') },
    ]
    const cheers = parseCheers(me, txs)
    expect(cheers.map((c) => [c.hash, c.luna, c.message])).toEqual([
      ['h4', 5_00000, '💪'],
      ['h1', 10_00000, 'You got this!'],
    ])
    expect(cheers[0]!.from).toContain('…')
    expect(hexToText('zz')).toBeNull()
    expect(hexToText('ff')).toBeNull()

    // Falls back to two parameters when the server rejects three, and to an empty list after that.
    const picky = fake((b) => (b.params.length === 3 ? { error: { message: 'invalid params' } } : { result: { data: txs } }))
    expect((await fetchCheers(picky, me, 'mainnet', {})).cheers).toHaveLength(2)
    const broken = fake(() => ({ error: { message: 'history not available' } }))
    expect((await fetchCheers(broken, me, 'mainnet', {})).cheers).toEqual([])
  })

  it('answers blockchain reads even when no database is connected', async () => {
    const handler = createHandler(() => null, async () => ({ result: 42 }), {})
    const res = await run(handler, '/api/hf?a=rpc&m=getBlockNumber')
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ result: 42 })
    expect(res.headers['cache-control']).toContain('s-maxage=5')
    const profiles = await run(handler, '/api/hf?a=leaderboard')
    expect(profiles.status).toBe(503)
  })
})

/** Call the handler like Vercel does and collect the response. */
async function run(handler: ReturnType<typeof createHandler>, url: string) {
  const headers: Record<string, string> = {}
  let status = 0
  let body = ''
  const req = { url, method: 'GET', headers: {}, socket: {} } as unknown as IncomingMessage
  const res = {
    set statusCode(v: number) {
      status = v
    },
    setHeader: (k: string, v: string) => (headers[k.toLowerCase()] = v),
    end: (b: string) => (body = b),
  } as unknown as ServerResponse
  await handler(req, res)
  return { status, body, headers }
}

describe('review fixes', () => {
  it('uses the default RPC servers and allows exactly the three read methods', async () => {
    expect(rpcUrlFor('mainnet', {})).toBe('https://rpc.nimiqwatch.com')
    expect(rpcUrlFor('testnet', {})).toBe('https://rpc.nimiq-testnet.com')
    expect(rpcUrlFor('mainnet', { NIMIQ_RPC_URL: 'https://m.example' })).toBe('https://m.example')
    const seen: unknown[] = []
    const t: RpcTransport = async (url, body) => (seen.push([url, (body as any).method, (body as any).params]), { result: 1 })
    await relay(t, { method: 'getBlockNumber', param: null, net: 'testnet' }, {})
    await relay(t, { method: 'getTransactionByHash', param: 'AB'.repeat(32), net: 'mainnet' }, {})
    expect(seen).toEqual([
      ['https://rpc.nimiq-testnet.com', 'getBlockNumber', []],
      ['https://rpc.nimiqwatch.com', 'getTransactionByHash', ['ab'.repeat(32)]],
    ])
    for (const [m, p] of [['getTransactionByHash', 'abc'], ['getTransactionsByAddress', newAddress()], ['sendBasicTransaction', 'x'], [null, null]] as const)
      await expect(relay(t, { method: m, param: p, net: 'mainnet' }, {})).rejects.toMatchObject({ status: 400 })
  })

  it('keeps answering blockchain reads when the database is down', async () => {
    const down = { cmd: async () => { throw new Error('ECONNREFUSED') }, pipeline: async () => { throw new Error('ECONNREFUSED') } }
    const handler = createHandler(() => down, async () => ({ result: 7 }), {})
    const res = await run(handler, '/api/hf?a=rpc&m=getBlockNumber&net=testnet')
    expect([res.status, JSON.parse(res.body)]).toEqual([200, { result: 7 }])
  })

  it('rejects oversized backups instead of silently trimming them', () => {
    const me = newAddress()
    const closed = (i: number) => goal({ id: `closed${i}xx`, status: 'archived' })
    expect(() => cleanState({ goals: Array.from({ length: 25 }, (_, i) => closed(i)) }, me, now)).toThrow(/24 goals/)
    expect(() => cleanState({ goals: Array.from({ length: 24 }, (_, i) => closed(i)) }, me, now)).not.toThrow()
    const events = (n: number) => Array.from({ length: n }, () => ({ type: 'lock', luna: 1, at: now }))
    expect(() => cleanState({ goals: [goal({ events: events(41) })] }, me, now)).toThrow(/40 events/)
    expect(cleanState({ goals: [goal({ events: events(40) })] }, me, now).goals[0]!.events).toHaveLength(40)
  })

  it('cleans names, emoji, amounts and accounts', () => {
    const me = newAddress()
    const s = cleanState(
      { goals: [goal({ name: '  Rent\u0000 ​buffer  ', emoji: '🏠🏠🏠🏠🏠' })], accounts: ['bad', newAddress(), newAddress(), newAddress(), newAddress(), me] },
      me,
      now,
    )
    expect(s.goals[0]!.name).toBe('Rent buffer')
    expect(s.goals[0]!.emoji).toBe('🎯') // more than 4 code points is replaced
    expect(s.accounts).toHaveLength(4)
    expect(s.accounts[0]).toBe(me)
    expect(() => cleanState({ goals: [goal({ name: 'x'.repeat(41) })] }, me, now)).toThrow()
    expect(() => cleanState({ goals: [goal({ savedLuna: -1 })] }, me, now)).toThrow()
    expect(() => cleanState({ goals: [goal(), goal()] }, me, now)).toThrow() // duplicate id
  })

  it('round-trips a backup through the API: sync, restore and the public goal', async () => {
    const me = newAddress()
    await syncState(ctx(), me, { state: { goals: [goal({ status: 'completed', reachedAt: now })], accounts: [me], network: 'testnet' } })
    const restored = (await getState(ctx(), me)).state!
    expect(restored.network).toBe('testnet')
    expect(restored.goals[0]!.reachedAt).toBe(now)
    const pub = await publicGoal(ctx(), me, 'abc123def')
    expect(pub.goal.status).toBe('completed')
    expect(pub.network).toBe('testnet')
    expect(await publicStats(ctx())).toMatchObject({ activeGoals: 0, lockedLuna: 0 })
  })
})

describe('health check and mangled links', () => {
  it('answers ?a=health with the relay status, and reads %26-encoded parameters', async () => {
    const handler = createHandler(() => null, async () => ({ result: { data: 4242, metadata: {} } }), {})
    const health = await run(handler, '/api/hf?a=health')
    expect(JSON.parse(health.body)).toMatchObject({ ok: true, version: 'local', relay: 'ok', block: 4242, database: false, rpcServer: 'https://rpc.nimiqwatch.com' })
    const mangled = await run(handler, '/api/hf?a=rpc%26m=getBlockNumber')
    expect([mangled.status, JSON.parse(mangled.body)]).toEqual([200, { result: 4242 }])

    const down = createHandler(() => null, async () => ({ error: { message: 'upstream unavailable' } }), {})
    expect(JSON.parse((await run(down, '/api/hf?a=health')).body)).toMatchObject({ ok: false, relay: 'upstream unavailable', block: null })
  })
})

describe('several goals on the server', () => {
  const active = (i: number) => goal({ id: `active${i}xx`, lockedLuna: (i + 1) * 10_00000 })

  it('accepts up to 5 active goals and refuses a sixth', () => {
    const me = newAddress()
    expect(cleanState({ goals: Array.from({ length: 5 }, (_, i) => active(i)) }, me, now).goals).toHaveLength(5)
    expect(() => cleanState({ goals: Array.from({ length: 6 }, (_, i) => active(i)) }, me, now)).toThrow(/5 active goals/)
  })

  it('validates the wallet baseline', () => {
    const me = newAddress()
    const ok = cleanState({ goals: [goal()], walletBaselineLuna: 750_00000, walletBaselineFromChain: true }, me, now)
    expect([ok.walletBaselineLuna, ok.walletBaselineFromChain]).toEqual([750_00000, true])
    expect(cleanState({ goals: [goal()] }, me, now).walletBaselineLuna).toBeUndefined() // older phones
    for (const bad of [{ walletBaselineLuna: -1, walletBaselineFromChain: true }, { walletBaselineLuna: 1.5, walletBaselineFromChain: true }, { walletBaselineLuna: 2e16, walletBaselineFromChain: true }, { walletBaselineLuna: 5, walletBaselineFromChain: 'yes' }])
      expect(() => cleanState({ goals: [goal()], ...bad }, me, now)).toThrow()
  })

  it('counts every active goal and its NIM in the public numbers', async () => {
    const [a, b] = [newAddress(), newAddress()]
    await syncState(ctx(), a, { state: { goals: [active(0), active(1), active(2), goal({ id: 'closed99', status: 'archived' })] } })
    await syncState(ctx(), b, { state: { goals: [active(3)] } })
    expect(await publicStats(ctx())).toMatchObject({ activeGoals: 4, lockedLuna: (10 + 20 + 30 + 40) * 1_00000 })
    // A backup from before several goals (locked amount, no goal count) still counts as one goal.
    await store.cmd('HSET', 'locked', 'NQOLDSAVER', 5_00000)
    expect(await publicStats(ctx())).toMatchObject({ activeGoals: 5 })
  })

  it('gives a Goalkeeper the other goals by amount only, never their names', async () => {
    const me = newAddress()
    await syncState(ctx(), me, { state: { goals: [active(0), active(1)], walletBaselineLuna: 0, walletBaselineFromChain: true } })
    const r = await publicGoal(ctx(), me, 'active1xx')
    expect(r.goal.name).toBe('Rent buffer')
    expect(r.wallet.goals).toEqual([
      { self: false, lockedLuna: 10_00000, pendingLuna: 0, rewardLuna: 0 },
      { self: true, lockedLuna: 20_00000, pendingLuna: 0, rewardLuna: 0 },
    ])
    expect(JSON.stringify(r.wallet)).not.toContain('active0xx')
  })

  it('reads tagged and untagged cheers', () => {
    const me = newAddress()
    const friend = newAddress()
    const tx = (h: string, text: string, at: number) => ({ hash: h, from: friend, to: me, value: 1_00000, timestamp: at, recipientData: hex(text) })
    const cheers = parseCheers(me, [
      tx('t1', 'Holdfast cheer mhx8k2ab: For your fees!', 3000),
      tx('t2', 'Holdfast cheer: Old link', 2000),
      tx('t3', 'Holdfast cheerful: not ours', 1000),
      tx('t4', 'Holdfast cheer toolongtag9: nope', 500),
    ])
    expect(cheers.map((c) => [c.hash, c.goal ?? null, c.message])).toEqual([
      ['t1', 'mhx8k2ab', 'For your fees!'],
      ['t2', null, 'Old link'],
    ])
  })
})

describe('chain diagnostics', () => {
  it('health reports the stake for an address and whether the phone calls an RPC server directly', async () => {
    const me = newAddress()
    const handler = createHandler(
      () => null,
      async (_url, body: any) => (body.method === 'getBlockNumber' ? { result: { data: 9, metadata: {} } } : { result: { data: { balance: 123 }, metadata: {} } }),
      { VITE_NIMIQ_RPC_URL: 'https://some.rpc' },
    )
    const r = JSON.parse((await run(handler, `/api/hf?a=health&addr=${me.replace(/\s/g, '')}`)).body)
    expect(r).toMatchObject({ ok: true, block: 9, directRpcFromPhone: 'https://some.rpc', staker: { result: { balance: 123 } } })
    const noVite = JSON.parse((await run(createHandler(() => null, async () => ({ result: 1 }), {}), '/api/hf?a=health')).body)
    expect(noVite.directRpcFromPhone).toBe(false)
    expect(noVite.staker).toBeUndefined()
  })

  it('treats "not a staker" answers as zero stake, not as a failure', async () => {
    const { isNotAStaker } = await import('../src/lib/chain')
    for (const m of ['Staker not found: NQ12', 'No staker with address NQ..', 'Account is not a staker', 'Staker does not exist']) expect(isNotAStaker(m)).toBe(true)
    // A server that can't answer must never look like "no stake".
    for (const m of ['Method not found', 'Internal error', 'timeout', 'RPC method getStakerByAddress not found']) expect(isNotAStaker(m)).toBe(false)
  })
})
