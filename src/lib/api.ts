import { config } from './config'

export interface PublicProfile {
  name: string
  /** Shortened address, e.g. "NQ12 3456…ABCD". */
  address: string
  code: string
  referrals: number
  joinedAt: number
}
export interface LeaderboardRow extends PublicProfile {
  /** null until the profile has at least one referral. Equal counts share a rank. */
  rank: number | null
}
export interface OwnProfile extends PublicProfile {
  fullAddress: string
  rank: number | null
  referredBy: string | null
  /** True while this profile may still name its inviter. */
  canClaimInvite: boolean
  referralList: { name: string; address: string; joinedAt: number }[]
}

export interface PublicStats {
  savers: number
  activeGoals: number
  lockedLuna: number
}

/** A goal as backed up on the server (the same fields as on the phone, plus the saved amount). */
export interface SyncedGoal {
  id: string
  name: string
  emoji: string
  targetLuna: number
  baselineLuna: number
  lockedLuna: number
  savedLuna: number
  createdAt: number
  status: 'active' | 'completed' | 'archived'
  sealBrokenAt: number | null
  reachedAt: number | null
  pendingUnlock: { luna: number; step: 'inactive' | 'retired'; startedAt: number } | null
  validator: string | null
  baselineFromChain?: boolean
  events: { type: 'created' | 'lock' | 'unlock' | 'retire' | 'release' | 'reached' | 'shared'; luna: number; at: number; tx?: string }[]
}

export interface SyncedState {
  goals: SyncedGoal[]
  stakerCreated: boolean
  accounts: string[]
  network: 'mainnet' | 'testnet'
  updatedAt: number
}

export interface PublicGoal {
  goal: SyncedGoal
  owner: { name: string }
  accounts: string[]
  network: 'mainnet' | 'testnet'
  updatedAt: number
}

/** code 'unavailable' means the profile service is not reachable or not set up on this deployment. */
export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

async function call<T>(action: string, opts: { body?: unknown; token?: string | null; query?: Record<string, string> } = {}): Promise<T> {
  const qs = new URLSearchParams({ a: action, ...opts.query })
  let res: Response
  try {
    res = await fetch(`${config.apiBase}/api/hf?${qs}`, {
      method: opts.body === undefined ? 'GET' : 'POST',
      headers: {
        Accept: 'application/json',
        ...(opts.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
  } catch {
    throw new ApiFailure(0, 'unavailable', 'Could not reach Holdfast. Check your connection.')
  }
  const json = (await res.json().catch(() => null)) as (T & { error?: string; message?: string }) | null
  if (res.ok && json) return json
  // A host without the API (static hosting) answers with HTML or a bare 404.
  if (!json?.error || json.error === 'not_configured') throw new ApiFailure(res.status, 'unavailable', 'Profiles are not available right now.')
  throw new ApiFailure(res.status, json.error, json.message || 'Something went wrong.')
}

export const api = {
  leaderboard: () => call<{ total: number; ranked?: number; top: LeaderboardRow[] }>('leaderboard'),
  invite: (code: string) => call<{ code: string; name: string }>('invite', { query: { code } }),
  challenge: (address: string) => call<{ message: string }>('challenge', { body: { address } }),
  login: (body: { message: string; publicKey: string; signature: string; browserId: string; deviceId: string | null; ref: string | null }) =>
    call<{ token: string; isNew: boolean; referralCounted: boolean; profile: OwnProfile }>('login', { body }),
  me: (token: string) => call<{ profile: OwnProfile }>('me', { token }),
  setName: (token: string, name: string) => call<{ profile: OwnProfile }>('name', { token, body: { name } }),
  claim: (token: string, code: string) => call<{ profile: OwnProfile; inviter: string }>('claim', { token, body: { code } }),
  stats: () => call<PublicStats>('stats'),
  goal: (address: string, id: string) => call<PublicGoal>('goal', { query: { addr: address.replace(/\s/g, ''), id } }),
  sync: (token: string, state: Omit<SyncedState, 'updatedAt'>) => call<{ updatedAt: number }>('sync', { token, body: { state } }),
  state: (token: string) => call<{ state: SyncedState | null }>('state', { token }),
}
