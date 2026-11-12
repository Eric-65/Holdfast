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

/** Look up who sent the invite this visitor arrived with (works without a wallet). */
export async function loadInvite(): Promise<void> {
  const code = pendingInviteCode()
  if (!code) return
  try {
    ctx.invite = await api.invite(code)
    emit()
  } catch (err) {
    // An unknown code is dropped; if the service is just unreachable, keep it for later.
    if (err instanceof ApiFailure && err.code === 'unknown_code') clearInviteCode()
  }
}

/** After the wallet connects: restore this device's session, or find out that sign-in is needed. */
export async function loadProfile(): Promise<void> {
  if (!ctx.address) return
  const token = sessionToken(ctx.address)
  try {
    if (token) {
      const { profile } = await api.me(token)
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
