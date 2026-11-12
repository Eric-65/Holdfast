/**
 * Small pieces of identity kept on this device: an anonymous browser ID, the invite code the
 * visitor arrived with, and the sign-in session for each wallet.
 */
const BROWSER_ID_KEY = 'holdfast.bid'
const BROWSER_ID_COOKIE = 'hf_bid'
const REF_KEY = 'holdfast.ref'
const SESSION_PREFIX = 'holdfast.session.'
const WELCOMED_PREFIX = 'holdfast.welcomed.'

const compact = (address: string) => address.replace(/\s/g, '').toUpperCase()

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function lsSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* storage unavailable */
  }
}

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return m ? decodeURIComponent(m[1]!) : null
}
function writeCookie(name: string, value: string): void {
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${365 * 24 * 3600}; Path=/; SameSite=Lax${secure}`
}

const validBrowserId = (v: string | null): v is string => !!v && /^[A-Za-z0-9-]{16,64}$/.test(v)

/**
 * Random, anonymous ID for this browser. Kept in both a cookie and localStorage so it survives
 * if one of them is cleared. It carries no personal data.
 */
export function browserId(): string {
  let id = [lsGet(BROWSER_ID_KEY), readCookie(BROWSER_ID_COOKIE)].find(validBrowserId)
  if (!id) {
    id =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
  }
  lsSet(BROWSER_ID_KEY, id)
  writeCookie(BROWSER_ID_COOKIE, id)
  return id
}

export const cleanInviteCode = (v: string | null | undefined): string | null =>
  v && /^[A-Za-z0-9]{5,12}$/.test(v) ? v.toUpperCase() : null

/** Remember the invite code from ?ref=CODE and tidy it out of the address bar. */
export function captureInviteCode(loc: Location = location): string | null {
  const params = new URLSearchParams(loc.search)
  const code = cleanInviteCode(params.get('ref'))
  if (params.has('ref')) {
    params.delete('ref')
    const query = params.toString()
    history.replaceState(null, '', loc.pathname + (query ? `?${query}` : '') + loc.hash)
  }
  if (code) lsSet(REF_KEY, code)
  return code
}

/** Read an invite code from what someone typed or pasted: a bare code or a whole invite link. */
export function parseInviteInput(text: string): string | null {
  const t = text.trim()
  // Works on a link inside a longer pasted message too ("Join me: https://... see you").
  const fromLink = /\/i\/([A-Za-z0-9]{5,12})(?![A-Za-z0-9])/.exec(t)?.[1] ?? /[?&]ref=([A-Za-z0-9]{5,12})(?![A-Za-z0-9])/.exec(t)?.[1]
  return cleanInviteCode(fromLink ?? t)
}

export const setInviteCode = (code: string): void => lsSet(REF_KEY, code)
export const pendingInviteCode = (): string | null => cleanInviteCode(lsGet(REF_KEY))
export const clearInviteCode = (): void => lsSet(REF_KEY, null)

export const sessionToken = (address: string): string | null => lsGet(SESSION_PREFIX + compact(address))
export const setSessionToken = (address: string, token: string | null): void => lsSet(SESSION_PREFIX + compact(address), token)

export const wasWelcomed = (address: string): boolean => lsGet(WELCOMED_PREFIX + compact(address)) === '1'
export const markWelcomed = (address: string): void => lsSet(WELCOMED_PREFIX + compact(address), '1')
