# Holdfast

**Save it. Stake it. Hold fast.**

Holdfast is a savings Mini App for the [Nimiq Pay](https://nimiq.com) wallet, built for the
Nimiq Mini Apps Competition, Cycle III (Save category).

## The problem

People set savings goals and then dip into them. Custodial savings apps can freeze accounts, fail
logins and charge withdrawal fees. Goal-tracker apps only log numbers, and no money moves.

## How Holdfast works

| | |
|---|---|
| 🔒 **Lock it** | Saving into a goal = **staking NIM from your own wallet**. The NIM stays yours, earns staking rewards, and Nimiq's unstaking cool-down puts friction in front of impulse withdrawals. Holdfast is non-custodial: it never holds funds or keys. Every transaction is signed by you in Nimiq Pay. |
| 🛡️ **Goalkeeper** | Share a link with one trusted friend. With no signup, they see your progress, can send a **cheer** (a NIM gift with a message) and see when you **break the seal** (start unstaking). |
| 💵 **Dollar view** | Every goal is shown in NIM, **USD** and **NGN** (plus your Nimiq Pay currency if it's different). You can set targets in fiat too. |

### Saver flow
1. Create a goal: name, icon, target (in NIM, USD or NGN) and a validator to delegate to.
2. **Lock** NIM. The first lock sends a `NewStaker` transaction; later locks send `Stake` transactions.
3. Share the Goalkeeper link.
4. Withdrawing ("break the seal") needs you to type the goal name to confirm. Holdfast then walks you through
   Nimiq's three unstaking steps: deactivate (`SetActiveStake`) → retire after the cool-down (`RetireStake`)
   → return to wallet (`RemoveStake`).

### Goalkeeper flow
The link (`#/keep/<payload>`) carries the goal name, target, the saver's public address, the baseline
stake and a progress snapshot in the URL **fragment**, so it never reaches a server. With an RPC endpoint
configured the page reads the saver's stake live from the chain and flags any stake being withdrawn.
Cheers are sent with `sendBasicTransactionWithData` inside Nimiq Pay, or with a `nimiq:` payment link elsewhere.

## Tech

- Vite + TypeScript, no UI framework (~17 kB gzipped JS).
- [`@nimiq/mini-app-sdk`](https://www.npmjs.com/package/@nimiq/mini-app-sdk) for the wallet provider, staking transactions, balances and host fiat.
- Goals are stored in `localStorage`, keyed per wallet address.
- Prices: CoinGecko (`nimiq-2`), cached for 5 minutes with a stale fallback.
- Validators: the Nimiq validators API. If it's unreachable, you can paste a validator address instead.
- **Demo mode**: outside Nimiq Pay, the landing page offers a clearly labelled simulated wallet so you can try every flow in a normal browser.

## Configuration

Copy `.env.example` to `.env`:

| Variable | Purpose |
|---|---|
| `VITE_NIMIQ_RPC_URL` | A Nimiq PoS JSON-RPC endpoint that allows browser (CORS) requests. It enables live on-chain progress (`getStakerByAddress`), so progress includes staking rewards, and live seal-break detection for Goalkeepers. **Optional**: without it Holdfast uses its own ledger, and Goalkeepers see the snapshot from the link. |
| `VITE_VALIDATORS_API_URL` | Override the validators list endpoint. |
| `VITE_PRICE_API_URL` | Override the price endpoint (CoinGecko `simple/price` format). |

## Develop

```bash
npm install
npm run dev        # http://localhost:5173. Use the demo wallet, or load the URL in Nimiq Pay's Mini App dev mode
npm test           # unit tests (amount parsing, address checksums, goal ledger, share links, API parsing)
npm run build      # static build in dist/
```

## Deploy

`.github/workflows/deploy.yml` runs the tests and builds on every push. It deploys to GitHub Pages only from
`main`, and only after tests and the build pass. To turn it on, enable Pages with the source set to
"GitHub Actions". You can set `VITE_NIMIQ_RPC_URL` as a repository variable. The build uses a relative base path,
so `dist/` also works on any static host.

## Honest limits

- Nimiq staking works per address, so all of a wallet's stake is one pool. Holdfast tracks one active goal at a time.
  It records the stake you already had when you created the goal as a baseline, so that stake doesn't count toward the goal.
- Without an RPC endpoint, Holdfast can't see stake you created outside Holdfast. When you withdraw, it sets your active
  stake using its own ledger. Nimiq Pay shows the exact transaction before you sign it.
- Cheers go to the saver's wallet balance. The saver then locks them into the goal.

## License

MIT
