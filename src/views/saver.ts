import { ctx, commit, refreshChain, loadValidators, fiatValues } from '../app'
import { chainAvailable } from '../lib/chain'
import { formatFiat, formatNim, formatAddress, isValidAddress, parseNimInput, pct, shortAddress, timeAgo, toLuna, toNim } from '../lib/format'
import {
  activeGoal,
  createGoal,
  markReachedIfDone,
  recordLock,
  recordRelease,
  recordRetire,
  recordUnlockStart,
  replaceGoal,
  savedLuna,
  type Goal,
  type GoalEvent,
} from '../lib/store'
import { keeperUrl, type KeeperPayload } from '../lib/share'
import { errorMessage, isUserRejection } from '../lib/wallet'
import { $, $$, busy, copyText, html, openSheet, raw, ring, toast, type Raw } from '../ui'
import { demoBadge, fiatRow, header, nim } from './common'

const EMOJIS = ['🎯', '🏠', '🎓', '✈️', '🚗', '💍', '📱', '🛡️', '👶', '💻', '🏥', '🎁']

// ---------- Landing (not connected) ----------

export function renderLanding(root: HTMLElement, onDemo: () => void): void {
  root.innerHTML = html`${header()}
  <main class="page landing">
    <section class="hero">
      <h1>Save it. Stake it. <span class="gold">Hold fast.</span></h1>
      <p class="lead">Lock savings goals by staking NIM from your own wallet. It earns rewards, stays yours,
        and a trusted friend keeps you honest.</p>
    </section>
    <ol class="pillars">
      <li><b>🔒 Lock it</b><span>Saving = staking. The unstaking cool-down puts a speed bump in front of impulse withdrawals.</span></li>
      <li><b>🛡️ Goalkeeper</b><span>Share a link with one friend. They see your progress, send a cheer in NIM and see if you break the seal.</span></li>
      <li><b>💵 Dollar view</b><span>Every goal in NIM, USD and NGN.</span></li>
    </ol>
    <div class="card center">
      <p><b>Open Holdfast inside Nimiq Pay</b> to use your wallet. Holdfast never holds your funds: every
        transaction is signed by you in Nimiq Pay.</p>
      <button class="btn btn-ghost" id="demo">Try the demo (no real NIM)</button>
    </div>
  </main>`.html
  $('#demo', root)!.addEventListener('click', onDemo)
}

export function renderConnecting(root: HTMLElement): void {
  root.innerHTML = html`${header()}
  <main class="page center-page"><div class="spinner big"></div><p class="muted">Connecting to Nimiq Pay…</p></main>`.html
}

// ---------- Home (connected) ----------

export function renderHome(root: HTMLElement): void {
  const goal = activeGoal(ctx.state)
  if (goal) return renderGoal(root, goal)
  renderNewGoal(root)
}

function pastGoals(): Raw {
  const past = ctx.state.goals.filter((g) => g.status !== 'active').slice(-5).reverse()
  if (!past.length) return html``
  return html`<section class="card"><h3>Past goals</h3><ul class="past">
    ${past.map(
      (g) => html`<li><span>${g.emoji} ${g.name}</span><span class="muted">${g.reachedAt ? 'Reached' : g.sealBrokenAt ? 'Seal broken' : 'Closed'} · ${formatNim(g.lockedLuna)} NIM</span></li>`,
    )}
  </ul></section>`
}

// ---------- New goal ----------

