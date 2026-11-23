export type GoalEventType = 'created' | 'lock' | 'unlock' | 'retire' | 'release' | 'reached' | 'shared' | 'rejected'

export interface GoalEvent {
  type: GoalEventType
  luna: number
  at: number
  tx?: string
  /** For locks: true once the network confirmed the transaction went through. */
  ok?: boolean
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
  /**
   * Staking rewards this goal had already earned at its last change (lock, withdrawal, or another
   * goal's change). Kept so a new goal doesn't take a share of rewards earned before it existed.
   */
  rewardLuna?: number
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
  /**
   * Active stake that belongs to no goal: what the wallet had staked before Holdfast, plus the NIM
   * of closed goals (it stays staked). Goals divide whatever is staked above this.
   */
  walletBaselineLuna?: number
  /** true once walletBaselineLuna is known (read from the chain, or carried over from older data). */
  walletBaselineFromChain?: boolean
}

/** Up to this many goals can be active at once. */
export const MAX_ACTIVE_GOALS = 5
/** A reading taken within this long after a lock or withdrawal may not include it yet. */
export const SETTLE_MS = 3 * 60_000

const key = (address: string) => `holdfast.v1.${address.replace(/\s/g, '').toUpperCase()}`
const empty = (): StoreState => ({ version: 1, goals: [], stakerCreated: false, walletBaselineLuna: 0, walletBaselineFromChain: false })

export function loadState(address: string, storage: Storage = localStorage): StoreState {
  try {
    const raw = storage.getItem(key(address))
    if (!raw) return empty()
    const s = JSON.parse(raw) as StoreState
    if (s?.version !== 1 || !Array.isArray(s.goals)) return empty()
    return migrateState(s)
  } catch {
    return empty()
  }
}

/**
 * Bring data from the single-goal version up to date. The old active goal's starting stake was
 * "everything staked that isn't this goal", which is exactly the wallet baseline now.
 */
