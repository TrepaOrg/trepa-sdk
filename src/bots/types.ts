import type { components } from '../api/schema';
import type { TrepaClient } from '../http/client';
import type { SessionConfig } from '../http/session';
import type { Trepa } from '../http/trepa';
import type { BotBalanceManagerConfig } from '../solana/balance-manager-config';

export type { BotBalanceManagerConfig } from '../solana/balance-manager-config';

export type OpenPool = components['schemas']['PoolWithRelationsDto'];

export type UserDto = components['schemas']['UserDto'];

/** Submit `{ value, stake }` or `null` to skip. */
export type BotPredictDecision = { value: number; stake: number } | null;

/** New outcome or `null` to leave on-chain value unchanged. */
export type BotUpdatePredictionDecision = { value: number } | null;

export interface BotCredentials {
	apiKey: string;
	privateKey: string;
}

/** Session defaults (minus per-bot keys), Solana URLs, and optional funder config. */
export type BotSwarmDefaults = Omit<SessionConfig, 'apiKey' | 'privateKey'> & {
	/** @default `TREPA_SOLANA_RPC_URL` or public mainnet-beta HTTPS */
	solanaRpcUrl?: string;
	/** @default `TREPA_SOLANA_RPC_SUBSCRIPTIONS_URL` or public mainnet-beta WS */
	solanaRpcSubscriptionsUrl?: string;
	trepa?: Trepa;
	balanceManager?: BotBalanceManagerConfig;
};

export interface BotSlot {
	index: number;
	count: number;
}

/** Per-slot API context for `predict` / `updatePrediction` / hooks. */
export interface BotContext {
	slot: BotSlot;
	me: UserDto;
	trepa: TrepaClient;
	signal: AbortSignal;
}

/** Successful `predictions.create`. */
export interface BotPredictionInfo {
	pool: OpenPool;
	value: number;
	stake: number;
}

/** Context for `updatePrediction` after create. */
export interface BotSubmittedPredictionContext {
	pool: OpenPool;
	value: number;
	stake: number;
	predictionId: string;
}

/** Successful `predictions.update`. */
export interface BotPredictionUpdatedInfo {
	pool: OpenPool;
	predictionId: string;
	previousValue: number;
	value: number;
	stake: number;
}

/** Skip path for a pool window. */
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

/** Strategy and lifecycle hooks for one swarm slot. */
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

	signal?: AbortSignal;

	balanceManager?: BotBalanceManagerConfig;

	onStart?: (ctx: BotContext) => string | void;
	onPredicted?: (info: BotPredictionInfo) => string | void;
	onPredictionUpdated?: (info: BotPredictionUpdatedInfo) => string | void;
	onPoolSkipped?: (info: BotSkippedInfo) => string | void;
	onError?: (err: unknown) => string | void;
}
