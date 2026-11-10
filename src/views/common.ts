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

export function header(right: Raw | string = ''): Raw {
  return html`<header class="topbar">
    <a class="brand" href="#/">${logo}<span>Holdfast</span></a>
    <div class="topbar-right">${right}</div>
  </header>`
}

export function demoBadge(): Raw {
  return ctx.wallet?.mode === 'demo'
    ? html`<span class="badge badge-demo" title="Simulated wallet. No real NIM moves.">Demo</span>`
    : html``
}
