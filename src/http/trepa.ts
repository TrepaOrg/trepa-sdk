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
	/**
	 * One credential per swarm bot. The first entry is also used for calls on `Trepa` that are
	 * not slot-scoped (e.g. `trepa.predictions`). Omit for public endpoints only.
	 */
	credentials?: readonly BotCredentials[];
	/** API base URL (default: production). */
	baseUrl?: string;
	/** Solana HTTP JSON-RPC (balance manager, wallet HUD; default: public mainnet-beta). */
	solanaRpcUrl?: string;
	/**
	 * Solana WebSocket JSON-RPC (subscriptions). Not derived from `solanaRpcUrl`; set both when
	 * leaving mainnet. Default: public mainnet-beta WS.
	 */
	solanaRpcSubscriptionsUrl?: string;
	/**
	 * Target balances per bot for the optional funder. Enable with env `TREPA_MASTER_PRIVATE_KEY`
	 * (never pass the master secret in application code).
	 */
	balanceManager?: BotBalanceManagerConfig;
}

/**
 * SDK entry point: REST client, `bots` runner, and resolved Solana RPC URLs.
 *
 * ```ts
 * const trepa = new Trepa({
 *   credentials: [{ apiKey: '…', privateKey: '…' }],
 * })
 * await trepa.bots.run({ predict: (pool) => ({ value: …, stake: pool.min_stake }) })
 * ```
 *
 * With multiple credentials, `trepa.bots.run` starts one loop per bot; inside `predict` / `onStart`,
 * use `ctx.trepa` for that bot’s session.
 */
export class Trepa extends TrepaClient {
	/** Parallel predictor runner (one loop per configured credential). */
	readonly bots: Bots;

	/** Resolved Solana HTTP RPC URL. */
	readonly solanaRpcUrl: string;
	/** Resolved Solana WebSocket RPC URL. */
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
