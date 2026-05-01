import type { components } from './api/schema';
import { type EventKind, writeEvent } from './format';
import type {
	AuthResource,
	PredictionsResource,
	StreaksResource,
} from './resources';

export type OpenPool = components['schemas']['PoolWithRelationsDto'];
type UserDto = components['schemas']['UserDto'];

export type BotPredictDecision = { value: number; stake: number } | null;

export interface BotContext {
	me: UserDto;
	streakId: string;
}

export interface BotPredictionInfo {
	pool: OpenPool;
	value: number;
	stake: number;
}

export interface BotSkippedInfo {
	pool: OpenPool | null;
	reason:
		| 'no-open-pool'
		| 'predict-returned-null'
		| 'invalid-value'
		| 'invalid-stake'
		| 'predict-threw';
}

export interface BotOptions {
	/**
	 * Decide what to predict in a given pool. Return `{ value, stake }` to
	 * submit a prediction, or `null` to skip the pool. The returned `value`
	 * is automatically snapped to `pool.step` and clamped to
	 * `[pool.min_outcome, pool.max_outcome]`. The `stake` is clamped to
	 * `[pool.min_stake, pool.max_stake]`.
	 *
	 * Errors thrown by `predict` are caught: `onError` is called with the
	 * thrown value and `onPoolSkipped` is fired with reason `'predict-threw'`.
	 * The bot loop continues. You don't need to wrap `predict` in your own
	 * try/catch unless you want to recover with a fallback value.
	 */
	predict: (pool: OpenPool) => BotPredictDecision | Promise<BotPredictDecision>;
	/** Polling cadence when no pool is open. Default 15s. */
	pollIntervalMs?: number;
	/** Extra wait after a pool's `prediction_end_date` before polling again. Default 5s. */
	postResolveBufferMs?: number;
	/**
	 * Cancel the loop. The bot resolves once the signal aborts.
	 *
	 * If omitted, the bot installs its own `SIGINT` and `SIGTERM` handlers
	 * (when running in Node) so `Ctrl-C` and container shutdowns cleanly stop
	 * the loop. Pass your own signal when you need to control shutdown
	 * yourself or coordinate with other lifecycles.
	 */
	signal?: AbortSignal;
	/**
	 * Lifecycle callbacks. All optional. Return a string to have the bot
	 * print it on the matching color-coded line — e.g. `[READY]: ...`,
	 * `[PRED]: ...`, `[SKIP]: ...`, `[ERROR]: ...`. Return nothing (or run
	 * your own `console.log` inside) to stay silent or hand-roll output.
	 */
	onStart?: (ctx: BotContext) => string | void;
	onPredicted?: (info: BotPredictionInfo) => string | void;
	onPoolSkipped?: (info: BotSkippedInfo) => string | void;
	onError?: (err: unknown) => string | void;
}

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_POST_RESOLVE_BUFFER_MS = 5_000;

/**
 * A long-running predictor loop. Subscribes to a streak and calls your
 * `predict` callback once per pool. You decide the value, the bot handles
 * polling, dedup, snapping, waiting, and graceful shutdown.
 *
 * ```ts
 * import { Trepa, formatNumber } from '@trepa/sdk'
 *
 * await trepa.bot.run({
 *   predict: (pool) => ({
 *     value: (pool.min_outcome + pool.max_outcome) / 2,
 *     stake: pool.min_stake,
 *   }),
 *   onPredicted: ({ pool, value }) =>
 *     `${pool.title} → ${formatNumber(value, pool.precision)}`,
 * })
 * ```
 */
export class Bot {
	private readonly auth: AuthResource;
	private readonly streaks: StreaksResource;
	private readonly predictions: PredictionsResource;

	constructor(resources: {
		auth: AuthResource;
		streaks: StreaksResource;
		predictions: PredictionsResource;
	}) {
		this.auth = resources.auth;
		this.streaks = resources.streaks;
		this.predictions = resources.predictions;
	}

