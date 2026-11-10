import { describe, expect, it } from 'vitest'
import { decodeKeeper, encodeKeeper, keeperUrl, nimiqPaymentUri, type KeeperPayload } from '../src/lib/share'
import { cheerData } from '../src/views/keeper'
import { parseValidators, normalizeStaker } from '../src/lib/chain'
import { parsePriceResponse } from '../src/lib/prices'

const payload: KeeperPayload = {
  v: 1, n: 'Lagos rent 🏠', e: '🏠', t: 5_000_00000, a: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
  b: 0, c: 1700000000000, s: 1_234_00000, st: 1700000500000,
}

describe('goalkeeper links', () => {
  it('round-trips unicode payloads through URL-safe base64', () => {
    const enc = encodeKeeper(payload)
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeKeeper(enc)).toEqual(payload)
  })
  it('rejects tampered or malformed payloads', () => {
    expect(decodeKeeper('not-base64!!')).toBeNull()
    expect(decodeKeeper(encodeKeeper({ ...payload, t: -1 }))).toBeNull()
    expect(decodeKeeper(encodeKeeper({ ...payload, v: 2 as 1 }))).toBeNull()
  })
  it('builds a hash route and replaces an existing hash', () => {
    const url = keeperUrl('https://example.org/app/#/old', payload)
    expect(url.startsWith('https://example.org/app/#/keep/')).toBe(true)
  })
  it('builds nimiq payment URIs', () => {
    expect(nimiqPaymentUri('NQ07 0000', 10, 'Go!')).toBe('nimiq:NQ070000?amount=10&message=Go%21')
  })
  it('keeps cheer data within 64 bytes', () => {
    const d = cheerData('🎉'.repeat(40))
    expect(new TextEncoder().encode(d).length).toBeLessThanOrEqual(64)
    expect(d.startsWith('Holdfast cheer: ')).toBe(true)
  })
})

describe('external data parsing', () => {
  it('parses validator lists in either shape and ranks payout pools first', () => {
    const list = parseValidators({
      validators: [
        { address: 'NQ1', name: 'Solo', payoutType: 'none', score: { total: 0.99 } },
        { address: 'NQ2', name: 'Pool', payoutType: 'restake', fee: 0.1, score: { total: 0.8 }, logo: 'javascript:alert(1)' },
        { name: 'no address' },
      ],
    })
    expect(list.map((v) => v.name)).toEqual(['Pool', 'Solo'])
    expect(list[0]!.logo).toBeNull()
    expect(parseValidators([{ address: 'NQ3' }])[0]!.name).toBe('Unnamed validator')
  })
  it('normalizes stakers and prices', () => {
    expect(normalizeStaker('A', null).balance).toBe(0)
    expect(normalizeStaker('A', { balance: 5, inactiveBalance: 2, delegation: 'V' })).toMatchObject({ balance: 5, inactiveBalance: 2, delegation: 'V' })
    expect(parsePriceResponse({ 'nimiq-2': { usd: 0.001, ngn: 1.6, eur: 0 } })).toEqual({ usd: 0.001, ngn: 1.6 })
    expect(parsePriceResponse({})).toBeNull()
  })
})
