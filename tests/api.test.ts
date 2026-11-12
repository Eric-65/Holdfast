// @vitest-environment node
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError, authenticate, cleanName, createChallenge, inviteInfo, leaderboard, login, ownProfile, setName, type RequestContext } from '../api/_lib/core'
import { addressFromPublicKey, decodeBytes, normalizeAddress, signedMessageDigest, verifySignedMessage } from '../api/_lib/crypto'
import { MemoryStore } from '../api/_lib/store'

interface TestWallet {
  privateKey: KeyObject
  publicKey: Buffer
  address: string
}
function makeWallet(): TestWallet {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)
  return { privateKey, publicKey: Buffer.from(raw), address: addressFromPublicKey(raw) }
}
/** Sign the way a Nimiq wallet does: Ed25519 over sha256(prefix + length + message). */
const walletSign = (w: TestWallet, message: string) => sign(null, signedMessageDigest(message), w.privateKey)

let store: MemoryStore
let now: number
const ctx = (over: Partial<RequestContext> = {}): RequestContext => ({
  store,
  now,
  country: 'NG',
  ipKey: 'ip-' + Math.random().toString(36).slice(2),
  requireUniqueDevice: false,
  ...over,
})
const device = (n: number) => n.toString(16).padStart(64, '0')

async function join(w: TestWallet, extra: Record<string, unknown> = {}, over: Partial<RequestContext> = {}) {
  const { message } = await createChallenge(ctx(over), { address: w.address })
  return login(ctx(over), {
    message,
    publicKey: w.publicKey.toString('hex'),
    signature: walletSign(w, message).toString('hex'),
    browserId: 'browser-' + w.address.replace(/\s/g, '').slice(-12),
    ...extra,
  })
}

beforeEach(() => {
  store = new MemoryStore()
  now = Date.UTC(2026, 10, 11, 12)
  store.now = () => now
})

describe('crypto', () => {
  it('derives the same addresses as the official Nimiq library', () => {
    // Vectors produced with @nimiq/core (PublicKey.toAddress().toUserFriendlyAddress()).
    expect(addressFromPublicKey(Buffer.from('d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737', 'hex'))).toBe(
      'NQ21 SEXP BY6P CVJG 8RQX UVFR BQFD FBD6 S5LD',
    )
    expect(addressFromPublicKey(Buffer.from('3ee2a8a7283cb2fd728943daa127ef09e483071a8b4bc699ba4522f09b14cfde', 'hex'))).toBe(
      'NQ51 QDUJ BNUY VSYK 1V6H 9J9T PMA9 CDYX TQ34',
    )
  })
  it('normalizes and checksums addresses', () => {
    expect(normalizeAddress('nq21sexpby6pcvjg8rqxuvfrbqfdfbd6s5ld')).toBe('NQ21 SEXP BY6P CVJG 8RQX UVFR BQFD FBD6 S5LD')
    expect(normalizeAddress('NQ22 SEXP BY6P CVJG 8RQX UVFR BQFD FBD6 S5LD')).toBeNull()
    expect(normalizeAddress(42)).toBeNull()
  })
  it('verifies wallet signatures and rejects tampering', () => {
    const w = makeWallet()
    const sig = walletSign(w, 'hello')
    expect(verifySignedMessage('hello', w.publicKey, sig)).toBe(true)
    expect(verifySignedMessage('hello!', w.publicKey, sig)).toBe(false)
    expect(verifySignedMessage('hello', makeWallet().publicKey, sig)).toBe(false)
    expect(verifySignedMessage('hello', Buffer.alloc(5), sig)).toBe(false)
  })
  it('decodes hex and base64 keys', () => {
    const w = makeWallet()
    expect(decodeBytes('0x' + w.publicKey.toString('hex'), 32)).toEqual(w.publicKey)
    expect(decodeBytes(w.publicKey.toString('base64'), 32)).toEqual(w.publicKey)
    expect(decodeBytes('zz', 32)).toBeNull()
  })
})

