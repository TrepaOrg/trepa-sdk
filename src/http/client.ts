import type { Client } from 'openapi-fetch';

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
import type { paths, components } from '../api/schema';

/**
 * Typed Trepa API client for one session (one API key and optional wallet key).
 * Prefer `new Trepa(…)` or `ctx.trepa` from a bot slot over constructing this directly.
 */
export class TrepaClient {
	protected readonly session: Session;

	readonly auth: AuthResource;
	readonly users: UsersResource;
	readonly pools: PoolsResource;
	readonly streaks: StreaksResource;
	readonly predictions: PredictionsResource;
	readonly rewards: RewardsResource;
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

	me(): Promise<components['schemas']['UserDto']> {
		return this.auth.me();
	}

	logout(): Promise<void> {
		return this.auth.logout();
	}

	/** Refresh the session; the SDK usually does this automatically after 401/403. */
	refresh(): Promise<void> {
		return this.auth.refresh();
	}

	/** Active API origin. */
	get baseUrl(): string {
		return this.session.baseUrl;
	}

	/** Low-level `openapi-fetch` client for any path in the Trepa OpenAPI spec. */
	get raw(): Client<paths> {
		return this.session.client;
	}
}
