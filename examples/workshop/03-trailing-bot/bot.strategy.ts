import { credentialsFromEnv, Trepa } from '@trepa/sdk';

import { BTC, wait } from './utils.ts';

/**
 * Bot 3 — Trailing spot
 *
 * Submit spot once, then revise before the window closes.
 */

const LEAD_TIME_MS = 5_000;

const trepa = new Trepa({
	credentials: credentialsFromEnv(),
});

await trepa.bots.run({
	predict: async (pool) => {
		const spot = await BTC();

		return { value: spot, stake: pool.min_stake };
	},

	updatePrediction: async (info) => {
		const end = new Date(info.pool.prediction_end_date).getTime();
		const now = Date.now();

		const timeLeft = end - now;
		const timeToWait = timeLeft - LEAD_TIME_MS;

		await wait(timeToWait);

		const spot = await BTC();

		return { value: spot };
	},
});
