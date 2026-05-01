import {
	credentialsFromEnv,
	formatError,
	formatNumber,
	Trepa,
} from '@trepa/sdk';

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
	onStart: ({ me }) => {
		return `logged in as ${me.username}`;
	},
	onPredicted: ({ pool, value, stake }) => {
		return `${pool.title} → ${formatNumber(value, pool.precision)} @ ${formatNumber(stake, 2)} USDC`;
	},
	onPoolSkipped: ({ pool, reason }) => {
		return `${pool?.title}: ${reason}`;
	},
	onError: (err) => {
		return formatError(err);
	},
});