function renderNewGoal(root: HTMLElement): void {
  void loadValidators()
  const units = ['nim', ...ctx.fiats.filter((f) => ctx.prices?.rates[f])]
  const validatorOptions = ctx.validators.slice(0, 25)
  root.innerHTML = html`${header(demoBadge())}
  <main class="page">
    <section class="hero small">
      <h1>Start a goal</h1>
      <p class="lead">What are you holding fast for?</p>
    </section>
    <form id="goal-form" class="card form" novalidate>
      <label>Goal name
        <input name="name" maxlength="40" required placeholder="Rent buffer, new laptop…" autocomplete="off"/>
      </label>
      <fieldset class="emoji-pick" aria-label="Icon">
        ${EMOJIS.map((e, i) => html`<label><input type="radio" name="emoji" value="${e}" ${i === 0 ? raw('checked') : ''}/><span>${e}</span></label>`)}
      </fieldset>
      <label>Target
        <div class="amount-input">
          <input name="target" inputmode="decimal" required placeholder="0"/>
          <select name="unit" aria-label="Currency">${units.map((u) => html`<option value="${u}">${u.toUpperCase()}</option>`)}</select>
        </div>
        <span class="hint" id="target-hint">&nbsp;</span>
      </label>
      <label>Validator <span class="muted small">(who your stake is delegated to)</span>
        ${
          validatorOptions.length
            ? html`<select name="validator">${validatorOptions.map(
                (v) => html`<option value="${v.address}">${v.name}${v.fee !== null ? ` · ${(v.fee * 100).toFixed(1)}% fee` : ''}</option>`,
              )}<option value="__custom">Enter address…</option></select>`
            : html`<span class="hint">${ctx.validatorsLoaded ? 'Validator list unavailable. Paste a validator address:' : 'Loading validators…'}</span>`
        }
        <input name="validatorCustom" class="${validatorOptions.length ? 'hidden' : ''}" placeholder="NQ.. validator address" autocomplete="off" spellcheck="false"/>
        <span class="hint">Only used if you are not staking yet. Your NIM stays in your wallet's staking account, not with Holdfast.</span>
      </label>
      <button class="btn btn-primary" type="submit">Create goal</button>
    </form>
    ${pastGoals()}
  </main>`.html

  const form = $<HTMLFormElement>('#goal-form', root)!
  const sel = form.elements.namedItem('validator') as HTMLSelectElement | null
  const custom = form.elements.namedItem('validatorCustom') as HTMLInputElement
  sel?.addEventListener('change', () => custom.classList.toggle('hidden', sel.value !== '__custom'))
  const hint = $('#target-hint', root)!
  const updateHint = () => {
    const luna = targetLuna(form)
    if (!luna) return void (hint.innerHTML = '&nbsp;')
    const unit = (form.elements.namedItem('unit') as HTMLSelectElement).value
    const others = fiatValues(luna).filter((v) => v.currency !== unit)
    hint.textContent = [unit !== 'nim' ? `${formatNim(luna)} NIM` : '', ...others.map((v) => formatFiat(v.value, v.currency))]
      .filter(Boolean)
      .join(' · ')
  }
  form.addEventListener('input', updateHint)
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const name = (form.elements.namedItem('name') as HTMLInputElement).value.trim()
    const target = targetLuna(form)
    const emoji = (form.querySelector('input[name=emoji]:checked') as HTMLInputElement)?.value ?? '🎯'
    let validator: string | null = sel && sel.value !== '__custom' ? sel.value : custom.value.trim()
    if (!name) return toast('Give your goal a name', 'error')
    if (!target) return toast('Enter a target amount', 'error')
    if (validator && !isValidAddress(validator)) return toast('That validator address is not valid', 'error')
    validator = validator ? formatAddress(validator) : null
    const baseline = ctx.stake ? ctx.stake.balance : 0
    const goal = createGoal({ name, emoji, targetLuna: target, baselineLuna: baseline, validator })
    commit({ ...ctx.state, goals: [...ctx.state.goals, goal] })
    toast('Goal created. Lock your first NIM!', 'success')
  })
}

function targetLuna(form: HTMLFormElement): number | null {
  const raw = (form.elements.namedItem('target') as HTMLInputElement).value
  const unit = (form.elements.namedItem('unit') as HTMLSelectElement).value
  if (unit === 'nim') return parseNimInput(raw)
  const parsedFiat = parseNimInput(raw) // same number grammar, value in fiat*1e5
  const rate = ctx.prices?.rates[unit]
  if (!parsedFiat || !rate) return null
  return toLuna(toNim(parsedFiat) / rate)
}

// ---------- Goal dashboard ----------

function currentSaved(goal: Goal): number {
  return savedLuna(goal, ctx.stake ? ctx.stake.balance : null)
}

