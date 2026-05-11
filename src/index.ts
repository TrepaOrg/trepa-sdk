export { ensureTrepaEnvLoaded } from './config/env-load';
export { Trepa, type TrepaConfig } from './http/trepa';
export { TrepaClient } from './http/client';
export { TrepaError } from './core/errors';
export { signTransaction } from './http/sign';
export { Bots, credentialsFromEnv, snapOutcomeToPool } from './bots';
export type {
	BotCredentials,
	BotSwarmDefaults,
	BotSlot,
	BotOptions,
	BotContext,
	BotPredictDecision,
	BotPredictionInfo,
	BotPredictionUpdatedInfo,
	BotUpdatePredictionDecision,
	BotSubmittedPredictionContext,
	BotSkippedInfo,
	OpenPool,
} from './bots';
export {
	type BalanceManagerConfig,
	type BotBalanceManagerConfig,
} from './solana/balance-manager';
export type { components, operations, paths } from './api/schema';
export {
	trepaLog,
	writeEvent,
	formatNumber,
	formatError,
	logBotSwarmStartup,
	logBotSwarmShutdown,
	type EventKind,
	type TrepaLogSlot,
} from './logging/format';
export type { MasterWalletHudLine, SlotWalletHudLine } from './logging/log-ink';
export { SDK_DOCS_URL, SDK_VERSION } from './core/version';
