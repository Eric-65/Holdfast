import { describe, expect, it } from 'vitest'
import { busy, reapplyBusy } from '../src/ui'

describe('busy buttons', () => {
  it("can't start the same action twice, even after the screen is redrawn", async () => {
    document.body.innerHTML = '<form id="lock-form"><button type="submit">Lock</button></form>'
    let release!: () => void
    let runs = 0
    const action = () => {
      runs++
      return new Promise<void>((r) => (release = r))
    }
    const first = busy(document.querySelector('button')!, 'Confirm in Nimiq Pay…', action)
    // A background refresh redraws the form: a fresh, enabled button replaces the old one.
    document.body.innerHTML = '<form id="lock-form"><button type="submit">Lock</button></form>'
    reapplyBusy()
    const redrawn = document.querySelector('button')!
    expect(redrawn.disabled).toBe(true)
    expect(redrawn.textContent).toContain('Confirm in Nimiq Pay')
    // A second tap does nothing while the first action is still waiting.
    expect(await busy(redrawn, 'Confirm in Nimiq Pay…', action)).toBeUndefined()
    expect(runs).toBe(1)
    release()
    await first
    expect(redrawn.disabled).toBe(false)
    expect(redrawn.textContent).toBe('Lock')
    await busy(redrawn, 'x', async () => undefined)
    expect(runs).toBe(1)
  })
})
