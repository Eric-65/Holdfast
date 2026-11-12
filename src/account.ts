import { ctx, emit } from './app'
import { api, ApiFailure, type OwnProfile } from './lib/api'
import { browserId, clearInviteCode, pendingInviteCode, sessionToken, setSessionToken } from './lib/identity'
import { deviceIdentifier } from './lib/wallet'

/** Profiles, sign-in and invites. The wallet address is the account; signing a message proves it. */

function setProfile(profile: OwnProfile | null, status: typeof ctx.profileStatus): void {
  ctx.profile = profile
  ctx.profileStatus = status
  if (status === 'ready' || status === 'signed_out') ctx.apiAvailable = true
  else if (status === 'unavailable') ctx.apiAvailable = false
  emit(true)
}

/** Find out whether this deployment has the profile service (static hosts do not). */
export async function checkApi(): Promise<boolean> {
  if (ctx.apiAvailable === null) {
    try {
      await api.leaderboard()
      ctx.apiAvailable = true
    } catch {
      ctx.apiAvailable = false
    }
    emit()
  }
  return ctx.apiAvailable
}

/** How long the "X invited you" message stays on screen after arriving through an invite link. */
const INVITE_BANNER_MS = 6000

let inviteLookup: Promise<void> | null = null
/**
 * Look up who sent the invite this visitor arrived with (works without a wallet).
 * `justArrived` is true only for the visit that came in through the link: that visit shows
 * the inviter's name for a few seconds. The code itself is kept quietly until a profile exists.
 */
export function loadInvite(justArrived = false): Promise<void> {
  inviteLookup ??= (async () => {
    const code = pendingInviteCode()
    if (!code) return
    try {
      ctx.invite = await api.invite(code)
      if (justArrived) {
        ctx.inviteBannerUntil = Date.now() + INVITE_BANNER_MS
        window.setTimeout(() => {
          ctx.inviteBannerUntil = 0
          emit()
        }, INVITE_BANNER_MS)
      }
      emit()
    } catch (err) {
      // An unknown code is dropped; if the service is just unreachable, keep it for later.
      if (err instanceof ApiFailure && err.code === 'unknown_code') clearInviteCode()
    }
  })()
  return inviteLookup
}

let profileLoadedAt = 0

/** After the wallet connects: restore this device's session, or find out that sign-in is needed. */
export async function loadProfile(): Promise<void> {
  if (!ctx.address) return
  const token = sessionToken(ctx.address)
  try {
    if (token) {
      const { profile } = await api.me(token)
      profileLoadedAt = Date.now()
      return setProfile(profile, 'ready')
    }
    // No session yet. A cheap public call tells us whether profiles exist on this deployment.
    setProfile(null, (await checkApi()) ? 'signed_out' : 'unavailable')
  } catch (err) {
    if (err instanceof ApiFailure && err.code === 'signed_out') {
      setSessionToken(ctx.address, null)
      return setProfile(null, 'signed_out')
    }
    // Keep a profile we already have on a temporary network error.
    if (!ctx.profile) setProfile(null, 'unavailable')
  }
}

/** Fetch fresh referral counts and rank, at most every few seconds. Used when a screen is opened. */
export async function refreshProfile(maxAgeMs = 5000): Promise<void> {
  if (ctx.profileStatus !== 'ready' || Date.now() - profileLoadedAt < maxAgeMs) return
  profileLoadedAt = Date.now()
  await loadProfile()
}

/**
 * A signed-in profile with no inviter that opens an invite link (or still holds a code from one)
 * gets that inviter recorded. Returns the inviter's name when it was recorded.
 */
export async function claimPendingInvite(): Promise<string | null> {
  const code = pendingInviteCode()
  if (!code || ctx.profileStatus !== 'ready' || !ctx.profile) return null
  // The code has done its job either way; never keep nagging about it.
  clearInviteCode()
  ctx.invite = null
  if (!ctx.profile.canClaimInvite || code === ctx.profile.code) return null
  try {
    return await claimInvite(code)
  } catch {
    return null
  }
}

/** Record who invited this profile. Throws ApiFailure with a readable message if it cannot. */
export async function claimInvite(code: string): Promise<string> {
  const token = ctx.address ? sessionToken(ctx.address) : null
  if (!token) throw new ApiFailure(401, 'signed_out', 'Please sign in with your wallet again.')
  const { profile, inviter } = await api.claim(token, code)
  profileLoadedAt = Date.now()
  setProfile(profile, 'ready')
  return inviter
}

export interface SignInResult {
  profile: OwnProfile
  isNew: boolean
  referralCounted: boolean
}

/**
 * Create or open the profile for the connected wallet: the wallet signs a one-time message
 * from the server, which proves ownership of the address. No funds move.
 */
export async function signIn(): Promise<SignInResult> {
  const wallet = ctx.wallet
  const address = ctx.address
  if (!wallet || !address) throw new Error('Connect your wallet first')
  const { message } = await api.challenge(address)
  const { publicKey, signature } = await wallet.sign(message)
  const deviceId = await deviceIdentifier('Confirms you are one real Holdfast user, so invites are counted fairly.')
  const result = await api.login({ message, publicKey, signature, browserId: browserId(), deviceId, ref: pendingInviteCode() })
  setSessionToken(address, result.token)
  clearInviteCode()
  ctx.invite = null
  profileLoadedAt = Date.now()
  setProfile(result.profile, 'ready')
  return result
}

export async function rename(name: string): Promise<void> {
  const token = ctx.address ? sessionToken(ctx.address) : null
  if (!token) throw new ApiFailure(401, 'signed_out', 'Please sign in with your wallet again.')
  const { profile } = await api.setName(token, name)
  setProfile(profile, 'ready')
}

export function signOut(): void {
  if (ctx.address) setSessionToken(ctx.address, null)
  setProfile(null, 'signed_out')
}
