import { describe, expect, it } from 'vitest'
import { formatAddress, formatFiat, formatNim, isValidAddress, parseNimInput, pct, toLuna } from '../src/lib/format'

describe('parseNimInput', () => {
  it('parses plain and grouped numbers into luna', () => {
    expect(parseNimInput('1')).toBe(100_000)
    expect(parseNimInput('1,250.5')).toBe(125_050_000)
    expect(parseNimInput(' 12,5 ')).toBe(1_250_000)
    expect(parseNimInput('0.00001')).toBe(1)
  })
  it('rejects invalid, zero and over-precise input', () => {
    for (const bad of ['', 'abc', '0', '-5', '1.000001', '1e5']) expect(parseNimInput(bad)).toBeNull()
  })
})

describe('formatting', () => {
  it('formats NIM and fiat', () => {
    expect(formatNim(toLuna(1234.567))).toBe('1,235')
    expect(formatNim(toLuna(12.345))).toBe('12.35')
    expect(formatFiat(1234.5, 'usd')).toBe('$1,234.50')
    expect(formatFiat(1234.5, 'usdt')).toBe('1,234.50 USDT')
    expect(formatFiat(0.6, 'USDT')).toBe('0.60 USDT')
    expect(formatFiat(5000, 'NGN')).toBe('₦5,000.00')
  })
  it('clamps percentages', () => {
    expect(pct(50, 100)).toBe(50)
    expect(pct(150, 100)).toBe(100)
    expect(pct(5, 0)).toBe(0)
  })
})

describe('addresses', () => {
  it('validates Nimiq address checksums', () => {
    expect(isValidAddress('NQ07 0000 0000 0000 0000 0000 0000 0000 0000')).toBe(true)
    expect(isValidAddress('nq0700000000000000000000000000000000')).toBe(true)
    expect(isValidAddress('NQ08 0000 0000 0000 0000 0000 0000 0000 0000')).toBe(false)
    expect(isValidAddress('NQ07 0000')).toBe(false)
  })
  it('groups addresses', () => {
    expect(formatAddress('nq0700000000000000000000000000000000')).toBe('NQ07 0000 0000 0000 0000 0000 0000 0000 0000')
  })
})
