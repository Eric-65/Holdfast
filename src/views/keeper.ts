import { ctx } from '../app'
import { chainAvailable, getStaker, type StakerInfo } from '../lib/chain'
import { formatAddress, formatFiat, formatNim, parseNimInput, pct, shortAddress, timeAgo, toNim } from '../lib/format'
import { nimiqPaymentUri, type KeeperPayload } from '../lib/share'
import { connectNimiqPay, errorMessage, insideNimiqPay, isUserRejection, type Wallet } from '../lib/wallet'
import { fiatValues } from '../app'
import { $, $$, busy, copyText, html, ring, toast } from '../ui'
import { fiatRow, header, nim } from './common'

const CHEERS_KEY = 'holdfast.cheers.v1'
const MAX_DATA_BYTES = 64

interface KeeperLive {
  stake: StakerInfo | null
  loading: boolean
}

function cheersSent(addr: string): number {
  try {
    const all = JSON.parse(localStorage.getItem(CHEERS_KEY) ?? '{}') as Record<string, number>
    return all[addr.replace(/\s/g, '')] ?? 0
  } catch {
    return 0
  }
}
function addCheer(addr: string, luna: number): void {
  try {
    const all = JSON.parse(localStorage.getItem(CHEERS_KEY) ?? '{}') as Record<string, number>
    const k = addr.replace(/\s/g, '')
    all[k] = (all[k] ?? 0) + luna
    localStorage.setItem(CHEERS_KEY, JSON.stringify(all))
  } catch {
    /* ignore */
  }
}

/** Truncate a message so the transaction data (prefix + message) fits in Nimiq's data limit. */
export function cheerData(message: string): string {
  const prefix = 'Holdfast cheer: '
  const enc = new TextEncoder()
  let msg = message.trim() || '💪'
  while (enc.encode(prefix + msg).length > MAX_DATA_BYTES) msg = [...msg].slice(0, -1).join('')
  return prefix + msg
}

export function renderKeeper(root: HTMLElement, p: KeeperPayload): void {
  const live: KeeperLive = { stake: null, loading: chainAvailable() }
  let friendWallet: Wallet | null = ctx.wallet

  const draw = () => {
    const onChain = live.stake !== null
    const saved = onChain ? Math.max(0, live.stake!.balance - p.b) : p.s
    const leaving = onChain ? live.stake!.inactiveBalance + live.stake!.retiredBalance : 0
    const broken = !!p.x || leaving > 0 || (onChain && saved < p.s)
    const reached = saved >= p.t
    const percent = pct(saved, p.t)
    const sent = cheersSent(p.a)
    root.innerHTML = html`${header(html`<span class="badge">Goalkeeper</span>`)}
    <main class="page keeper">
      <p class="eyebrow">You're the Goalkeeper for</p>
      <section class="goal-hero ${broken ? 'broken' : ''} ${reached ? 'reached' : ''}">
        <div class="ring-wrap">
          ${ring(percent)}
          <div class="ring-center"><div class="goal-emoji">${p.e}</div><div class="ring-pct">${Math.floor(percent)}%</div></div>
        </div>
        <h1 class="goal-name">${p.n}</h1>
        <div class="big-amount">${nim(saved)} <span class="muted">of ${formatNim(p.t)}</span></div>
        ${fiatRow(saved)}
        <div class="status-line">
          ${
            reached
              ? html`<span class="chip chip-good">🎉 Goal reached</span>`
              : broken
                ? html`<span class="chip chip-bad">⚠️ Seal broken${p.x ? ` ${timeAgo(p.x)}` : ''}</span>`
                : html`<span class="chip chip-lock">🔒 Still sealed</span>`
          }
        </div>
        ${
          leaving > 0
            ? html`<p class="alert">${formatNim(leaving)} NIM is being withdrawn from staking right now. Maybe check in with your friend?</p>`
            : ''
        }
        <p class="muted small">${
          live.loading
            ? 'Checking the blockchain…'
            : onChain
              ? 'Live from the Nimiq blockchain'
              : `Snapshot shared ${timeAgo(p.st)}`
        } · Saving since ${new Date(p.c).toLocaleDateString()}</p>
      </section>

      <section class="card">
        <h3>Send a cheer 🎉</h3>
        <p class="muted">A small NIM gift straight to your friend's wallet, with a message. They can lock it into the goal.</p>
        <form id="cheer-form" class="form" novalidate>
          <div class="chips">${[5, 10, 25, 100].map((n) => html`<button type="button" class="chip-btn" data-amt="${n}">${n} NIM</button>`)}</div>
          <div class="amount-input"><input name="amount" inputmode="decimal" placeholder="10" aria-label="Amount in NIM"/><span class="unit">NIM</span></div>
          <span class="hint" id="cheer-hint">&nbsp;</span>
          <input name="message" maxlength="48" placeholder="You've got this!" aria-label="Message"/>
          <button class="btn btn-primary" type="submit">${friendWallet || insideNimiqPay() ? 'Send cheer' : 'Cheer with a Nimiq wallet'}</button>
        </form>
        ${sent > 0 ? html`<p class="muted small">You've cheered ${formatNim(sent)} NIM so far. 💛</p>` : ''}
      </section>

      <section class="card">
        <h3>How this works</h3>
        <p class="muted small">Your friend saves by <b>staking</b> NIM from their own wallet with Holdfast. You can see the stake on
        the public Nimiq blockchain, and if they start unstaking ("break the seal") this page shows it.</p>
        <button class="btn btn-link mono" id="copy-addr">${shortAddress(p.a)} · copy address</button>
      </section>
      <p class="center"><a class="btn btn-link" href="#/">Start your own goal with Holdfast →</a></p>
    </main>`.html

    const form = $<HTMLFormElement>('#cheer-form', root)!
    const amt = form.elements.namedItem('amount') as HTMLInputElement
    const hint = $('#cheer-hint', root)!
    const upd = () => {
      const l = parseNimInput(amt.value)
      hint.textContent = l ? fiatValues(l).map((v) => formatFiat(v.value, v.currency)).join(' · ') || ' ' : ' '
    }
    amt.addEventListener('input', upd)
    $$<HTMLButtonElement>('.chip-btn', form).forEach((b) =>
      b.addEventListener('click', () => {
        amt.value = b.dataset.amt!
        upd()
      }),
    )
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const luna = parseNimInput(amt.value)
      if (!luna) return toast('Pick an amount', 'error')
      const message = (form.elements.namedItem('message') as HTMLInputElement).value
      const btn = $<HTMLButtonElement>('button[type=submit]', form)
      void busy(btn, 'Opening wallet…', async () => {
        if (!friendWallet && insideNimiqPay()) friendWallet = await connectNimiqPay(8000)
        if (!friendWallet) {
          location.href = nimiqPaymentUri(p.a, toNim(luna), cheerData(message))
          return
        }
        try {
          await friendWallet.sendBasicTransactionWithData({ recipient: formatAddress(p.a), value: luna, data: cheerData(message) })
          addCheer(p.a, luna)
          toast('Cheer sent! 🎉', 'success')
          draw()
        } catch (err) {
          toast(isUserRejection(err) ? 'Cancelled' : `Could not send: ${errorMessage(err)}`, isUserRejection(err) ? 'info' : 'error')
        }
      })
    })
    $('#copy-addr', root)!.addEventListener('click', async () => {
      if (await copyText(formatAddress(p.a))) toast('Address copied', 'success')
    })
  }

  draw()
  if (chainAvailable()) {
    void getStaker(p.a).then((s) => {
      live.stake = s
      live.loading = false
      draw()
    })
  }
}
