import { ctx, emit } from '../app'
import { claimInvite, refreshStats, rename, signIn, signOut } from '../account'
import { api, ApiFailure, type LeaderboardRow } from '../lib/api'
import { inviteUrl, nimiqPayDeepLink, miniAppTarget } from '../lib/deeplink'
import { timeAgo } from '../lib/format'
import { clearInviteCode, markWelcomed, parseInviteInput, pendingInviteCode, setInviteCode } from '../lib/identity'
import { errorMessage, isUserRejection } from '../lib/wallet'
import { $, busy, copyText, html, openSheet, raw, toast, type Raw } from '../ui'
import { header } from './common'
import { statsStrip } from './saver'

/** Profile, invite link, referrals and the public leaderboard. */

const PALETTE = ['#E9A21B', '#2F6FE0', '#13A36E', '#D94848', '#8A56E8', '#0FA3B1', '#E0683C', '#5B6AD0']

/** Coloured initial; the colour is derived from the wallet address so it stays the same. */
function avatar(name: string, address: string, cls = ''): Raw {
  let h = 0
  for (const ch of address) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const initial = [...name.trim()][0]?.toUpperCase() ?? '?'
  return html`<span class="avatar ${cls}" style="${raw(`background:${PALETTE[h % PALETTE.length]}`)}" aria-hidden="true">${initial}</span>`
}

const storedList = raw(`<ul class="stored-list">
  <li><b>Wallet address and display name.</b> Shown on your profile and the leaderboard.</li>
  <li><b>Your wallet signature.</b> Proof that the address is yours.</li>
  <li><b>An anonymous device ID</b> from Nimiq Pay, if you allow it, and an <b>anonymous browser ID</b>. They tell one person from many wallets.</li>
  <li><b>When you joined and were last seen, and your country.</b> Your IP address is not stored.</li>
  <li><b>Who invited you</b>, if anyone. When an invite link is opened, a scrambled note of the network is kept for 30 minutes so the invite still counts after moving into Nimiq Pay.</li>
</ul>`)

function failureText(err: unknown): string {
  if (err instanceof ApiFailure) return err.message
  return `Something went wrong: ${errorMessage(err)}`
}

/**
 * Optional invite code at sign-up. It is filled in when the visitor arrived through an invite
 * link; a friend's code or whole link can also be typed or pasted, in case the link's code did
 * not make it into Nimiq Pay.
 */
const inviteField = (): Raw => html`<label class="invite-field">Invite code <span class="muted small">(optional)</span>
  <input name="invite" value="${pendingInviteCode() ?? ''}" placeholder="Code or link from the friend who invited you"
    autocomplete="off" autocapitalize="characters" spellcheck="false"/></label>`

/** Shared sign-in action for the welcome sheet and the profile page. */
async function doSignIn(btn: HTMLButtonElement | null, inviteInput: HTMLInputElement | null): Promise<boolean> {
  const typed = inviteInput?.value.trim() ?? ''
  if (inviteInput) {
    const code = typed ? parseInviteInput(typed) : null
    if (typed && !code) {
      toast('That invite code does not look right. Check it, or leave the field empty.', 'error')
      return false
    }
    if (code) setInviteCode(code)
    else clearInviteCode()
  }
  return busy(btn, 'Confirm in Nimiq Pay…', async () => {
    try {
      const r = await signIn()
      invalidateBoard()
      const invited = r.profile.referredBy ? `${r.profile.referredBy} invited you 🎉` : 'Welcome 🎉'
      toast(r.isNew ? `Profile created. ${invited}` : 'Welcome back 👋', 'success')
      return true
    } catch (err) {
      toast(isUserRejection(err) ? 'Cancelled. You can create your profile any time.' : failureText(err), isUserRejection(err) ? 'info' : 'error')
      return false
    }
  })
}

