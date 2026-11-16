import { ctx, emit, fiatValues } from '../app'
import { api, type PublicGoal } from '../lib/api'
import { chainAvailable, fetchCheers, getStakeTotals, readFreshFor, type Cheer, type Net, type StakerInfo } from '../lib/chain'
import { formatAddress, formatFiat, formatNim, LUNA_PER_NIM, parseNimInput, pct, shortAddress, timeAgo, toNim } from '../lib/format'
import { encodeKeeper, nimiqPaymentUri, type KeeperPayload } from '../lib/share'
import { connectNimiqPay, errorMessage, insideNimiqPay, isUserRejection, type Wallet } from '../lib/wallet'
import { $, $$, busy, copyText, html, ring, toast } from '../ui'
import { fiatRow, header, nim } from './common'
import { cheersForGoal, eventRow } from './saver'
import { goalSavings, walletBaselineKnown, type StoreState } from '../lib/store'

const CHEERS_KEY = 'holdfast.cheers.v1'
const MAX_DATA_BYTES = 64

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

/**
 * The transaction message for a cheer, at most 64 bytes of UTF-8. With a goal id it names the goal
 * ("Holdfast cheer <first 8 of id>: ..."), so the cheer shows on that goal only.
 */
export function cheerData(message: string, goalId?: string): string {
  const tag = goalId && /^[A-Za-z0-9]{6,32}$/.test(goalId) ? ` ${goalId.slice(0, 8)}` : ''
  const prefix = `Holdfast cheer${tag}: `
  const enc = new TextEncoder()
  let msg = message.trim() || '💪'
  while (enc.encode(prefix + msg).length > MAX_DATA_BYTES) msg = [...msg].slice(0, -1).join('')
  return prefix + msg
}

/**
 * What the Goalkeeper page knows beyond the link itself. Kept between redraws so the page does not
 * fetch again every time it redraws (prices, theme...).
 */
interface KeeperData {
  key: string
  /** The saver's backed-up goal. undefined while loading, null if there is none. */
  server: PublicGoal | null | undefined
  stake: StakerInfo | null
  stakeLoading: boolean
  cheers: Cheer[] | null
  loadedAt: number
}
let data: KeeperData | null = null
const REFRESH_MS = 30_000

function load(p: KeeperPayload, key: string): void {
  const net: Net = p.nt ? 'testnet' : 'mainnet'
  const mine: KeeperData = { key, server: p.g ? undefined : null, stake: null, stakeLoading: chainAvailable(), cheers: data?.key === key ? data.cheers : null, loadedAt: Date.now() }
  if (data?.key === key) Object.assign(mine, { server: data.server ?? mine.server, stake: data.stake })
  data = mine
  const current = () => data === mine

  const readStake = (accounts: string[]) => {
    if (!chainAvailable()) return
    void getStakeTotals(accounts, net).then((stake) => {
      if (!current()) return
      mine.stake = stake ?? mine.stake
      mine.stakeLoading = false
      emit()
    })
  }
  const fallbackAccounts = [p.a, ...(p.as ?? [])]
  if (p.g && ctx.apiAvailable !== false) {
    api
      .goal(p.a, p.g)
      .then((r) => {
        if (!current()) return
        mine.server = r
        readStake(r.accounts)
      })
      .catch(() => {
        if (!current()) return
        mine.server = null
        readStake(fallbackAccounts)
      })
      .finally(() => current() && emit())
  } else {
    mine.server = null
    readStake(fallbackAccounts)
  }
  void fetchCheers(p.a, net).then((cheers) => {
    if (!current()) return
    if (cheers) mine.cheers = cheers
    emit()
  })
}

/**
 * Whether the saver's starting stake is known, using the same rule as the saver's own screen: a
 * goal that says so, or an older goal with a non-zero baseline. A link without a backed-up goal
 * only has the baseline in the link, which is reliable when it is not zero.
 */
export function keeperBaselineKnown(g: { baselineFromChain?: boolean; baselineLuna: number } | null, p: { b: number }): boolean {
  if (g) return g.baselineFromChain === true || (g.baselineFromChain === undefined && g.baselineLuna > 0)
  return p.b > 0
}

