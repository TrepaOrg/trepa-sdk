/**
 * Minimal example bot: submits the current BTC spot as the prediction value.
 *
 * @example Strategy reference
 * ```json
 * {
 *   "id": "spot-bot",
 *   "predict": {
 *     "value": "fetchBtcPrice()",
 *     "stake": "pool.min_stake"
 *   }
 * }
 * ```
 */

import { credentialsFromEnv, Trepa } from '@trepa/sdk';

import { fetchBtcPrice } from './utils.ts';

const trepa = new Trepa({
	credentials: credentialsFromEnv(),
});

await trepa.bots.run({
	predict: async (pool) => {
		const value = await fetchBtcPrice();
		const stake = pool.min_stake;

		return { value, stake };
	},
});