/** Shown once per wallet after connecting, so a new user can create their profile in one tap. */
export function openWelcomeSheet(): void {
  if (!ctx.address) return
  markWelcomed(ctx.address)
  openSheet(
    html`<h2>${ctx.invite ? html`🎉 ${ctx.invite.name} invited you` : 'Create your Holdfast profile'}</h2>
      <p>Your wallet is your account. Sign one message to prove it's yours and get your own invite link.
        <b>It's free and moves no NIM.</b></p>
      ${inviteField()}
      <details class="stored"><summary>What Holdfast stores</summary>${storedList}</details>
      <button class="btn btn-primary" id="welcome-sign">Sign &amp; create profile</button>
      <button class="btn btn-link" id="welcome-later">Not now</button>`,
    (sheet, close) => {
      $('#welcome-later', sheet)!.addEventListener('click', close)
      const btn = $<HTMLButtonElement>('#welcome-sign', sheet)!
      btn.addEventListener('click', async () => {
        if (await doSignIn(btn, $<HTMLInputElement>('input[name=invite]', sheet))) close()
      })
    },
  )
}

// ---------- Profile ----------

export function renderProfile(root: HTMLElement): void {
  const p = ctx.profile
  if (ctx.profileStatus === 'unknown') {
    root.innerHTML = html`${header()}<main class="page center-page"><div class="spinner big"></div><p class="muted">Loading your profile…</p></main>`.html
    return
  }
  if (ctx.profileStatus === 'unavailable') {
    root.innerHTML = html`${header()}<main class="page center-page"><h2>Profiles aren't available right now</h2>
      <p class="muted">Your goals are safe on this device. Please try again later.</p><a class="btn btn-secondary" href="#/">Back to my goal</a></main>`.html
    return
  }
  if (!p) {
    root.innerHTML = html`${header()}
    <main class="page">
      <section class="hero small">
        <h1>Your profile</h1>
        <p class="lead">Your wallet is your account. Sign one message to prove it's yours.</p>
      </section>
      <form class="card form" id="signin-form" novalidate>
        <p>You get a display name, your own invite link and a place on the leaderboard. <b>Signing is free and moves no NIM.</b></p>
        ${inviteField()}
        <details class="stored"><summary>What Holdfast stores</summary>${storedList}</details>
        <button class="btn btn-primary" id="sign-in" type="submit">Sign &amp; create profile</button>
      </form>
    </main>`.html
    const form = $<HTMLFormElement>('#signin-form', root)!
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      void doSignIn($<HTMLButtonElement>('#sign-in', form), $<HTMLInputElement>('input[name=invite]', form))
    })
    return
  }

  const link = inviteUrl(p.code)
  const shareText = 'Join me on Holdfast: lock your savings goals in Nimiq Pay and earn staking rewards while you save.'
  root.innerHTML = html`${header()}
  <main class="page">
    <section class="profile-head">
      ${avatar(p.name, p.fullAddress, 'avatar-xl')}
      <h1 class="profile-name">${p.name}</h1>
      <button class="btn btn-link mono" id="copy-address" title="Copy wallet address">${p.address}</button>
      <button class="chip-btn" id="edit-name">✏️ Edit name</button>
    </section>

    <section class="stat-row">
      <div class="stat"><b>${p.referrals}</b><span>${p.referrals === 1 ? 'referral' : 'referrals'}</span></div>
      <a class="stat" href="#/board"><b>${p.rank ? `#${p.rank}` : '–'}</b><span>${p.rank ? 'leaderboard' : 'not ranked yet'}</span></a>
      <div class="stat"><b>${new Date(p.joinedAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</b><span>joined</span></div>
    </section>

    <section class="card keeper-card">
      <h3>🔗 Your invite link</h3>
      <p>Every new wallet that joins Holdfast through this link counts as your referral.</p>
      <div class="share-url" id="invite-url">${link}</div>
      <div class="row">
        <button class="btn btn-secondary" id="share-invite">Share…</button>
        <button class="btn btn-ghost invite-copy" id="copy-invite">Copy link</button>
      </div>
      <a class="btn btn-link invite-wa" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`${shareText} ${link}`)}">Send via WhatsApp</a>
    </section>

    <section class="card">
      <h3>Your referrals${p.referrals ? html` <span class="muted">(${p.referrals})</span>` : ''}</h3>
      ${
        p.referralList.length
          ? html`<ul class="people">${p.referralList.map(
              (r) => html`<li>${avatar(r.name, r.address)}<div class="who"><b>${r.name}</b><span class="muted small mono">${r.address}</span></div>
                <time class="muted small">${timeAgo(r.joinedAt)}</time></li>`,
            )}</ul>`
          : html`<p class="muted">No one yet. Share your invite link and they'll appear here as soon as they create their profile.</p>`
      }
      ${p.referredBy ? html`<p class="muted small">You were invited by <b>${p.referredBy}</b>.</p>` : ''}
    </section>

    ${
      p.canClaimInvite
        ? html`<section class="card">
            <h3>Who invited you?</h3>
            <p class="muted">Enter their invite code, or paste their invite link, so they get the credit. You can do this once, in your first week.</p>
            <form id="claim-form" class="form" novalidate>
              <input name="code" placeholder="Invite code or link" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Invite code or link"/>
              <button class="btn btn-secondary" type="submit">Add my inviter</button>
            </form>
          </section>`
        : ''
    }

    <section class="card">
      <details class="stored"><summary>What Holdfast stores about you</summary>${storedList}
        <p class="muted small">It is used only to keep profiles and invite counts honest.</p></details>
      <button class="btn btn-link" id="sign-out">Sign out on this device</button>
    </section>
  </main>`.html

  $('#copy-address', root)!.addEventListener('click', async () => {
    if (await copyText(p.fullAddress)) toast('Wallet address copied', 'success')
  })
  $('#copy-invite', root)!.addEventListener('click', async () => {
    if (await copyText(link)) toast('Invite link copied', 'success')
    else toast('Copy failed. Long-press the link to copy.', 'error')
  })
  const share = $<HTMLButtonElement>('#share-invite', root)!
  if (!navigator.share) share.classList.add('hidden')
  share.addEventListener('click', () => void navigator.share({ title: 'Holdfast', text: shareText, url: link }).catch(() => {}))
  $('#sign-out', root)!.addEventListener('click', () => {
    signOut()
    toast('Signed out on this device', 'info')
  })
  $('#edit-name', root)!.addEventListener('click', () => editName(p.name))
  const claimForm = $<HTMLFormElement>('#claim-form', root)
  claimForm?.addEventListener('submit', (e) => {
    e.preventDefault()
    const input = claimForm.elements.namedItem('code') as HTMLInputElement
    const code = parseInviteInput(input.value)
    if (!code) return toast('Enter the invite code or link your friend sent you', 'error')
    void busy($<HTMLButtonElement>('button[type=submit]', claimForm), 'Saving…', async () => {
      try {
        const inviter = await claimInvite(code)
        invalidateBoard()
        toast(`🎉 ${inviter} is now your inviter`, 'success')
      } catch (err) {
        toast(failureText(err), 'error')
      }
    })
  })
}

function editName(current: string): void {
  openSheet(
    html`<h2>Display name</h2>
      <form id="name-form" class="form" novalidate>
        <label>Shown on your profile and the leaderboard
          <input name="name" maxlength="24" value="${current}" autocomplete="nickname"/>
        </label>
        <span class="hint">2 to 24 characters.</span>
        <button class="btn btn-primary" type="submit">Save name</button>
      </form>`,
    (sheet, close) => {
      const form = $<HTMLFormElement>('#name-form', sheet)!
      const input = form.elements.namedItem('name') as HTMLInputElement
      input.focus()
      input.select()
      form.addEventListener('submit', (e) => {
        e.preventDefault()
        const name = input.value.trim()
        if ([...name].length < 2) return toast('Names need at least 2 characters', 'error')
        void busy($<HTMLButtonElement>('button[type=submit]', form), 'Saving…', async () => {
          try {
            await rename(name)
            invalidateBoard()
            close()
            toast('Name updated', 'success')
          } catch (err) {
            toast(failureText(err), 'error')
          }
        })
      })
    },
  )
}

// ---------- Leaderboard ----------

interface BoardState {
  rows: LeaderboardRow[]
  total: number
  loadedAt: number
  error: string | null
}
let board: BoardState | null = null
let boardLoading = false

async function loadBoard(): Promise<void> {
  if (boardLoading) return
  boardLoading = true
  try {
    const data = await api.leaderboard()
    board = { rows: data.top, total: data.total, loadedAt: Date.now(), error: null }
  } catch (err) {
    board = { rows: board?.rows ?? [], total: board?.total ?? 0, loadedAt: Date.now(), error: failureText(err) }
  } finally {
    boardLoading = false
  }
  // Redraw through the router so the page keeps its navigation (and never wipes a form mid-typing).
  emit()
}

const MEDALS = ['🥇', '🥈', '🥉']

export function renderBoard(root: HTMLElement): void {
  if (!board || Date.now() - board.loadedAt > 15_000) void loadBoard()
  void refreshStats()
  const me = ctx.profile
  const inTop = !!me && !!board?.rows.some((r) => r.code === me.code)
  root.innerHTML = html`${header()}
  <main class="page">
    <section class="hero small">
      <h1>🏆 Leaderboard</h1>
      <p class="lead">Savers who brought the most friends to Holdfast.</p>
      ${statsStrip()}
    </section>
    ${
      !board
        ? html`<div class="center-page short"><div class="spinner big"></div></div>`
        : board.error && !board.rows.length
          ? html`<section class="card center"><p class="muted">${board.error}</p><button class="btn btn-secondary" id="board-retry">Try again</button></section>`
          : html`<section class="card board-card">
              ${
                board.rows.length
                  ? html`<ol class="people board">${board.rows.map(
                      (r, i) => html`${
                        // Everyone below this line has no referrals yet, so has no rank.
                        r.rank === null && (i === 0 || board!.rows[i - 1]!.rank !== null)
                          ? html`<li class="board-divider" aria-hidden="true"><span>${i === 0 ? 'No referrals yet. Invite a friend to take #1' : 'Not ranked yet'}</span></li>`
                          : ''
                      }<li class="${me && r.code === me.code ? 'is-me' : ''}">
                        <span class="rank">${r.rank === null ? '–' : (MEDALS[r.rank - 1] ?? r.rank)}</span>
                        ${avatar(r.name, r.address)}
                        <div class="who"><b>${r.name}${me && r.code === me.code ? html` <span class="chip chip-lock">You</span>` : ''}</b>
                          <span class="muted small mono">${r.address}</span></div>
                        <span class="score"><b>${r.referrals}</b><span class="muted small">${r.referrals === 1 ? 'referral' : 'referrals'}</span></span>
                      </li>`,
                    )}</ol>`
                  : html`<p class="muted center">No profiles yet. Be the first on the board!</p>`
              }
            </section>
            <p class="muted small center">${board.total} ${board.total === 1 ? 'saver' : 'savers'} on Holdfast${
              me && !inTop && me.rank ? html` · Your rank: <b>#${me.rank}</b>` : ''
            }</p>`
    }
    ${
      ctx.wallet
        ? html`<a class="btn btn-primary" href="#/me">${me ? 'Invite friends to climb' : 'Create your profile to join'}</a>`
        : html`<a class="btn btn-primary" href="${nimiqPayDeepLink(miniAppTarget(location, ctx.invite?.code ?? null))}">Open in Nimiq Pay to join ↗</a>
            <a class="btn btn-link" href="#/">About Holdfast</a>`
    }
  </main>`.html
  $('#board-retry', root)?.addEventListener('click', () => void loadBoard())
}

/** Forget the cached board so the next visit refetches (after a sign-in or rename). */
export function invalidateBoard(): void {
  if (board) board.loadedAt = 0
}

/** Bottom navigation for connected wallets. */
export function tabBar(active: 'goal' | 'board' | 'me'): Raw {
  const tab = (id: string, href: string, icon: string, label: string, dot = false) =>
    html`<a href="${href}" class="${id === active ? 'active' : ''}" ${id === active ? raw('aria-current="page"') : ''}>
      <span class="tab-icon" aria-hidden="true">${icon}${dot ? raw('<i class="tab-dot"></i>') : ''}</span><span>${label}</span></a>`
  return html`<nav class="tabbar" aria-label="Main">
    ${tab('goal', '#/', '🎯', 'Goal')}
    ${tab('board', '#/board', '🏆', 'Leaderboard')}
    ${tab('me', '#/me', '👤', 'Profile', ctx.profileStatus === 'signed_out')}
  </nav>`
}
