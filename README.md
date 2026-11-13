# Holdfast Savings

**Save it. Stake it. Hold fast.**

Holdfast Savings is a savings app that runs inside the **Nimiq Pay** wallet. When you save toward a goal, your NIM is staked: it stays in your own wallet, earns rewards and is harder to spend on impulse. A friend you trust keeps you on track.

Built for the Nimiq Mini Apps Competition, Cycle III (Save category).

<p>
  <img src="docs/landing.png" width="200" alt="Holdfast home screen">
  <img src="docs/goal-light.png" width="200" alt="A savings goal in light theme">
  <img src="docs/goal-dark.png" width="200" alt="The same goal in dark theme">
  <img src="docs/goalkeeper.png" width="200" alt="The Goalkeeper page a friend sees">
</p>

<sub>Screenshots use sample prices.</sub>

---

## The problem

- People set savings goals and then dip into them.
- Savings apps that hold your money can freeze accounts, fail logins and charge withdrawal fees.
- Goal-tracker apps only log numbers. No money actually moves.

## The solution

| Feature | What it does |
|---|---|
| 🔒 **Lock it** | Saving into a goal **stakes NIM from your own wallet**. Your money never leaves your control and it earns staking rewards. Getting it back takes Nimiq's unstaking cool-down, which slows down impulse withdrawals. |
| 🛡️ **Goalkeeper** | You share a link with one trusted friend. Without signing up, they see your **live** progress, send you a **cheer** (a NIM gift with a message) and see if you **break the seal** (start withdrawing). |
| 🎉 **Cheer wall** | Cheers are read straight from the blockchain and shown to you and your Goalkeeper. One tap locks them into your goal. |
| ☁️ **Backup** | With a profile, your goals are backed up and come back on a new phone. |
| 💵 **Dollar view** | Every amount shows in **NIM, USDT and NGN**. You can also set your target in USDT or naira. |
| 👤 **Profiles & invites** | Your wallet is your account. You get a display name you can edit and your own invite link. Every new wallet that joins through your link counts as your referral, and a public **leaderboard** ranks savers by referrals. |
| 🌗 **Light & dark theme** | Follows your phone's setting. Tap the sun/moon button to switch, and Holdfast remembers your choice. |

**Holdfast never holds your money.** Every transaction is shown and signed by you in Nimiq Pay.

---

## How it works

### For savers
1. **Create a goal.** Give it a name, an icon and a target (in NIM, USDT or NGN), and pick a validator. A validator is the network node your stake is delegated to.
2. **Lock NIM.** Enter an amount or tap a shortcut (10, 50, 100, 500, or "Rest" for whatever is left to reach the target). Nimiq Pay asks you to approve the staking transaction.
3. **Watch it grow.** A progress ring shows how close you are, in NIM, USDT and naira.
4. **Share with a Goalkeeper.** Tap *Share Goalkeeper link* and send it by any app, by WhatsApp or by copying it.
5. **Reach the goal.** Holdfast celebrates and you can start a new one. Your NIM stays staked until you decide otherwise.

### Breaking the seal (withdrawing)
Withdrawing is possible but deliberately slow:
1. You must **type the goal's name** to confirm. You can also tap "Keep holding fast" instead.
2. **Deactivate** the stake. Your Goalkeeper can now see that you're withdrawing.
3. After Nimiq's cool-down period, **retire** the stake.
4. **Return** the NIM to your wallet.

Holdfast shows each step and tells you what to do next.

### For Goalkeepers (the friend)
- Open the link. No app install or account is needed.
- See the goal, live progress, amounts in USDT and naira, recent activity, the cheer wall, and whether it is 🔒 sealed, 🎉 reached or ⚠️ broken.
- The page reads the saver's stake from the Nimiq blockchain, so a withdrawal shows up even if it was made outside Holdfast.
- **Send a cheer:** pick an amount and write a short message. Inside Nimiq Pay it sends directly. Elsewhere it opens a Nimiq payment link.

### Opening Holdfast
- **In Nimiq Pay:** Holdfast connects to your wallet by itself. Nimiq Pay may ask you to approve sharing your wallet address. If the wallet doesn't answer or you decline, Holdfast shows a **Connect Nimiq Pay** button to try again.
- **In a normal browser:** Holdfast shows a landing page that explains how it works, with common questions at the end and an **Open in Nimiq Pay** button that stays at the top. On a phone with Nimiq Pay installed, it opens the app there directly. If nothing happens, Holdfast shows the address to paste into Nimiq Pay under *Mini Apps → Custom URL*.