function renderGoal(root: HTMLElement, goal: Goal): void {
  const saved = currentSaved(goal)
  const reached = markReachedIfDone(goal, saved)
  if (reached !== goal) {
    commit(replaceGoal(ctx.state, reached))
    toast(`Goal reached: ${goal.name}! 🎉`, 'success')
    return
  }
  const p = pct(saved, goal.targetLuna)
  const left = Math.max(0, goal.targetLuna - saved)
  const rewards = ctx.stake ? saved - goal.lockedLuna : 0
  const source = ctx.stake ? 'Live from the Nimiq blockchain' : 'From your Holdfast ledger'
  root.innerHTML = html`${header(demoBadge())}
  <main class="page">
    <section class="goal-hero ${goal.sealBrokenAt ? 'broken' : ''} ${goal.reachedAt ? 'reached' : ''}">
      <div class="ring-wrap">
        ${ring(p)}
        <div class="ring-center">
          <div class="goal-emoji">${goal.emoji}</div>
          <div class="ring-pct">${Math.floor(p)}%</div>
        </div>
      </div>
      <h1 class="goal-name">${goal.name}</h1>
      <div class="big-amount">${nim(saved)} <span class="muted">of ${formatNim(goal.targetLuna)}</span></div>
      ${fiatRow(saved)}
      <div class="status-line">
        ${
          goal.reachedAt
            ? html`<span class="chip chip-good">🎉 Goal reached</span>`
            : goal.sealBrokenAt
              ? html`<span class="chip chip-bad">Seal broken ${timeAgo(goal.sealBrokenAt)}</span>`
              : html`<span class="chip chip-lock">🔒 Sealed · ${formatNim(left)} NIM to go</span>`
        }
        ${rewards > 0 ? html`<span class="chip chip-good">+${formatNim(rewards, { decimals: 2 })} NIM rewards</span>` : ''}
      </div>
      <p class="muted small">${source}${ctx.stake ? '' : chainAvailable() ? ' (chain unreachable)' : ''}</p>
    </section>

    ${goal.pendingUnlock ? unlockCard(goal) : ''}

    <section class="card">
      <h3>Lock more NIM</h3>
      <form id="lock-form" class="lock-form" novalidate>
        <div class="amount-input"><input name="amount" inputmode="decimal" placeholder="0" aria-label="Amount in NIM"/><span class="unit">NIM</span></div>
        <div class="chips">
          ${[10, 50, 100, 500].map((n) => html`<button type="button" class="chip-btn" data-amt="${n}">${n}</button>`)}
          ${left > 0 ? html`<button type="button" class="chip-btn" data-amt="${toNim(left)}">Rest</button>` : ''}
        </div>
        <span class="hint" id="lock-hint">${ctx.walletBalance !== null ? `Wallet: ${formatNim(ctx.walletBalance)} NIM` : ''}</span>
        <button class="btn btn-primary" type="submit">🔒 Lock into goal</button>
      </form>
      <p class="muted small">Locking stakes NIM from your own wallet. You sign every transaction in Nimiq Pay.</p>
    </section>

    <section class="card keeper-card">
      <h3>🛡️ Goalkeeper</h3>
      <p>Pick one trusted friend. They can watch your progress, send a cheer in NIM, and they'll see if you break the seal. No signup needed.</p>
      <button class="btn btn-secondary" id="share">Share Goalkeeper link</button>
    </section>

    <section class="card">
      <h3>Activity</h3>
      <ul class="timeline">${goal.events.slice().reverse().slice(0, 12).map(eventRow)}</ul>
    </section>

    <section class="danger-zone">
      ${
        goal.pendingUnlock
          ? ''
          : html`<button class="btn btn-danger-ghost" id="break">Break the seal (withdraw)</button>`
      }
      <button class="btn btn-link" id="close-goal">${goal.reachedAt ? 'Finish goal & start a new one' : 'Close this goal'}</button>
    </section>
    <p class="footnote muted small">Wallet ${shortAddress(ctx.address ?? '')} · Holdfast is non-custodial and never holds your NIM.</p>
  </main>`.html

  const form = $<HTMLFormElement>('#lock-form', root)!
  const input = form.elements.namedItem('amount') as HTMLInputElement
  const hint = $('#lock-hint', root)!
  const baseHint = hint.textContent ?? ''
  const updateHint = () => {
    const l = parseNimInput(input.value)
    const f = l ? fiatValues(l).map((v) => formatFiat(v.value, v.currency)).join(' · ') : ''
    hint.textContent = [f, baseHint].filter(Boolean).join('  ·  ')
  }
  input.addEventListener('input', updateHint)
  $$<HTMLButtonElement>('.chip-btn', form).forEach((b) =>
    b.addEventListener('click', () => {
      input.value = String(Number(b.dataset.amt).toFixed(5)).replace(/\.?0+$/, '')
      updateHint()
    }),
  )
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const luna = parseNimInput(input.value)
    if (!luna) return toast('Enter an amount to lock', 'error')
    void busy($('button[type=submit]', form) as HTMLButtonElement, 'Confirm in Nimiq Pay…', () => lock(goal, luna))
  })
  $('#share', root)!.addEventListener('click', () => shareKeeper(goal))
  $('#break', root)?.addEventListener('click', () => breakSeal(goal))
  $('#close-goal', root)!.addEventListener('click', () => closeGoal(goal))
  bindUnlockCard(root, goal)
}

