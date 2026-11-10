export const LUNA_PER_NIM = 100_000

export const toLuna = (nim: number): number => Math.round(nim * LUNA_PER_NIM)
export const toNim = (luna: number): number => luna / LUNA_PER_NIM

/** Parse user input like "1,250.5" or "1250,5" into luna. Returns null if invalid. */
export function parseNimInput(raw: string): number | null {
  let s = raw.trim().replace(/\s/g, '')
  if (!s) return null
  // Treat a single comma with no dot as a decimal separator ("12,5").
  if (s.includes(',') && !s.includes('.') && /^\d+,\d{1,5}$/.test(s)) s = s.replace(',', '.')
  else s = s.replace(/,/g, '')
  if (!/^\d+(\.\d{0,5})?$/.test(s)) return null
  const luna = toLuna(Number(s))
  return Number.isFinite(luna) && luna > 0 ? luna : null
}

export function formatNim(luna: number, opts: { decimals?: number } = {}): string {
  const nim = toNim(luna)
  const decimals = opts.decimals ?? (Math.abs(nim) >= 1000 ? 0 : 2)
  return nim.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: decimals })
}

const FIAT_SYMBOL: Record<string, string> = { usd: '$', ngn: '₦', eur: '€', crc: '₡', gmd: 'D' }

export function formatFiat(amount: number, currency: string): string {
  const cur = currency.toLowerCase()
  const sym = FIAT_SYMBOL[cur] ?? `${currency.toUpperCase()} `
  const decimals = amount !== 0 && Math.abs(amount) < 1 ? 4 : 2
  const body = Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  })
  return `${amount < 0 ? '-' : ''}${sym}${body}`
}

/** Normalize a Nimiq address to the canonical "NQxx XXXX ..." grouping. */
export function formatAddress(addr: string): string {
  const clean = addr.replace(/\s/g, '').toUpperCase()
  return clean.replace(/(.{4})/g, '$1 ').trim()
}

export function shortAddress(addr: string): string {
  const a = formatAddress(addr)
  return a.length > 14 ? `${a.slice(0, 9)}…${a.slice(-4)}` : a
}

/** Structural validity + IBAN-style checksum used by Nimiq user-friendly addresses. */
export function isValidAddress(addr: string): boolean {
  const s = addr.replace(/\s/g, '').toUpperCase()
  if (!/^NQ\d{2}[0-9A-HJ-NP-VXY]{32}$/.test(s)) return false
  const rearranged = s.slice(4) + s.slice(0, 4)
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  let rem = 0
  for (const ch of numeric) rem = (rem * 10 + Number(ch)) % 97
  return rem === 1
}

export function pct(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.max(0, Math.min(100, (part / whole) * 100))
}

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
