import { describe, expect, it } from 'vitest'
import {
  activeGoal,
  createGoal,
  loadState,
  markReachedIfDone,
  recordLock,
  recordRelease,
  recordRetire,
  recordUnlockStart,
  saveState,
  savedLuna,
  withChainBaseline,
} from '../src/lib/store'

const mk = () =>
  createGoal({ name: '  Rent buffer ', emoji: '🏠', targetLuna: 1_000_00000, baselineLuna: 50_00000, baselineFromChain: true, validator: null, now: 1 })

describe('goal lifecycle', () => {
  it('creates an active goal with trimmed name', () => {
    const g = mk()
    expect(g.name).toBe('Rent buffer')
    expect(g.status).toBe('active')
    expect(activeGoal({ version: 1, goals: [g], stakerCreated: false })).toBe(g)
  })

  it('counts saved from chain minus baseline, else from ledger', () => {
    let g = recordLock(mk(), 200_00000, 'tx1')
    expect(savedLuna(g, null)).toBe(200_00000)
    expect(savedLuna(g, 260_00000)).toBe(210_00000) // includes rewards
    expect(savedLuna(g, 10_00000)).toBe(0) // never negative
    g = markReachedIfDone(g, 1_000_00000, 5)
    expect(g.reachedAt).toBe(5)
    expect(markReachedIfDone(g, 2_000_00000, 9)).toBe(g)
  })

  it('walks the unstake steps and marks the seal broken', () => {
    let g = recordLock(mk(), 300_00000, 'tx1')
    g = recordUnlockStart(g, 100_00000, 'tx2', 10)
    expect(g.sealBrokenAt).toBe(10)
    expect(g.pendingUnlock).toEqual({ luna: 100_00000, step: 'inactive', startedAt: 10 })
    g = recordRetire(g, 'tx3')
    expect(g.pendingUnlock?.step).toBe('retired')
    g = recordRelease(g, 'tx4')
    expect(g.pendingUnlock).toBeNull()
    expect(g.lockedLuna).toBe(200_00000)
    expect(g.events.map((e) => e.type)).toEqual(['created', 'lock', 'unlock', 'retire', 'release'])
  })
})

describe('starting stake not known when the goal was made', () => {
  const unknown = () => createGoal({ name: 'Laptop', emoji: '💻', targetLuna: 500_00000, baselineLuna: 0, validator: null, now: 1 })

  it('uses the ledger until the starting stake is read from the chain', () => {
    // 1,000 NIM was already staked before the goal; it must not count toward it.
    const g = recordLock(unknown(), 50_00000, 'tx1', 10)
    expect(savedLuna(g, 1_050_00000)).toBe(50_00000)
    const fixed = withChainBaseline(g, 1_050_00000, 10 + 5 * 60_000)
    expect(fixed.baselineLuna).toBe(1_000_00000)
    expect(fixed.baselineFromChain).toBe(true)
    expect(savedLuna(fixed, 1_052_00000)).toBe(52_00000) // rewards count from now on
  })

  it('waits for a settled reading right after a lock, and leaves known baselines alone', () => {
    const g = recordLock(unknown(), 50_00000, 'tx1', 10)
    expect(withChainBaseline(g, 1_000_00000, 10 + 60_000)).toBe(g) // lock may not be on chain yet
    const known = mk()
    expect(withChainBaseline(known, 9_999_00000)).toBe(known)
    // Older goals saved before this field existed, with a zero baseline, are treated as unknown.
    const legacy = { ...unknown(), baselineFromChain: undefined }
    expect(withChainBaseline(legacy, 30_00000, 99).baselineLuna).toBe(30_00000)
  })
})

describe('persistence', () => {
  it('round-trips per address and survives corrupt data', () => {
    const state = { version: 1 as const, goals: [mk()], stakerCreated: true }
    saveState('NQ07 0000', state)
    expect(loadState('nq070000')).toEqual(state)
    localStorage.setItem('holdfast.v1.BROKEN', '{nope')
    expect(loadState('broken').goals).toEqual([])
  })
})

describe('Goalkeeper and relay safety rules', () => {
  it('only uses chain totals on the Goalkeeper page when the starting stake is known', async () => {
    const { keeperBaselineKnown } = await import('../src/views/keeper')
    expect(keeperBaselineKnown({ baselineFromChain: true, baselineLuna: 0 }, { b: 0 })).toBe(true)
    expect(keeperBaselineKnown({ baselineFromChain: false, baselineLuna: 500 }, { b: 0 })).toBe(false)
    expect(keeperBaselineKnown({ baselineLuna: 0 }, { b: 0 })).toBe(false) // older goal, never read
    expect(keeperBaselineKnown({ baselineLuna: 700 }, { b: 0 })).toBe(true)
    expect(keeperBaselineKnown(null, { b: 0 })).toBe(false) // snapshot-only link
    expect(keeperBaselineKnown(null, { b: 900 })).toBe(true)
  })

  it('stops using the relay only on a static host, not on a passing gateway error', async () => {
    const { looksLikeStaticHost } = await import('../src/lib/chain')
    expect(looksLikeStaticHost({ status: 404, ok: false }, null)).toBe(true)
    expect(looksLikeStaticHost({ status: 200, ok: true }, null)).toBe(true) // the app's HTML page
    expect(looksLikeStaticHost({ status: 504, ok: false }, null)).toBe(false)
    expect(looksLikeStaticHost({ status: 502, ok: false }, null)).toBe(false)
  })
})
