import { cleanNet, type Net } from './chain.js'
import { ApiError, defaultName, rateLimit, userKey, type RequestContext } from './core.js'
import { normalizeAddress } from './crypto.js'

/**
 * Goal backup and live Goalkeeper pages. A signed-in saver's goals are copied here from the
 * phone, so they survive a new phone or a cleared app, and a friend's Goalkeeper link always
 * shows the latest progress instead of a snapshot. The money itself is never here: it stays
 * staked in the saver's own wallet.
 */

const EVENT_TYPES = new Set(['created', 'lock', 'unlock', 'retire', 'release', 'reached', 'shared'])
const MAX_GOALS = 12
const MAX_EVENTS = 40
const MAX_ACCOUNTS = 4
/** More than every NIM that will ever exist, in luna. Anything larger is malformed. */
const MAX_LUNA = 1e16
/** Year 2100, in ms. */
const MAX_TIME = 4_102_444_800_000

export interface SyncedEvent {
  type: string
  luna: number
  at: number
  tx?: string
}

export interface SyncedGoal {
  id: string
  name: string
  emoji: string
  targetLuna: number
  baselineLuna: number
  lockedLuna: number
  /** Saved toward the goal when the phone last synced (on-chain stake when it could read it). */
  savedLuna: number
  createdAt: number
  status: 'active' | 'completed' | 'archived'
  sealBrokenAt: number | null
  reachedAt: number | null
  pendingUnlock: { luna: number; step: 'inactive' | 'retired'; startedAt: number } | null
  validator: string | null
  baselineFromChain?: boolean
  events: SyncedEvent[]
}

export interface SyncedState {
  goals: SyncedGoal[]
  stakerCreated: boolean
  /** The saver's Nimiq Pay addresses; stake on all of them counts. The first is the signed-in one. */
  accounts: string[]
  network: Net
  updatedAt: number
}

const stateKey = (address: string) => `st:${address.replace(/\s/g, '')}`
const LOCKED_KEY = 'locked'

const bad = (what: string): never => {
  throw new ApiError(400, 'bad_goal', `Goal data is malformed (${what}).`)
}
const luna = (v: unknown, what: string): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_LUNA ? v : bad(what)
const time = (v: unknown, what: string): number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 && v < MAX_TIME ? v : bad(what)
const optTime = (v: unknown, what: string): number | null => (v === null || v === undefined ? null : time(v, what))

function cleanText(v: unknown, max: number, what: string): string {
  if (typeof v !== 'string') return bad(what)
  const s = v
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  const n = [...s].length
  return n >= 1 && n <= max ? s : bad(what)
}

function cleanEvent(raw: unknown): SyncedEvent | null {
  const e = raw as Record<string, unknown>
  if (!e || typeof e !== 'object' || typeof e.type !== 'string' || !EVENT_TYPES.has(e.type)) return null
  const l = typeof e.luna === 'number' && Number.isInteger(e.luna) && e.luna >= 0 && e.luna <= MAX_LUNA ? e.luna : null
  const at = typeof e.at === 'number' && Number.isInteger(e.at) && e.at > 0 && e.at < MAX_TIME ? e.at : null
  if (l === null || at === null) return null
  const tx = typeof e.tx === 'string' && /^[0-9a-f]{64}$/i.test(e.tx) ? e.tx.toLowerCase() : undefined
  return { type: e.type, luna: l, at, ...(tx ? { tx } : {}) }
}

export function cleanGoal(raw: unknown): SyncedGoal {
  const g = raw as Record<string, unknown>
  if (!g || typeof g !== 'object') bad('goal')
  if (typeof g.id !== 'string' || !/^[A-Za-z0-9]{6,32}$/.test(g.id)) bad('id')
  if (g.status !== 'active' && g.status !== 'completed' && g.status !== 'archived') bad('status')
  let pendingUnlock: SyncedGoal['pendingUnlock'] = null
  if (g.pendingUnlock !== null && g.pendingUnlock !== undefined) {
    const p = g.pendingUnlock as Record<string, unknown>
    if (typeof p !== 'object' || (p.step !== 'inactive' && p.step !== 'retired')) bad('pendingUnlock')
    pendingUnlock = { luna: luna(p.luna, 'pendingUnlock'), step: p.step as 'inactive' | 'retired', startedAt: time(p.startedAt, 'pendingUnlock') }
  }
  const validator = g.validator === null || g.validator === undefined ? null : (normalizeAddress(g.validator) ?? bad('validator'))
  const events = (Array.isArray(g.events) ? g.events : []).slice(-MAX_EVENTS).map(cleanEvent).filter((e): e is SyncedEvent => !!e)
  const emoji = typeof g.emoji === 'string' && g.emoji.length <= 16 && [...g.emoji].length <= 4 && g.emoji.trim() ? g.emoji : '🎯'
  return {
    id: g.id as string,
    name: cleanText(g.name, 40, 'name'),
    emoji,
    targetLuna: luna(g.targetLuna, 'targetLuna'),
    baselineLuna: luna(g.baselineLuna, 'baselineLuna'),
    lockedLuna: luna(g.lockedLuna, 'lockedLuna'),
    savedLuna: g.savedLuna === undefined ? luna(g.lockedLuna, 'lockedLuna') : luna(g.savedLuna, 'savedLuna'),
    createdAt: time(g.createdAt, 'createdAt'),
    status: g.status as SyncedGoal['status'],
    sealBrokenAt: optTime(g.sealBrokenAt, 'sealBrokenAt'),
    reachedAt: optTime(g.reachedAt, 'reachedAt'),
    pendingUnlock,
    validator,
    ...(typeof g.baselineFromChain === 'boolean' ? { baselineFromChain: g.baselineFromChain } : {}),
    events,
  }
}

