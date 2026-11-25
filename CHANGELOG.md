# Changelog

## 1.0.0 (November 2026)

The first full release of Holdfast Savings, entered in the Nimiq Mini Apps Competition, Cycle III (Save).

### Saving
- **Goals that lock by staking.** Saving into a goal stakes NIM from your own Nimiq Pay wallet. It earns staking rewards and never leaves your control.
- **Several goals at once** (up to 5), sharing one stake. Each goal gets its fair share of the stake and of new rewards.
- **Every lock confirmed on the blockchain.** Holdfast picks the right staking transaction (create staker or add stake), follows it on chain, and takes a lock the network refused back off its goal.
- **Targets in NIM, USDT or naira,** and every amount shown in all three.

### Withdrawing
- **Break the seal, slowly on purpose:** type the goal's name, deactivate, wait out the network's 12-to-24-hour cool-down, retire, return to wallet.
- **Cool-down countdown:** the Retire button stays disabled until the network can accept it, with the time left on screen.
- **Each step confirmed on chain,** and matched to the wallet's real staking balances.
- A goal whose NIM has all come back shows **Withdrawn** and leaves the public numbers.

### Friends
- **Goalkeeper links:** one friend sees your live progress, can cheer you on, and sees if you break the seal. No signup.
- **Cheer wall:** cheers are NIM payments with a message, read from the blockchain; one tap locks them into your goal.
- **Profiles** signed with your wallet, **invite links**, **referrals** and a public **leaderboard**.
- **Goal backup:** goals come back on a new phone.

### Release 1.0 polish
- **First-use intro:** three short cards (Lock it · Goalkeeper · Hold fast), shown once, skippable.
- **Holdfast in numbers** (`#/stats`): savers, active goals, NIM locked (checked on chain), referrals, and wallets that joined this week.
- **Built on Nimiq** section on the landing page.
- **Motion:** progress rings fill up, a burst when a lock is confirmed, leaderboard rows rise in, shimmering placeholders while loading. All of it is off when the phone asks for reduced motion.
- **Empty states** that say what to do next: no goals, no cheers, no referrals, empty leaderboard.
- **Link previews** on WhatsApp, X and others (Open Graph and Twitter cards), a web manifest and an app icon. Shorter share messages with the link on its own line.
- **Accessibility:** stronger contrast in light mode, 44 px tap targets, visible focus outlines. Lighthouse mobile: Accessibility 100, SEO 100.
- **NIM shown to 2 decimals** everywhere, and to the last luna where it matters (the most you can withdraw).

### Reliability and security
- Every network request has a timeout and a friendly retry. Buttons that wait can't be pressed twice, even if the screen redraws.
- **Error reports:** app errors (message, screen, version, time; no address, no IP) are kept so problems can be found and fixed.
- **"Update available — tap to reload"** when a newer build is live.
- **Security headers:** Content-Security-Policy, `nosniff`, a referrer policy, and camera, microphone and location turned off.
- Rate limits on every public API action. Health diagnostics that show a wallet's backup now need the admin token.
- `?a=health` and `?a=version` report the app version and the commit that is live.
