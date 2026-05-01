import type { Client } from 'openapi-fetch';

import type { paths, components } from './api/schema';
import { Bots, type BotCredentials } from './bot';
import {
	AuthResource,
	PoolsResource,
	PredictionsResource,
	RewardsResource,
	StreaksResource,
	UsersResource,
	WithdrawalsResource,
} from './resources';
import { Session } from './session';

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
 *   predict: (pool) => ({ value: ..., stake: pool.min_stake }),
 * }))
 * ```
 *
 * For a single-identity setup (or direct API calls), pass an array with
 * one credential. The first credential is used as the primary identity for
 * any non-bot resource call.
 */
export class Trepa {
	private readonly session: Session;

	readonly auth: AuthResource;
	readonly users: UsersResource;
	readonly pools: PoolsResource;
	readonly streaks: StreaksResource;
	readonly predictions: PredictionsResource;
	readonly rewards: RewardsResource;
	readonly withdrawals: WithdrawalsResource;
	readonly bots: Bots;

	constructor(config: TrepaConfig = {}) {
		const credentials = config.credentials ?? [];
		const primary = credentials[0];

		this.session = new Session({
			apiKey: primary?.apiKey,
			privateKey: primary?.privateKey,
			baseUrl: config.baseUrl,
		});
		this.auth = new AuthResource(this.session);
		this.users = new UsersResource(this.session);
		this.pools = new PoolsResource(this.session);
		this.streaks = new StreaksResource(this.session);
		this.predictions = new PredictionsResource(this.session);
		this.rewards = new RewardsResource(this.session);
		this.withdrawals = new WithdrawalsResource(this.session);
		this.bots = new Bots(credentials, {
			baseUrl: config.baseUrl,
		});
	}

	/** The user behind the current session. Shortcut for `trepa.auth.me()`. */
	me(): Promise<components['schemas']['UserDto']> {
		return this.auth.me();
	}

	/** End the current session and clear cookies. */
	logout(): Promise<void> {
		return this.auth.logout();
	}

	/**
	 * Force a token refresh. The SDK refreshes automatically on 401/403, so
	 * you normally don't need to call this.
	 */
	refresh(): Promise<void> {
		return this.auth.refresh();
	}

	/** API origin in use. */
	get baseUrl(): string {
		return this.session.baseUrl;
	}

	/**
	 * The underlying typed openapi-fetch client. Reach for this when you need
	 * an endpoint the resource methods don't expose yet. Every path in
	 * `openapi.json` is callable here with full type-safety.
	 */
	get raw(): Client<paths> {
		return this.session.client;
	}
}
