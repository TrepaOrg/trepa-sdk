/**
 * Example bot: normal-quantile liquidity spread around BTC spot, with a late
 * `updatePrediction` refresh before pool close (see `LEAD_TIME_MS`).
 *
 * @example Strategy reference
 * ```json
 * {
 *   "id": "liquidity-bot",
 *   "predict": {
 *     "value": "spot + sigma * inverseNormalCdf((index + 0.5) / count)",
 *     "sigma": "spot * stdLogReturns * sqrt(resolutionMinutes)",
 *     "stake": "pool.min_stake"
 *   },
 *   "updatePrediction": {
 *     "timingMsBeforeClose": 10000,
 *     "value": "same formula as predict; returns null if past close"
 *   }
 * }
 * ```
 */

import { Trepa, credentialsFromEnv } from '@trepa/sdk';
import type { BotSubmittedPredictionContext } from '../../src/bot.ts';

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
		updatePrediction: async (prediction: BotSubmittedPredictionContext) => {
			const closeTs = new Date(prediction.pool.prediction_end_date).getTime();
			const waitMs = closeTs - LEAD_TIME_MS - Date.now();

			if (waitMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, waitMs));
			}

			if (Date.now() >= closeTs) {
				return null;
			}

			const resolutionMinutes = Math.max(
				0,
				(new Date(prediction.pool.reference_date).getTime() - closeTs) / 60_000,
			);

			const [price, stdLogReturns] = await Promise.all([
				fetchBtcPrice(),
				fetchBtcStdLogReturns(),
			]);

			const sigma = price * stdLogReturns * Math.sqrt(resolutionMinutes);

			const quantile = (index + 0.5) / count;
			const offset = sigma * inverseNormalCdf(quantile);

			const value = price + offset;

			return { value };
		},
	})),
);
