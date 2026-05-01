# @trepa/sdk

Trepa SDK is the official TypeScript SDK for the [Trepa API](https://docs.trepa.app/developers/introduction).

## Install

```bash
npm install @trepa/sdk
```

## Usage

```ts
import { Trepa } from '@trepa/sdk'

const trepa = new Trepa({
	apiKey: process.env.TREPA_API_KEY!,
	privateKey: process.env.TREPA_PRIVATE_KEY!,
})

// 1. Confirm the session is live.
const me = await trepa.me()

// 2. Find the open Bitcoin Flash pool.
const streak = await trepa.streaks.bitcoin()

const { current_pool: pool } = await trepa.streaks.poolDetails(streak.id)

if (!pool) throw new Error('No Bitcoin pool open right now.')

// 3. Place a prediction.
await trepa.predictions.create({
	poolId: pool.id,
	stake: 1,
	value: 50_000,
})

// Give the prediction some time to be indexed.
await new Promise((resolve) => setTimeout(resolve, 5_000))

// 4. Tweak the prediction while the pool is still open.
const [active] = await trepa.users.predictions(me.id, {
	filter_by: ['ACTIVE'],
	limit: 1,
})

await trepa.predictions.update({
	predictionId: active.id,
	value: 55_000,
})

// 5. (Optional) Claim a reward manually. Rewards from resolved pools are
//    auto-claimed to your balance, so you only need this if you want to
//    settle a specific prediction yourself.
/* const [resolved] = await trepa.users.predictions(me.id, {
	filter_by: ['RESOLVED'],
	includes: ['pool', 'reward'],
	limit: 1,
})

if (resolved?.reward && !resolved.reward.is_claimed && resolved.pool) {
	await trepa.rewards.claim({
		poolId: resolved.pool.id,
		rewardId: resolved.reward.id,
	})
} */

// 6. (Optional) Withdraw USDC from your Trepa balance to any external
//    Solana wallet. `mintAddress` below is USDC on Solana mainnet.
/* await trepa.withdrawals.create({
	toAddress: 'YourSolanaWalletPubkey',
	amount: 10,
	mintAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
}) */

// 7. End the session when you're done.
await trepa.logout()
```

For the full set of endpoints and walkthroughs of every flow, see the [docs](https://docs.trepa.app/developers/introduction).

## Building a bot

For long-running bots, skip the manual loop and use `trepa.bot.run`. It handles polling, dedup, value-snapping, and graceful shutdown — you only write a `predict(pool)` callback.

```ts
import { Trepa } from '@trepa/sdk'

const trepa = new Trepa({
	apiKey: process.env.TREPA_API_KEY!,
	privateKey: process.env.TREPA_PRIVATE_KEY!,
})

await trepa.bot.run({
	stake: 1,
	predict: (pool) => (pool.min_outcome + pool.max_outcome) / 2,
	onPredicted: ({ pool, value, stake }) =>
		console.log(`[${pool.title}] ${value} @ ${stake}`),
})
```

`predict` can return a bare `number`, `{ value, stake }` to override the stake, or `null` to skip the pool. The returned value is automatically snapped to `pool.step` and clamped to the pool's outcome range. By default the bot installs `SIGINT` and `SIGTERM` handlers so `Ctrl-C` and container shutdowns stop the loop cleanly — pass your own `signal: AbortSignal` if you want to manage shutdown yourself. See [`examples/bitcoin-bot`](./examples/bitcoin-bot) for a runnable template.

## License

[MIT](./LICENSE)
