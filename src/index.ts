export { ensureTrepaEnvLoaded } from './env-load';
export { Trepa, type TrepaConfig } from './trepa';
export { TrepaClient } from './client';
export { TrepaError, isTrepaError } from './errors';
export { signTransaction } from './sign';
export { Bots, credentialsFromEnv } from './bot';
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
} from './bot';
export { snapOutcomeToPool } from './bot';
export type { components, operations, paths } from './api/schema';
export {
	trepaLog,
	writeEvent,
	formatNumber,
	formatError,
	logBotSwarmStartup,
	logBotSwarmShutdown,
	type EventKind,
} from './format';
export { SDK_DOCS_URL, SDK_VERSION } from './version';
