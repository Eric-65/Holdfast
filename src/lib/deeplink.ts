/**
 * Links that open this Mini App directly inside the Nimiq Pay wallet.
 * Format from the Nimiq Mini Apps docs: nimiqpay://miniapp?url=your-app.com
 */

type Loc = Pick<Location, 'origin' | 'host' | 'pathname'>
const basePath = (loc: Pick<Location, 'pathname'>) => loc.pathname.replace(/index\.html$/, '') || '/'

/**
 * A profile's invite link. On a root deploy it is the short /i/CODE form (the host redirects it
 * to ?ref=CODE); it has no query string or fragment, so it survives being passed through
 * Nimiq Pay's deep link. Sub-path deploys fall back to ?ref=CODE.
 */
export function inviteUrl(code: string, loc: Loc = location): string {
  const path = basePath(loc)
  return path === '/' ? `${loc.origin}/i/${code}` : `${loc.origin}${path}?ref=${code}`
}

/** Where Nimiq Pay should load the app from: bare host for a root deploy, else the full URL. */
export function miniAppTarget(loc: Loc = location, inviteCode: string | null = null): string {
  if (inviteCode) return inviteUrl(inviteCode, loc)
  const path = basePath(loc)
  return path === '/' ? loc.host : `${loc.origin}${path}`
}

/** `:` and `/` must stay literal in the url value; everything else is percent-encoded. */
export function nimiqPayDeepLink(target: string = miniAppTarget()): string {
  const encoded = encodeURIComponent(target).replace(/%3A/gi, ':').replace(/%2F/gi, '/')
  return `nimiqpay://miniapp?url=${encoded}`
}

/** The address a user pastes into Nimiq Pay > Mini Apps > Custom URL. */
export function miniAppUrl(loc: Loc = location, inviteCode: string | null = null): string {
  return inviteCode ? inviteUrl(inviteCode, loc) : `${loc.origin}${basePath(loc)}`
}

export const NIMIQ_PAY_INSTALL_URL = 'https://nimiq.com/nimiq-pay'

export const isMobileDevice = (ua: string = navigator.userAgent): boolean => /Android|iPhone|iPad|iPod/i.test(ua)
