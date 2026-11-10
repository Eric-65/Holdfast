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
} from '../src/lib/store'

const mk = () => createGoal({ name: '  Rent buffer ', emoji: '🏠', targetLuna: 1_000_00000, baselineLuna: 50_00000, validator: null, now: 1 })

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

describe('persistence', () => {
  it('round-trips per address and survives corrupt data', () => {
    const state = { version: 1 as const, goals: [mk()], stakerCreated: true }
    saveState('NQ07 0000', state)
    expect(loadState('nq070000')).toEqual(state)
    localStorage.setItem('holdfast.v1.BROKEN', '{nope')
    expect(loadState('broken').goals).toEqual([])
  })
})
