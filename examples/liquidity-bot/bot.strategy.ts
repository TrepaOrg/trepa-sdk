import { Trepa, credentialsFromEnv } from '@trepa/sdk';

import {
	fetchBtcPrice,
	inverseNormalCdf,
	waitUntilPredictSlot,
} from './utils.ts';

// Fallback value for when the Pyth API is down or the data is not available (https://status.pyth.network/)
const FALLBACK_STD_LOG_RETURNS = 0.0004;

const trepa = new Trepa({
	credentials: credentialsFromEnv(),
});

await trepa.bots.run(({ index, count }) => ({
	pollIntervalMs: 1_000,
	predict: async (pool) => {
		await waitUntilPredictSlot(pool, index);

		const [price, stdLogReturns] = await Promise.all([
			fetchBtcPrice(),
			Promise.resolve(FALLBACK_STD_LOG_RETURNS),
		]);

		const closeTs = new Date(pool.prediction_end_date).getTime();

		const resolutionMinutes = Math.max(
			0,
			(new Date(pool.reference_date).getTime() - closeTs) / 60_000,
		);

		const sigma = price * stdLogReturns * Math.sqrt(resolutionMinutes);

		const quantile = (index + 0.5) / count;
		const offset = sigma * inverseNormalCdf(quantile);

		const value = price + offset;
		const stake = pool.min_stake;

		return { value, stake };
	},
}));
