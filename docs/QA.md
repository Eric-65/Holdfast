# Holdfast QA

## Real-device test: end to end in Nimiq Pay

Passed on a real phone inside Nimiq Pay, November 2026, by the builder. The device and notes columns are for the builder to fill in.

| # | Flow | Result | Device | Notes |
|---|---|---|---|---|
| 1 | Open from a phone browser with **Open in Nimiq Pay** | ✅ Passed | | |
| 2 | Connect: approve | ✅ Passed | | |
| 3 | Connect: decline, then **Connect Nimiq Pay** to retry | ✅ Passed | | |
| 4 | Create a profile with a real Nimiq Pay signature | ✅ Passed | | |
| 5 | Invite link opened by a friend, referral counted | ✅ Passed | | |
| 6 | Leaderboard ranks by referrals | ✅ Passed | | |
| 7 | Create several goals (up to 5) | ✅ Passed | | |
| 8 | First lock creates the staker; later locks add stake; each confirmed on chain | ✅ Passed | | |
| 9 | Goalkeeper link: live progress for the friend | ✅ Passed | | |
| 10 | Cheers sent by a friend, shown on the cheer wall | ✅ Passed | | |
| 11 | 3-step withdrawal: deactivate, cool-down countdown, retire, return to wallet | ✅ Passed | | |
| 12 | Goal backup and restore | ✅ Passed | | |
| 13 | Public usage numbers (savers, active goals, NIM locked) | ✅ Passed | | |

## Bugs found on the real device, and fixed

| Bug | Cause | Fix |
|---|---|---|
| Locks showed as saved but nothing was staked | "Add stake" was sent to a wallet that wasn't a staker yet, and mainnet validators were used on testnet | Choose create-staker vs add-stake from the chain, testnet validators on testnet, confirm every lock on chain, undo refused locks on open (`fix/verify-locks`) |
| "NIM locked" counted refused locks | Stats summed what phones reported | Count only stake the blockchain confirms (`fix/stats-on-chain`) |
| Retire could be pressed during the cool-down and was marked done | The step was recorded when Nimiq Pay returned a hash | Countdown from `inactiveFrom` + 43,201 blocks, steps recorded only once confirmed on chain, reconcile with the staker's balances (`fix/withdraw-cooldown`) |
| A stale pending transaction in Nimiq Pay blocked every new one | Nimiq Pay keeps one pending transaction per wallet until it expires | Plain message that only this wallet is waiting and nothing was sent (`fix/wallet-busy-message`). The pending state itself is Nimiq Pay's. |

## Release 1.0 smoke test (preview, inside Nimiq Pay)

To run on the `release/1.0` Vercel preview, inside Nimiq Pay, before merging. Result: ✅ / ❌, with a note for anything odd.

| # | Check | Expected | Result | Device | Notes |
|---|---|---|---|---|---|
| 1 | Open the preview in Nimiq Pay, connect | Connects; no console or CSP errors | | | |
| 2 | First-use intro cards | Show once, skippable, never again after | | | |
| 3 | Lock 1 NIM into an existing goal | Confirmed on chain, "Live from the Nimiq blockchain" | | | |
| 4 | Open a Goalkeeper link in Nimiq Pay and in a normal browser | Live progress loads | | | |
| 5 | Profile, leaderboard and the new #/stats page | Load with real numbers | | | |
| 6 | Share an invite link on WhatsApp | Shows the new preview card | | | |
| 7 | Light/dark, 360 px wide screen | Nothing overlaps or is cut off | | | |

### Automated checks on the release branch

Run on `release/1.0` in this repository's development environment (a headless browser with a simulated Nimiq Pay wallet, serving the production build with the exact `vercel.json` headers, CSP included). These don't replace the smoke test above inside Nimiq Pay.

| Check | Result |
|---|---|
| `npm test`: 100 automated tests | ✅ 100 passed |
| `npm run build` | ✅ |
| Release browser checks: landing with CSP (no errors or blocked resources), Built on Nimiq, `#/stats` with and without a wallet, intro cards (show once, Next, Skip, never again), goals list and goal detail live in light and dark, lock 1 NIM (confirmed, burst), cheer wall and its empty state, Goalkeeper page for a friend, leaderboard (placeholder, rows rise in), profile, WhatsApp texts | ✅ 35/35 |
| Double tap while Nimiq Pay waits for approval, with a redraw in between | ✅ one transaction (on `main`: two) |
| 360 px wide, light and dark: landing, goal, leaderboard, profile, stats, new goal | ✅ nothing wider than the screen |
| Earlier browser suites: lock repair and refused locks (12), several goals (25), balance lookups (12), no API (12), landing (13), withdrawal cool-down (10) | ✅ all passed |
| Lighthouse mobile, landing page (local, simulated 4G) | Performance 96 · Accessibility 100 · Best Practices 96 · SEO 100 (before: 97 · 94 · 96 · 92) |

### Bugs found during this release, and fixed

| Bug | Fix |
|---|---|
| A background redraw while Nimiq Pay was asking for approval brought back an enabled "Lock" button, so a second tap requested a second transaction. Reproduced on `main`: wallet approval held for 3 s, a redraw during it, a second tap → **2 transactions requested**; on `release/1.0` → **1** | Running actions are remembered across redraws; the redrawn button stays disabled (`busy()` in `src/ui.ts`, test in `tests/ui.test.ts`) |
| `?a=health&addr=…` showed anyone a wallet's backed-up addresses and goal names | That part now needs `HF_ADMIN_TOKEN`; the public part shows only on-chain stake |
| Leaderboard, stats and health had no rate limit (the CDN cache can be bypassed) | Per-IP limits |
| No request timeout on API, price and validator calls: a hung network kept a spinner forever | 8 to 12 second timeouts with a friendly retry message |
| Light-theme grey and gold text below WCAG AA contrast; some tap targets under 44 px | New colour tokens, 44 px targets |
| (Found while building the new cheers empty state) the cheer card would shimmer forever if cheers couldn't load | Shows "Cheers can't be loaded right now" after the first failed attempt |

