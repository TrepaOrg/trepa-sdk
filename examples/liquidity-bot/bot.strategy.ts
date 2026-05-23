import { Trepa, credentialsFromEnv } from '@trepa/sdk';

import {
	fetchBtcPrice,
	fetchBtcStdLogReturns,
	waitUntilPredictSlot,
	waitUntilUpdateSlot,
} from './utils.ts';

const SIGMA_LIMIT = 1;

const computeLadderValue = async (
	index: number,
	count: number,
): Promise<number> => {
	const [price, stdLogReturns] = await Promise.all([
		fetchBtcPrice(),
		fetchBtcStdLogReturns(),
	]);

	const sigma = price * stdLogReturns;
	const z =
		count <= 1
			? 0
			: -SIGMA_LIMIT + (2 * SIGMA_LIMIT * index) / (count - 1);

	return price + sigma * z;
};

const trepa = new Trepa({
	credentials: credentialsFromEnv(),
});

await trepa.bots.run(({ index, count }) => ({
	pollIntervalMs: 1_000,
	predict: async (pool) => {
		await waitUntilPredictSlot(pool, index);

		const value = await computeLadderValue(index, count);
		const stake = pool.min_stake;

		return { value, stake };
	},
	updatePrediction: async (prediction) => {
		await waitUntilUpdateSlot(prediction.pool, index);

		if (Date.now() >= new Date(prediction.pool.prediction_end_date).getTime()) {
			return null;
		}

		const value = await computeLadderValue(index, count);

		return { value };
	},
}));
