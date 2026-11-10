import { ctx, fiatValues } from '../app'
import { formatFiat, formatNim, timeAgo } from '../lib/format'
import { html, raw, type Raw } from '../ui'

export function fiatRow(luna: number, cls = 'fiat-row'): Raw {
  const vals = fiatValues(luna)
  if (!vals.length)
    return html`<div class="${cls} muted">${ctx.prices === null ? 'Dollar view unavailable offline' : ''}</div>`
  return html`<div class="${cls}">
    ${vals.map((v) => html`<span class="fiat-pill" data-cur="${v.currency}">${formatFiat(v.value, v.currency)}</span>`)}
    ${ctx.prices?.stale ? html`<span class="muted small">· rate ${timeAgo(ctx.prices.updatedAt)}</span>` : ''}
  </div>`
}

export function nim(luna: number): Raw {
  return html`<span class="nim">${formatNim(luna)}<small> NIM</small></span>`
}

export const logo = raw(`<svg class="logo" viewBox="0 0 48 48" aria-hidden="true">
  <defs><linearGradient id="hfg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F6C453"/><stop offset="1" stop-color="#E9A21B"/></linearGradient></defs>
  <path d="M24 3 42 9.5v13.2C42 34 34.4 41.6 24 45 13.6 41.6 6 34 6 22.7V9.5Z" fill="url(#hfg)"/>
  <path d="M24 13v19m-7-7a7 7 0 0 0 14 0M19.5 17.5h9" fill="none" stroke="#1F2348" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="24" cy="12" r="2.6" fill="none" stroke="#1F2348" stroke-width="2.6"/>
</svg>`)

/** Sun/moon switch; CSS shows the icon for the theme you'd switch to. Click is handled in main.ts. */
const themeToggle = raw(`<button type="button" class="theme-toggle" aria-label="Switch theme">
  <svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"/></svg>
  <svg class="icon-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg>
</button>`)

export function header(right: Raw | string = ''): Raw {
  return html`<header class="topbar">
    <a class="brand" href="#/">${logo}<span>Holdfast</span></a>
    <div class="topbar-right">${right}${themeToggle}</div>
  </header>`
}

export function demoBadge(): Raw {
  return ctx.wallet?.mode === 'demo'
    ? html`<span class="badge badge-demo" title="Simulated wallet. No real NIM moves.">Demo</span>`
    : html``
}
