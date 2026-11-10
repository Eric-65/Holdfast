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

export function openSheet(content: Raw, onMount?: (root: HTMLElement, close: () => void) => void): () => void {
  const wrap = document.createElement('div')
  wrap.className = 'sheet-backdrop'
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><button class="sheet-close" aria-label="Close">×</button>${content.html}</div>`
  document.body.appendChild(wrap)
  requestAnimationFrame(() => wrap.classList.add('open'))
  const close = () => {
    wrap.classList.remove('open')
    setTimeout(() => wrap.remove(), 200)
  }
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close()
  })
  $('.sheet-close', wrap)!.addEventListener('click', close)
  onMount?.($('.sheet', wrap)!, close)
  return close
}

/** Disable a button while an async action runs. */
export async function busy<T>(btn: HTMLButtonElement | null, label: string, fn: () => Promise<T>): Promise<T> {
  const prev = btn?.innerHTML
  if (btn) {
    btn.disabled = true
    btn.innerHTML = `<span class="spinner"></span> ${escapeHtml(label)}`
  }
  try {
    return await fn()
  } finally {
    if (btn) {
      btn.disabled = false
      btn.innerHTML = prev ?? ''
    }
  }
}

export function ring(percent: number, size = 184, stroke = 14, cls = ''): Raw {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const off = c * (1 - Math.max(0, Math.min(100, percent)) / 100)
  return raw(`<svg class="ring ${cls}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" fill="none"/>
    <circle class="ring-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" fill="none"
      stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" stroke-linecap="round"
      transform="rotate(-90 ${size / 2} ${size / 2})"/>
  </svg>`)
}

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
