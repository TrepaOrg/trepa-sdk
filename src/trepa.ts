import type { Client } from 'openapi-fetch'
import type { paths, components } from './api/schema'
import { Session, type SessionConfig } from './session'
import {
	AuthResource,
	PoolsResource,
	PredictionsResource,
	RewardsResource,
	StreaksResource,
	UsersResource,
	WithdrawalsResource,
} from './resources'
import { Bot } from './bot'

export type TrepaConfig = SessionConfig

/**
 * The single entry point for the Trepa SDK.
 *
 * ```ts
 * const trepa = new Trepa({
 *   apiKey: process.env.TREPA_API_KEY!,
 *   privateKey: process.env.TREPA_PRIVATE_KEY!,
 * })
 *
 * const me = await trepa.me()
 * const streak = await trepa.streaks.bitcoin()
 * const { current_pool } = await trepa.streaks.poolDetails(streak.id)
 * if (!current_pool) throw new Error('No Bitcoin pool open right now.')
 *
 * const { signature } = await trepa.predictions.create({
 *   poolId: current_pool.id,
 *   stake: 1,
 *   value: 50_000,
 * })
 * ```
 */
export class Trepa {
	private readonly session: Session

	readonly auth: AuthResource
	readonly users: UsersResource
	readonly pools: PoolsResource
	readonly streaks: StreaksResource
	readonly predictions: PredictionsResource
	readonly rewards: RewardsResource
	readonly withdrawals: WithdrawalsResource
	readonly bot: Bot

	constructor(config: TrepaConfig = {}) {
		this.session = new Session(config)
		this.auth = new AuthResource(this.session)
		this.users = new UsersResource(this.session)
		this.pools = new PoolsResource(this.session)
		this.streaks = new StreaksResource(this.session)
		this.predictions = new PredictionsResource(this.session)
		this.rewards = new RewardsResource(this.session)
		this.withdrawals = new WithdrawalsResource(this.session)
		this.bot = new Bot(this.session, {
			auth: this.auth,
			streaks: this.streaks,
			predictions: this.predictions,
		})
	}

	/** The user behind the current session. Shortcut for `trepa.auth.me()`. */
	me(): Promise<components['schemas']['UserDto']> {
		return this.auth.me()
	}

	/** End the current session and clear cookies. */
	logout(): Promise<void> {
		return this.auth.logout()
	}

	/**
	 * Force a token refresh. The SDK refreshes automatically on 401/403 — you
	 * normally don't need to call this.
	 */
	refresh(): Promise<void> {
		return this.auth.refresh()
	}

	/** API origin in use. */
	get baseUrl(): string {
		return this.session.baseUrl
	}

	/**
	 * The underlying typed openapi-fetch client. Reach for this when you need
	 * an endpoint the resource methods don't expose yet — every path in
	 * `openapi.json` is callable here with full type-safety.
	 */
	get raw(): Client<paths> {
		return this.session.client
	}
}