### Profiles, invites and the leaderboard
1. **Create your profile.** The first time your wallet connects, Holdfast offers to create your profile. You sign one message in Nimiq Pay. It is free, moves no NIM, and proves the wallet address is yours.
2. **Name and invite link.** Your profile gets a display name (tap **Edit name** to change it) and a unique invite link like `https://holdfast-puce.vercel.app/i/ABC2345`.
3. **Referrals.** When someone opens your link and creates their own profile with a wallet that is new to Holdfast, they count as your referral and appear on your profile. A wallet counts once, for one inviter, and you cannot refer yourself. The friend sees "X invited you" for a few seconds when they arrive; the invite itself is remembered quietly until they create their profile.

   An invite link opens in a browser first, and the code can get lost on the way into Nimiq Pay. Holdfast covers that in three ways:
   - **Same network:** if Holdfast is opened in Nimiq Pay within 30 minutes of the invite link being opened from the same network, the new profile is matched to that inviter. If links from two different inviters were opened from that network, nothing is guessed.
   - **Invite code field:** when creating a profile, a friend can type the inviter's code or paste their link.
   - **Who invited you?:** a profile with no inviter can add one from the Profile screen, once, in its first week. Opening the inviter's link inside Nimiq Pay does the same automatically.
4. **Leaderboard.** The 🏆 tab ranks profiles by referrals, most first. Every profile's invite link counts the same way. Profiles with the same number of referrals share a rank, and the one who joined first is listed first. A profile needs at least one referral to get a rank; the rest are listed under **Not ranked yet**. Anyone can view the board, with or without a wallet. It shows display names and shortened addresses.

**What Holdfast stores for each profile**, as evidence that it is a real, unique user:

| Stored | Why |
|---|---|
| Wallet address, public key and display name | The profile itself |
| The signed message and wallet signature | Proof that the wallet's owner created the profile |
| Nimiq Pay device identifier | An anonymous ID for the phone. Nimiq Pay asks the user first, and it is left empty if they decline |
| Browser ID (cookie + localStorage) | A random anonymous ID, to notice many wallets coming from one browser |
| Joined and last-seen times | When the profile was created and last used |
| Country | From the hosting platform's location header. The IP address itself is not stored |
| Inviter, and how the invite was matched | `code`, `network_match` or `claimed_later`, with the time |
| A scrambled note of the network that opened an invite link | Kept for 30 minutes only, so the invite survives the jump into Nimiq Pay |

Each profile also records how many wallets had already used the same device and browser when it joined, so duplicate sign-ups are easy to spot. By default every new wallet counts as a referral. Set `HF_REQUIRE_UNIQUE_DEVICE=1` to stop counting wallets that come from a device or browser already seen.

---

## What's built and tested

| Area | Status |
|---|---|
| Goal creation, locking, the full 3-step withdrawal, Goalkeeper sharing, cheers, theme switch | ✅ Built. Tested end to end in a mobile browser with a simulated Nimiq Pay wallet |
| Wallet connection screens (approved, declined, no answer, retry) | ✅ Tested in a browser with a simulated Nimiq Pay wallet |
| **Open in Nimiq Pay** button | ⚠️ Built from the documented link format. Needs a check on a phone with Nimiq Pay installed |
| Profiles, sign-in with a wallet signature, invite links, referrals, leaderboard | ✅ Built. Tested in a browser with simulated wallets that sign the way Nimiq wallets do. Needs a check with real Nimiq Pay signatures |
| Amount parsing, address checks, goal history, share links, sign-in and referral rules | ✅ 44 automated tests |
| Real staking transactions inside Nimiq Pay | ⚠️ Built with the official Nimiq SDK. Needs a final check on a real device |
| Live progress straight from the blockchain | ✅ Read through Holdfast's own read-only relay to a public Nimiq RPC server. No setting needed |
| Goal backup, live Goalkeeper pages, cheer wall, usage numbers | ✅ Built and covered by automated tests. Needs a check on a real device |

---

## Run it yourself

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/Eric-65/Holdfast.git
cd Holdfast
npm install
npm run dev
```

Open the address it prints (usually http://localhost:5173). In a normal browser you'll see the landing page; saving and locking need Nimiq Pay (see below).

| Command | What it does |
|---|---|
| `npm run dev` | Starts the app locally |
| `npm test` | Runs the automated tests |
| `npm run build` | Builds the finished app into `dist/` |
| `npm run preview` | Serves the built app locally |

**Try it in Nimiq Pay:** run `npm run dev`, then open your computer's local network address (it is printed in the terminal) as a Mini App in Nimiq Pay.

### Settings

All settings are optional. To use them, copy `.env.example` to `.env`.

| Setting | Purpose |
|---|---|
| `VITE_NIMIQ_RPC_URL` | A Nimiq RPC server that allows browser requests. It turns on **live** blockchain progress (including staking rewards) and live withdrawal alerts for Goalkeepers. Without it, Goalkeepers see the snapshot saved in their link. |
| `VITE_VALIDATORS_API_URL` | Where to load the validator list from |
| `VITE_PRICE_API_URL` | Where to load NIM prices from (CoinGecko format) |
| `VITE_API_BASE` | Where the Holdfast API lives, if it is not on the same site as the app |

Server settings (set on the host, not in `.env`):

| Setting | Purpose |
|---|---|
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | The Upstash Redis database that holds profiles and referrals. Vercel sets these for you when you connect the database (see [Deploy](#deploy)). `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` work too. |
| `HF_REQUIRE_UNIQUE_DEVICE` | Set to `1` to count a referral only when the device and browser are new to Holdfast |
| `NIMIQ_RPC_URL`, `NIMIQ_TESTNET_RPC_URL` | Nimiq RPC servers the relay reads from. Default `https://rpc.nimiqwatch.com` and `https://rpc.nimiq-testnet.com` |

