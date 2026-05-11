import { TrepaClient } from './client';
import { Session } from './session';
import { Bots } from '../bots/swarm';
import type { BotCredentials } from '../bots/types';
import { ensureTrepaEnvLoaded } from '../config/env-load';
import type { BotBalanceManagerConfig } from '../solana/balance-manager-config';

const DEFAULT_SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';
const DEFAULT_SOLANA_RPC_SUBSCRIPTIONS_URL =
	'wss://api.mainnet-beta.solana.com';

const trepaProcessEnv = (): Record<string, string | undefined> =>
	typeof process !== 'undefined' && process.env ? process.env : {};

function envUrl(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const t = value.trim();
	return t === '' ? undefined : t;
}

export interface TrepaConfig {
	/** One credential per swarm bot; first entry is the primary `TrepaClient` session. */
	credentials?: readonly BotCredentials[];
	/** Trepa REST origin. */
	baseUrl?: string;
	/** Solana HTTP RPC URL. */
	solanaRpcUrl?: string;
	/** Solana WebSocket RPC URL (set with `solanaRpcUrl` when not on default mainnet). */
	solanaRpcSubscriptionsUrl?: string;
	/** Optional per-bot target balances; master key via `TREPA_MASTER_PRIVATE_KEY`. */
	balanceManager?: BotBalanceManagerConfig;
}

/** Root client: Trepa API plus `bots` and resolved Solana RPC URLs. */
export class Trepa extends TrepaClient {
	/** Multi-bot runner (`credentials.length` loops). */
	readonly bots: Bots;

	readonly solanaRpcUrl: string;
	readonly solanaRpcSubscriptionsUrl: string;

	constructor(config: TrepaConfig = {}) {
		ensureTrepaEnvLoaded();
		const env = trepaProcessEnv();
		const baseUrl = config.baseUrl ?? envUrl(env.TREPA_BASE_URL);
		const credentials = config.credentials ?? [];
		const primary = credentials[0];
		const session = new Session({
			apiKey: primary?.apiKey,
			privateKey: primary?.privateKey,
			baseUrl,
		});
		super(session);
		this.solanaRpcUrl =
			config.solanaRpcUrl ??
			envUrl(env.TREPA_SOLANA_RPC_URL) ??
			DEFAULT_SOLANA_RPC_URL;
		this.solanaRpcSubscriptionsUrl =
			config.solanaRpcSubscriptionsUrl ??
			envUrl(env.TREPA_SOLANA_RPC_SUBSCRIPTIONS_URL) ??
			DEFAULT_SOLANA_RPC_SUBSCRIPTIONS_URL;
		this.bots = new Bots(credentials, {
			baseUrl,
			solanaRpcUrl: this.solanaRpcUrl,
			solanaRpcSubscriptionsUrl: this.solanaRpcSubscriptionsUrl,
			trepa: this,
			balanceManager: config.balanceManager,
		});
	}
}
