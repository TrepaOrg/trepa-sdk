import { Spot } from '@binance/spot';
import { Trepa } from '@trepa/sdk';

const trepa = new Trepa({
	baseUrl: process.env.TREPA_API_URL,
	apiKey: process.env.TREPA_API_KEY,
	privateKey: process.env.TREPA_PRIVATE_KEY,
});

const binance = new Spot({});

await trepa.bot.run({
	predict: async (pool) => {
		const range = pool.max_outcome - pool.min_outcome;

		const res = await binance.restAPI.tickerPrice({ symbol: 'BTCUSDT' });

		const data = res.data();
		const ticker = Array.isArray(data) ? data[0] : data;
		const price = Number(ticker?.price);

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