/**
 * This goal's share of the saver's live stake, with the same rule the saver's own screen uses
 * (goalSavings over every active goal). null when it can't be worked out from chain data: no
 * backed-up wallet, a closed goal, or a wallet baseline that isn't known yet.
 */
export function keeperGoalShare(server: PublicGoal | null | undefined, liveActive: number | null): number | null {
  const g = server?.goal
  if (!g || g.status !== 'active' || liveActive === null) return null
  const w = server.wallet
  // Older backups (one goal, no wallet section): the goal's own starting stake is the wallet baseline.
  const baselineKnown = w?.baselineFromChain ?? keeperBaselineKnown(g, { b: 0 })
  const baseline = w?.baselineFromChain != null ? (w.baselineLuna ?? 0) : g.baselineLuna
  const ledgers = w?.goals.length ? w.goals : [{ self: true, lockedLuna: g.lockedLuna, pendingLuna: g.pendingUnlock?.luna ?? 0, rewardLuna: g.rewardLuna ?? 0 }]
  const state: StoreState = {
    version: 1,
    stakerCreated: true,
    walletBaselineLuna: baseline,
    walletBaselineFromChain: baselineKnown,
    goals: ledgers.map((l, i) => ({
      id: l.self ? 'self' : `other${i}`,
      name: '',
      emoji: '',
      targetLuna: 0,
      createdAt: 0,
      baselineLuna: 0,
      lockedLuna: l.lockedLuna,
      rewardLuna: l.rewardLuna ?? 0,
      validator: null,
      status: 'active',
      sealBrokenAt: null,
      reachedAt: null,
      pendingUnlock: l.pendingLuna ? { luna: l.pendingLuna, step: 'inactive', startedAt: 0 } : null,
      events: [],
    })),
  }
  if (!walletBaselineKnown(state)) return null
  return goalSavings(state, liveActive).get('self') ?? null
}

