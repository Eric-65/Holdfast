import { timingSafeEqual, createHash } from 'node:crypto'
import { ApiError, rateLimit, type RequestContext } from './core.js'

/**
 * Error reports from the app, so problems people hit are visible to the builder. Each report keeps
 * only the message, the screen, the app version and the time: never a wallet address or an IP.
 */
const KEY = 'reports'
const MAX_REPORTS = 300

export interface ErrorReport {
  message: string
  screen: string
  version: string
  at: number
}

/** Wallet addresses (with or without spaces) are replaced, so a report can't identify anyone. */
export const scrubAddresses = (text: string): string => text.replace(/NQ\d{2}(?:\s?[0-9A-HJ-NP-VXY]{4}){8}/gi, 'NQ…')

/** Only the route, without goal ids or Goalkeeper link contents. */
export function cleanScreen(value: unknown): string {
  const s = typeof value === 'string' ? value : ''
  const route = s.replace(/^#?\/?/, '').split(/[/?]/)[0] ?? ''
  return /^[a-z]{1,12}$/.test(route) ? `#/${route}` : '#/'
}

const text = (value: unknown, max: number): string =>
  scrubAddresses(typeof value === 'string' ? value : '')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

export async function saveReport(ctx: RequestContext, body: Record<string, unknown>): Promise<{ ok: true }> {
  await rateLimit(ctx, `report:${ctx.ipKey}`, 20, 600)
  const message = text(body.message, 300)
  if (!message) throw new ApiError(400, 'bad_report', 'Report is empty.')
  const report: ErrorReport = {
    message,
    screen: cleanScreen(body.screen),
    version: text(body.version, 40).replace(/[^\w.+-]/g, '') || 'unknown',
    at: ctx.now,
  }
  await ctx.store.pipeline([
    ['LPUSH', KEY, JSON.stringify(report)],
    ['LTRIM', KEY, 0, MAX_REPORTS - 1],
  ])
  return { ok: true }
}

/** True when `given` matches the HF_ADMIN_TOKEN setting (compared in constant time). */
export function isAdmin(given: string | null | undefined, adminToken: string | undefined): boolean {
  if (!adminToken || adminToken.length < 16 || !given) return false
  const h = (s: string) => createHash('sha256').update(s).digest()
  return timingSafeEqual(h(given), h(adminToken))
}

export async function listReports(ctx: RequestContext): Promise<{ count: number; reports: ErrorReport[] }> {
  const raw = await ctx.store.cmd<string[]>('LRANGE', KEY, 0, MAX_REPORTS - 1)
  const reports = (Array.isArray(raw) ? raw : []).flatMap((r) => {
    try {
      return [JSON.parse(r) as ErrorReport]
    } catch {
      return []
    }
  })
  return { count: reports.length, reports }
}
