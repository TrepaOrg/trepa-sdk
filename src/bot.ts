import type { components } from './api/schema';
import { TrepaError } from './errors';
import type {
	AuthResource,
	PredictionsResource,
	StreaksResource,
} from './resources';
import type { Session } from './session';

export type OpenPool = components['schemas']['PoolWithRelationsDto'];
type UserDto = components['schemas']['UserDto'];

export type BotPredictDecision =
	| number
	| { value: number; stake?: number }
	| null
	| undefined
	| void;

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
		| 'predict-threw';
}

export interface BotOptions {
	/** Streak to follow. Defaults to the Bitcoin Flash streak. */
	streakId?: string;
	/** Default stake (USDC) when `predict` returns just a number. */
	stake?: number;
	/**
	 * Decide what to predict in a given pool. The returned `value` is
	 * automatically snapped to `pool.step` and clamped to
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
	/** Called once before the loop starts. */
	onStart?: (ctx: BotContext) => void;
	/** Called after a successful prediction. */
	onPredicted?: (info: BotPredictionInfo) => void;
	/** Called when a pool is skipped (no pool open, predict returned null, etc). */
	onPoolSkipped?: (info: BotSkippedInfo) => void;
	/** Called on every loop error. Defaults to `console.error`. */
	onError?: (err: unknown) => void;
}

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_POST_RESOLVE_BUFFER_MS = 5_000;

/**
 * A long-running predictor loop. Subscribes to a streak and calls your
 * `predict` callback once per pool. You decide the value, the bot handles
 * polling, dedup, snapping, waiting, and graceful shutdown.
 *
 * ```ts
 * const ac = new AbortController()
 * process.on('SIGINT', () => ac.abort())
 *
 * await trepa.bot.run({
 *   stake: 1,
 *   signal: ac.signal,
 *   predict: (pool) => (pool.min_outcome + pool.max_outcome) / 2,
 *   onPredicted: ({ pool, value, stake }) =>
 *     console.log(`[${pool.title}] ${value} @ ${stake}`),
 * })
 * ```
 */
export class Bot {
	private readonly auth: AuthResource;
	private readonly streaks: StreaksResource;
	private readonly predictions: PredictionsResource;

	constructor(
		_session: Session,
		resources: {
			auth: AuthResource;
			streaks: StreaksResource;
			predictions: PredictionsResource;
		},
	) {
		this.auth = resources.auth;
		this.streaks = resources.streaks;
		this.predictions = resources.predictions;
	}

	async run(options: BotOptions): Promise<void> {
		const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
		const postResolveBufferMs =
			options.postResolveBufferMs ?? DEFAULT_POST_RESOLVE_BUFFER_MS;
		const onError = options.onError ?? defaultOnError;
		const { signal, dispose } = resolveSignal(options.signal);

		try {
			const me = await this.auth.me();
			const streakId = options.streakId ?? (await this.streaks.bitcoin()).id;
			options.onStart?.({ me, streakId });

			const seen = new Set<string>();

			while (!signal.aborted) {
				try {
					const { current_pool: pool } =
						await this.streaks.poolDetails(streakId);

					if (!pool || pool.is_closed) {
						options.onPoolSkipped?.({
							pool: pool ?? null,
							reason: 'no-open-pool',
						});
						await sleep(pollIntervalMs, signal);
						continue;
					}

					if (!seen.has(pool.id)) {
						seen.add(pool.id);
						await this.tryPredict(pool, options, onError);
					}

					await sleepUntil(
						pool.prediction_end_date,
						postResolveBufferMs,
						pollIntervalMs,
						signal,
					);
				} catch (err) {
					onError(err);
					await sleep(pollIntervalMs, signal);
				}
			}
		} finally {
			dispose();
		}
	}

	private async tryPredict(
		pool: OpenPool,
		options: BotOptions,
		onError: (err: unknown) => void,
	): Promise<void> {
		let decision: BotPredictDecision;

		try {
			decision = await options.predict(pool);
		} catch (err) {
			onError(err);
			options.onPoolSkipped?.({ pool, reason: 'predict-threw' });
			return;
		}

		if (decision === null || decision === undefined) {
			options.onPoolSkipped?.({ pool, reason: 'predict-returned-null' });
			return;
		}

		const rawValue = typeof decision === 'number' ? decision : decision.value;
		const overrideStake =
			typeof decision === 'number' ? undefined : decision.stake;
		const rawStake = overrideStake ?? options.stake;

		if (rawStake === undefined) {
			throw new TrepaError(
				'bot.run: stake is required. Pass `stake` in BotOptions or return { value, stake } from `predict`.',
				{ status: 0, code: 'missing_stake' },
			);
		}

		if (!Number.isFinite(rawValue)) {
			options.onPoolSkipped?.({ pool, reason: 'invalid-value' });
			return;
		}

		const value = snap(rawValue, pool);
		const stake = clamp(rawStake, pool.min_stake, pool.max_stake);

		try {
			await this.predictions.create({ poolId: pool.id, stake, value });
			options.onPredicted?.({ pool, value, stake });
		} catch (err) {
			onError(err);
		}
	}
}

const defaultOnError = (err: unknown): void => {
	console.error('[trepa.bot]', err);
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
