import { credentialsFromEnv, Trepa } from '@trepa/sdk';

import { BTC, wait } from './utils.ts';

/**
 * Bot 3 — Trailing spot
 *
 * Submit spot once, then revise before the window closes.
 */

const trepa = new Trepa({
	credentials: credentialsFromEnv(),
});

await trepa.bots.run({
	predict: async (pool) => {
		const spot = await BTC();

		return { value: spot, stake: pool.min_stake };
	},

	updatePrediction: async (info) => {
		const endMs = new Date(info.pool.prediction_end_date).getTime();

		if (Date.now() >= endMs) {
			return null;
		}

		await wait(8_000);

		if (Date.now() >= endMs) {
			return null;
		}

		const spot = await BTC();

		return { value: spot };
	},
});