function eventRow(e: GoalEvent): Raw {
  const label: Record<GoalEvent['type'], string> = {
    created: `🎯 Goal set: ${formatNim(e.luna)} NIM`,
    lock: `🔒 Locked ${formatNim(e.luna)} NIM`,
    unlock: `⚠️ Seal broken: unlocking ${formatNim(e.luna)} NIM`,
    retire: `⏳ Retired ${formatNim(e.luna)} NIM`,
    release: `↩️ ${formatNim(e.luna)} NIM back in wallet`,
    reached: `🎉 Goal reached`,
    shared: `🛡️ Goalkeeper link shared`,
  }
  return html`<li class="ev ev-${e.type}"><span>${label[e.type]}</span><time class="muted small">${timeAgo(e.at)}</time></li>`
}

async function lock(goal: Goal, luna: number): Promise<void> {
  const w = ctx.wallet
  if (!w) return
  const existingStaker =
    ctx.state.stakerCreated || (ctx.stake ? ctx.stake.balance + ctx.stake.inactiveBalance + ctx.stake.retiredBalance > 0 : false)
  try {
    let tx: string
    if (existingStaker) {
      tx = await w.sendStakeTransaction({ value: luna })
    } else {
      if (!goal.validator) {
        toast('Choose a validator first (close and recreate the goal with one)', 'error')
        return
      }
      try {
        tx = await w.sendNewStakerTransaction({ delegation: goal.validator, value: luna })
      } catch (err) {
        // Already a staker (e.g. staked earlier in Nimiq Pay): add to the existing stake instead.
        if (isUserRejection(err)) throw err
        tx = await w.sendStakeTransaction({ value: luna })
      }
    }
    const latest = ctx.state.goals.find((g) => g.id === goal.id) ?? goal
    commit({ ...replaceGoal(ctx.state, recordLock(latest, luna, tx)), stakerCreated: true })
    toast(`Locked ${formatNim(luna)} NIM. Hold fast! 🔒`, 'success')
    setTimeout(() => void refreshChain(), 4000)
  } catch (err) {
    toast(isUserRejection(err) ? 'Cancelled' : `Could not lock: ${errorMessage(err)}`, isUserRejection(err) ? 'info' : 'error')
  }
}

// ---------- Goalkeeper share ----------

function keeperPayload(goal: Goal): KeeperPayload {
  return {
    v: 1,
    n: goal.name,
    e: goal.emoji,
    t: goal.targetLuna,
    a: formatAddress(ctx.address ?? ''),
    b: goal.baselineLuna,
    c: goal.createdAt,
    s: currentSaved(goal),
    st: Date.now(),
    ...(goal.sealBrokenAt ? { x: goal.sealBrokenAt } : {}),
  }
}