export function migrateState(s: StoreState): StoreState {
  if (s.walletBaselineFromChain !== undefined) return s
  const old = s.goals.find((g) => g.status === 'active')
  if (old && !baselineUnknown(old)) return { ...s, walletBaselineLuna: old.baselineLuna, walletBaselineFromChain: true }
  return { ...s, walletBaselineLuna: 0, walletBaselineFromChain: false }
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

export const activeGoals = (s: StoreState): Goal[] => s.goals.filter((g) => g.status === 'active')
/** The first active goal (older single-goal code paths and tests). */
export const activeGoal = (s: StoreState): Goal | undefined => activeGoals(s)[0]

/** What Holdfast locked for a goal and is still active (a withdrawal underway is excluded). */
export const ledgerOf = (g: Goal): number => Math.max(0, g.lockedLuna - (g.pendingUnlock?.luna ?? 0))
/** A goal's weight when the stake is divided: its ledger plus the rewards it had already earned. */
export const weightOf = (g: Goal): number => ledgerOf(g) + Math.max(0, g.rewardLuna ?? 0)

export const walletBaselineKnown = (s: StoreState): boolean => s.walletBaselineFromChain === true

/**
 * How much each active goal has saved. A wallet has one stake, so goals divide it: whatever is
 * staked above the wallet baseline (the "pool", including rewards) is shared in proportion to
 * each goal's weight, which is what it locked plus rewards it had already earned. New rewards
 * are therefore split in proportion to what each goal holds. Without a live reading, or before
 * the wallet baseline is known, each goal shows its weight (its ledger plus earned rewards).
 * Rounded down; the few luna left over go to the largest goal.
 */
export function goalSavings(state: StoreState, liveActiveStake: number | null): Map<string, number> {
  const goals = activeGoals(state)
  const out = new Map<string, number>()
  if (liveActiveStake === null || !walletBaselineKnown(state)) {
    for (const g of goals) out.set(g.id, weightOf(g))
    return out
  }
  const pool = BigInt(Math.max(0, Math.floor(liveActiveStake - (state.walletBaselineLuna ?? 0))))
  const ledgers = goals.map((g) => BigInt(weightOf(g)))
  const total = ledgers.reduce((a, b) => a + b, 0n)
  if (total === 0n) {
    for (const g of goals) out.set(g.id, 0)
    return out
  }
  let given = 0n
  goals.forEach((g, i) => {
    const share = (pool * ledgers[i]!) / total
    given += share
    out.set(g.id, Number(share))
  })
  const rest = pool - given
  if (rest > 0n) {
    let largest = 0
    ledgers.forEach((l, i) => (l > ledgers[largest]! ? (largest = i) : 0))
    const id = goals[largest]!.id
    out.set(id, out.get(id)! + Number(rest))
  }
  return out
}

/** One goal's saved amount (0 for a goal that isn't active). */
export const goalSaved = (state: StoreState, goal: Goal, liveActiveStake: number | null): number =>
  goalSavings(state, liveActiveStake).get(goal.id) ?? 0

/**
 * Record the rewards each goal has earned so far, using a live reading. Call it before any change
 * to the goals (a lock, a withdrawal, a new goal), so the change doesn't move rewards between goals.
 */
export function checkpointRewards(s: StoreState, liveActiveStake: number | null): StoreState {
  if (liveActiveStake === null || !walletBaselineKnown(s)) return s
  const savings = goalSavings(s, liveActiveStake)
  let changed = false
  const goals = s.goals.map((g) => {
    if (g.status !== 'active') return g
    const reward = Math.max(0, (savings.get(g.id) ?? 0) - ledgerOf(g))
    if (reward === (g.rewardLuna ?? 0)) return g
    changed = true
    return { ...g, rewardLuna: reward }
  })
  return changed ? { ...s, goals } : s
}

/**
 * Start a withdrawal of `luna` from one goal. Its rewards are used up after its ledger, so what is
 * left on the goal is exactly what it had minus what was withdrawn; other goals don't change.
 */
export function startGoalWithdrawal(s: StoreState, goalId: string, luna: number, tx: string, liveActiveStake: number | null, now = Date.now()): StoreState {
  const before = checkpointRewards(s, liveActiveStake)
  const goal = before.goals.find((g) => g.id === goalId)
  if (!goal) return s
  const savedBefore = weightOf(goal)
  const after = recordUnlockStart(goal, luna, tx, now)
  const reward = Math.max(0, savedBefore - luna - ledgerOf(after))
  return replaceGoal(before, { ...after, rewardLuna: reward })
}

/**
 * Fill in an unknown wallet baseline from the first settled chain reading: whatever is staked now,
 * minus what Holdfast locked for the active goals, belongs to no goal.
 */
export function withWalletBaseline(s: StoreState, activeStake: number, now = Date.now()): StoreState {
  if (walletBaselineKnown(s)) return s
  const recent = activeGoals(s).some((g) => g.events.some((e) => (e.type === 'lock' || e.type === 'unlock') && now - e.at < SETTLE_MS))
  if (recent) return s
  const locked = activeGoals(s).reduce((a, g) => a + weightOf(g), 0)
  return { ...s, walletBaselineLuna: Math.max(0, activeStake - locked), walletBaselineFromChain: true }
}

/**
 * Close a goal. Its NIM stays staked, so its saved amount moves into the wallet baseline and
 * the other goals' numbers don't change.
 */
export function closeGoalInState(s: StoreState, goalId: string, liveActiveStake: number | null): StoreState {
  const goal = s.goals.find((g) => g.id === goalId)
  if (!goal || goal.status !== 'active') return s
  const saved = goalSavings(s, liveActiveStake).get(goal.id) ?? weightOf(goal)
  const closed: Goal = { ...goal, status: goal.reachedAt ? 'completed' : 'archived' }
  return {
    ...replaceGoal(s, closed),
    // With an unknown baseline the first chain reading will include this NIM anyway.
    ...(walletBaselineKnown(s) ? { walletBaselineLuna: (s.walletBaselineLuna ?? 0) + saved } : {}),
  }
}

/**
 * Amount saved toward a goal in the single-goal model (kept for older data and tests):
 * on-chain active stake minus the goal's own starting stake, or its ledger.
 */
export function savedLuna(goal: Goal, onChainActive: number | null): number {
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

/** `tx` is absent when the blockchain showed the step done without Holdfast seeing the transaction. */
export function recordRetire(goal: Goal, tx?: string, now = Date.now()): Goal {
  if (!goal.pendingUnlock) return goal
  return {
    ...goal,
    pendingUnlock: { ...goal.pendingUnlock, step: 'retired' },
    events: [...goal.events, { type: 'retire', luna: goal.pendingUnlock.luna, at: now, ...(tx ? { tx } : {}) }],
  }
}

export function recordRelease(goal: Goal, tx?: string, now = Date.now()): Goal {
  if (!goal.pendingUnlock) return goal
  const luna = goal.pendingUnlock.luna
  return {
    ...goal,
    lockedLuna: Math.max(0, goal.lockedLuna - luna),
    pendingUnlock: null,
    events: [...goal.events, { type: 'release', luna, at: now, ...(tx ? { tx } : {}) }],
  }
}

/**
 * Blocks after a deactivation takes effect (`inactiveFrom`) until the stake can be retired: one
 * epoch of 43,200 blocks plus one (Nimiq's collateral lock-up, the same on mainnet and testnet).
 * Blocks come about once a second, so with the wait for the deactivation to take effect at the
 * next election block, a withdrawal takes 12 to 24 hours in total.
 */
export const RETIRE_LOCKUP_BLOCKS = 43_201

/** The block from which deactivated stake can be retired, or null if nothing is deactivated. */
export const retireReadyBlock = (inactiveFrom: number | null): number | null =>
  inactiveFrom === null ? null : inactiveFrom + RETIRE_LOCKUP_BLOCKS

/** Back to waiting for the cool-down: the stake was not retired (refused, or sent too early). */
export function undoRetire(goal: Goal): Goal {
  const p = goal.pendingUnlock
  if (!p || p.step !== 'retired') return goal
  return {
    ...goal,
    pendingUnlock: { ...p, step: 'inactive' },
    events: goal.events.filter((e) => !(e.type === 'retire' && e.at >= p.startedAt)),
  }
}

/**
 * Match a withdrawal to what the blockchain shows, once the last step has had time to settle:
 * a retire that didn't happen is undone, and a retire or return that did happen is recorded.
 */
export function reconcileWithdrawal(goal: Goal, stake: { inactiveBalance: number; retiredBalance: number }, now = Date.now()): Goal {
  const p = goal.pendingUnlock
  if (!p) return goal
  const last = Math.max(p.startedAt, ...goal.events.filter((e) => e.type === 'retire' && e.at >= p.startedAt).map((e) => e.at))
  if (now - last < SETTLE_MS) return goal
  const retired = stake.retiredBalance >= p.luna
  const inactive = stake.inactiveBalance >= p.luna
  if (p.step === 'retired' && !retired && inactive) return undoRetire(goal)
  if (p.step === 'retired' && !retired && !inactive) return recordRelease(goal, undefined, now)
  if (p.step === 'inactive' && retired && !inactive) return recordRetire(goal, undefined, now)
  return goal
}

/**
 * The network refused a lock (it was included but failed, e.g. adding stake to a wallet that isn't a
 * staker yet). Nothing was staked, so take it off the goal and note it in the activity.
 */
export function rejectLock(goal: Goal, tx: string, now = Date.now()): Goal {
  const event = goal.events.find((e) => e.type === 'lock' && e.tx === tx)
  if (!event) return goal
  return {
    ...goal,
    lockedLuna: Math.max(0, goal.lockedLuna - event.luna),
    events: [...goal.events.filter((e) => e !== event), { type: 'rejected', luna: event.luna, at: now, tx }],
  }
}

/** The network confirmed this lock went through. */
export function confirmLock(goal: Goal, tx: string): Goal {
  if (!goal.events.some((e) => e.type === 'lock' && e.tx === tx && !e.ok)) return goal
  return { ...goal, events: goal.events.map((e) => (e.type === 'lock' && e.tx === tx ? { ...e, ok: true } : e)) }
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
