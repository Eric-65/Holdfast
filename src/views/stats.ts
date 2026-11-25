import { refreshStats } from '../account'
import { ctx } from '../app'
import { formatNim, toNim } from '../lib/format'
import { html, skeleton } from '../ui'
import { header } from './common'

/** #/stats — public usage numbers: the evidence that real wallets use Holdfast. */
export function renderStats(root: HTMLElement): void {
  void refreshStats()
  const st = ctx.stats
  const tile = (value: string, label: string, note: string) =>
    html`<li class="stat-tile"><b>${value}</b><span class="stat-label">${label}</span><span class="stat-note">${note}</span></li>`
  root.innerHTML = html`${header()}
  <main class="page">
    <a class="back-link" href="${ctx.wallet ? '#/board' : '#/'}">← ${ctx.wallet ? 'Leaderboard' : 'About Holdfast'}</a>
    <section class="hero small">
      <h1>Holdfast in numbers</h1>
      <p class="lead">Live totals for every saver, straight from Holdfast and the Nimiq blockchain.</p>
    </section>
    ${
      ctx.apiAvailable === false
        ? html`<section class="card center"><p class="muted">Usage numbers aren't available on this copy of Holdfast.</p></section>`
        : !st
          ? html`<section class="card">${skeleton(5, 'skeleton-tiles')}</section>`
          : html`<ul class="stat-tiles">
              ${tile(st.savers.toLocaleString('en-US'), st.savers === 1 ? 'saver' : 'savers', 'Wallets with a Holdfast profile, each proved by a wallet signature.')}
              ${tile(st.activeGoals.toLocaleString('en-US'), st.activeGoals === 1 ? 'active goal' : 'active goals', 'Open goals. A goal stops counting once its NIM is withdrawn.')}
              ${tile(formatNim(st.lockedLuna, { decimals: 0 }), 'NIM locked', 'Checked on the Nimiq blockchain: only stake that is really there counts.')}
              ${st.referrals !== undefined ? tile(st.referrals.toLocaleString('en-US'), st.referrals === 1 ? 'referral' : 'referrals', 'New wallets that joined through a friend’s invite link.') : ''}
              ${st.joined7d !== undefined ? tile(st.joined7d.toLocaleString('en-US'), 'joined this week', 'Profiles created in the last 7 days.') : ''}
            </ul>
            <p class="muted small center">${toNim(st.lockedLuna) > 0 ? 'NIM locked is re-read from the blockchain every few minutes. ' : ''}Numbers refresh every minute.</p>`
    }
    <a class="btn btn-secondary" href="#/board">🏆 See the leaderboard</a>
  </main>`.html
}