function shareKeeper(goal: Goal): void {
  const url = keeperUrl(location.href, keeperPayload(goal))
  const text = `I'm saving for "${goal.name}" with Holdfast. Be my Goalkeeper: watch my progress, cheer me on, and call me out if I break the seal.`
  openSheet(
    html`<h2>Be my Goalkeeper</h2>
      <p class="muted">Send this link to <b>one</b> friend you trust. It shows your goal, progress and public wallet address. Re-share after big changes so the snapshot stays fresh.</p>
      <div class="share-url" id="share-url">${url}</div>
      <div class="row">
        <button class="btn btn-primary" id="do-share">Share…</button>
        <button class="btn btn-secondary" id="do-copy">Copy link</button>
      </div>
      <a class="btn btn-link" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}">Send via WhatsApp</a>`,
    (sheet) => {
      const mark = () => {
        const latest = ctx.state.goals.find((g) => g.id === goal.id) ?? goal
        commit(replaceGoal(ctx.state, { ...latest, events: [...latest.events, { type: 'shared', luna: 0, at: Date.now() }] }))
      }
      const nativeShare = $<HTMLButtonElement>('#do-share', sheet)!
      if (!navigator.share) nativeShare.classList.add('hidden')
      nativeShare.addEventListener('click', async () => {
        try {
          await navigator.share({ title: 'Holdfast Goalkeeper', text, url })
          mark()
        } catch {
          /* dismissed */
        }
      })
      $('#do-copy', sheet)!.addEventListener('click', async () => {
        if (await copyText(url)) {
          toast('Link copied', 'success')
          mark()
        } else toast('Copy failed. Long-press the link to copy.', 'error')
      })
    },
  )
}

// ---------- Breaking the seal (unstake) ----------

function breakSeal(goal: Goal): void {
  const max = goal.lockedLuna > 0 ? Math.max(goal.lockedLuna, currentSaved(goal)) : currentSaved(goal)
  openSheet(
    html`<h2>Break the seal?</h2>
      <p>You're <b>${Math.floor(pct(currentSaved(goal), goal.targetLuna))}%</b> of the way to <b>${goal.emoji} ${goal.name}</b>.
      Withdrawing stops rewards on that NIM and your Goalkeeper will see it.</p>
      <p class="muted small">Unstaking on Nimiq takes three steps: deactivate now, then after the network's cool-down
        retire it, then return it to your wallet. Holdfast walks you through each one.</p>
      <form id="unlock-form" class="form" novalidate>
        <label>Amount to withdraw
          <div class="amount-input"><input name="amount" inputmode="decimal" value="${toNim(max)}"/><span class="unit">NIM</span></div>
        </label>
        <label>Type <b>${goal.name}</b> to confirm
          <input name="confirm" autocomplete="off" spellcheck="false"/>
        </label>
        <button class="btn btn-danger" type="submit" disabled>Break the seal</button>
        <button class="btn btn-secondary" type="button" id="keep">Keep holding fast 💪</button>
      </form>`,
    (sheet, close) => {
      const form = $<HTMLFormElement>('#unlock-form', sheet)!
      const confirmInput = form.elements.namedItem('confirm') as HTMLInputElement
      const submit = $<HTMLButtonElement>('button[type=submit]', form)!
      confirmInput.addEventListener('input', () => {
        submit.disabled = confirmInput.value.trim().toLowerCase() !== goal.name.trim().toLowerCase()
      })
      $('#keep', sheet)!.addEventListener('click', () => {
        close()
        toast('Proud of you. Holding fast! 🛡️', 'success')
      })
      form.addEventListener('submit', (e) => {
        e.preventDefault()
        const luna = parseNimInput((form.elements.namedItem('amount') as HTMLInputElement).value)
        if (!luna) return toast('Enter an amount', 'error')
        if (luna > max) return toast(`You can withdraw at most ${formatNim(max)} NIM from this goal`, 'error')
        void busy(submit, 'Confirm in Nimiq Pay…', async () => {
          if (await startUnlock(goal, luna)) close()
        })
      })
    },
  )
}

