/**
 * Goalkeeper links carry everything a friend needs in the URL fragment (never sent to a
 * server): goal name, target, the saver's public address, the baseline stake and a signed-off
 * snapshot. With an RPC configured the friend's view goes live from chain data.
 */
export interface KeeperPayload {
  v: 1
  /** goal name */
  n: string
  /** emoji */
  e: string
  /** target, luna */
  t: number
  /** saver address (public) */
  a: string
  /** baseline stake, luna */
  b: number
  /** goal created at (ms) */
  c: number
  /** saved snapshot, luna */
  s: number
  /** snapshot time (ms) */
  st: number
  /** seal broken at (ms), if any */
  x?: number
  /** saver display name (optional) */
  w?: string
}

function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function encodeKeeper(p: KeeperPayload): string {
  return toBase64Url(JSON.stringify(p))
}

export function decodeKeeper(s: string): KeeperPayload | null {
  try {
    const p = JSON.parse(fromBase64Url(s)) as KeeperPayload
    const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0
    if (p?.v !== 1 || typeof p.n !== 'string' || typeof p.a !== 'string') return null
    if (!num(p.t) || !num(p.b) || !num(p.c) || !num(p.s) || !num(p.st)) return null
    if (p.x !== undefined && !num(p.x)) return null
    return {
      v: 1,
      n: p.n.slice(0, 40),
      e: typeof p.e === 'string' ? [...p.e].slice(0, 2).join('') : '🎯',
      t: p.t,
      a: p.a,
      b: p.b,
      c: p.c,
      s: p.s,
      st: p.st,
      ...(p.x ? { x: p.x } : {}),
      ...(typeof p.w === 'string' && p.w ? { w: p.w.slice(0, 24) } : {}),
    }
  } catch {
    return null
  }
}

export function keeperUrl(base: string, p: KeeperPayload): string {
  const clean = base.split('#')[0]
  return `${clean}#/keep/${encodeKeeper(p)}`
}

/** Nimiq payment request URI (opens a wallet outside Nimiq Pay). */
export function nimiqPaymentUri(address: string, nim: number, message: string): string {
  const params = new URLSearchParams()
  if (nim > 0) params.set('amount', String(nim))
  if (message) params.set('message', message)
  const q = params.toString()
  return `nimiq:${address.replace(/\s/g, '')}${q ? `?${q}` : ''}`
}
