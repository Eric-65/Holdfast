import { addressFromPublicKey, decodeBytes, normalizeAddress, randomCode, randomHex, sha256Hex, verifySignedMessage } from './crypto.js'
import type { Command, Store } from './store.js'

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

export interface RequestContext {
  store: Store
  now: number
  /** Two-letter country from the hosting platform's geo header, if any. */
  country: string | null
  /** Hash of the caller's IP. Used only for short-lived rate-limit counters, never stored on a profile. */
  ipKey: string
  /**
   * Hash of the caller's network (IPv4 address or IPv6 /64). Kept for 30 minutes next to an
   * opened invite link, so the invite survives the jump from a browser into Nimiq Pay.
   */
  netKey: string
  /** When true, a new wallet on an already-seen device or browser does not count as a referral. */
  requireUniqueDevice: boolean
}

export interface PublicProfile {
  name: string
  address: string
  code: string
  referrals: number
  joinedAt: number
}

export interface OwnProfile extends PublicProfile {
  fullAddress: string
  rank: number | null
  referredBy: string | null
  /** True while this profile may still name its inviter (none recorded, and it joined recently). */
  canClaimInvite: boolean
  referralList: { name: string; address: string; joinedAt: number }[]
}

const CHALLENGE_TTL_S = 300
const SESSION_TTL_S = 30 * 24 * 3600
const NAME_MIN = 2
const NAME_MAX = 24
const LEADERBOARD_SIZE = 50
const REFERRAL_LIST_SIZE = 100
/** How long an opened invite link is remembered for the same network. */
const CLICK_TTL_S = 30 * 60
/** A profile created without an inviter can still name one for this long. */
const CLAIM_WINDOW_MS = 7 * 24 * 3600 * 1000
const AMBIGUOUS = '*'

const userKey = (address: string) => `u:${address.replace(/\s/g, '')}`
export const shortAddress = (address: string) => `${address.slice(0, 9)}…${address.slice(-4)}`
const defaultName = (address: string) => `Saver ${address.replace(/\s/g, '').slice(-4)}`

async function rateLimit(ctx: RequestContext, bucket: string, limit: number, windowS: number): Promise<void> {
  const key = `rl:${bucket}:${Math.floor(ctx.now / (windowS * 1000))}`
  const [count] = await ctx.store.pipeline([
    ['INCR', key],
    ['EXPIRE', key, windowS * 2],
  ])
  if (Number(count) > limit) throw new ApiError(429, 'rate_limited', 'Too many requests. Please try again in a few minutes.')
}

/** Display names: 2-24 visible characters, no control or invisible characters, single spaces. */
export function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  const length = [...name].length
  return length >= NAME_MIN && length <= NAME_MAX ? name : null
}

export const cleanCode = (value: unknown): string | null =>
  typeof value === 'string' && /^[A-Za-z0-9]{5,12}$/.test(value.trim()) ? value.trim().toUpperCase() : null
const cleanDeviceId = (v: unknown) => (typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v) ? v.toLowerCase() : null)
const cleanBrowserId = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(v) ? v : null)

// ---------- Sign-in ----------

export function challengeMessage(address: string, nonce: string, now: number): string {
  return `Holdfast sign-in. Free: moves no NIM.\nWallet: ${address}\nNonce: ${nonce}\nTime: ${new Date(now).toISOString().slice(0, 19)}Z`
}

export async function createChallenge(ctx: RequestContext, body: { address?: unknown }): Promise<{ message: string }> {
  const address = normalizeAddress(body.address)
  if (!address) throw new ApiError(400, 'bad_address', 'That is not a valid Nimiq address.')
  // Mobile carriers put many phones behind one IP, so the per-IP limits are generous.
  await rateLimit(ctx, `ch:${ctx.ipKey}`, 60, 300)
  const nonce = randomHex(16)
  await ctx.store.cmd('SET', `nonce:${nonce}`, address, 'EX', CHALLENGE_TTL_S)
  return { message: challengeMessage(address, nonce, ctx.now) }
}