async function startUnlock(goal: Goal, luna: number): Promise<boolean> {
  const w = ctx.wallet
  if (!w) return false
  // Active stake after deactivation. Prefer chain truth so stake outside this goal is untouched.
  // Without chain data, use Holdfast's ledger across all goals (minus withdrawals already underway).
  const ledgerActive = ctx.state.goals.reduce((a, g) => a + g.lockedLuna - (g.pendingUnlock?.luna ?? 0), 0)
  const currentActive = ctx.stake ? ctx.stake.balance : goal.baselineLuna + ledgerActive
  const newActiveBalance = Math.max(0, currentActive - luna)
  try {
    const tx = await w.sendSetActiveStakeTransaction({ newActiveBalance })
    const latest = ctx.state.goals.find((g) => g.id === goal.id) ?? goal
    commit(replaceGoal(ctx.state, recordUnlockStart(latest, luna, tx)))
    toast('Seal broken. Your NIM is cooling down.', 'info')
    setTimeout(() => void refreshChain(), 4000)
    return true
  } catch (err) {
    toast(isUserRejection(err) ? 'Cancelled. Still sealed 🔒' : `Could not unlock: ${errorMessage(err)}`, isUserRejection(err) ? 'info' : 'error')
    return false
  }
}

function unlockCard(goal: Goal): Raw {
  const p = goal.pendingUnlock!
  const step = p.step === 'inactive' ? 2 : 3
  return html`<section class="card unlock-card">
    <h3>Withdrawal in progress</h3>
    <ol class="steps">
      <li class="done">Deactivated ${formatNim(p.luna)} NIM</li>
      <li class="${step === 2 ? 'current' : 'done'}">Retire after the cool-down</li>
      <li class="${step === 3 ? 'current' : ''}">Return to wallet</li>
    </ol>
    <p class="muted small">Started ${timeAgo(p.startedAt)}. ${
      step === 2
        ? 'Stake can only be retired once the network cool-down (end of the current epoch plus a reporting window) has passed. If Nimiq Pay rejects it, try again later.'
        : 'Last step: move the NIM back to your spendable balance.'
    }</p>
    <button class="btn btn-secondary" id="unlock-next">${step === 2 ? 'Retire stake' : 'Return NIM to wallet'}</button>
  </section>`
}

function bindUnlockCard(root: HTMLElement, goal: Goal): void {
  const btn = $<HTMLButtonElement>('#unlock-next', root)
  const p = goal.pendingUnlock
  if (!btn || !p || !ctx.wallet) return
  const w = ctx.wallet
  btn.addEventListener('click', () =>
    void busy(btn, 'Confirm in Nimiq Pay…', async () => {
      try {
        const latest = ctx.state.goals.find((g) => g.id === goal.id) ?? goal
        if (p.step === 'inactive') {
          const tx = await w.sendRetireStakeTransaction({ retireStake: p.luna })
          commit(replaceGoal(ctx.state, recordRetire(latest, tx)))
          toast('Retired. One more step.', 'info')
        } else {
          const tx = await w.sendRemoveStakeTransaction({ value: p.luna })
          commit(replaceGoal(ctx.state, recordRelease(latest, tx)))
          toast('NIM returned to your wallet.', 'info')
        }
        setTimeout(() => void refreshChain(), 4000)
      } catch (err) {
        toast(
          isUserRejection(err) ? 'Cancelled' : `Not yet: ${errorMessage(err)}. The cool-down may still be running.`,
          isUserRejection(err) ? 'info' : 'error',
        )
      }
    }),
  )
}

function closeGoal(goal: Goal): void {
  openSheet(
    html`<h2>${goal.reachedAt ? 'Finish this goal?' : 'Close this goal?'}</h2>
      <p class="muted">Your NIM stays staked and keeps earning. Closing only archives the goal in Holdfast so you can start a new one.</p>
      <button class="btn btn-primary" id="confirm-close">${goal.reachedAt ? 'Finish goal' : 'Close goal'}</button>`,
    (sheet, close) => {
      $('#confirm-close', sheet)!.addEventListener('click', () => {
        const latest = ctx.state.goals.find((g) => g.id === goal.id) ?? goal
        commit(replaceGoal(ctx.state, { ...latest, status: latest.reachedAt ? 'completed' : 'archived' }))
        close()
      })
    },
  )
}
