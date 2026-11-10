import { describe, expect, it } from 'vitest'
import { decodeKeeper, encodeKeeper, keeperUrl, nimiqPaymentUri, type KeeperPayload } from '../src/lib/share'
import { miniAppTarget, miniAppUrl, nimiqPayDeepLink } from '../src/lib/deeplink'
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

describe('open in Nimiq Pay links', () => {
  it('uses the bare host for a root deploy and the full URL for a sub-path', () => {
    expect(miniAppTarget({ origin: 'https://holdfast.app', host: 'holdfast.app', pathname: '/' })).toBe('holdfast.app')
    expect(miniAppTarget({ origin: 'https://me.github.io', host: 'me.github.io', pathname: '/Holdfast/index.html' })).toBe('https://me.github.io/Holdfast/')
    expect(miniAppUrl({ origin: 'https://me.github.io', pathname: '/Holdfast/' })).toBe('https://me.github.io/Holdfast/')
  })
  it('keeps : and / literal and encodes everything else', () => {
    expect(nimiqPayDeepLink('holdfast.app')).toBe('nimiqpay://miniapp?url=holdfast.app')
    expect(nimiqPayDeepLink('https://me.github.io/Holdfast/')).toBe('nimiqpay://miniapp?url=https://me.github.io/Holdfast/')
    expect(nimiqPayDeepLink('https://a.b/x?y=1&z=2#h')).toBe('nimiqpay://miniapp?url=https://a.b/x%3Fy%3D1%26z%3D2%23h')
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
    expect(parsePriceResponse({ 'nimiq-2': { usd: 0.001, ngn: 1.6, eur: 0 } })).toEqual({ usd: 0.001, ngn: 1.6, usdt: 0.001 })
    // USDT rate follows the live USDT/USD price when the API provides it
    expect(parsePriceResponse({ 'nimiq-2': { usd: 0.001 }, tether: { usd: 0.8 } })!.usdt).toBeCloseTo(0.00125)
    expect(parsePriceResponse({})).toBeNull()
  })
})
