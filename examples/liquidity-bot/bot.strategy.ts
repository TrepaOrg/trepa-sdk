import {
	type BotCredentials,
	formatError,
	formatNumber,
	Trepa,
} from '@trepa/sdk';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fetchBtcPrice, fetchBtcStdLogReturns } from './utils.ts';

/**
 * Quote-ladder strategy for the Bitcoin streak.
 *
 * N bots lay a flat ladder
 * of predictions around BTC spot, sized to actual realized volatility:
 *
 *   σ      = spot · std_log_returns(7d, 1m) · √(minutes_to_resolution)
 *   bot[i] = spot − σ + (i + ½) · 2σ/N   for i ∈ [0, N)
 *
 * Every bot waits until `prediction_end_date − LEAD_TIME_MS` so the
 * spot snapshot is as close to the resolution window as we dare go
 * without missing the cutoff, then submits at min stake.
 *
 * The whole ladder is presence: thin enough per tick that a real
 * predictor can arb against any quote, wide enough as a band that the
 * curve looks alive across the full ±σ outcome region.
 */

const credentials = JSON.parse(
	readFileSync(resolve(process.cwd(), 'bots.credentials.json'), 'utf8'),
) as BotCredentials[];

const trepa = new Trepa({ credentials });

const LEAD_TIME_MS = 8_000;

await trepa.bots.run(({ index, count }) => ({
	predict: async (pool) => {
		const closeTs = new Date(pool.prediction_end_date).getTime();
		const waitMs = closeTs - LEAD_TIME_MS - Date.now();

		if (waitMs > 0) {
			await new Promise((resolve) => setTimeout(resolve, waitMs));
		}

		const [price, stdLogReturns] = await Promise.all([
			fetchBtcPrice(),
			fetchBtcStdLogReturns(),
		]);

		const resolutionMinutes = Math.max(
			0,
			(new Date(pool.reference_date).getTime() - closeTs) / 60_000,
		);
		const sigma = price * stdLogReturns * Math.sqrt(resolutionMinutes);

		const sliceWidth = (2 * sigma) / count;
		const offset = -sigma + (index + 0.5) * sliceWidth;

		const value = price + offset;
		const stake = pool.min_stake;

		return { value, stake };
	},
	onStart: ({ me }) => {
		return `online as @${me.username}`;
	},
	onPredicted: ({ pool, value, stake }) => {
		return `${pool.title} → ${formatNumber(value, pool.precision)} @ ${formatNumber(stake, 2)} USDC`;
	},
	onPoolSkipped: ({ pool, reason }) => {
		return `${pool?.title ?? '(no pool open)'} — ${reason}`;
	},
	onError: (err) => {
		return formatError(err);
	},
}));
