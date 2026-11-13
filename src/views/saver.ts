import { ctx, commit, readLiveStake, refreshBalance, refreshChain, refreshCheers, loadValidators, fiatValues } from '../app'
import { backupNow } from '../account'
import { chainAvailable, readFreshFor } from '../lib/chain'
import { formatFiat, formatNim, formatAddress, isValidAddress, parseNimInput, pct, shortAddress, timeAgo, toLuna, toNim } from '../lib/format'
import {
  activeGoal,
  baselineUnknown,
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
import { errorMessage, hostNetwork, isUserRejection } from '../lib/wallet'
import { isMobileDevice, miniAppTarget, miniAppUrl, NIMIQ_PAY_INSTALL_URL, nimiqPayDeepLink } from '../lib/deeplink'
import { pendingInviteCode } from '../lib/identity'
import { $, $$, busy, copyText, html, openSheet, raw, ring, toast, type Raw } from '../ui'
import { fiatRow, header, nim } from './common'

const EMOJIS = ['🎯', '🏠', '🎓', '✈️', '🚗', '💍', '📱', '🛡️', '👶', '💻', '🏥', '🎁']

// ---------- Landing (not connected) ----------

/** The four things that happen when you lock NIM, drawn as links of one chain. */
const lockChain = raw(`<svg class="chain" viewBox="0 0 288 132" role="img" aria-label="Four linked steps: approve in Nimiq Pay, staked from your own wallet, earning staking rewards, visible to your Goalkeeper.">
  <circle class="link l0" cx="45" cy="48" r="40"/>
  <circle class="link l1" cx="111" cy="48" r="40"/>
  <circle class="link l0" cx="177" cy="48" r="40"/>
  <circle class="link l1" cx="243" cy="48" r="40"/>
  <path class="gap" d="M74.1 20.5 A40 40 0 0 1 81.1 30.8"/><path class="link l0" d="M72.6 19.0 A40 40 0 0 1 82.0 32.7"/>
  <path class="gap" d="M81.9 75.5 A40 40 0 0 1 74.9 65.2"/><path class="link l1" d="M83.4 77.0 A40 40 0 0 1 74.0 63.3"/>
  <path class="gap" d="M140.1 20.5 A40 40 0 0 1 147.1 30.8"/><path class="link l1" d="M138.6 19.0 A40 40 0 0 1 148.0 32.7"/>
  <path class="gap" d="M147.9 75.5 A40 40 0 0 1 140.9 65.2"/><path class="link l0" d="M149.4 77.0 A40 40 0 0 1 140.0 63.3"/>
  <path class="gap" d="M206.1 20.5 A40 40 0 0 1 213.1 30.8"/><path class="link l0" d="M204.6 19.0 A40 40 0 0 1 214.0 32.7"/>
  <path class="gap" d="M213.9 75.5 A40 40 0 0 1 206.9 65.2"/><path class="link l1" d="M215.4 77.0 A40 40 0 0 1 206.0 63.3"/>
  <text class="link-icon" x="45" y="56">👍</text>
  <text class="link-text" x="45" y="110">Approve in</text><text class="link-text" x="45" y="124">Nimiq Pay</text>
  <text class="link-icon" x="111" y="56">🔒</text>
  <text class="link-text" x="111" y="110">Staked from</text><text class="link-text" x="111" y="124">your wallet</text>
  <text class="link-icon" x="177" y="56">🌱</text>
  <text class="link-text" x="177" y="110">Earning</text><text class="link-text" x="177" y="124">rewards</text>
  <text class="link-icon" x="243" y="56">🛡️</text>
  <text class="link-text" x="243" y="110">Goalkeeper</text><text class="link-text" x="243" y="124">sees it</text>
</svg>`)

/** Who does what: you lock NIM into the goal, your Goalkeeper sees the progress and cheers you on. */
const keeperDiagram = raw(`<svg class="diagram" viewBox="0 0 360 240" role="img" aria-label="You lock NIM into your goal. Your Goalkeeper sees the progress and sends you cheers.">
  <defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z"/></marker></defs>
  <path class="edge" d="M98 96 Q180 34 238 54" marker-end="url(#arrow)"/>
  <path class="edge" d="M274 100 V140" marker-end="url(#arrow)"/>
  <path class="edge" d="M238 186 Q160 214 96 148" marker-end="url(#arrow)"/>
  <text class="edge-label" x="150" y="46">lock NIM</text>
  <text class="edge-label" x="286" y="125">progress</text>
  <text class="edge-label" x="128" y="216">cheers</text>
  <g class="node"><circle cx="64" cy="120" r="36"/><text x="64" y="125">You</text></g>
  <g class="node node-goal"><circle cx="274" cy="62" r="36"/><text x="274" y="67">Goal</text></g>
  <g class="node"><circle cx="274" cy="180" r="36"/><text x="274" y="185">Friend</text></g>
</svg>`)

const FAQ: [string, string][] = [
  [
    'Do I need Nimiq Pay?',
    'Yes. Holdfast is a Mini App that runs inside the Nimiq Pay wallet, so saving and locking happen there. A friend who is only your Goalkeeper can follow your progress in any browser.',
  ],
  [
    'Where is my money while it is locked?',
    'In your own wallet. Locking stakes your NIM on the Nimiq network from your wallet. Holdfast never holds your funds or your keys, and you approve every transaction in Nimiq Pay.',
  ],
  [
    'Can I take my money out?',
    'Always. Tap Break the seal, type the goal name to confirm, and Holdfast walks you through the three unstaking steps. The Nimiq network adds a cool-down before the NIM is back in your balance, and your Goalkeeper sees that you withdrew.',
  ],
  [
    'What does my Goalkeeper see?',
    'Your goal name, target, progress and public wallet address, and whether the seal is broken. They can send you a cheer in NIM. They cannot move or touch your savings.',
  ],
  [
    'What does it cost?',
    'Holdfast is free and takes no cut of your savings or rewards. The validator your stake is delegated to may keep a small share of the staking rewards.',
  ],
  [
    'What if I lose my phone?',
    'Your staked NIM belongs to your Nimiq wallet, not to Holdfast. Restore the wallet in Nimiq Pay and the stake is still there. Goal names and history are saved on the device, so you would set those up again.',
  ],
]

/** 950 → "950", 12,400 → "12.4K", 100,000 → "100K", 2,500,000 → "2.5M": always fits a small tile. */
export function compactNumber(n: number): string {
  const units: [number, string][] = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]
  for (const [size, suffix] of units) {
    if (n >= size) {
      const v = n / size
      return `${v >= 100 ? Math.floor(v) : Math.floor(v * 10) / 10}${suffix}`
    }
  }
  return String(Math.floor(n))
}