describe('sign-in', () => {
  it('creates a profile with a name, invite code and session on first sign-in', async () => {
    const w = makeWallet()
    const r = await join(w, { deviceId: device(1) })
    expect(r.isNew).toBe(true)
    expect(r.profile.fullAddress).toBe(w.address)
    expect(r.profile.name).toBe(`Saver ${w.address.replace(/\s/g, '').slice(-4)}`)
    expect(r.profile.code).toMatch(/^[2-9A-Z]{7}$/)
    expect(r.profile.rank).toBe(1)
    expect(await authenticate(ctx(), `Bearer ${r.token}`)).toBe(w.address)
  })

  it('stores the evidence that the user is real and unique', async () => {
    const w = makeWallet()
    await join(w, { deviceId: device(7) })
    const raw = (await store.cmd<string[]>('HGETALL', `u:${w.address.replace(/\s/g, '')}`)) as string[]
    const user = Object.fromEntries(raw.reduce<[string, string][]>((a, v, i) => (i % 2 ? a : [...a, [v, raw[i + 1]!]]), []))
    expect(user.publicKey).toBe(w.publicKey.toString('hex'))
    expect(user.proofSignature).toHaveLength(128)
    expect(user.proofMessage).toContain(w.address)
    expect(user.deviceId).toBe(device(7))
    expect(user.browserId).toMatch(/^browser-/)
    expect(user.country).toBe('NG')
    expect(Number(user.createdAt)).toBe(now)
    expect(Number(user.lastSeenAt)).toBe(now)
    // No raw IP address is kept anywhere on the profile.
    expect(Object.keys(user).some((k) => /ip/i.test(k) && k !== 'claimedAddress')).toBe(false)
  })

  it('keeps the same profile when the wallet signs in again', async () => {
    const w = makeWallet()
    const first = await join(w)
    now += 60_000
    const second = await join(w)
    expect(second.isNew).toBe(false)
    expect(second.profile.code).toBe(first.profile.code)
    expect(second.profile.joinedAt).toBe(first.profile.joinedAt)
    expect((await leaderboard(ctx())).total).toBe(1)
  })

  it('rejects forged, replayed and expired sign-ins', async () => {
    const w = makeWallet()
    const attacker = makeWallet()
    const { message } = await createChallenge(ctx(), { address: w.address })
    const good = { message, publicKey: w.publicKey.toString('hex'), signature: walletSign(w, message).toString('hex') }

    // Wrong key signing a challenge issued for someone else still only proves the attacker's own wallet.
    const forged = await login(ctx(), { ...good, publicKey: attacker.publicKey.toString('hex'), signature: walletSign(attacker, message).toString('hex') })
    expect(forged.profile.fullAddress).toBe(attacker.address)
    // That challenge is now used up, so the original cannot be replayed.
    await expect(login(ctx(), good)).rejects.toMatchObject({ code: 'challenge_expired' })

    const c2 = await createChallenge(ctx(), { address: w.address })
    await expect(
      login(ctx(), { message: c2.message, publicKey: w.publicKey.toString('hex'), signature: walletSign(attacker, c2.message).toString('hex') }),
    ).rejects.toMatchObject({ code: 'bad_signature' })

    const c3 = await createChallenge(ctx(), { address: w.address })
    now += 6 * 60_000
    await expect(
      login(ctx(), { message: c3.message, publicKey: w.publicKey.toString('hex'), signature: walletSign(w, c3.message).toString('hex') }),
    ).rejects.toMatchObject({ code: 'challenge_expired' })

    await expect(login(ctx(), { message: 'Holdfast sign-in. made up', publicKey: 'aa', signature: 'bb' })).rejects.toBeInstanceOf(ApiError)
    await expect(authenticate(ctx(), 'Bearer ' + 'a'.repeat(64))).rejects.toMatchObject({ status: 401 })
    await expect(createChallenge(ctx(), { address: 'NQ00 nope' })).rejects.toMatchObject({ code: 'bad_address' })
  })

  it('rate-limits sign-in attempts per caller', async () => {
    const w = makeWallet()
    const same = { ipKey: 'one-caller' }
    for (let i = 0; i < 60; i++) await createChallenge(ctx(same), { address: w.address })
    await expect(createChallenge(ctx(same), { address: w.address })).rejects.toMatchObject({ status: 429 })
  })
})

