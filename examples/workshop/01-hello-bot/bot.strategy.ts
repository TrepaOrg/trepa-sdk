import { credentialsFromEnv, Trepa } from '@trepa/sdk';

/**
 * Bot 1 — Hello Trepa
 *
 * Fixed forecast. The SDK handles pool polling, signing, and submit.
 */

const trepa = new Trepa({
	credentials: credentialsFromEnv(),
});

await trepa.bots.run({
	predict: (pool) => {
		// Return null to skip this pool
		// return null;

		return {
			value: 95_000,
			stake: pool.min_stake,
		};
	},
});