/** Live usage numbers, shown once there is something to show. */
export function statsStrip(): Raw {
  const st = ctx.stats
  if (!st || st.savers < 1) return html``
  const tile = (value: string, label: string, full: string) =>
    html`<li class="stats-tile" title="${full}"><b>${value}</b><span class="stats-label">${label}</span></li>`
  const nim = Math.floor(toNim(st.lockedLuna))
  return html`<ul class="stats-strip" aria-label="Holdfast in numbers">
    ${tile(compactNumber(st.savers), st.savers === 1 ? 'saver' : 'savers', `${st.savers.toLocaleString('en-US')} savers`)}
    ${tile(compactNumber(st.activeGoals), st.activeGoals === 1 ? 'active goal' : 'active goals', `${st.activeGoals.toLocaleString('en-US')} active goals`)}
    ${tile(compactNumber(nim), 'NIM locked', `${nim.toLocaleString('en-US')} NIM locked`)}
  </ul>`
}

export function renderLanding(root: HTMLElement): void {
  // An invited visitor keeps their invite code when they move over to Nimiq Pay.
  const inviteCode = ctx.invite?.code ?? pendingInviteCode()
  const deepLink = nimiqPayDeepLink(miniAppTarget(location, inviteCode))
  const pasteUrl = miniAppUrl(location, inviteCode)
  const mobile = isMobileDevice()
  const openButton = (id: string, cls: string, label: string) =>
    html`<a class="btn btn-primary open-np ${cls}" ${id ? raw(`id="${id}"`) : ''} href="${deepLink}">${label}</a>`

  root.innerHTML = html`<div class="landing-wrap">
  ${header(openButton('open-nimiq-pay', 'btn-compact', 'Open in Nimiq Pay'))}
  <main class="page landing">
    ${
      // Shown for a few seconds on the visit that arrived through the link, then it clears.
      ctx.invite && Date.now() < ctx.inviteBannerUntil
        ? html`<p class="invite-banner" role="status" style="${raw(`animation-delay:${Math.max(0, ctx.inviteBannerUntil - Date.now() - 500)}ms`)}">🎉 <b>${ctx.invite.name}</b> invited you to Holdfast</p>`
        : ''
    }

    <section class="l-hero">
      <h1>Save it. Stake it. <span class="gold">Hold fast.</span></h1>
      <p class="lead">Lock savings goals by staking NIM from your own wallet. It earns rewards, stays yours,
        and a trusted friend keeps you honest.</p>
      ${statsStrip()}
      <div id="open-help" class="open-help ${mobile ? 'hidden' : ''}">
        <p><b>${mobile ? 'Nothing happened?' : 'On a computer?'}</b>
          ${mobile ? 'Nimiq Pay may not be installed, or your browser blocked the link.' : 'Open this page on the phone where Nimiq Pay is installed, or:'}</p>
        <ol>
          <li><a href="${NIMIQ_PAY_INSTALL_URL}" target="_blank" rel="noopener">Get Nimiq Pay</a> if you don't have it.</li>
          <li>In Nimiq Pay, open <b>Mini Apps</b> and choose <b>Custom URL</b>.</li>
          <li>Paste this address:</li>
        </ol>
        <div class="share-url" id="paste-url">${pasteUrl}</div>
        <button class="btn btn-secondary" id="copy-url">Copy address</button>
      </div>
    </section>

    <section class="l-panel" aria-label="Saving without Holdfast">
      <h3 class="l-label">Your savings, most months</h3>
      <div class="bubbles">
        <p>I'll just borrow 20 from savings</p>
        <p class="right">putting it back on Friday</p>
        <p>wait, how much was in there?</p>
        <p class="right">it's only this once (again)</p>
        <p>new goal: start over next month</p>
      </div>
    </section>

    <section class="l-panel" aria-label="The same month with Holdfast">
      <h3 class="l-label">The same month in Holdfast</h3>
      <ul class="l-rows">
        <li><span>500 NIM locked for Rent buffer</span><span class="chip chip-lock">Sealed</span></li>
        <li><span>Staking rewards on your goal</span><span class="chip chip-good">Earning</span></li>
        <li><span>Ada cheered you 10 NIM</span><span class="chip chip-gold">Cheer</span></li>
        <li><span>Impulse withdrawal</span><span class="chip chip-bad">Cool-down</span></li>
      </ul>
    </section>

    <section class="l-block">
      <div class="l-panel lock-panel">
        <span class="l-label">Lock</span>
        <b class="lock-title">50 NIM into Rent buffer</b>
        ${lockChain}
        <div class="lock-result">🔒 Sealed. Still yours.</div>
      </div>
      <h2>Locked is not gone. It never leaves your wallet.</h2>
      <p class="lead">Saving in Holdfast means staking. Your NIM stays in your own Nimiq wallet and earns rewards while it waits.
        Getting it back takes a deliberate, three-step withdrawal, which is exactly the speed bump an impulse needs.</p>
    </section>

    <section class="l-block">
      <div class="l-panel">${keeperDiagram}</div>
      <h2>One friend keeps you honest.</h2>
      <p class="lead">Share a link with a friend you trust. Without signing up, your Goalkeeper sees your progress,
        can send you a cheer in NIM, and sees it if you break the seal.</p>
    </section>

    <section class="l-block">
      <div class="l-panel">
        <h3 class="l-label">Rent buffer, 37% there</h3>
        <ul class="l-rows worth">
          <li><span>NIM</span><b>1,500</b></li>
          <li><span>USDT</span><b>1.80</b></li>
          <li><span>Naira</span><b>₦2,775</b></li>
        </ul>
      </div>
      <h2>Know what your goal is worth.</h2>
      <p class="lead">Every goal shows in NIM, USDT and naira, and you can set your target in whichever one you think in.</p>
    </section>

    <section class="l-faq">
      <h2>FAQs</h2>
      ${FAQ.map(([q, a]) => html`<details class="faq"><summary><span>${q}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary><p>${a}</p></details>`)}
    </section>

    <section class="l-end">
      ${openButton('', '', 'Open in Nimiq Pay ↗')}
      ${ctx.apiAvailable ? html`<a class="btn btn-ghost" href="#/board">🏆 See the leaderboard</a>` : ''}
      <p class="muted small center">Holdfast is non-custodial. It never holds your NIM.</p>
    </section>
  </main></div>`.html

  // If Nimiq Pay doesn't take over within a few seconds, show the manual way in.
  $$<HTMLAnchorElement>('.open-np', root).forEach((link) =>
    link.addEventListener('click', () => {
      window.setTimeout(() => {
        if (document.visibilityState !== 'visible') return
        const help = $('#open-help')
        help?.classList.remove('hidden')
        help?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 2500)
    }),
  )
  $('#copy-url', root)!.addEventListener('click', async () => {
    if (await copyText(pasteUrl)) toast('Address copied. Paste it in Nimiq Pay.', 'success')
    else toast('Copy failed. Long-press the address to copy.', 'error')
  })
}

export function renderConnecting(root: HTMLElement): void {
  root.innerHTML = html`${header()}
  <main class="page center-page">
    <div class="spinner big"></div>
    <h2>Connecting to your wallet…</h2>
    <p class="muted">If Nimiq Pay asks, approve the request so Holdfast can see your wallet address.</p>
  </main>`.html
}

/** Shown instead of an endless spinner when Nimiq Pay doesn't answer or the user declines. */
export function renderConnectFailed(root: HTMLElement, message: string, onRetry: () => void): void {
  root.innerHTML = html`${header()}
  <main class="page center-page">
    <div class="connect-icon" aria-hidden="true">🔌</div>
    <h2>Wallet not connected</h2>
    <p class="muted">${message}</p>
    <button class="btn btn-primary" id="retry">Connect Nimiq Pay</button>
    <p class="muted small">Holdfast only reads your wallet address. It can't move NIM without your approval.</p>
  </main>`.html
  $('#retry', root)!.addEventListener('click', onRetry)
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
  root.innerHTML = html`${header()}
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
    void busy($<HTMLButtonElement>('button[type=submit]', form), 'Creating…', async () => {
      // Stake you already have doesn't count toward a new goal, so read it first.
      if (!ctx.stake && chainAvailable()) await refreshChain()
      const goal = createGoal({
        name,
        emoji,
        targetLuna: target,
        baselineLuna: ctx.stake ? ctx.stake.balance : 0,
        baselineFromChain: !!ctx.stake,
        validator,
      })
      commit({ ...ctx.state, goals: [...ctx.state.goals, goal] })
      toast('Goal created. Lock your first NIM!', 'success')
    })
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
  // The lock form shows the wallet balance as a hint; this is the only screen that asks for it.
  void refreshBalance()
  void refreshCheers()
  const cheers = (ctx.cheers ?? []).filter((c) => c.at >= goal.createdAt)
  const cheersLuna = cheers.reduce((a, c) => a + c.luna, 0)
  const p = pct(saved, goal.targetLuna)
  const left = Math.max(0, goal.targetLuna - saved)
  const rewards = ctx.stake && !baselineUnknown(goal) ? saved - goal.lockedLuna : 0
  const live = !!ctx.stake && !baselineUnknown(goal)
  const source = live ? 'Live from the Nimiq blockchain' : 'From your Holdfast ledger'
  root.innerHTML = html`${header()}
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

    ${
      cheers.length
        ? html`<section class="card cheers-card">
            <h3>🎉 Cheers received <span class="muted">${formatNim(cheersLuna)} NIM</span></h3>
            <ul class="cheers">${cheers.slice(0, 5).map(
              (c) => html`<li><span class="cheer-amt">+${formatNim(c.luna)}</span><span class="cheer-msg">${c.message || '💪'}
                <span class="muted small">${c.from} · ${timeAgo(c.at)}</span></span></li>`,
            )}</ul>
            ${
              goal.reachedAt
                ? ''
                : html`<button class="btn btn-ghost" id="lock-cheers" data-amt="${toNim(Math.min(cheersLuna, left || cheersLuna))}">🔒 Lock cheers into this goal</button>`
            }
            <p class="muted small">Cheers land in your wallet's normal balance. Locking them makes them part of your goal.</p>
          </section>`
        : ''
    }

    <section class="card keeper-card">
      <h3>🛡️ Goalkeeper</h3>
      <p>Pick one trusted friend. They can watch your progress, send a cheer in NIM, and they'll see if you break the seal. No signup needed.</p>
      <button class="btn btn-secondary" id="share">Share Goalkeeper link</button>
      ${backupNote()}
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
  $('#lock-cheers', root)?.addEventListener('click', (e) => {
    input.value = String(Number((e.currentTarget as HTMLElement).dataset.amt).toFixed(5)).replace(/\.?0+$/, '')
    updateHint()
    input.scrollIntoView({ behavior: 'smooth', block: 'center' })
    input.focus()
  })
  $('#share', root)!.addEventListener('click', (e) =>
    void busy(e.currentTarget as HTMLButtonElement, 'Preparing link…', async () => {
      // Make sure the profile has the latest version, so the link opens on fresh numbers.
      await backupNow()
      shareKeeper(goal)
    }),
  )
  $('#break', root)?.addEventListener('click', (e) =>
    void busy(e.currentTarget as HTMLButtonElement, 'Checking your stake…', () => breakSeal(goal)),
  )
  $('#close-goal', root)!.addEventListener('click', () => closeGoal(goal))
  bindUnlockCard(root, goal)
}

/** Whether this goal is backed up, which is what keeps the Goalkeeper's link live. */
function backupNote(): Raw {
  if (ctx.apiAvailable !== true) return html``
  if (ctx.profileStatus === 'ready')
    return html`<p class="muted small">☁️ Backed up to your profile${ctx.syncedAt ? ` ${timeAgo(ctx.syncedAt)}` : ''}. Your Goalkeeper's link shows live progress.</p>`
  return html`<p class="muted small"><a href="#/me">Create your profile</a> to back up this goal and keep your Goalkeeper's link live. Without it, they see a snapshot.</p>`
}

export function eventRow(e: GoalEvent): Raw {
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
  // Knowing whether this wallet already stakes decides which transaction Nimiq Pay is asked for.
  if (!ctx.stake && chainAvailable()) await refreshChain()
  const existingStaker =
    ctx.state.stakerCreated || (ctx.stake ? ctx.stake.balance + ctx.stake.inactiveBalance + ctx.stake.retiredBalance > 0 : false)
  try {
    let tx: string
    if (existingStaker) {
      tx = await w.sendStakeTransaction({ value: luna })
    } else {
      // A goal created before the validator list had loaded has no validator yet. Use the
      // top-ranked one, which is also the form's default choice, and remember it on the goal.
      let validator = goal.validator
      if (!validator) {
        await loadValidators(true)
        validator = ctx.validators[0] ? formatAddress(ctx.validators[0].address) : null
        if (!validator) {
          toast("Couldn't load the validator list. Check your connection and try again.", 'error')
          return
        }
        const current = ctx.state.goals.find((g) => g.id === goal.id) ?? goal
        commit(replaceGoal(ctx.state, { ...current, validator }))
      }
      try {
        tx = await w.sendNewStakerTransaction({ delegation: validator, value: luna })
      } catch (err) {
        // Already a staker (e.g. staked earlier in Nimiq Pay): add to the existing stake instead.
        if (isUserRejection(err)) throw err
        tx = await w.sendStakeTransaction({ value: luna })
      }
    }
    const latest = ctx.state.goals.find((g) => g.id === goal.id) ?? goal
    commit({ ...replaceGoal(ctx.state, recordLock(latest, luna, tx)), stakerCreated: true })
    toast(`Locked ${formatNim(luna)} NIM. Hold fast! 🔒`, 'success')
    afterTransaction()
  } catch (err) {
    toast(isUserRejection(err) ? 'Cancelled' : `Could not lock: ${errorMessage(err)}`, isUserRejection(err) ? 'info' : 'error')
  }
}

/** Re-read stake and balance a little after a transaction, skipping cached readings. */
function afterTransaction(): void {
  readFreshFor(60_000)
  setTimeout(() => (void refreshChain(), void refreshBalance(true)), 4000)
  setTimeout(() => void refreshChain(), 15_000)
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
    g: goal.id,
    ...(ctx.accounts.length > 1 ? { as: ctx.accounts.slice(1, 4).map((a) => a.replace(/\s/g, '')) } : {}),
    ...(hostNetwork() === 'testnet' ? { nt: 1 as const } : {}),
    ...(ctx.profile ? { w: ctx.profile.name } : {}),
  }
}