export function renderKeeper(root: HTMLElement, p: KeeperPayload): void {
  const key = encodeKeeper(p)
  if (!data || data.key !== key || Date.now() - data.loadedAt > REFRESH_MS) load(p, key)
  const d = data!
  let friendWallet: Wallet | null = ctx.wallet

  const g = d.server?.goal ?? null
  const name = g?.name ?? p.n
  const emoji = g?.emoji ?? p.e
  const target = g?.targetLuna ?? p.t
  const createdAt = g?.createdAt ?? p.c
  const snapshot = g ? g.savedLuna : p.s
  // With a backed-up goal: this goal's share of the live stake, divided like on the saver's screen.
  // A link without a backup (older links) uses the stake above the starting stake in the link.
  const share = d.server ? keeperGoalShare(d.server, d.stake ? d.stake.balance : null) : null
  const linkOnly = !d.server && d.stake !== null && keeperBaselineKnown(null, p)
  const chainOk = share !== null || linkOnly
  const saved = share !== null ? share : linkOnly ? Math.max(0, d.stake!.balance - p.b) : snapshot
  // Small differences (rounding, a few rewards paid out) are noise, not a broken seal.
  const noise = Math.max(LUNA_PER_NIM, snapshot * 0.02)
  // With a backup, "withdrawing" is this goal's own withdrawal; other goals don't affect it.
  const withdrawing = g ? (g.pendingUnlock?.luna ?? 0) : d.stake ? d.stake.inactiveBalance + d.stake.retiredBalance : 0
  const leaving = g ? withdrawing : withdrawing > noise ? withdrawing : 0
  const sealBrokenAt = g?.sealBrokenAt ?? p.x ?? null
  // Stake that disappeared since the last update, without a withdrawal through Holdfast.
  const dropped = chainOk && snapshot - saved > noise
  const reached = !!g?.reachedAt || saved >= target
  const closed = !!g && g.status !== 'active' && !reached
  const broken = !reached && (!!sealBrokenAt || leaving > 0 || dropped)
  const percent = pct(saved, target)
  const sent = cheersSent(p.a)
  const owner = d.server?.owner.name ?? p.w ?? null
  const cheers = cheersForGoal(d.cheers ?? [], { id: p.g ?? '', createdAt })
  const cheersLuna = cheers.reduce((a, c) => a + c.luna, 0)
  const source = d.stakeLoading && d.stake === null
    ? 'Checking the blockchain…'
    : chainOk
      ? 'Live from the Nimiq blockchain'
      : d.server
        ? `Updated ${timeAgo(d.server.updatedAt)}`
        : d.server === undefined
          ? 'Loading the latest progress…'
          : `Snapshot shared ${timeAgo(p.st)}`

  root.innerHTML = html`${header(html`<span class="badge">Goalkeeper</span>`)}
    <main class="page keeper">
      <p class="eyebrow">${owner ? html`You're <b>${owner}</b>'s Goalkeeper` : "You're the Goalkeeper for"}</p>
      <section class="goal-hero ${broken ? 'broken' : ''} ${reached ? 'reached' : ''}">
        <div class="ring-wrap">
          ${ring(percent)}
          <div class="ring-center"><div class="goal-emoji">${emoji}</div><div class="ring-pct">${Math.floor(percent)}%</div></div>
        </div>
        <h1 class="goal-name">${name}</h1>
        <div class="big-amount">${nim(saved)} <span class="muted">of ${formatNim(target)}</span></div>
        ${fiatRow(saved)}
        <div class="status-line">
          ${
            reached
              ? html`<span class="chip chip-good">🎉 Goal reached</span>`
              : broken
                ? html`<span class="chip chip-bad">⚠️ Seal broken${sealBrokenAt ? ` ${timeAgo(sealBrokenAt)}` : ''}</span>`
                : closed
                  ? html`<span class="chip chip-muted">Goal closed</span>`
                  : html`<span class="chip chip-lock">🔒 Still sealed</span>`
          }
          ${cheersLuna > 0 ? html`<span class="chip chip-gold">🎉 ${formatNim(cheersLuna)} NIM cheered</span>` : ''}
        </div>
        ${
          leaving > 0
            ? html`<p class="alert">${formatNim(leaving)} NIM is being withdrawn from staking right now. Maybe check in with your friend?</p>`
            : ''
        }
        <p class="muted small">${source} · Saving since ${new Date(createdAt).toLocaleDateString()}</p>
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

      ${
        cheers.length
          ? html`<section class="card cheers-card">
              <h3>Cheer wall</h3>
              <ul class="cheers">${cheers.slice(0, 8).map(
                (c) => html`<li><span class="cheer-amt">+${formatNim(c.luna)}</span><span class="cheer-msg">${c.message || '💪'}
                  <span class="muted small">${c.from} · ${timeAgo(c.at)}</span></span></li>`,
              )}</ul>
              <p class="muted small">Read from the public Nimiq blockchain.</p>
            </section>`
          : ''
      }

      ${
        g && g.events.some((e) => e.type !== 'shared')
          ? html`<section class="card">
              <h3>Recent activity</h3>
              <ul class="timeline">${g.events.filter((e) => e.type !== 'shared').slice(-6).reverse().map(eventRow)}</ul>
            </section>`
          : ''
      }

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
        location.href = nimiqPaymentUri(p.a, toNim(luna), cheerData(message, p.g))
        return
      }
      try {
        await friendWallet.sendBasicTransactionWithData({ recipient: formatAddress(p.a), value: luna, data: cheerData(message, p.g) })
        addCheer(p.a, luna)
        toast('Cheer sent! 🎉', 'success')
        emit(true)
        // Show it on the cheer wall once the network has it (a block takes about a second).
        readFreshFor(60_000)
        window.setTimeout(() => {
          if (data) data.loadedAt = 0
          emit(true)
        }, 5000)
      } catch (err) {
        toast(isUserRejection(err) ? 'Cancelled' : `Could not send: ${errorMessage(err)}`, isUserRejection(err) ? 'info' : 'error')
      }
    })
  })
  $('#copy-addr', root)!.addEventListener('click', async () => {
    if (await copyText(formatAddress(p.a))) toast('Address copied', 'success')
  })
}
