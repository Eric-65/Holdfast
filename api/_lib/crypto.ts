import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto'
import { blake2b } from '@noble/hashes/blake2b'

const ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVXY'
const SIGNED_PREFIX = '\x16Nimiq Signed Message:\n'
// DER header that turns a raw 32-byte Ed25519 key into an SPKI key Node can import.
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex')

/** Decode hex (with or without 0x) or base64 into bytes; null if neither. */
export function decodeBytes(value: unknown, expectedLength: number): Buffer | null {
  if (typeof value !== 'string') return null
  const s = value.trim().replace(/^0x/i, '')
  let buf: Buffer | null = null
  if (/^[0-9a-f]+$/i.test(s) && s.length === expectedLength * 2) buf = Buffer.from(s, 'hex')
  else if (/^[A-Za-z0-9+/_-]+=*$/.test(s)) buf = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  return buf && buf.length === expectedLength ? buf : null
}

/** Nimiq user-friendly address ("NQ12 3456 ...") for an Ed25519 public key. */
export function addressFromPublicKey(publicKey: Uint8Array): string {
  const raw = blake2b(publicKey, { dkLen: 32 }).subarray(0, 20)
  let bits = ''
  for (const b of raw) bits += b.toString(2).padStart(8, '0')
  let body = ''
  for (let i = 0; i < 160; i += 5) body += ALPHABET[parseInt(bits.slice(i, i + 5), 2)]
  const check = String(98 - mod97(body + 'NQ00')).padStart(2, '0')
  return groupAddress('NQ' + check + body)
}

function mod97(s: string): number {
  let rem = 0
  for (const ch of s) {
    const digits = /[0-9]/.test(ch) ? ch : String(ch.charCodeAt(0) - 55)
    for (const d of digits) rem = (rem * 10 + Number(d)) % 97
  }
  return rem
}

const groupAddress = (compact: string) => compact.replace(/(.{4})/g, '$1 ').trim()

/** Canonical "NQ12 3456 ..." form, or null if the address is malformed or fails its checksum. */
export function normalizeAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const s = value.replace(/\s/g, '').toUpperCase()
  if (!/^NQ\d{2}[0-9A-HJ-NP-VXY]{32}$/.test(s)) return null
  if (mod97(s.slice(4) + s.slice(0, 4)) !== 1) return null
  return groupAddress(s)
}

/**
 * Check a wallet signature over `message`. Nimiq wallets sign
 * sha256(prefix + byteLength + message); a few sign the prefixed or the raw message directly.
 * Every accepted form covers the full message, so accepting all of them is safe.
 */
export function verifySignedMessage(message: string, publicKey: Uint8Array, signature: Uint8Array): boolean {
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI, publicKey]), format: 'der', type: 'spki' })
    const msg = Buffer.from(message, 'utf8')
    const prefixed = Buffer.concat([Buffer.from(SIGNED_PREFIX + String(msg.length), 'utf8'), msg])
    const candidates = [createHash('sha256').update(prefixed).digest(), prefixed, msg]
    return candidates.some((data) => verify(null, data, key, signature))
  } catch {
    return false
  }
}

/** Bytes a Nimiq wallet signs for `message` (used by tests and the local dev wallet). */
export function signedMessageDigest(message: string): Buffer {
  const msg = Buffer.from(message, 'utf8')
  return createHash('sha256')
    .update(Buffer.concat([Buffer.from(SIGNED_PREFIX + String(msg.length), 'utf8'), msg]))
    .digest()
}

export const randomHex = (bytes: number): string => randomBytes(bytes).toString('hex')
export const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex')

/** Short invite code without look-alike characters (no 0/O, 1/I/L). */
export function randomCode(length = 7): string {
  const chars = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += chars[bytes[i]! % chars.length]
  return out
}