function shareKeeper(goal: Goal): void {
  const url = keeperUrl(location.href, keeperPayload(goal))
  const text = `I'm saving for "${goal.name}" with Holdfast. Be my Goalkeeper: watch my progress, cheer me on, and call me out if I break the seal.`
  openSheet(
    html`<h2>Be my Goalkeeper</h2>
      <p class="muted">Send this link to <b>one</b> friend you trust. It shows your goal, progress and public wallet address.
        ${ctx.profileStatus === 'ready' ? 'It always shows your latest progress.' : 'Without a profile it shows a snapshot, so re-share it after big changes.'}</p>
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

/**
 * How much of the live active stake belongs to this goal: what it has saved (or, while its
 * starting stake is unknown, what Holdfast locked for it), never more than is actually active.
 */
function goalShare(goal: Goal, liveActive: number): number {
  const own = baselineUnknown(goal) ? goal.lockedLuna - (goal.pendingUnlock?.luna ?? 0) : savedLuna(goal, liveActive)
  return Math.max(0, Math.min(liveActive, own))
}

async function breakSeal(goal: Goal): Promise<void> {
  // Withdrawing sets the wallet's *total* active stake. Without a fresh reading Holdfast could
  // switch off stake that has nothing to do with this goal, so it never guesses.
  const live = await readLiveStake()
  if (!live) {
    openSheet(
      html`<h2>Can't check your stake right now</h2>
        <p>To withdraw only this goal's NIM, Holdfast needs to read how much you have staked from the Nimiq network, and it couldn't just now.</p>
        <p class="muted small">Your NIM is safe and still staked. Check your connection and try again in a moment.</p>
        <button class="btn btn-secondary" id="retry-break">Try again</button>`,
      (sheet, close) =>
        $('#retry-break', sheet)!.addEventListener('click', () => {
          close()
          void breakSeal(goal)
        }),
    )
    return
  }
  goal = ctx.state.goals.find((g) => g.id === goal.id) ?? goal
  // What this goal can give back: its share of the active stake (never other stake).
  const max = goalShare(goal, live.balance)
  if (max <= 0) return toast('There is no active stake on this goal to withdraw.', 'info')
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
        <label><span>Type <b>${goal.name}</b> to confirm</span>
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
  // The transaction sets the new total of active stake, so it must start from the real total,
  // read again right now. If that read fails, nothing is sent.
  const live = await readLiveStake()
  if (!live) {
    toast("Can't check your stake right now, so nothing was sent. Your NIM is safe and still staked. Try again in a moment.", 'error')
    return false
  }
  const latestGoal = ctx.state.goals.find((g) => g.id === goal.id) ?? goal
  if (luna > goalShare(latestGoal, live.balance)) {
    toast(`Your stake changed. You can withdraw at most ${formatNim(goalShare(latestGoal, live.balance))} NIM from this goal now.`, 'error')
    return false
  }
  const newActiveBalance = live.balance - luna
  try {
    const tx = await w.sendSetActiveStakeTransaction({ newActiveBalance })
    const latest = ctx.state.goals.find((g) => g.id === goal.id) ?? goal
    commit(replaceGoal(ctx.state, recordUnlockStart(latest, luna, tx)))
    toast('Seal broken. Your NIM is cooling down.', 'info')
    afterTransaction()
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
        afterTransaction()
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
