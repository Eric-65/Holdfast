/**
 * Minimal Redis interface. Production uses Upstash Redis over its REST API (the store Vercel
 * offers under Storage); tests and local dev use the in-memory version.
 */
export type RedisValue = string | number | null | RedisValue[]
export type Command = (string | number)[]

export interface Store {
  cmd<T = RedisValue>(...command: Command): Promise<T>
  pipeline(commands: Command[]): Promise<RedisValue[]>
}

export class UpstashStore implements Store {
  constructor(
    private url: string,
    private token: string,
  ) {}

  private async post(path: string, body: unknown): Promise<any> {
    const res = await fetch(this.url.replace(/\/$/, '') + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || json === null) throw new Error(`Store error ${res.status}`)
    return json
  }

  async cmd<T = RedisValue>(...command: Command): Promise<T> {
    const json = await this.post('', command)
    if (json.error) throw new Error(String(json.error))
    return json.result as T
  }

  async pipeline(commands: Command[]): Promise<RedisValue[]> {
    if (!commands.length) return []
    const json = (await this.post('/pipeline', commands)) as { result?: RedisValue; error?: string }[]
    return json.map((r) => {
      if (r.error) throw new Error(String(r.error))
      return r.result ?? null
    })
  }
}

/** Reads the variables Vercel sets when an Upstash Redis store is connected to the project. */
export function storeFromEnv(env: Record<string, string | undefined> = process.env): Store | null {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN
  return url && token ? new UpstashStore(url, token) : null
}

type Entry =
  | { t: 'string'; v: string; exp?: number }
  | { t: 'hash'; v: Map<string, string>; exp?: number }
  | { t: 'zset'; v: Map<string, number>; exp?: number }
  | { t: 'set'; v: Set<string>; exp?: number }

/** In-memory stand-in implementing the subset of Redis commands Holdfast uses. */
export class MemoryStore implements Store {
  private data = new Map<string, Entry>()
  now: () => number = Date.now

