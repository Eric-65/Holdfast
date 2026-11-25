import { describe, expect, it } from 'vitest'
import { readingShowsChange } from '../src/app'
import {
  checkpointRewards,
  closeGoalInState,
  startGoalWithdrawal,
  createGoal,
  goalSavings,
  migrateState,
  recordLock,
  recordUnlockStart,
  savedLuna,
  withWalletBaseline,
  type Goal,
  type StoreState,
} from '../src/lib/store'

const NIM = 100_000
const T0 = Date.UTC(2026, 10, 1)
const LATER = T0 + 24 * 3600_000

/** A goal that locked `locked` NIM a day before LATER. */
function goal(id: string, locked: number, over: Partial<Goal> = {}): Goal {
  const g = createGoal({ name: id, emoji: '🎯', targetLuna: 1000 * NIM, baselineLuna: 0, validator: null, now: T0 })
  return { ...recordLock({ ...g, id }, locked * NIM, 'ab'.repeat(32), T0), ...over }
}
const state = (goals: Goal[], baseline: number | null): StoreState => ({
  version: 1,
  goals,
  stakerCreated: true,
  walletBaselineLuna: (baseline ?? 0) * NIM,
  walletBaselineFromChain: baseline !== null,
})
const nimOf = (m: Map<string, number>) => Object.fromEntries([...m].map(([k, v]) => [k, v / NIM]))

describe('goalSavings: several goals share one stake', () => {
  it('one goal gets everything above the wallet baseline, rewards included', () => {
    const s = state([goal('a', 100)], 1000)
    expect(nimOf(goalSavings(s, 1105 * NIM))).toEqual({ a: 105 })
  })

  it('three goals share rewards in proportion to what each locked', () => {
    const s = state([goal('a', 100), goal('b', 300), goal('c', 600)], 500)
    // 1,000 NIM locked + 50 NIM rewards above the 500 NIM baseline.
    const m = goalSavings(s, 1550 * NIM)
    expect(nimOf(m)).toEqual({ a: 105, b: 315, c: 630 })
    expect([...m.values()].reduce((x, y) => x + y, 0)).toBe(1050 * NIM)
  })

  it('gives the rounding remainder to the largest goal, so the total always adds up', () => {
    const s = state([goal('a', 1), goal('b', 1), goal('c', 1)], 0)
    const m = goalSavings(s, 10) // 10 luna split three ways
    expect([...m.values()].reduce((x, y) => x + y, 0)).toBe(10)
    expect(Math.max(...m.values()) - Math.min(...m.values())).toBeLessThanOrEqual(1)
  })

  it('shows each goal its own ledger without a live reading or a known baseline', () => {
    const goals = [goal('a', 100), goal('b', 40)]
    expect(nimOf(goalSavings(state(goals, null), 9999 * NIM))).toEqual({ a: 100, b: 40 })
    expect(nimOf(goalSavings(state(goals, 500), null))).toEqual({ a: 100, b: 40 })
  })

  it('shows 0 for every goal when nothing is locked', () => {
    expect(nimOf(goalSavings(state([goal('a', 0), goal('b', 0)], 100), 900 * NIM))).toEqual({ a: 0, b: 0 })
  })

  it("a withdrawal on one goal leaves the other goals' shares alone", () => {
    const before = state([goal('a', 100), goal('b', 300)], 1000)
    const m1 = goalSavings(before, 1400 * NIM)
    // Withdraw all of b: 300 NIM is deactivated, so the active stake drops by 300.
    const s2 = { ...before, goals: [before.goals[0]!, recordUnlockStart(before.goals[1]!, 300 * NIM, 'cd'.repeat(32), LATER)] }
    const m2 = goalSavings(s2, 1100 * NIM)
    expect(m2.get('a')).toBe(m1.get('a'))
    expect(m2.get('b')).toBe(0)
  })

  it('ignores closed goals', () => {
    const s = state([goal('a', 100), goal('old', 50, { status: 'archived' })], 1050)
    expect(nimOf(goalSavings(s, 1150 * NIM))).toEqual({ a: 100 })
  })
})

describe('moving from one goal to several', () => {
  it('migrating old single-goal data keeps the same saved amount', () => {
    // The old model: saved = live stake − the goal's own starting stake.
    const old = goal('edu', 200, { baselineLuna: 750 * NIM, baselineFromChain: true })
    const legacy: StoreState = { version: 1, goals: [old], stakerCreated: true }
    const live = 963 * NIM
    const migrated = migrateState(legacy)
    expect(migrated.walletBaselineLuna).toBe(750 * NIM)
    expect(migrated.walletBaselineFromChain).toBe(true)
    expect(goalSavings(migrated, live).get('edu')).toBe(savedLuna(old, live))
    // An older goal whose starting stake was never read stays on its ledger until a reading.
    const unknown = migrateState({ version: 1, goals: [goal('x', 10)], stakerCreated: true })
    expect(unknown.walletBaselineFromChain).toBe(false)
    expect(goalSavings(unknown, live).get('x')).toBe(10 * NIM)
  })

  it('fills the wallet baseline from the first settled reading only', () => {
    const s = state([goal('a', 100)], null)
    expect(withWalletBaseline(s, 1100 * NIM, T0 + 60_000)).toBe(s) // a lock a minute ago: not settled
    const filled = withWalletBaseline(s, 1100 * NIM, LATER)
    expect(filled.walletBaselineLuna).toBe(1000 * NIM)
    expect(filled.walletBaselineFromChain).toBe(true)
    expect(withWalletBaseline(filled, 5000 * NIM, LATER)).toBe(filled) // known: left alone
  })
})

