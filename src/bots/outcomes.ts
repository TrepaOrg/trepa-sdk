import type { OpenPool } from './types';

function clampNumber(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/** Rounds `value` to `pool.step` and clamps to the pool outcome range. */
export function snapOutcomeToPool(value: number, pool: OpenPool): number {
	const snapped =
		Math.round((value - pool.min_outcome) / pool.step) * pool.step +
		pool.min_outcome;
	return clampNumber(snapped, pool.min_outcome, pool.max_outcome);
}
