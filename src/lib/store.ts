export type GoalEventType = 'created' | 'lock' | 'unlock' | 'retire' | 'release' | 'reached' | 'shared'

export interface GoalEvent {
  type: GoalEventType
  luna: number
  at: number
  tx?: string
}

/** Withdrawal in progress. Nimiq stake goes active -> inactive -> retired -> back to wallet. */
export interface PendingUnlock {
  luna: number
  step: 'inactive' | 'retired'
  startedAt: number
}

export interface Goal {
  id: string
  name: string
  emoji: string
  targetLuna: number
  createdAt: number
  /** Stake the user already had before this goal; not counted toward it. */
  baselineLuna: number
  /**
   * true when baselineLuna was read from the blockchain. false (or missing, on older goals with a
   * zero baseline) means it is not known yet; Holdfast fills it in at the first stake reading.
   */
  baselineFromChain?: boolean
  /** NIM locked through Holdfast for this goal (ledger, net of withdrawals). */
  lockedLuna: number
  validator: string | null
  status: 'active' | 'completed' | 'archived'
  sealBrokenAt: number | null
  reachedAt: number | null
  pendingUnlock: PendingUnlock | null
  events: GoalEvent[]
}

export interface StoreState {
  version: 1
  goals: Goal[]
  /** Set once Holdfast has created a staker for this address (first lock uses NewStaker). */
  stakerCreated: boolean
  /** When this device last changed the goals (ms). */
  updatedAt?: number
}

const key = (address: string) => `holdfast.v1.${address.replace(/\s/g, '').toUpperCase()}`
const empty = (): StoreState => ({ version: 1, goals: [], stakerCreated: false })

export function loadState(address: string, storage: Storage = localStorage): StoreState {
  try {
    const raw = storage.getItem(key(address))
    if (!raw) return empty()
    const s = JSON.parse(raw) as StoreState
    if (s?.version !== 1 || !Array.isArray(s.goals)) return empty()
    return s
  } catch {
    return empty()
  }
}

export function saveState(address: string, state: StoreState, storage: Storage = localStorage): void {
  try {
    storage.setItem(key(address), JSON.stringify(state))
  } catch {
    /* storage may be unavailable (private mode); app keeps working in memory */
  }
}

/** Goal ids appear in Goalkeeper links, so they include enough randomness not to be guessed. */
export const newId = (): string => {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'
      ? Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join('')
      : Math.random().toString(36).slice(2, 10)
  return Date.now().toString(36) + rand
}

export function createGoal(input: {
  name: string
  emoji: string
  targetLuna: number
  baselineLuna: number
  baselineFromChain?: boolean
  validator: string | null
  now?: number
}): Goal {
  const now = input.now ?? Date.now()
  return {
    id: newId(),
    name: input.name.trim().slice(0, 40),
    emoji: input.emoji,
    targetLuna: input.targetLuna,
    createdAt: now,
    baselineLuna: input.baselineLuna,
    baselineFromChain: input.baselineFromChain ?? false,
    lockedLuna: 0,
    validator: input.validator,
    status: 'active',
    sealBrokenAt: null,
    reachedAt: null,
    pendingUnlock: null,
    events: [{ type: 'created', luna: input.targetLuna, at: now }],
  }
}

export const activeGoal = (s: StoreState): Goal | undefined => s.goals.find((g) => g.status === 'active')

/**
 * Amount saved toward a goal. Uses on-chain active stake when known (so rewards count),
 * otherwise Holdfast's own ledger.
 */
export function savedLuna(goal: Goal, onChainActive: number | null): number {
  // Without a known starting stake, on-chain totals could include savings from before the goal.
  if (onChainActive === null || baselineUnknown(goal)) return goal.lockedLuna
  return Math.max(0, onChainActive - goal.baselineLuna)
}

export function recordLock(goal: Goal, luna: number, tx: string, now = Date.now()): Goal {
  return { ...goal, lockedLuna: goal.lockedLuna + luna, events: [...goal.events, { type: 'lock', luna, at: now, tx }] }
}

export function markReachedIfDone(goal: Goal, saved: number, now = Date.now()): Goal {
  if (goal.reachedAt || saved < goal.targetLuna) return goal
  return { ...goal, reachedAt: now, events: [...goal.events, { type: 'reached', luna: saved, at: now }] }
}

export function recordUnlockStart(goal: Goal, luna: number, tx: string, now = Date.now()): Goal {
  return {
    ...goal,
    sealBrokenAt: goal.sealBrokenAt ?? now,
    pendingUnlock: { luna, step: 'inactive', startedAt: now },
    events: [...goal.events, { type: 'unlock', luna, at: now, tx }],
  }
}

export function recordRetire(goal: Goal, tx: string, now = Date.now()): Goal {
  if (!goal.pendingUnlock) return goal
  return {
    ...goal,
    pendingUnlock: { ...goal.pendingUnlock, step: 'retired' },
    events: [...goal.events, { type: 'retire', luna: goal.pendingUnlock.luna, at: now, tx }],
  }
}

export function recordRelease(goal: Goal, tx: string, now = Date.now()): Goal {
  if (!goal.pendingUnlock) return goal
  const luna = goal.pendingUnlock.luna
  return {
    ...goal,
    lockedLuna: Math.max(0, goal.lockedLuna - luna),
    pendingUnlock: null,
    events: [...goal.events, { type: 'release', luna, at: now, tx }],
  }
}

export function replaceGoal(s: StoreState, goal: Goal): StoreState {
  return { ...s, goals: s.goals.map((g) => (g.id === goal.id ? goal : g)) }
}

/** Whether the goal still needs its starting stake read from the blockchain. */
export const baselineUnknown = (g: Goal): boolean =>
  g.baselineFromChain === false || (g.baselineFromChain === undefined && g.baselineLuna === 0)

/**
 * Fill in an unknown starting stake from the first blockchain reading. Whatever is staked now,
 * minus what Holdfast itself locked for this goal, was there before the goal.
 */
export function withChainBaseline(g: Goal, activeStake: number, now = Date.now()): Goal {
  if (!baselineUnknown(g)) return g
  // Right after a lock or withdrawal the reading may not include it yet; wait for a settled one.
  if (g.events.some((e) => (e.type === 'lock' || e.type === 'unlock') && now - e.at < 3 * 60_000)) return g
  const lockedStillActive = Math.max(0, g.lockedLuna - (g.pendingUnlock?.luna ?? 0))
  return { ...g, baselineLuna: Math.max(0, activeStake - lockedStillActive), baselineFromChain: true }
}