export interface LoginBody {
  message?: unknown
  publicKey?: unknown
  signature?: unknown
  browserId?: unknown
  deviceId?: unknown
  ref?: unknown
}

export interface LoginResult {
  token: string
  isNew: boolean
  referralCounted: boolean
  profile: OwnProfile
}

export async function login(ctx: RequestContext, body: LoginBody): Promise<LoginResult> {
  await rateLimit(ctx, `login:${ctx.ipKey}`, 60, 300)
  const message = typeof body.message === 'string' && body.message.length <= 400 ? body.message : null
  const publicKey = decodeBytes(body.publicKey, 32)
  const signature = decodeBytes(body.signature, 64)
  if (!message || !publicKey || !signature) throw new ApiError(400, 'bad_request', 'Missing or malformed sign-in data.')

  // The message must be one this server issued, unused and unexpired.
  const nonce = /^Nonce: ([0-9a-f]{32})$/m.exec(message)?.[1]
  const claimed = nonce ? await ctx.store.cmd<string | null>('GETDEL', `nonce:${nonce}`) : null
  if (!nonce || !claimed || !message.startsWith('Holdfast sign-in.') || !message.includes(`\nWallet: ${claimed}\n`))
    throw new ApiError(400, 'challenge_expired', 'That sign-in request expired. Please try again.')
  if (!verifySignedMessage(message, publicKey, signature))
    throw new ApiError(401, 'bad_signature', 'The wallet signature could not be verified.')

  // Identity is the address derived from the key that actually signed, never a claimed one.
  const address = addressFromPublicKey(publicKey)
  const key = userKey(address)
  const deviceId = cleanDeviceId(body.deviceId)
  const browserId = cleanBrowserId(body.browserId)
  const isNew = (await ctx.store.cmd<number>('HSETNX', key, 'createdAt', ctx.now)) === 1

  // Evidence of uniqueness: which wallets have been seen on this device and browser.
  const seen = await ctx.store.pipeline([
    ...(deviceId ? ([['SADD', `dev:${deviceId}`, address], ['SCARD', `dev:${deviceId}`]] as Command[]) : []),
    ...(browserId ? ([['SADD', `bid:${browserId}`, address], ['SCARD', `bid:${browserId}`]] as Command[]) : []),
  ])
  const walletsOnDevice = deviceId ? Number(seen[1]) : 0
  const walletsOnBrowser = browserId ? Number(seen[deviceId ? 3 : 1]) : 0

  let referralCounted = false
  if (isNew) {
    let code = ''
    for (let i = 0; i < 6 && !code; i++) {
      const candidate = randomCode(i < 4 ? 7 : 9)
      if ((await ctx.store.cmd('SET', `code:${candidate}`, address, 'NX')) === 'OK') code = candidate
    }
    if (!code) throw new ApiError(500, 'code_failed', 'Could not create an invite code. Please try again.')

    const fields: Record<string, string | number> = {
      address,
      name: defaultName(address),
      code,
      country: ctx.country ?? '',
      publicKey: publicKey.toString('hex'),
      proofMessage: message,
      proofSignature: signature.toString('hex'),
      claimedAddress: claimed,
      deviceId: deviceId ?? '',
      browserId: browserId ?? '',
      walletsOnDeviceAtSignup: walletsOnDevice,
      walletsOnBrowserAtSignup: walletsOnBrowser,
    }

    // Who invited this wallet? First the code the app sent (from the link or typed in). If the
    // code was lost on the way into Nimiq Pay, fall back to an invite link opened from the same
    // network in the last 30 minutes, but only when exactly one inviter's link was opened there.
    let refCode = cleanCode(body.ref)
    let source = 'code'
    let referrer = refCode ? await ctx.store.cmd<string | null>('GET', `code:${refCode}`) : null
    if (refCode) fields.refCodeUsed = refCode
    if (!referrer) {
      const clicked = await ctx.store.cmd<string | null>('GET', `click:${ctx.netKey}`)
      if (clicked && clicked !== AMBIGUOUS) {
        refCode = clicked
        source = 'network_match'
        referrer = await ctx.store.cmd<string | null>('GET', `code:${clicked}`)
      }
    }
    const credit = referrer && referrer !== address ? referralFields(ctx, referrer, source, walletsOnDevice, walletsOnBrowser) : null
    if (credit) Object.assign(fields, credit.fields)
    referralCounted = !!credit?.counted
    await ctx.store.pipeline([
      ['HSET', key, ...Object.entries(fields).flat()],
      ['ZADD', 'lb', 'NX', 0, address],
      ['INCR', 'stats:users'],
      ...(referralCounted ? creditCommands(ctx, referrer!, address) : []),
    ])
  }

  const token = randomHex(32)
  await ctx.store.pipeline([
    ['HSET', key, 'lastSeenAt', ctx.now, 'lastCountry', ctx.country ?? '', 'lastDeviceId', deviceId ?? '', 'lastBrowserId', browserId ?? ''],
    ['HINCRBY', key, 'logins', 1],
    ['SET', `sess:${sha256Hex(token)}`, address, 'EX', SESSION_TTL_S],
  ])
  return { token, isNew, referralCounted, profile: await ownProfile(ctx, address) }
}

