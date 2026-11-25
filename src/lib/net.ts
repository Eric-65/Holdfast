/** An abort signal that fires after `ms`, so no request can hang a screen. Undefined on old browsers. */
export const timeoutSignal = (ms: number): AbortSignal | undefined =>
  typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined

/** True when a fetch failed because it ran out of time. */
export const isTimeout = (err: unknown): boolean =>
  err instanceof DOMException ? err.name === 'TimeoutError' || err.name === 'AbortError' : false
