import type { components } from './api/schema';
import { TrepaError } from './errors';
import { type EventKind, writeEvent } from './format';
import {
	AuthResource,
	PredictionsResource,
	StreaksResource,
} from './resources';
import { Session, type SessionConfig } from './session';

/** A pool that's currently open to predictions, with all its relations. */
export type OpenPool = components['schemas']['PoolWithRelationsDto'];
type UserDto = components['schemas']['UserDto'];

/** What `predict` returns: a `{ value, stake }` to submit, or `null` to skip. */
export type BotPredictDecision = { value: number; stake: number } | null;

/** API + signing credentials for one bot in the swarm. */
export interface BotCredentials {
	/** The bot's Trepa API key (from your account settings). */
	apiKey: string;
	/** Base58-encoded 64-byte Solana secret key for the bot's wallet. */
	privateKey: string;
}

/**
 * Load `BotCredentials` from environment variables.
 *
 * For a single bot, set `TREPA_API_KEY` and `TREPA_PRIVATE_KEY`. For a
 * swarm, use indexed pairs starting at `_1`:
 *
 * ```sh
 * TREPA_API_KEY_1=trp_…
 * TREPA_PRIVATE_KEY_1=…
 * TREPA_API_KEY_2=trp_…
 * TREPA_PRIVATE_KEY_2=…
 * ```
 *
 * The helper returns every consecutive indexed pair until one is missing,
 * or falls back to the unindexed pair otherwise.
 *
 * Run your bot with Node's built-in env loader so a `.env` file is picked
 * up automatically:
 *
 * ```sh
 * node --env-file=.env bot.ts
 * ```
 *
 * Throws `TrepaError` if no credentials are set, or if a pair is half
 * set (e.g. an `apiKey` without a `privateKey`).
 */
export const credentialsFromEnv = (): BotCredentials[] => {
	const env: Record<string, string | undefined> =
		typeof process !== 'undefined' && process.env ? process.env : {};

	if (
		env.TREPA_API_KEY_1 !== undefined ||
		env.TREPA_PRIVATE_KEY_1 !== undefined
	) {
		const credentials: BotCredentials[] = [];
		for (let i = 1; ; i++) {
			const apiKey = env[`TREPA_API_KEY_${i}`];
			const privateKey = env[`TREPA_PRIVATE_KEY_${i}`];
			if (apiKey === undefined && privateKey === undefined) break;
			if (!apiKey || !privateKey) {
				throw new TrepaError(
					`Incomplete swarm credentials: missing ${
						apiKey ? `TREPA_PRIVATE_KEY_${i}` : `TREPA_API_KEY_${i}`
					}.`,
					{ status: 0, code: 'missing_credentials_env' },
				);
			}
			credentials.push({ apiKey, privateKey });
		}
		return credentials;
	}

	const apiKey = env.TREPA_API_KEY;
	const privateKey = env.TREPA_PRIVATE_KEY;
	if (apiKey && privateKey) return [{ apiKey, privateKey }];
	if (apiKey || privateKey) {
		throw new TrepaError(
			`Incomplete credentials: missing ${
				apiKey ? 'TREPA_PRIVATE_KEY' : 'TREPA_API_KEY'
			}.`,
			{ status: 0, code: 'missing_credentials_env' },
		);
	}

	throw new TrepaError(
		'No Trepa credentials in environment. Set TREPA_API_KEY and ' +
			'TREPA_PRIVATE_KEY, or TREPA_API_KEY_1 / TREPA_PRIVATE_KEY_1 ' +
			'(_2, _3, ...) for a swarm.',
		{ status: 0, code: 'missing_credentials_env' },
	);
};

/** A bot's seat in the swarm. */
export interface BotSlot {
	/** Zero-based index of this bot in the swarm. */
	index: number;
	/** Total number of bots in the swarm. */
	count: number;
}

/** Context handed to `onStart` once the bot has authenticated. */
export interface BotContext {
	/** The user behind this bot's session. */
	me: UserDto;
	/** The streak this bot is participating in. */
	streakId: string;
}

/** Context handed to `onPredicted` after a successful submission. */
export interface BotPredictionInfo {
	/** The pool the prediction was submitted to. */
	pool: OpenPool;
	/** Final value submitted (snapped to `pool.step`, clamped to outcome range). */
	value: number;
	/** Final stake submitted (clamped to `[min_stake, max_stake]`). */
	stake: number;
}

/** Context handed to `onPoolSkipped` whenever the bot skips a pool. */
export interface BotSkippedInfo {
	/** The pool that was skipped, or `null` when no pool was open. */
	pool: OpenPool | null;
	/** Why the bot skipped the pool. */
	reason:
		| 'no-open-pool'
		| 'started-mid-pool'
		| 'predict-returned-null'
		| 'invalid-value'
		| 'invalid-stake'
		| 'predict-threw'
		| 'predict-too-late';
}