/** What to record on the invited profile, and whether the referral counts. */
function referralFields(ctx: RequestContext, referrer: string, source: string, walletsOnDevice: number, walletsOnBrowser: number) {
  const duplicate = walletsOnDevice > 1 || walletsOnBrowser > 1
  const counted = !(duplicate && ctx.requireUniqueDevice)
  return {
    counted,
    fields: {
      referredBy: referrer,
      referralSource: source,
      referredAt: ctx.now,
      referralStatus: counted ? (duplicate ? 'counted_shared_device' : 'counted') : 'not_counted_duplicate_device',
    } as Record<string, string | number>,
  }
}

/** Add the invited wallet to the inviter's list and raise the inviter's leaderboard score by one. */
const creditCommands = (ctx: RequestContext, referrer: string, invited: string): Command[] => [
  ['ZADD', `refs:${referrer}`, ctx.now, invited],
  ['ZINCRBY', 'lb', 1, referrer],
]

/**
 * A profile that joined without an inviter (for example because the invite code was lost on the
 * way into Nimiq Pay) can name one, once, within a week of joining. The wallet still counts for
 * one inviter only, and two profiles cannot invite each other.
 */
export async function claimInvite(ctx: RequestContext, address: string, body: { code?: unknown }): Promise<{ profile: OwnProfile; inviter: string }> {
  await rateLimit(ctx, `claim:${address.replace(/\s/g, '')}`, 10, 3600)
  const key = userKey(address)
  const [createdAt, referredBy, onDevice, onBrowser] = await ctx.store.cmd<(string | null)[]>(
    'HMGET', key, 'createdAt', 'referredBy', 'walletsOnDeviceAtSignup', 'walletsOnBrowserAtSignup',
  )
  if (!createdAt) throw new ApiError(401, 'signed_out', 'Please sign in with your wallet again.')
  if (referredBy) throw new ApiError(409, 'already_invited', 'Your profile already has an inviter.')
  if (ctx.now - Number(createdAt) > CLAIM_WINDOW_MS)
    throw new ApiError(403, 'claim_closed', 'An inviter can only be added in the first week after joining.')
  const code = cleanCode(body.code)
  const referrer = code ? await ctx.store.cmd<string | null>('GET', `code:${code}`) : null
  if (!code || !referrer) throw new ApiError(404, 'unknown_code', 'That invite code is not valid.')
  if (referrer === address) throw new ApiError(400, 'self_invite', 'You cannot use your own invite code.')
  const [inviterName, inviterReferredBy] = await ctx.store.cmd<(string | null)[]>('HMGET', userKey(referrer), 'name', 'referredBy')
  if (inviterReferredBy === address) throw new ApiError(400, 'mutual_invite', 'You invited this person, so they cannot be your inviter.')

  // Only the first claim wins if two arrive at once.
  if ((await ctx.store.cmd<number>('HSETNX', key, 'referredBy', referrer)) !== 1)
    throw new ApiError(409, 'already_invited', 'Your profile already has an inviter.')
  const credit = referralFields(ctx, referrer, 'claimed_later', Number(onDevice ?? 0), Number(onBrowser ?? 0))
  await ctx.store.pipeline([
    ['HSET', key, ...Object.entries({ ...credit.fields, refCodeUsed: code }).flat()],
    ...(credit.counted ? creditCommands(ctx, referrer, address) : []),
  ])
  return { profile: await ownProfile(ctx, address), inviter: inviterName ?? defaultName(referrer) }
}

