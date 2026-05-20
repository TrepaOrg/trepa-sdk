import { Trepa, credentialsFromEnv } from '@trepa/sdk';

import {
	fetchBtcPrice,
	fetchBtcStdLogReturns,
	inverseNormalCdf,
	waitUntilPredictSlot,
} from './utils.ts';

const trepa = new Trepa({
	credentials: credentialsFromEnv(),
});

await trepa.bots.run(({ index, count }) => ({
	pollIntervalMs: 1_000,
	predict: async (pool) => {
		await waitUntilPredictSlot(pool, index);

		const [price, stdLogReturns] = await Promise.all([
			fetchBtcPrice(),
			fetchBtcStdLogReturns(),
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
