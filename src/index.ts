export { Trepa, type TrepaConfig } from './trepa'
export { TrepaError, isTrepaError } from './errors'
export { signTransaction } from './sign'
export { Bot } from './bot'
export type {
	BotOptions,
	BotContext,
	BotPredictDecision,
	BotPredictionInfo,
	BotSkippedInfo,
	OpenPool,
} from './bot'
export type { components, operations, paths } from './api/schema'