export async function authenticate(ctx: RequestContext, authorization: string | undefined): Promise<string> {
  const token = /^Bearer ([0-9a-f]{64})$/.exec(authorization ?? '')?.[1]
  const address = token ? await ctx.store.cmd<string | null>('GET', `sess:${sha256Hex(token)}`) : null
  if (!address) throw new ApiError(401, 'signed_out', 'Please sign in with your wallet again.')
  return address
}

// ---------- Profiles ----------

function hashToObject(flat: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (Array.isArray(flat)) for (let i = 0; i + 1 < flat.length; i += 2) out[String(flat[i])] = String(flat[i + 1])
  else if (flat && typeof flat === 'object') Object.assign(out, flat)
  return out
}

interface Standing {
  address: string
  referrals: number
  joinedAt: number
  /** null until the profile has at least one referral. */
  rank: number | null
}

/**
 * Every profile in leaderboard order: most referrals first. Profiles with the same number share
 * a rank (1, 2, 2, 4), and among them the one who joined first is listed first. A profile needs
 * at least one referral to be ranked; the rest are listed after, by join date, without a rank.
 * Reads the whole board, which is fine for thousands of profiles.
 */
async function standings(ctx: RequestContext): Promise<Standing[]> {
  const flat = await ctx.store.cmd<unknown>('ZRANGE', 'lb', 0, -1, 'WITHSCORES')
  const list = Array.isArray(flat) ? flat.map(String) : []
  const rows: Standing[] = []
  for (let i = 0; i + 1 < list.length; i += 2) rows.push({ address: list[i]!, referrals: Number(list[i + 1]) || 0, joinedAt: 0, rank: null })
  const joined = await ctx.store.pipeline(rows.map((r) => ['HGET', userKey(r.address), 'createdAt'] as Command))
  rows.forEach((r, i) => (r.joinedAt = Number(joined[i] ?? 0) || Number.MAX_SAFE_INTEGER))
  rows.sort((a, b) => b.referrals - a.referrals || a.joinedAt - b.joinedAt || (a.address < b.address ? -1 : 1))
  rows.forEach((r, i) => {
    if (r.referrals <= 0) return
    const prev = rows[i - 1]
    r.rank = prev && prev.referrals === r.referrals ? prev.rank : i + 1
  })
  return rows
}

