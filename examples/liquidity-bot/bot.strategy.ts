import { Spot } from '@binance/spot';
import { Trepa } from '@trepa/sdk';

/**
 * Liquidity-seeding strategy for the Bitcoin Flash streak.
 *
 * For every open pool, anchor a prediction at Binance's live BTC/USDT spot
 * price — the same reference the streak resolves against — then nudge it by
 * a tiny random offset (±0.25% of the pool's outcome range). The jitter is
 * deliberate: stacking every liquidity bot on the exact same tick would
 * leave gaps in the curve, so we spread quotes across nearby steps to give
 * real predictors something to trade against on either side of spot.
 *
 * Stake is pinned to the pool minimum. The goal here is presence, not
 * profit — be in every pool, cheaply, so the book is never empty.
 */

const trepa = new Trepa({
	baseUrl: process.env.TREPA_API_URL,
	apiKey: process.env.TREPA_API_KEY,
	privateKey: process.env.TREPA_PRIVATE_KEY,
});

const binance = new Spot({});

await trepa.bot.run({
	predict: async (pool) => {
		const res = await binance.restAPI.tickerPrice({ symbol: 'BTCUSDT' });

		const data = res.data();
		const ticker = Array.isArray(data) ? data[0] : data;
		const price = Number(ticker?.price);

		const range = pool.max_outcome - pool.min_outcome;
		const jitter = (Math.random() - 0.5) * 0.005 * range;

		const value = price + jitter;
		const stake = Math.min(pool.max_stake, pool.min_stake);

		return { value, stake };
	},
	onStart: ({ me }) => {
		console.log(`Liquidity bot online as ${me.username}`);
	},
	onPredicted: ({ pool, value, stake }) => {
		console.log(`[${pool.title}] predicted ${value} with ${stake} stake`);
	},
	onError: (err) => {
		console.error(err);
	},
	onPoolSkipped: ({ pool, reason }) => {
		console.log(`[${pool?.title}] skipped: ${reason}`);
	},
});
