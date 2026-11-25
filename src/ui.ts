import { escapeHtml } from './lib/format'

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null =>
  root.querySelector<T>(sel)
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] =>
  Array.from(root.querySelectorAll<T>(sel))

/** Tagged template that escapes interpolations unless wrapped with raw(). */
export class Raw {
  constructor(public readonly html: string) {}
}
export const raw = (html: string) => new Raw(html)
export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = ''
  strings.forEach((s, i) => {
    out += s
    if (i < values.length) out += renderValue(values[i])
  })
  return new Raw(out)
}
function renderValue(v: unknown): string {
  if (v === null || v === undefined || v === false) return ''
  if (v instanceof Raw) return v.html
  if (Array.isArray(v)) return v.map(renderValue).join('')
  return escapeHtml(String(v))
}

let toastTimer: number | undefined
export function toast(message: string, kind: 'info' | 'error' | 'success' = 'info'): void {
  let el = $('#toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'toast'
    el.setAttribute('role', 'status')
    el.setAttribute('aria-live', 'polite')
    document.body.appendChild(el)
  }
  el.className = `toast toast-${kind} show`
  el.textContent = message
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), 3800)
}

export function openSheet(
  content: Raw,
  onMount?: (root: HTMLElement, close: () => void) => void,
  opts: { className?: string; onClose?: () => void } = {},
): () => void {
  const wrap = document.createElement('div')
  wrap.className = `sheet-backdrop ${opts.className ?? ''}`
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><button class="sheet-close" aria-label="Close">×</button>${content.html}</div>`
  document.body.appendChild(wrap)
  requestAnimationFrame(() => wrap.classList.add('open'))
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    wrap.classList.remove('open')
    setTimeout(() => wrap.remove(), 200)
    opts.onClose?.()
  }
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close()
  })
  $('.sheet-close', wrap)!.addEventListener('click', close)
  onMount?.($('.sheet', wrap)!, close)
  return close
}

/** Actions still running, by button key, so a redraw can't bring back an enabled copy of the button. */
const running = new Map<string, string>()
const keyOf = (btn: HTMLButtonElement): string => btn.id || (btn.form?.id ? `form:${btn.form.id}` : '')

/**
 * Disable a button while an async action runs. The same action can't start twice, even if the
 * screen was redrawn in between (the new button is disabled too, see reapplyBusy).
 */
export async function busy<T>(btn: HTMLButtonElement | null, label: string, fn: () => Promise<T>): Promise<T | undefined> {
  const key = btn ? keyOf(btn) : ''
  if (key && running.has(key)) return undefined
  const prev = btn?.innerHTML
  if (key) running.set(key, label)
  if (btn) {
    btn.disabled = true
    btn.innerHTML = `<span class="spinner"></span> ${escapeHtml(label)}`
  }
  try {
    return await fn()
  } finally {
    if (key) running.delete(key)
    // The button on screen now may be a redrawn copy: enable whichever is there.
    const current = key ? findByKey(key) : null
    for (const b of new Set([btn, current])) {
      if (!b) continue
      b.disabled = false
      if (b === btn) b.innerHTML = prev ?? ''
    }
    if (current && current !== btn && current.dataset.label) current.innerHTML = current.dataset.label
  }
}

function findByKey(key: string): HTMLButtonElement | null {
  if (key.startsWith('form:')) return document.getElementById(key.slice(5))?.querySelector<HTMLButtonElement>('button[type=submit]') ?? null
  return document.getElementById(key) as HTMLButtonElement | null
}

/** After a redraw: show buttons whose action is still running as busy again. */
export function reapplyBusy(): void {
  running.forEach((label, key) => {
    const b = findByKey(key)
    if (!b || b.disabled) return
    b.dataset.label = b.innerHTML
    b.disabled = true
    b.innerHTML = `<span class="spinner"></span> ${escapeHtml(label)}`
  })
}

/** When each animated ring was first drawn: a redraw during the animation carries on from there. */
const ringsShown = new Map<string, number>()
const RING_ANIM_MS = 1000

/**
 * A progress ring. With `animateKey`, the first time that ring is drawn on this visit it fills up
 * from zero (redraws after that don't replay it).
 */
export function ring(percent: number, size = 184, stroke = 14, cls = '', animateKey = ''): Raw {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const off = c * (1 - Math.max(0, Math.min(100, percent)) / 100)
  const now = Date.now()
  if (animateKey && !ringsShown.has(animateKey)) ringsShown.set(animateKey, now)
  const elapsed = animateKey ? now - (ringsShown.get(animateKey) ?? 0) : RING_ANIM_MS
  const animate = elapsed < RING_ANIM_MS
  const style = `--ring-c:${c.toFixed(2)}${animate ? `;--ring-delay:-${elapsed}ms` : ''}`
  return raw(`<svg class="ring ${cls} ${animate ? 'ring-anim' : ''}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true" style="${style}">
    <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" fill="none"/>
    <circle class="ring-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" fill="none"
      stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" stroke-linecap="round"
      transform="rotate(-90 ${size / 2} ${size / 2})"/>
  </svg>`)
}

/** A short burst of sparks around the element (a confirmed lock). Purely decorative. */
export function burst(target: Element | null): void {
  if (!target) return
  // Drawn over the page at the target's centre, so a redraw of the screen doesn't cut it short.
  const r = target.getBoundingClientRect()
  const el = document.createElement('span')
  el.className = 'burst'
  el.setAttribute('aria-hidden', 'true')
  el.style.left = `${r.left + r.width / 2}px`
  el.style.top = `${r.top + r.height / 2}px`
  el.innerHTML = Array.from({ length: 12 }, (_, i) => `<i style="--i:${i}"></i>`).join('')
  document.body.appendChild(el)
  window.setTimeout(() => el.remove(), 1100)
}

/** Grey placeholder blocks with a shimmer, while something loads. */
export const skeleton = (lines = 3, cls = ''): Raw =>
  raw(`<div class="skeleton-group ${cls}" aria-hidden="true">${'<span class="skeleton"></span>'.repeat(lines)}</div>`)

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}
