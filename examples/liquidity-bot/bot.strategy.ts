import { formatError, formatNumber, Trepa } from '@trepa/sdk';

import { average, fetchBtcPrice } from './utils';

/**
 * Liquidity-seeding strategy for the Bitcoin streak.
 *
 * For every open pool, anchor a prediction at Binance's live BTC/USDT spot
 * price — the same reference the streak resolves against — then pull it
 * partway toward where other predictors are already clustered. We
 * re-fetch the pool with `includes: ['predictions']` to read the live
 * book, take the average of the crowd, and blend 30% of the way from spot
 * toward it. The crowd usually prices in short-term drift faster than
 * naked spot does, so following the consensus lowers expected error
 * without giving up the spot anchor entirely. A small random jitter
 * (±0.25% of the outcome range) keeps multiple bots from landing on the
 * exact same tick.
 *
 * Stake is pinned to the pool minimum. The goal here is presence with a
 * touch of edge — be in every pool, cheaply, and lean toward the crowd.
 */

const trepa = new Trepa({
	baseUrl: process.env.TREPA_API_URL,
	apiKey: process.env.TREPA_API_KEY,
	privateKey: process.env.TREPA_PRIVATE_KEY,
});

const CROWD_PULL = 0.3;
const JITTER_FRACTION = 0.005;

await trepa.bot.run({
	predict: async (pool) => {
		const [price, withPredictions] = await Promise.all([
			fetchBtcPrice(),
			trepa.pools.get(pool.id, { includes: ['predictions'] }),
		]);

		const others = withPredictions.predictions ?? [];
		const range = pool.max_outcome - pool.min_outcome;

		const crowdCenter = average(
			others.map((p) => p.prediction),
			price,
		);
		const target = price + (crowdCenter - price) * CROWD_PULL;
		const jitter = (Math.random() - 0.5) * JITTER_FRACTION * range;

		const value = target + jitter;
		const stake = Math.min(pool.max_stake, pool.min_stake);

		return { value, stake };
	},
	onStart: ({ me }) => {
		return `bot online as @${me.username}`;
	},
	onPredicted: ({ pool, value, stake }) => {
		return `${pool.title} → ${formatNumber(value, pool.precision)} @ ${formatNumber(stake, 2)} USDC`;
	},
	onPoolSkipped: ({ pool, reason }) => {
		return `${pool?.title ?? ''} — ${reason}`;
	},
	onError: (err) => {
		return formatError(err);
	},
});