describe('referrals and leaderboard', () => {
  it('counts each new wallet that joins through an invite link, once', async () => {
    const alice = makeWallet()
    const a = await join(alice, { deviceId: device(1) })
    const bob = makeWallet()
    const carol = makeWallet()
    now += 1000
    const b = await join(bob, { ref: a.profile.code.toLowerCase(), deviceId: device(2) })
    now += 1000
    await join(carol, { ref: a.profile.code, deviceId: device(3) })
    expect(b.referralCounted).toBe(true)
    expect(b.profile.referredBy).toBe(a.profile.name)

    // Signing in again, with or without the code, never counts twice.
    now += 1000
    expect((await join(bob, { ref: a.profile.code })).referralCounted).toBe(false)

    const me = await ownProfile(ctx(), alice.address)
    expect(me.referrals).toBe(2)
    expect(me.rank).toBe(1)
    expect(me.referralList.map((r) => r.address)).toEqual([carol, bob].map((w) => `${w.address.slice(0, 9)}…${w.address.slice(-4)}`))
    expect(me.referralList[1]!.joinedAt).toBe(b.profile.joinedAt)
  })

  it('ignores self-referrals, unknown codes and codes used after joining', async () => {
    const alice = makeWallet()
    const a = await join(alice)
    const bob = makeWallet()
    await join(bob, { ref: 'NOSUCHCODE' })
    await join(bob, { ref: a.profile.code }) // already a member: too late
    const b = await ownProfile(ctx(), bob.address)
    await join(alice, { ref: b.code })
    expect((await ownProfile(ctx(), alice.address)).referrals).toBe(0)
    expect(b.referrals).toBe(0)
    expect(b.referredBy).toBeNull()
  })

  it('flags wallets sharing a device, and can refuse to count them', async () => {
    const alice = makeWallet()
    const a = await join(alice, { deviceId: device(1) })
    const sock = makeWallet()
    const counted = await join(sock, { ref: a.profile.code, deviceId: device(1) })
    expect(counted.referralCounted).toBe(true)
    expect(await store.cmd('HGET', `u:${sock.address.replace(/\s/g, '')}`, 'referralStatus')).toBe('counted_shared_device')

    const sock2 = makeWallet()
    const strict = await join(sock2, { ref: a.profile.code, deviceId: device(1) }, { requireUniqueDevice: true })
    expect(strict.referralCounted).toBe(false)
    expect(await store.cmd('HGET', `u:${sock2.address.replace(/\s/g, '')}`, 'referralStatus')).toBe('not_counted_duplicate_device')
    expect((await ownProfile(ctx(), alice.address)).referrals).toBe(1)
  })

  it('ranks profiles by referrals', async () => {
    const [a, b, c] = [makeWallet(), makeWallet(), makeWallet()]
    const pa = await join(a)
    const pb = await join(b)
    await join(c, { ref: pb.profile.code })
    await join(makeWallet(), { ref: pb.profile.code })
    await join(makeWallet(), { ref: pa.profile.code })
    await setName(ctx(), b.address, { name: '  Queen   B ' })
    const board = await leaderboard(ctx())
    expect(board.total).toBe(5)
    expect(board.top.slice(0, 2).map((r) => [r.rank, r.name, r.referrals])).toEqual([
      [1, 'Queen B', 2],
      [2, pa.profile.name, 1],
    ])
    expect(board.top[0]!.address).not.toContain(b.address.slice(12, 30)) // shortened in public output
    expect((await ownProfile(ctx(), a.address)).rank).toBe(2)
  })

  it('resolves invite codes to the inviter name', async () => {
    const a = await join(makeWallet())
    expect(await inviteInfo(ctx(), a.profile.code.toLowerCase())).toEqual({ code: a.profile.code, name: a.profile.name })
    await expect(inviteInfo(ctx(), 'ZZZZZZZ')).rejects.toMatchObject({ status: 404 })
    await expect(inviteInfo(ctx(), '<script>')).rejects.toMatchObject({ status: 404 })
  })
})

describe('display names', () => {
  it('cleans and validates names', () => {
    expect(cleanName('  Ada   Lovelace ')).toBe('Ada Lovelace')
    expect(cleanName('Chị Mai 🎯')).toBe('Chị Mai 🎯')
    expect(cleanName('a')).toBeNull()
    expect(cleanName('x'.repeat(25))).toBeNull()
    expect(cleanName('ab​\u0000')).toBe('ab')
    expect(cleanName(null)).toBeNull()
  })
  it('lets a signed-in wallet rename itself, with a limit', async () => {
    const w = makeWallet()
    await join(w)
    expect((await setName(ctx(), w.address, { name: 'Holder' })).name).toBe('Holder')
    await expect(setName(ctx(), w.address, { name: '' })).rejects.toMatchObject({ code: 'bad_name' })
    for (let i = 0; i < 9; i++) await setName(ctx(), w.address, { name: `Holder ${i}` })
    await expect(setName(ctx(), w.address, { name: 'Once more' })).rejects.toMatchObject({ status: 429 })
  })
})