  private get(key: string): Entry | undefined {
    const e = this.data.get(key)
    if (e?.exp !== undefined && e.exp <= this.now()) {
      this.data.delete(key)
      return undefined
    }
    return e
  }
  private ensure<T extends Entry['t']>(key: string, t: T): Extract<Entry, { t: T }> {
    let e = this.get(key)
    if (!e) {
      e = (t === 'string' ? { t, v: '' } : t === 'hash' ? { t, v: new Map() } : t === 'zset' ? { t, v: new Map() } : { t, v: new Set() }) as Entry
      this.data.set(key, e)
    }
    if (e.t !== t) throw new Error('WRONGTYPE')
    return e as Extract<Entry, { t: T }>
  }
  private sorted(key: string, rev: boolean): [string, number][] {
    const e = this.get(key)
    if (!e || e.t !== 'zset') return []
    const list = [...e.v.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    return rev ? list.reverse() : list
  }

  async pipeline(commands: Command[]): Promise<RedisValue[]> {
    const out: RedisValue[] = []
    for (const c of commands) out.push(await this.cmd(...c))
    return out
  }

  async cmd<T = RedisValue>(...command: Command): Promise<T> {
    return this.run(command.map(String)) as T
  }

  private run(a: string[]): RedisValue {
    const op = a[0]!.toUpperCase()
    const key = a[1]!
    switch (op) {
      case 'GET': {
        const e = this.get(key)
        return e?.t === 'string' ? e.v : null
      }
      case 'SET': {
        const opts = a.slice(3).map((s) => s.toUpperCase())
        if (opts.includes('NX') && this.get(key)) return null
        const ex = opts.indexOf('EX')
        this.data.set(key, { t: 'string', v: a[2]!, exp: ex >= 0 ? this.now() + Number(a[3 + ex + 1]) * 1000 : undefined })
        return 'OK'
      }
      case 'GETDEL': {
        const e = this.get(key)
        this.data.delete(key)
        return e?.t === 'string' ? e.v : null
      }
      case 'DEL':
        return this.data.delete(key) ? 1 : 0
      case 'INCR': {
        const e = this.ensure(key, 'string')
        e.v = String(Number(e.v || 0) + 1)
        return Number(e.v)
      }
      case 'EXPIRE': {
        const e = this.get(key)
        if (!e) return 0
        e.exp = this.now() + Number(a[2]) * 1000
        return 1
      }
      case 'HSET': {
        const e = this.ensure(key, 'hash')
        let added = 0
        for (let i = 2; i + 1 < a.length; i += 2) {
          if (!e.v.has(a[i]!)) added++
          e.v.set(a[i]!, a[i + 1]!)
        }
        return added
      }
      case 'HSETNX': {
        const e = this.ensure(key, 'hash')
        if (e.v.has(a[2]!)) return 0
        e.v.set(a[2]!, a[3]!)
        return 1
      }
      case 'HGET': {
        const e = this.get(key)
        return e?.t === 'hash' ? (e.v.get(a[2]!) ?? null) : null
      }
      case 'HMGET': {
        const e = this.get(key)
        return a.slice(2).map((f) => (e?.t === 'hash' ? (e.v.get(f) ?? null) : null))
      }
      case 'HGETALL': {
        const e = this.get(key)
        return e?.t === 'hash' ? [...e.v.entries()].flat() : []
      }
      case 'HDEL': {
        const e = this.get(key)
        if (e?.t !== 'hash') return 0
        let removed = 0
        for (const f of a.slice(2)) if (e.v.delete(f)) removed++
        return removed
      }
      case 'HVALS': {
        const e = this.get(key)
        return e?.t === 'hash' ? [...e.v.values()] : []
      }
      case 'HLEN': {
        const e = this.get(key)
        return e?.t === 'hash' ? e.v.size : 0
      }
      case 'HINCRBY': {
        const e = this.ensure(key, 'hash')
        const n = Number(e.v.get(a[2]!) ?? 0) + Number(a[3])
        e.v.set(a[2]!, String(n))
        return n
      }
      case 'ZADD': {
        const e = this.ensure(key, 'zset')
        const nx = a[2]!.toUpperCase() === 'NX'
        const [score, member] = nx ? [a[3]!, a[4]!] : [a[2]!, a[3]!]
        if (e.v.has(member)) {
          if (!nx) e.v.set(member, Number(score))
          return 0
        }
        e.v.set(member, Number(score))
        return 1
      }
      case 'ZINCRBY': {
        const e = this.ensure(key, 'zset')
        const n = (e.v.get(a[3]!) ?? 0) + Number(a[2])
        e.v.set(a[3]!, n)
        return String(n)
      }
      case 'ZRANGE': {
        const opts = a.slice(4).map((s) => s.toUpperCase())
        const list = this.sorted(key, opts.includes('REV'))
        const stop = Number(a[3]) < 0 ? list.length + Number(a[3]) : Number(a[3])
        const slice = list.slice(Number(a[2]), stop + 1)
        return opts.includes('WITHSCORES') ? slice.flatMap(([m, s]) => [m, String(s)]) : slice.map(([m]) => m)
      }
      case 'ZREVRANK': {
        const i = this.sorted(key, true).findIndex(([m]) => m === a[2])
        return i < 0 ? null : i
      }
      case 'ZSCORE': {
        const e = this.get(key)
        const s = e?.t === 'zset' ? e.v.get(a[2]!) : undefined
        return s === undefined ? null : String(s)
      }
      case 'ZCARD': {
        const e = this.get(key)
        return e?.t === 'zset' ? e.v.size : 0
      }
      case 'SADD': {
        const e = this.ensure(key, 'set')
        const had = e.v.has(a[2]!)
        e.v.add(a[2]!)
        return had ? 0 : 1
      }
      case 'SCARD': {
        const e = this.get(key)
        return e?.t === 'set' ? e.v.size : 0
      }
      case 'SMEMBERS': {
        const e = this.get(key)
        return e?.t === 'set' ? [...e.v] : []
      }
      default:
        throw new Error(`MemoryStore: unsupported command ${op}`)
    }
  }
}