/** Strategy + lifecycle hooks for a single bot in the swarm. */
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
	/** Polling cadence when no pool is open. Default 5s. */
	pollIntervalMs?: number;
	/** Extra wait after a pool's `prediction_end_date` before polling again. Default 250ms. */
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

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_POST_RESOLVE_BUFFER_MS = 250;
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

type BotState =
	| { kind: 'polling' }
	| { kind: 'no_open_pool' }
	| { kind: 'skipping_in_flight_pool'; pool: OpenPool }
	| { kind: 'awaiting_start'; pool: OpenPool }
	| { kind: 'predicting'; pool: OpenPool }
	| { kind: 'awaiting_end'; pool: OpenPool }
	| { kind: 'recovering_from_error'; err: unknown }
	| { kind: 'stopped' };

interface MachineCtx {
	resources: BotResources;
	options: BotOptions;
	signal: AbortSignal;
	streakId: string;
	pollIntervalMs: number;
	postResolveBufferMs: number;
	seen: Set<string>;
	isColdStart: boolean;
}

const runOne = async (
	resources: BotResources,
	options: BotOptions,
	signal: AbortSignal,
): Promise<void> => {
	const me = await resources.auth.me();
	const streakId = (await resources.streaks.bitcoin()).id;
	emit('ready', options.onStart?.({ me, streakId }));

	const ctx: MachineCtx = {
		resources,
		options,
		signal,
		streakId,
		pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
		postResolveBufferMs:
			options.postResolveBufferMs ?? DEFAULT_POST_RESOLVE_BUFFER_MS,
		seen: new Set<string>(),
		isColdStart: true,
	};

	let state: BotState = { kind: 'polling' };
	while (state.kind !== 'stopped') {
		if (signal.aborted) {
			state = { kind: 'stopped' };
			break;
		}
		state = await advance(state, ctx);
	}
};

const advance = async (state: BotState, ctx: MachineCtx): Promise<BotState> => {
	switch (state.kind) {
		case 'polling':
			return classify(ctx);

		case 'no_open_pool':
			await sleep(ctx.pollIntervalMs, ctx.signal);
			return { kind: 'polling' };

		case 'skipping_in_flight_pool':
			ctx.seen.add(state.pool.id);
			emit(
				'skip',
				ctx.options.onPoolSkipped?.({
					pool: state.pool,
					reason: 'started-mid-pool',
				}),
			);
			await sleepUntil(
				state.pool.prediction_end_date,
				ctx.postResolveBufferMs,
				ctx.pollIntervalMs,
				ctx.signal,
			);
			return { kind: 'polling' };

		case 'awaiting_start': {
			const wait =
				new Date(state.pool.prediction_start_date).getTime() - Date.now();
			if (wait > 0) await sleep(wait, ctx.signal);
			return { kind: 'predicting', pool: state.pool };
		}

		case 'predicting': {
			ctx.seen.add(state.pool.id);
			const deadlineMs = new Date(state.pool.prediction_end_date).getTime();
			await tryPredict(ctx.resources, state.pool, ctx.options, deadlineMs);
			return { kind: 'awaiting_end', pool: state.pool };
		}

		case 'awaiting_end':
			await sleepUntil(
				state.pool.prediction_end_date,
				ctx.postResolveBufferMs,
				ctx.pollIntervalMs,
				ctx.signal,
			);
			return { kind: 'polling' };

		case 'recovering_from_error':
			emit('error', ctx.options.onError?.(state.err));
			await sleep(ctx.pollIntervalMs, ctx.signal);
			return { kind: 'polling' };

		case 'stopped':
			return state;
	}
};

const classify = async (ctx: MachineCtx): Promise<BotState> => {
	let pool: OpenPool | null;
	try {
		pool =
			(await ctx.resources.streaks.poolDetails(ctx.streakId)).current_pool ??
			null;
	} catch (err) {
		return { kind: 'recovering_from_error', err };
	}

	if (!pool || pool.is_closed) {
		emit(
			'skip',
			ctx.options.onPoolSkipped?.({
				pool: pool ?? null,
				reason: 'no-open-pool',
			}),
		);
		return { kind: 'no_open_pool' };
	}

	const now = Date.now();
	const startMs = new Date(pool.prediction_start_date).getTime();
	const endMs = new Date(pool.prediction_end_date).getTime();

	if (ctx.isColdStart && now >= startMs) {
		ctx.isColdStart = false;
		return { kind: 'skipping_in_flight_pool', pool };
	}
	ctx.isColdStart = false;

	if (ctx.seen.has(pool.id)) {
		return { kind: 'awaiting_end', pool };
	}

	if (now >= endMs) {
		return { kind: 'no_open_pool' };
	}

	if (now < startMs) {
		return { kind: 'awaiting_start', pool };
	}

	return { kind: 'predicting', pool };
};

const tryPredict = async (
	resources: BotResources,
	pool: OpenPool,
	options: BotOptions,
	deadlineMs: number,
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

	if (Date.now() >= deadlineMs) {
		emit('skip', options.onPoolSkipped?.({ pool, reason: 'predict-too-late' }));
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