/** Check and tidy what the phone sent. `owner` is the signed-in address and always comes first. */
export function cleanState(raw: unknown, owner: string, now: number): SyncedState {
  const s = raw as Record<string, unknown>
  if (!s || typeof s !== 'object' || !Array.isArray(s.goals)) bad('state')
  const goals = (s.goals as unknown[]).slice(-MAX_GOALS).map(cleanGoal)
  if (goals.filter((g) => g.status === 'active').length > 1) bad('more than one active goal')
  if (new Set(goals.map((g) => g.id)).size !== goals.length) bad('duplicate goal id')
  const others = (Array.isArray(s.accounts) ? s.accounts : [])
    .map((a) => normalizeAddress(a))
    .filter((a): a is string => !!a && a !== owner)
  const accounts = [owner, ...new Set(others)].slice(0, MAX_ACCOUNTS)
  return { goals, stakerCreated: s.stakerCreated === true, accounts, network: cleanNet(s.network), updatedAt: now }
}

function readState(raw: unknown): SyncedState | null {
  if (typeof raw !== 'string') return null
  try {
    const s = JSON.parse(raw) as SyncedState
    return s && Array.isArray(s.goals) && Array.isArray(s.accounts) ? s : null
  } catch {
    return null
  }
}

/** Save the signed-in saver's goals. */
export async function syncState(ctx: RequestContext, address: string, body: { state?: unknown }): Promise<{ updatedAt: number }> {
  await rateLimit(ctx, `sync:${address.replace(/\s/g, '')}`, 240, 3600)
  const state = cleanState(body.state, address, ctx.now)
  const active = state.goals.find((g) => g.status === 'active')
  const member = address.replace(/\s/g, '')
  await ctx.store.pipeline([
    ['SET', stateKey(address), JSON.stringify(state)],
    active ? ['HSET', LOCKED_KEY, member, active.lockedLuna] : ['HDEL', LOCKED_KEY, member],
  ])
  return { updatedAt: state.updatedAt }
}

/** The signed-in saver's backed-up goals, to restore them on a new phone. */
export async function getState(ctx: RequestContext, address: string): Promise<{ state: SyncedState | null }> {
  return { state: readState(await ctx.store.cmd('GET', stateKey(address))) }
}

export interface PublicGoal {
  goal: SyncedGoal
  owner: { name: string }
  accounts: string[]
  network: Net
  updatedAt: number
}

/** One goal, for the friend holding its Goalkeeper link. Needs the saver's address and the goal id. */
export async function publicGoal(ctx: RequestContext, rawAddress: unknown, rawId: unknown): Promise<PublicGoal> {
  await rateLimit(ctx, `goal:${ctx.ipKey}`, 300, 300)
  const address = normalizeAddress(rawAddress)
  const id = typeof rawId === 'string' && /^[A-Za-z0-9]{6,32}$/.test(rawId) ? rawId : null
  if (!address || !id) throw new ApiError(400, 'bad_request', 'That Goalkeeper link is malformed.')
  const [rawState, name] = await ctx.store.pipeline([
    ['GET', stateKey(address)],
    ['HGET', userKey(address), 'name'],
  ])
  const state = readState(rawState)
  const goal = state?.goals.find((g) => g.id === id)
  if (!state || !goal) throw new ApiError(404, 'no_goal', 'This goal has not been backed up yet.')
  return {
    goal,
    owner: { name: typeof name === 'string' && name ? name : defaultName(address) },
    accounts: state.accounts,
    network: state.network,
    updatedAt: state.updatedAt,
  }
}

/** Public numbers that show Holdfast is in real use. */
export async function publicStats(ctx: RequestContext): Promise<{ savers: number; activeGoals: number; lockedLuna: number }> {
  const [users, locked] = await ctx.store.pipeline([
    ['GET', 'stats:users'],
    ['HVALS', LOCKED_KEY],
  ])
  const values = Array.isArray(locked) ? locked.map(Number).filter((n) => Number.isFinite(n) && n >= 0) : []
  return {
    savers: Number(users) || 0,
    activeGoals: values.length,
    lockedLuna: values.reduce((a, n) => a + n, 0),
  }
}
