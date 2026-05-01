import type { Client } from 'openapi-fetch';

import type { paths, components } from './api/schema';
import {
	AuthResource,
	PoolsResource,
	PredictionsResource,
	RewardsResource,
	StreaksResource,
	UsersResource,
	WithdrawalsResource,
} from './resources';
import type { Session } from './session';

/**
 * Single-session Trepa client. Holds every resource group bound to one
 * `Session` (one apiKey + privateKey pair).
 *
 * You normally don't construct this directly — use `new Trepa(...)` for a
 * one-identity client, or grab a slot-scoped instance from `ctx.trepa`
 * inside `predict` / `onStart` when running a swarm.
 */
export class TrepaClient {
	protected readonly session: Session;

	/** Authentication: session lifecycle and the current user. */
	readonly auth: AuthResource;
	/** Profiles, predictions history, statistics, and portfolios for any user. */
	readonly users: UsersResource;
	/** Browse and inspect individual pools across all streaks. */
	readonly pools: PoolsResource;
	/** Streak overview, open pools, and claimable streak rewards. */
	readonly streaks: StreaksResource;
	/** Submit, update, and resize predictions on open pools. */
	readonly predictions: PredictionsResource;
	/** Claim payouts on resolved pools. */
	readonly rewards: RewardsResource;
	/** Withdraw USDC from your Trepa balance to an external Solana wallet. */
	readonly withdrawals: WithdrawalsResource;

	constructor(session: Session) {
		this.session = session;
		this.auth = new AuthResource(session);
		this.users = new UsersResource(session);
		this.pools = new PoolsResource(session);
		this.streaks = new StreaksResource(session);
		this.predictions = new PredictionsResource(session);
		this.rewards = new RewardsResource(session);
		this.withdrawals = new WithdrawalsResource(session);
	}

	/** The user behind the current session. Shortcut for `auth.me()`. */
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
