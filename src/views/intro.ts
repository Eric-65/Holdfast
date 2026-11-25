import { ctx } from '../app'
import { activeGoals } from '../lib/store'
import { $, $$, html, openSheet } from '../ui'

/** First-use intro: three cards after the first connect, shown once per device, always skippable. */
const SEEN_KEY = 'holdfast.intro.v1'

const CARDS = [
  {
    icon: '🔒',
    title: 'Lock it',
    text: 'Saving into a goal stakes NIM from your own wallet. It earns staking rewards and stays yours: Holdfast never holds your money.',
  },
  {
    icon: '🛡️',
    title: 'Goalkeeper',
    text: 'Share a link with one friend you trust. They watch your progress, cheer you on in NIM, and see it if you break the seal.',
  },
  {
    icon: '⚓',
    title: 'Hold fast',
    text: 'You can always withdraw, but slowly on purpose: the Nimiq network keeps unstaked NIM locked for 12 to 24 hours. Impulses pass; goals stay.',
  },
]

let done: Promise<void> = Promise.resolve()

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return true // no storage (private mode): don't show it on every visit
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* storage unavailable */
  }
}

/** Resolves once the intro is closed (at once if it was seen before). */
export const introClosed = (): Promise<void> => done

/** Show the intro if this device hasn't seen it. Returns when it is closed. */
export function showIntroOnce(): Promise<void> {
  if (seen() || document.querySelector('.intro')) return done
  markSeen()
  done = new Promise<void>((resolve) => {
    const firstGoal = activeGoals(ctx.state).length === 0
    openSheet(
      html`<div class="intro-cards" aria-roledescription="carousel">
          ${CARDS.map(
            (c, i) => html`<section class="intro-card ${i === 0 ? 'active' : ''}" data-i="${i}" aria-label="${i + 1} of ${CARDS.length}">
              <div class="intro-icon" aria-hidden="true">${c.icon}</div>
              <h2>${c.title}</h2>
              <p>${c.text}</p>
            </section>`,
          )}
        </div>
        <div class="intro-dots" aria-hidden="true">${CARDS.map((_, i) => html`<i class="${i === 0 ? 'on' : ''}"></i>`)}</div>
        <div class="intro-actions">
          <button class="btn btn-link" type="button" id="intro-skip">Skip</button>
          <button class="btn btn-primary" type="button" id="intro-next">Next</button>
        </div>`,
      (sheet, close) => {
        let at = 0
        const next = $<HTMLButtonElement>('#intro-next', sheet)!
        const show = (i: number) => {
          at = i
          $$('.intro-card', sheet).forEach((el, j) => el.classList.toggle('active', j === i))
          $$('.intro-dots i', sheet).forEach((el, j) => el.classList.toggle('on', j === i))
          next.textContent = i < CARDS.length - 1 ? 'Next' : firstGoal ? 'Create my first goal' : 'Got it'
          $<HTMLElement>('.intro-card.active h2', sheet)?.focus?.()
        }
        next.addEventListener('click', () => (at < CARDS.length - 1 ? show(at + 1) : close()))
        $('#intro-skip', sheet)!.addEventListener('click', close)
        // Swipe left/right between cards.
        let startX: number | null = null
        sheet.addEventListener('touchstart', (e) => (startX = e.touches[0]?.clientX ?? null), { passive: true })
        sheet.addEventListener('touchend', (e) => {
          const end = e.changedTouches[0]?.clientX
          if (startX === null || end === undefined || Math.abs(end - startX) < 40) return
          show(Math.max(0, Math.min(CARDS.length - 1, at + (end < startX ? 1 : -1))))
        })
      },
      { className: 'intro', onClose: () => resolve() },
    )
  })
  return done
}
