import { Trepa, credentialsFromEnv } from '@trepa/sdk';

import { withManager } from './bot.manager.ts';
import {
	fetchBtcPrice,
	fetchBtcStdLogReturns,
	inverseNormalCdf,
} from './utils.ts';

const credentials = credentialsFromEnv();

const trepa = new Trepa({
	credentials,
});

const LEAD_TIME_MS = 10_000;

await withManager(trepa, credentials, () =>
	trepa.bots.run(({ index, count }) => ({
		predict: async (pool) => {
			const closeTs = new Date(pool.prediction_end_date).getTime();
			const waitMs = closeTs - LEAD_TIME_MS - Date.now();

			if (waitMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, waitMs));
			}

			const resolutionMinutes = Math.max(
				0,
				(new Date(pool.reference_date).getTime() - closeTs) / 60_000,
			);

			const [price, stdLogReturns] = await Promise.all([
				fetchBtcPrice(),
				fetchBtcStdLogReturns(),
			]);

			const sigma = price * stdLogReturns * Math.sqrt(resolutionMinutes);

			const quantile = (index + 0.5) / count;
			const offset = sigma * inverseNormalCdf(quantile);

			const value = price + offset;
			const stake = pool.min_stake;

			return { value, stake };
		},
	})),
);