	async run(options: BotOptions): Promise<void> {
		const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
		const postResolveBufferMs =
			options.postResolveBufferMs ?? DEFAULT_POST_RESOLVE_BUFFER_MS;
		const { signal, dispose } = resolveSignal(options.signal);

		try {
			const me = await this.auth.me();
			const streakId = (await this.streaks.bitcoin()).id;
			emit('ready', options.onStart?.({ me, streakId }));

			const seen = new Set<string>();

			while (!signal.aborted) {
				try {
					const { current_pool: pool } =
						await this.streaks.poolDetails(streakId);

					if (!pool || pool.is_closed) {
						emit(
							'skip',
							options.onPoolSkipped?.({
								pool: pool ?? null,
								reason: 'no-open-pool',
							}),
						);
						await sleep(pollIntervalMs, signal);
						continue;
					}

					if (!seen.has(pool.id)) {
						seen.add(pool.id);
						await this.tryPredict(pool, options);
					}

					await sleepUntil(
						pool.prediction_end_date,
						postResolveBufferMs,
						pollIntervalMs,
						signal,
					);
				} catch (err) {
					emit('error', options.onError?.(err));
					await sleep(pollIntervalMs, signal);
				}
			}
		} finally {
			dispose();
		}
	}

	private async tryPredict(pool: OpenPool, options: BotOptions): Promise<void> {
		let decision: BotPredictDecision;

		try {
			decision = await options.predict(pool);
		} catch (err) {
			emit('error', options.onError?.(err));
			emit('skip', options.onPoolSkipped?.({ pool, reason: 'predict-threw' }));
			return;
		}

		if (decision === null) {
			emit(
				'skip',
				options.onPoolSkipped?.({ pool, reason: 'predict-returned-null' }),
			);
			return;
		}

		if (!Number.isFinite(decision.value)) {
			emit('skip', options.onPoolSkipped?.({ pool, reason: 'invalid-value' }));
			return;
		}

		if (!Number.isFinite(decision.stake)) {
			emit('skip', options.onPoolSkipped?.({ pool, reason: 'invalid-stake' }));
			return;
		}

		const value = snap(decision.value, pool);
		const stake = clamp(decision.stake, pool.min_stake, pool.max_stake);

		try {
			await this.predictions.create({ poolId: pool.id, stake, value });
			emit('pred', options.onPredicted?.({ pool, value, stake }));
		} catch (err) {
			emit('error', options.onError?.(err));
		}
	}
}

const emit = (kind: EventKind, value: string | void): void => {
	if (typeof value === 'string') writeEvent(kind, value);
};

const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

interface ResolvedSignal {
	signal: AbortSignal;
	dispose: () => void;
}

const resolveSignal = (provided?: AbortSignal): ResolvedSignal => {
	if (provided) return { signal: provided, dispose: () => {} };

	const ac = new AbortController();
	const proc =
		typeof process !== 'undefined' && typeof process.on === 'function'
			? process
			: null;

	if (!proc) return { signal: ac.signal, dispose: () => {} };

	const handler = (): void => ac.abort();
	for (const sig of SHUTDOWN_SIGNALS) proc.on(sig, handler);
	return {
		signal: ac.signal,
		dispose: () => {
			for (const sig of SHUTDOWN_SIGNALS) proc.off(sig, handler);
		},
	};
};

function snap(value: number, pool: OpenPool): number {
	const snapped =
		Math.round((value - pool.min_outcome) / pool.step) * pool.step +
		pool.min_outcome;
	return clamp(snapped, pool.min_outcome, pool.max_outcome);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.resolve();
	return new Promise<void>((resolve) => {
		const done = (): void => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		};
		const onAbort = (): void => {
			clearTimeout(timer);
			done();
		};
		const timer = setTimeout(done, ms);
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

function sleepUntil(
	isoDate: string,
	bufferMs: number,
	minMs: number,
	signal?: AbortSignal,
): Promise<void> {
	const ms = new Date(isoDate).getTime() - Date.now() + bufferMs;
	return sleep(Math.max(ms, minMs), signal);
}