export async function ownProfile(ctx: RequestContext, address: string): Promise<OwnProfile> {
  const [rawUser, refs, refCount] = await ctx.store.pipeline([
    ['HGETALL', userKey(address)],
    ['ZRANGE', `refs:${address}`, 0, REFERRAL_LIST_SIZE - 1, 'REV', 'WITHSCORES'],
    ['ZCARD', `refs:${address}`],
  ])
  const board = await standings(ctx)
  const mine = board.find((s) => s.address === address)
  const rank = mine?.rank ?? null
  const user = hashToObject(rawUser)
  if (!user.address) throw new ApiError(401, 'signed_out', 'Please sign in with your wallet again.')

  const refList = Array.isArray(refs) ? refs.map(String) : []
  const referred: { address: string; joinedAt: number }[] = []
  for (let i = 0; i + 1 < refList.length; i += 2) referred.push({ address: refList[i]!, joinedAt: Number(refList[i + 1]) })
  const lookups = await ctx.store.pipeline([
    ...referred.map((r) => ['HGET', userKey(r.address), 'name'] as Command),
    ...(user.referredBy ? ([['HGET', userKey(user.referredBy), 'name']] as Command[]) : []),
  ])

  return {
    name: user.name ?? defaultName(address),
    address: shortAddress(address),
    fullAddress: address,
    code: user.code ?? '',
    // The list of referred wallets is the record; the leaderboard score is kept in step with it.
    referrals: Math.max(Number(refCount ?? 0), mine?.referrals ?? 0),
    joinedAt: Number(user.createdAt ?? 0),
    rank,
    referredBy: user.referredBy ? String(lookups[referred.length] ?? defaultName(user.referredBy)) : null,
    canClaimInvite: !user.referredBy && ctx.now - Number(user.createdAt ?? 0) <= CLAIM_WINDOW_MS,
    referralList: referred.map((r, i) => ({
      name: String(lookups[i] ?? defaultName(r.address)),
      address: shortAddress(r.address),
      joinedAt: r.joinedAt,
    })),
  }
}

export async function setName(ctx: RequestContext, address: string, body: { name?: unknown }): Promise<OwnProfile> {
  const name = cleanName(body.name)
  if (!name) throw new ApiError(400, 'bad_name', `Names need ${NAME_MIN} to ${NAME_MAX} characters.`)
  await rateLimit(ctx, `name:${address.replace(/\s/g, '')}`, 10, 3600)
  await ctx.store.cmd('HSET', userKey(address), 'name', name, 'nameUpdatedAt', ctx.now)
  return ownProfile(ctx, address)
}

export async function leaderboard(
  ctx: RequestContext,
): Promise<{ total: number; ranked: number; top: (PublicProfile & { rank: number | null })[] }> {
  const board = await standings(ctx)
  const top = board.slice(0, LEADERBOARD_SIZE)
  const users = await ctx.store.pipeline(top.map((r) => ['HMGET', userKey(r.address), 'name', 'code']))
  return {
    total: board.length,
    ranked: board.filter((r) => r.rank !== null).length,
    top: top.map((r, i) => {
      const [name, code] = Array.isArray(users[i]) ? (users[i] as (string | null)[]) : []
      return {
        rank: r.rank,
        name: name ?? defaultName(r.address),
        address: shortAddress(r.address),
        code: code ?? '',
        referrals: r.referrals,
        joinedAt: r.joinedAt === Number.MAX_SAFE_INTEGER ? 0 : r.joinedAt,
      }
    }),
  }
}

/** Who an invite code belongs to, for the "X invited you" banner. */
export async function inviteInfo(ctx: RequestContext, rawCode: unknown): Promise<{ code: string; name: string }> {
  await rateLimit(ctx, `inv:${ctx.ipKey}`, 120, 300)
  const code = cleanCode(rawCode)
  const address = code ? await ctx.store.cmd<string | null>('GET', `code:${code}`) : null
  if (!code || !address) throw new ApiError(404, 'unknown_code', 'That invite link is not valid.')
  // Remember that this network opened this invite. If links from two different inviters are
  // opened from one network, the note becomes ambiguous and is not used.
  const clickKey = `click:${ctx.netKey}`
  const previous = await ctx.store.cmd<string | null>('GET', clickKey)
  await ctx.store.cmd('SET', clickKey, previous && previous !== code ? AMBIGUOUS : code, 'EX', CLICK_TTL_S)
  const name = await ctx.store.cmd<string | null>('HGET', userKey(address), 'name')
  return { code, name: name ?? defaultName(address) }
}
