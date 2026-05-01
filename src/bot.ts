import type { components } from './api/schema';
import { TrepaError } from './errors';
import { type EventKind, writeEvent } from './format';
import {
	AuthResource,
	PredictionsResource,
	StreaksResource,
} from './resources';
import { Session, type SessionConfig } from './session';

export type OpenPool = components['schemas']['PoolWithRelationsDto'];
type UserDto = components['schemas']['UserDto'];

export type BotPredictDecision = { value: number; stake: number } | null;

export interface BotCredentials {
	apiKey: string;
	privateKey: string;
}

export interface BotSlot {
	index: number;
	count: number;
}

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
	 * Cancel the loop. The whole swarm resolves once the signal aborts.
	 *
	 * If omitted, `bots.run` installs its own `SIGINT` and `SIGTERM`
	 * handlers (when running in Node) so `Ctrl-C` and container shutdowns
	 * cleanly stop every bot in the swarm. Pass your own signal when you
	 * need to control shutdown yourself or coordinate with other lifecycles.
	 */
	signal?: AbortSignal;
	/**
	 * Lifecycle callbacks. All optional. Return a string to have the bot
	 * print it on the matching color-coded line — e.g. `[READY]: ...`,
	 * `[PRED]: ...`, `[SKIP]: ...`, `[ERROR]: ...`. Return nothing (or run
	 * your own `console.log` inside) to stay silent or hand-roll output.
	 *
	 * When the swarm has more than one bot, the SDK automatically prefixes
	 * each returned string with `[i/N]` so you can tell the bots apart.
	 */
	onStart?: (ctx: BotContext) => string | void;
	onPredicted?: (info: BotPredictionInfo) => string | void;
	onPoolSkipped?: (info: BotSkippedInfo) => string | void;
	onError?: (err: unknown) => string | void;
}

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_POST_RESOLVE_BUFFER_MS = 5_000;
const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

interface BotResources {
	auth: AuthResource;
	streaks: StreaksResource;
	predictions: PredictionsResource;
}

/**
 * One or more long-running predictor loops, one per credential passed to
 * `new Trepa({ credentials: [...] })`. Pass a strategy factory that
 * returns `BotOptions` per slot for swarm-aware coordination, or a plain
 * `BotOptions` object when every bot does the same thing.
 *
 * ```ts
 * const trepa = new Trepa({
 *   credentials: [
 *     { apiKey: '...', privateKey: '...' },
 *     { apiKey: '...', privateKey: '...' },
 *   ],
 * })
 *
 * await trepa.bots.run(({ index, count }) => ({
 *   predict: (pool) => ({
 *     value:
 *       pool.min_outcome +
 *       ((index + 0.5) / count) * (pool.max_outcome - pool.min_outcome),
 *     stake: pool.min_stake,
 *   }),
 * }))
 * ```
 */
export class Bots {
	private readonly credentials: readonly BotCredentials[];
	private readonly sessionDefaults: Omit<
		SessionConfig,
		'apiKey' | 'privateKey'
	>;

	constructor(
		credentials: readonly BotCredentials[],
		sessionDefaults: Omit<SessionConfig, 'apiKey' | 'privateKey'> = {},
	) {
		this.credentials = credentials;
		this.sessionDefaults = sessionDefaults;
	}

	/** Number of bots in the swarm. */
	get count(): number {
		return this.credentials.length;
	}

	/**
	 * Start every bot in the swarm and resolve when they all stop. Pass a
	 * factory `(slot) => BotOptions` for slot-aware strategies, or a plain
	 * `BotOptions` object to share a single strategy across every bot.
	 */
	async run(
		strategy: BotOptions | ((slot: BotSlot) => BotOptions),
	): Promise<void> {
		const count = this.credentials.length;
		if (count === 0) {
			throw new TrepaError(
				'bots.run() requires at least one set of credentials. ' +
					'Pass `credentials: [{ apiKey, privateKey }, ...]` to `new Trepa(...)`.',
				{ status: 0, code: 'missing_credentials' },
			);
		}

		const factory: (slot: BotSlot) => BotOptions =
			typeof strategy === 'function' ? strategy : () => strategy;

		const swarmAc = new AbortController();
		const proc =
			typeof process !== 'undefined' && typeof process.on === 'function'
				? process
				: null;
		const handler = (): void => swarmAc.abort();
		for (const sig of SHUTDOWN_SIGNALS) proc?.on(sig, handler);

		try {
			await Promise.all(
				this.credentials.map((creds, index) => {
					const slot: BotSlot = { index, count };
					const session = new Session({ ...this.sessionDefaults, ...creds });
					const resources: BotResources = {
						auth: new AuthResource(session),
						streaks: new StreaksResource(session),
						predictions: new PredictionsResource(session),
					};
					const opts = withTag(slot, factory(slot));
					const signal = opts.signal
						? AbortSignal.any([swarmAc.signal, opts.signal])
						: swarmAc.signal;
					return runOne(resources, opts, signal);
				}),
			);
		} finally {
			for (const sig of SHUTDOWN_SIGNALS) proc?.off(sig, handler);
		}
	}
}

const withTag = (slot: BotSlot, opts: BotOptions): BotOptions => {
	if (slot.count <= 1) return opts;
	const tag = `[${slot.index + 1}/${slot.count}]`;
	const wrap = <Arg>(
		fn: ((arg: Arg) => string | void) | undefined,
	): ((arg: Arg) => string | void) | undefined =>
		fn &&
		((arg) => {
			const result = fn(arg);
			return typeof result === 'string' ? `${tag} ${result}` : result;
		});
	return {
		...opts,
		onStart: wrap(opts.onStart),
		onPredicted: wrap(opts.onPredicted),
		onPoolSkipped: wrap(opts.onPoolSkipped),
		onError: wrap(opts.onError),
	};
};

const runOne = async (
	resources: BotResources,
	options: BotOptions,
	signal: AbortSignal,
): Promise<void> => {
	const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	const postResolveBufferMs =
		options.postResolveBufferMs ?? DEFAULT_POST_RESOLVE_BUFFER_MS;

	const me = await resources.auth.me();
	const streakId = (await resources.streaks.bitcoin()).id;
	emit('ready', options.onStart?.({ me, streakId }));

	const seen = new Set<string>();

	while (!signal.aborted) {
		try {
			const { current_pool: pool } =
				await resources.streaks.poolDetails(streakId);

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
				await tryPredict(resources, pool, options);
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
};

const tryPredict = async (
	resources: BotResources,
	pool: OpenPool,
	options: BotOptions,
): Promise<void> => {
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
		await resources.predictions.create({ poolId: pool.id, stake, value });
		emit('pred', options.onPredicted?.({ pool, value, stake }));
	} catch (err) {
		emit('error', options.onError?.(err));
	}
};

const emit = (kind: EventKind, value: string | void): void => {
	if (typeof value === 'string') writeEvent(kind, value);
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

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.resolve();
	return new Promise<void>((resolve) => {
		const done = (): void => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		};
		const onAbort = (): void => {
			clearTimeout(timer);
			done();
		};
		const timer = setTimeout(done, ms);
		signal.addEventListener('abort', onAbort, { once: true });
	});
}

function sleepUntil(
	isoDate: string,
	bufferMs: number,
	minMs: number,
	signal: AbortSignal,
): Promise<void> {
	const ms = new Date(isoDate).getTime() - Date.now() + bufferMs;
	return sleep(Math.max(ms, minMs), signal);
}
