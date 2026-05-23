import { credentialsFromEnv, Trepa } from '@trepa/sdk';

import { BTC } from './utils.ts';

/**
 * Bot 2 — Spot price
 *
 * Async predict: pull live BTC from Binance.
 */

const trepa = new Trepa({
	credentials: credentialsFromEnv(),
});

await trepa.bots.run({
	predict: async (pool) => {
		const spot = await BTC();

		return {
			value: spot,
			stake: pool.min_stake,
		};
	},
});
