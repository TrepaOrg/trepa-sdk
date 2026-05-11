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

/** Session-scoped Trepa API client (use `new Trepa(…)` in apps). */
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

	refresh(): Promise<void> {
		return this.auth.refresh();
	}

	get baseUrl(): string {
		return this.session.baseUrl;
	}

	get raw(): Client<paths> {
		return this.session.client;
	}
}