describe('closing and withdrawing with several goals', () => {
  it('closing a goal moves its savings into the wallet baseline; the others do not jump', () => {
    const s = state([goal('a', 100), goal('b', 300), goal('c', 600)], 500)
    const live = 1550 * NIM
    const before = goalSavings(s, live)
    const after = closeGoalInState(s, 'b', live)
    expect(after.goals.find((g) => g.id === 'b')!.status).toBe('archived')
    expect(after.walletBaselineLuna).toBe(500 * NIM + before.get('b')!)
    const m = goalSavings(after, live)
    expect(m.get('a')).toBe(before.get('a'))
    expect(m.get('c')).toBe(before.get('c'))
    expect(m.has('b')).toBe(false)
  })

  it('one goal can never give back more than its own share', () => {
    const s = state([goal('a', 100), goal('b', 300)], 1000)
    const live = 1420 * NIM // 20 NIM rewards
    const shareA = goalSavings(s, live).get('a')!
    expect(shareA).toBe(105 * NIM)
    // Taking a's whole share leaves b exactly what it had.
    const s2 = { ...s, goals: [recordUnlockStart(s.goals[0]!, shareA, 'ef'.repeat(32), LATER), s.goals[1]!] }
    expect(goalSavings(s2, live - shareA).get('b')).toBe(goalSavings(s, live).get('b'))
  })
})

describe('adding a goal does not take rewards earned before it', () => {
  it('the existing goal keeps its 105 NIM when a new goal locks 10 NIM', () => {
    // "For education": 100 NIM locked + 5 NIM rewards, above a 1,000 NIM wallet baseline.
    let s = state([goal('edu', 100)], 1000)
    expect(goalSavings(s, 1105 * NIM).get('edu')).toBe(105 * NIM)
    const rent = createGoal({ name: 'Rent', emoji: '🏠', targetLuna: 200 * NIM, baselineLuna: 0, validator: null, now: LATER })
    s = { ...s, goals: [...s.goals, { ...rent, id: 'rent' }] }
    // Lock 10 NIM into Rent: rewards so far are recorded first, then the stake grows by 10.
    s = checkpointRewards(s, 1105 * NIM)
    s = { ...s, goals: s.goals.map((g) => (g.id === 'rent' ? recordLock(g, 10 * NIM, 'ab'.repeat(32), LATER) : g)) }
    expect(nimOf(goalSavings(s, 1115 * NIM))).toEqual({ edu: 105, rent: 10 })
    // New rewards are then shared by what each goal holds: 11.5 NIM more → 10.5 and 1.
    expect(nimOf(goalSavings(s, 1126.5 * NIM))).toEqual({ edu: 115.5, rent: 11 })
  })

  it('withdrawing a goal uses its own rewards and leaves the others alone', () => {
    let s = state([goal('a', 100), goal('b', 100)], 1000)
    s = checkpointRewards(s, 1220 * NIM) // 10 NIM rewards each
    expect(nimOf(goalSavings(s, 1220 * NIM))).toEqual({ a: 110, b: 110 })
    const after = startGoalWithdrawal(s, 'a', 110 * NIM, 'cd'.repeat(32), 1220 * NIM, LATER)
    expect(nimOf(goalSavings(after, 1110 * NIM))).toEqual({ a: 0, b: 110 })
    const partial = startGoalWithdrawal(s, 'a', 30 * NIM, 'cd'.repeat(32), 1220 * NIM, LATER)
    expect(nimOf(goalSavings(partial, 1190 * NIM))).toEqual({ a: 80, b: 110 })
  })
})

describe('readings taken before a transaction was included', () => {
  it('only counts a reading as fresh once it shows the expected change', () => {
    const lock = { balance: 1115 * NIM, dir: 1 as const }
    expect(readingShowsChange(1105 * NIM, lock)).toBe(false) // still the old stake
    expect(readingShowsChange(1115 * NIM, lock)).toBe(true)
    expect(readingShowsChange(1115.2 * NIM, lock)).toBe(true) // plus a little reward
    const unlock = { balance: 1095 * NIM, dir: -1 as const }
    expect(readingShowsChange(1105 * NIM, unlock)).toBe(false)
    expect(readingShowsChange(1095.3 * NIM, unlock)).toBe(true)
  })
})

describe('locks the network refused', () => {
  it('takes a refused lock off its goal and notes it', async () => {
    const { rejectLock, confirmLock } = await import('../src/lib/store')
    const fresh = createGoal({ name: 'x', emoji: '🎯', targetLuna: 100 * NIM, baselineLuna: 0, validator: null, now: T0 })
    const g = recordLock(recordLock(fresh, 30 * NIM, 'aa'.repeat(32), T0), 10 * NIM, 'bb'.repeat(32), T0)
    const r = rejectLock(g, 'aa'.repeat(32), LATER)
    expect(r.lockedLuna).toBe(10 * NIM)
    expect(r.events.filter((e) => e.type === 'lock').map((e) => e.tx)).toEqual(['bb'.repeat(32)])
    expect(r.events.at(-1)).toMatchObject({ type: 'rejected', luna: 30 * NIM, tx: 'aa'.repeat(32) })
    expect(rejectLock(r, 'aa'.repeat(32))).toBe(r) // already undone: no change
    const c = confirmLock(r, 'bb'.repeat(32))
    expect(c.events.find((e) => e.tx === 'bb'.repeat(32))!.ok).toBe(true)
    expect(confirmLock(c, 'bb'.repeat(32))).toBe(c)
  })

  it('tells "not a staker" apart from a staker with zero stake', async () => {
    const { normalizeStaker } = await import('../src/lib/chain')
    expect(normalizeStaker('A', null).exists).toBe(false)
    expect(normalizeStaker('A', { balance: 0, delegation: 'V' }).exists).toBe(true)
  })
})
