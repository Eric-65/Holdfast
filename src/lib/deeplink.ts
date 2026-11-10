/**
 * Links that open this Mini App directly inside the Nimiq Pay wallet.
 * Format from the Nimiq Mini Apps docs: nimiqpay://miniapp?url=your-app.com
 */

/** Where Nimiq Pay should load the app from: bare host for a root deploy, else the full URL. */
export function miniAppTarget(loc: Pick<Location, 'origin' | 'host' | 'pathname'> = location): string {
  const path = loc.pathname.replace(/index\.html$/, '')
  return path === '/' || path === '' ? loc.host : `${loc.origin}${path}`
}

/** `:` and `/` must stay literal in the url value; everything else is percent-encoded. */
export function nimiqPayDeepLink(target: string = miniAppTarget()): string {
  const encoded = encodeURIComponent(target).replace(/%3A/gi, ':').replace(/%2F/gi, '/')
  return `nimiqpay://miniapp?url=${encoded}`
}

/** The address a user pastes into Nimiq Pay > Mini Apps > Custom URL. */
export function miniAppUrl(loc: Pick<Location, 'origin' | 'pathname'> = location): string {
  return `${loc.origin}${loc.pathname.replace(/index\.html$/, '')}`
}

export const NIMIQ_PAY_INSTALL_URL = 'https://nimiq.com/nimiq-pay'

export const isMobileDevice = (ua: string = navigator.userAgent): boolean => /Android|iPhone|iPad|iPod/i.test(ua)
