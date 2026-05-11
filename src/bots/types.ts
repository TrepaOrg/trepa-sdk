import type { components } from '../api/schema';
import type { TrepaClient } from '../http/client';
import type { SessionConfig } from '../http/session';
import type { Trepa } from '../http/trepa';
import type { BotBalanceManagerConfig } from '../solana/balance-manager-config';

export type { BotBalanceManagerConfig } from '../solana/balance-manager-config';

export type OpenPool = components['schemas']['PoolWithRelationsDto'];

export type UserDto = components['schemas']['UserDto'];

/** Result of {@link BotOptions.predict}: submit `{ value, stake }` or `null` to skip the pool. */
export type BotPredictDecision = { value: number; stake: number } | null;

/** Result of {@link BotOptions.updatePrediction}: new `{ value }` or `null` to leave the chain unchanged. */
export type BotUpdatePredictionDecision = { value: number } | null;

export interface BotCredentials {
	apiKey: string;
	privateKey: string;
}

/**
 * Defaults for each bot’s {@link Session} (except per-slot keys) plus Solana URLs and balance manager.
 * Usually supplied through `new Trepa(…)`.
 */
export type BotSwarmDefaults = Omit<SessionConfig, 'apiKey' | 'privateKey'> & {
	/** @default `TREPA_SOLANA_RPC_URL` or public mainnet-beta HTTPS */
	solanaRpcUrl?: string;
	/** @default `TREPA_SOLANA_RPC_SUBSCRIPTIONS_URL` or public mainnet-beta WS */
	solanaRpcSubscriptionsUrl?: string;
	/** @internal Used by `Trepa` to wire `bots.run` and the funder. */
	trepa?: Trepa;
	balanceManager?: BotBalanceManagerConfig;
};

export interface BotSlot {
	index: number;
	count: number;
}

/**
 * Per-slot context for {@link BotOptions.predict}, {@link BotOptions.updatePrediction}, and hooks.
 * Use `ctx.trepa` for API calls as this bot.
 */
export interface BotContext {
	slot: BotSlot;
	me: UserDto;
	trepa: TrepaClient;
	signal: AbortSignal;
}

/** Argument to {@link BotOptions.onPredicted} after a successful create. */
export interface BotPredictionInfo {
	pool: OpenPool;
	value: number;
	stake: number;
}

/** Passed to {@link BotOptions.updatePrediction} after create (includes `predictionId` for `predictions.update`). */
export interface BotSubmittedPredictionContext {
	pool: OpenPool;
	value: number;
	stake: number;
	predictionId: string;
}

/** Argument to {@link BotOptions.onPredictionUpdated} after a successful update. */
export interface BotPredictionUpdatedInfo {
	pool: OpenPool;
	predictionId: string;
	previousValue: number;
	value: number;
	stake: number;
}

/** Argument to {@link BotOptions.onPoolSkipped}; `pool` is `null` when nothing was open. */
export interface BotSkippedInfo {
	pool: OpenPool | null;
	reason:
		| 'no-open-pool'
		| 'started-mid-pool'
		| 'predict-returned-null'
		| 'predict-aborted'
		| 'invalid-value'
		| 'invalid-stake'
		| 'predict-threw'
		| 'predict-too-late';
}

/**
 * Bot strategy for one slot. Use a single object for identical bots, or `trepa.bots.run((slot) => ({ … }))`
 * for per-slot options.
 */
export interface BotOptions {
	predict: (
		pool: OpenPool,
		ctx: BotContext,
	) => BotPredictDecision | Promise<BotPredictDecision>;

	updatePrediction?: (
		info: BotSubmittedPredictionContext,
		ctx: BotContext,
	) => BotUpdatePredictionDecision | Promise<BotUpdatePredictionDecision>;

	/** @default 5000 */
	pollIntervalMs?: number;

	/** @default 250 */
	postResolveBufferMs?: number;

	/** Stops the slot cooperatively when aborted; `bots.run` also listens for `SIGINT` / `SIGTERM`. */
	signal?: AbortSignal;

	/** Merged over `Trepa`’s `balanceManager` for this slot’s funder (master key: `TREPA_MASTER_PRIVATE_KEY`). */
	balanceManager?: BotBalanceManagerConfig;

	onStart?: (ctx: BotContext) => string | void;
	onPredicted?: (info: BotPredictionInfo) => string | void;
	onPredictionUpdated?: (info: BotPredictionUpdatedInfo) => string | void;
	onPoolSkipped?: (info: BotSkippedInfo) => string | void;
	onError?: (err: unknown) => string | void;
}
