import {
	AlloraAPIClient,
	ChainSlug,
	PriceInferenceTimeframe,
	PriceInferenceToken,
} from '@alloralabs/allora-sdk';
import { credentialsFromEnv, Trepa } from '@trepa/sdk';

/**
 * Bot 4 — Allora forecast
 *
 * Fetches BTC price inference from Allora mainnet and submits it as
 * the forecast.
 */

const trepa = new Trepa({
	credentials: credentialsFromEnv(),
});

const allora = new AlloraAPIClient({
	chainSlug: ChainSlug.MAINNET,
	apiKey: process.env.ALLORA_API_KEY,
});

await trepa.bots.run({
	predict: async (pool) => {
		const { inference_data } = await allora.getPriceInference(
			PriceInferenceToken.BTC,
			PriceInferenceTimeframe.FIVE_MIN,
		);

		const value = Number(inference_data.network_inference_normalized);

		return {
			value,
			stake: pool.min_stake,
		};
	},
});
