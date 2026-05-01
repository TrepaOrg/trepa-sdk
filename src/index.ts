export { Trepa, type TrepaConfig } from './trepa';
export { TrepaError, isTrepaError } from './errors';
export { signTransaction } from './sign';
export { Bots } from './bot';
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
export { formatNumber, formatError } from './format';
export type { components, operations, paths } from './api/schema';