### Deploy

Holdfast runs on **Vercel** at https://holdfast-puce.vercel.app. Vercel builds the app and serves the API in `api/` from every push to `main`.

**Turning on profiles (one-time):** profiles need a database. In the Vercel project, open **Storage → Create Database → Upstash → Redis** (the free plan is enough), connect it to the project, then redeploy. Until that is done the app works exactly as before: goals, locking and Goalkeeper links all work, and the profile and leaderboard screens stay hidden.

The goals part of the app is a plain static website, so it also runs on any static host, without profiles. The GitHub Actions workflow runs the tests and the build on every push. It can also publish to GitHub Pages if you set the repository variable `DEPLOY_TO_PAGES` to `true` and enable Pages.

---

## Under the hood

- **Tech:** Vite and TypeScript, with no UI framework (about 23 kB of JavaScript, gzipped).
- **Wallet:** [`@nimiq/mini-app-sdk`](https://www.npmjs.com/package/@nimiq/mini-app-sdk). The first lock creates a staker, later locks add to it, and withdrawals use the deactivate, retire and remove steps.
- **Storage:** your goals are saved on your device, separately for each wallet address. Profiles and referrals are saved in the database.
- **Sign-in:** the server issues a one-time message, the wallet signs it, and the server checks the Ed25519 signature and derives the address from the signing key. A profile can only be created by the wallet's owner.
- **Invite links:** `/i/CODE` redirects to `/?ref=CODE`. The code is remembered on the device until the profile is created. The **Open in Nimiq Pay** button passes it along, and the fallbacks above cover the cases where Nimiq Pay opens Holdfast without it.
- **Fresh counts:** referral totals and rank are fetched again whenever the Profile or Leaderboard screen is opened.
- **Blockchain reads:** the app asks its own API (`/api/hf?a=rpc`), which forwards only three read-only methods (`getBlockNumber`, `getStakerByAddress`, `getTransactionByHash`) to a public Nimiq RPC server. Public RPC servers don't accept requests from web pages, so this is what makes live progress work. Cheers come from `?a=cheers`, which reads the wallet's transaction history and keeps payments whose message starts with `Holdfast cheer:`.
- **Safe withdrawals:** Nimiq's deactivate step sets the wallet's *total* active stake, so Holdfast always reads the real stake first and never guesses. Stake you had before the goal is left alone.
- **Goalkeeper link:** the goal details sit in the part of the link after `#`, which browsers never send to a server. It also carries the goal id, so a signed-in saver's backed-up goal is loaded live. Without a backup the link still works as a snapshot.
- **Open in Nimiq Pay:** the button uses Nimiq Pay's `nimiqpay://miniapp?url=…` link.
- **Prices:** NIM prices from CoinGecko, converted to USDT with the live USDT rate, refreshed every 5 minutes. If it can't be reached, Holdfast shows the last known price.

```
src/
  main.ts        app start-up and page routing
  app.ts         shared app state
  account.ts     profile sign-in, rename and invites
  lib/           wallet, blockchain, prices, goals, share links, theme, API client
  views/         saver screens, Goalkeeper page, profile and leaderboard
  style.css      all styles, including light and dark themes
api/
  hf.ts          the API (one serverless function)
  _lib/          sign-in and referral rules, signature checks, database access
tests/           automated tests
```

## Known limits

- Nimiq counts all of a wallet's stake together, so Holdfast runs **one goal at a time**. Stake you already had before creating a goal doesn't count toward it.
- Cheers arrive in the saver's normal balance. The saver can then lock them into the goal.
- If the saver has no profile, the Goalkeeper's page uses the blockchain for the amount but the goal details (name, target) come from the link.
- Goals sync one way at a time: a phone with goals backs them up; a phone with none restores them. Using two phones at once, the last one to change wins.
- One person with several wallets can still create several profiles. The stored device and browser IDs make this visible, and `HF_REQUIRE_UNIQUE_DEVICE=1` stops such wallets counting as referrals.

## License

MIT
