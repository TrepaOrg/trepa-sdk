import { Bots, type BotCredentials } from './bot';
import { TrepaClient } from './client';
import { Session } from './session';

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

/** Configuration for a `Trepa` client. */
export interface TrepaConfig {
	/**
	 * One credential per bot in the swarm. The first entry doubles as the
	 * primary identity for any non-bot resource call (`trepa.predictions.create`,
	 * `trepa.rewards.claim`, etc.). Omit for read-only access to public
	 * endpoints.
	 */
	credentials?: readonly BotCredentials[];
	/** Override the API origin (defaults to production). */
	baseUrl?: string;
	/**
	 * Solana JSON-RPC HTTPS endpoint (balance reads, sends). Used by tooling
	 * such as the liquidity-bot master-wallet funder; defaults to public
	 * mainnet-beta.
	 */
	solanaRpcUrl?: string;
	/**
	 * Solana JSON-RPC WebSocket endpoint for transaction subscriptions.
	 * Never inferred from `solanaRpcUrl` — set both explicitly when you leave
	 * mainnet. If omitted, defaults to public mainnet-beta WebSocket.
	 */
	solanaRpcSubscriptionsUrl?: string;
}

/**
 * The single entry point for the Trepa SDK.
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
 *   predict: (pool, { trepa }) => ({ value: ..., stake: pool.min_stake }),
 * }))
 * ```
 *
 * For a single-identity setup (or direct API calls), pass an array with
 * one credential. The first credential is used as the primary identity for
 * any non-bot resource call. Inside a swarm, each slot's `predict` and
 * `onStart` receives a `ctx.trepa` bound to that slot's credentials.
 */
export class Trepa extends TrepaClient {
	/** Run one or more long-running predictor loops in parallel. */
	readonly bots: Bots;

	/** Resolved Solana HTTP RPC (see `TrepaConfig.solanaRpcUrl`). */
	readonly solanaRpcUrl: string;
	/** Resolved Solana WebSocket RPC for confirms / subscriptions. */
	readonly solanaRpcSubscriptionsUrl: string;

	constructor(config: TrepaConfig = {}) {
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
		});
	}
}
