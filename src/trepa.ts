import { Bots, type BotCredentials } from './bot';
import { TrepaClient } from './client';
import { Session } from './session';

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

	constructor(config: TrepaConfig = {}) {
		const credentials = config.credentials ?? [];
		const primary = credentials[0];
		const session = new Session({
			apiKey: primary?.apiKey,
			privateKey: primary?.privateKey,
			baseUrl: config.baseUrl,
		});
		super(session);
		this.bots = new Bots(credentials, {
			baseUrl: config.baseUrl,
		});
	}
}
