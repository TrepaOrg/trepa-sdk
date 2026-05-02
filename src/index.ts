export {
	ensureTrepaEnvLoaded,
	getTrepaEnvLoadSummary,
	type TrepaEnvLoadSummary,
} from './env-load';
export { Trepa, type TrepaConfig } from './trepa';
export { TrepaClient } from './client';
export { TrepaError, isTrepaError } from './errors';
export { signTransaction } from './sign';
export { Bots, credentialsFromEnv } from './bot';
export type {
	BotCredentials,
	BotSlot,
	BotOptions,
	BotContext,
	BotPredictDecision,
	BotPredictionInfo,
	BotSkippedInfo,
	OpenPool,
} from './bot';
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
