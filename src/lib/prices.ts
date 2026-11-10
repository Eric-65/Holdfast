import { config } from './config'

export type Rates = Record<string, number> & { at?: never }
export interface PriceState {
  rates: Record<string, number>
  updatedAt: number
  stale: boolean
}

const CACHE_KEY = 'holdfast.prices.v2'
const MAX_AGE = 5 * 60_000

function readCache(): PriceState | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as PriceState
    return p && typeof p.updatedAt === 'number' && p.rates ? p : null
  } catch {
    return null
  }
}

export function parsePriceResponse(json: unknown): Record<string, number> | null {
  const entry = (json as Record<string, Record<string, unknown>> | null)?.['nimiq-2']
  if (!entry) return null
  const rates: Record<string, number> = {}
  for (const [k, v] of Object.entries(entry)) if (typeof v === 'number' && v > 0) rates[k.toLowerCase()] = v
  // The price API quotes in US dollars, not USDT. Convert with the live USDT/USD rate
  // (1:1 if that is missing, which is within a fraction of a percent).
  if (rates.usd) {
    const tetherUsd = (json as Record<string, Record<string, unknown>>).tether?.usd
    rates.usdt = rates.usd / (typeof tetherUsd === 'number' && tetherUsd > 0 ? tetherUsd : 1)
  }
  return Object.keys(rates).length ? rates : null
}

/** NIM price in USDT and fiat. Falls back to the last cached value (marked stale) when offline. */
export async function getPrices(): Promise<PriceState | null> {
  const cached = readCache()
  if (cached && Date.now() - cached.updatedAt < MAX_AGE) return { ...cached, stale: false }
  try {
    const res = await fetch(config.priceApiUrl, { headers: { Accept: 'application/json' } })
    const rates = res.ok ? parsePriceResponse(await res.json()) : null
    if (rates) {
      const state = { rates, updatedAt: Date.now(), stale: false }
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(state))
      } catch {
        /* storage may be unavailable */
      }
      return state
    }
  } catch {
    /* fall through to cache */
  }
  return cached ? { ...cached, stale: true } : null
}
