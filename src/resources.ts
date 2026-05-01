import type { components, operations } from './api/schema';
import type { Session } from './session';
import { signTransaction } from './sign';

type Schema<K extends keyof components['schemas']> = components['schemas'][K];
type Query<K extends keyof operations> = operations[K] extends {
	parameters: { query?: infer Q };
}
	? Q
	: never;
type RequiredQuery<K extends keyof operations> = operations[K] extends {
	parameters: { query: infer Q };
}
	? Q
	: never;

class Resource {
	protected readonly session: Session;
	constructor(session: Session) {
		this.session = session;
	}
	protected get client() {
		return this.session.client;
	}
}

export class AuthResource extends Resource {
	/** Get the user behind the current session. */
	async me(): Promise<Schema<'UserDto'>> {
		return this.session.request(
			() => this.client.GET('/auth/me'),
			'Failed to load the current user',
		);
	}

	/** Manually refresh the session token (auto-handled on 401/403 anyway). */
	async refresh(): Promise<void> {
		return this.session.refresh();
	}

	/** Invalidate the session server-side and clear local cookies. */
	async logout(): Promise<void> {
		return this.session.logout();
	}
}

export class UsersResource extends Resource {
	/** Get a user profile, optionally embedding related entities. */
	async get(
		id: string,
		params: Query<'UsersController_find'> = {},
	): Promise<Schema<'UserWithRelationsDto'>> {
		return this.session.request(() =>
			this.client.GET('/users/{id}', {
				params: { path: { id }, query: params },
			}),
		);
	}

	async predictions(
		id: string,
		params: Query<'UsersController_findUserPredictions'> = {},
	): Promise<Schema<'PredictionWithRelationsDto'>[]> {
		return this.session.request(() =>
			this.client.GET('/users/{id}/predictions', {
				params: { path: { id }, query: params },
			}),
		);
	}

	async statistics(id: string): Promise<Schema<'UserStatisticsDto'>> {
		return this.session.request(() =>
			this.client.GET('/users/{id}/statistics', { params: { path: { id } } }),
		);
	}

	async portfolio(userId: string): Promise<Schema<'PortfolioDto'>> {
		return this.session.request(() =>
			this.client.GET('/users/{user_id}/portfolio', {
				params: { path: { user_id: userId } },
			}),
		);
	}

	async streakDetails(
		id: string,
		streakId: string,
	): Promise<Schema<'StreakDetailsDto'>> {
		return this.session.request(() =>
			this.client.GET('/users/{id}/streak-details/{streak_id}', {
				params: { path: { id, streak_id: streakId } },
			}),
		);
	}
}

export class PoolsResource extends Resource {
	async list(
		params: Query<'PoolsController_findMany'> = {},
	): Promise<Schema<'PoolWithRelationsDto'>[]> {
		return this.session.request(() =>
			this.client.GET('/pools', { params: { query: params } }),
		);
	}

	async get(
		id: string,
		params: Query<'PoolsController_find'> = {},
	): Promise<Schema<'PoolWithRelationsDto'>> {
		return this.session.request(() =>
			this.client.GET('/pools/{id}', {
				params: { path: { id }, query: params },
			}),
		);
	}
}

export class StreaksResource extends Resource {
	/** The Bitcoin streak: the canonical entry point for the SDK. */
	async bitcoin(): Promise<Schema<'StreakBitcoinDto'>> {
		return this.session.request(() => this.client.GET('/streak/bitcoin'));
	}

	/** The current and next pool inside a streak. */
	async poolDetails(streakId: string): Promise<Schema<'StreakPoolDetailsDto'>> {
		return this.session.request(() =>
			this.client.GET('/streak/pool-details', {
				params: { query: { streak_id: streakId } },
			}),
		);
	}

	async pools(
		streakId: string,
		params: Omit<RequiredQuery<'StreaksController_getPools'>, 'streak_id'> = {},
	): Promise<Schema<'StreakPoolsListDto'>> {
		return this.session.request(() =>
			this.client.GET('/streak/pools', {
				params: { query: { ...params, streak_id: streakId } },
			}),
		);
	}

	/** The caller's progress and unclaimed rewards inside a streak. */
	async userDetails(
		streakId: string,
		params: Omit<
			RequiredQuery<'StreaksController_getUserDetails'>,
			'streak_id'
		> = {},
	): Promise<Schema<'StreakDetailsDto'>> {
		return this.session.request(() =>
			this.client.GET('/streak/user-details', {
				params: { query: { ...params, streak_id: streakId } },
			}),
		);
	}

	/**
	 * Build, sign, and submit a claim-streak-reward transaction in one call.
	 * Requires `privateKey` on the Trepa client.
	 */
	async claimReward(args: {
		streakRewardId: string;
	}): Promise<Schema<'SubmittedClaimStreakRewardTransactionDto'>> {
		const privateKey = this.session.requirePrivateKey('streaks.claimReward');
		const prepared = await this.session.request(
			() =>
				this.client.POST('/transactions/claim-streak-reward', {
					body: { streak_reward_id: args.streakRewardId },
				}),
			'Failed to build the claim-streak-reward transaction',
		);
		const signed_transaction = await signTransaction(
			prepared.transaction,
			privateKey,
		);
		return this.session.request(
			() =>
				this.client.POST('/transactions/claim-streak-reward/submit', {
					body: {
						streak_reward_id: args.streakRewardId,
						signed_transaction,
						proof: prepared.proof,
					},
				}),
			'Failed to submit the claim-streak-reward transaction',
		);
	}
}

export class PredictionsResource extends Resource {
	/**
	 * Build, sign, and submit a prediction in one call. Requires
	 * `privateKey` on the Trepa client.
	 */
	async create(args: {
		poolId: string;
		stake: number;
		value: number;
	}): Promise<Schema<'SubmittedPredictionTransactionDto'>> {
		const privateKey = this.session.requirePrivateKey('predictions.create');
		const prepared = await this.session.request(
			() =>
				this.client.POST('/transactions/prediction', {
					body: {
						pool_id: args.poolId,
						stake: args.stake,
						value: args.value,
					},
				}),
			'Failed to build the prediction transaction',
		);
		const signed_transaction = await signTransaction(
			prepared.transaction,
			privateKey,
		);
		return this.session.request(
			() =>
				this.client.POST('/transactions/prediction/submit', {
					body: {
						pool_id: args.poolId,
						signed_transaction,
						proof: prepared.proof,
					},
				}),
			'Failed to submit the prediction transaction',
		);
	}

	/** Move the value of an existing prediction. */
	async update(args: {
		predictionId: string;
		value: number;
	}): Promise<Schema<'SubmittedPredictionTransactionDto'>> {
		const privateKey = this.session.requirePrivateKey('predictions.update');
		const prepared = await this.session.request(
			() =>
				this.client.POST('/transactions/prediction/update', {
					body: { prediction_id: args.predictionId, value: args.value },
				}),
			'Failed to build the update-prediction transaction',
		);
		const signed_transaction = await signTransaction(
			prepared.transaction,
			privateKey,
		);
		return this.session.request(
			() =>
				this.client.POST('/transactions/prediction/update/submit', {
					body: {
						prediction_id: args.predictionId,
						signed_transaction,
						proof: prepared.proof,
					},
				}),
			'Failed to submit the update-prediction transaction',
		);
	}

	/** Change the stake on an existing prediction. */
	async updateStake(args: {
		predictionId: string;
		stake: number;
	}): Promise<Schema<'SubmittedPredictionTransactionDto'>> {
		const privateKey = this.session.requirePrivateKey(
			'predictions.updateStake',
		);
		const prepared = await this.session.request(
			() =>
				this.client.POST('/transactions/stake/update', {
					body: { prediction_id: args.predictionId, stake: args.stake },
				}),
			'Failed to build the update-stake transaction',
		);
		const signed_transaction = await signTransaction(
			prepared.transaction,
			privateKey,
		);
		return this.session.request(
			() =>
				this.client.POST('/transactions/stake/update/submit', {
					body: {
						prediction_id: args.predictionId,
						signed_transaction,
						proof: prepared.proof,
					},
				}),
			'Failed to submit the update-stake transaction',
		);
	}
}

export class RewardsResource extends Resource {
	/**
	 * Claim a pool reward in one call. The `poolId` is used to build the
	 * transaction; the `rewardId` is required to submit it (the API surfaces
	 * it on the prediction's relations; see `users.predictions(id, { includes: ['reward'] })`).
	 */
	async claim(args: {
		poolId: string;
		rewardId: string;
	}): Promise<Schema<'SubmittedClaimTransactionDto'>> {
		const privateKey = this.session.requirePrivateKey('rewards.claim');
		const prepared = await this.session.request(
			() =>
				this.client.POST('/transactions/claim-reward', {
					body: { pool_id: args.poolId },
				}),
			'Failed to build the claim-reward transaction',
		);
		const signed_transaction = await signTransaction(
			prepared.transaction,
			privateKey,
		);
		return this.session.request(
			() =>
				this.client.POST('/transactions/claim-reward/submit', {
					body: {
						reward_id: args.rewardId,
						signed_transaction,
						proof: prepared.proof,
					},
				}),
			'Failed to submit the claim-reward transaction',
		);
	}
}

export class WithdrawalsResource extends Resource {
	/** Withdraw USDC from your Trepa balance to an external Solana wallet. */
	async create(args: {
		toAddress: string;
		amount: number;
		mintAddress: string;
	}): Promise<Schema<'SubmittedWithdrawTransactionDto'>> {
		const privateKey = this.session.requirePrivateKey('withdrawals.create');
		const prepared = await this.session.request(
			() =>
				this.client.POST('/transactions/withdraw', {
					body: {
						to_address: args.toAddress,
						amount: args.amount,
						mint_address: args.mintAddress,
					},
				}),
			'Failed to build the withdraw transaction',
		);
		const signed_transaction = await signTransaction(
			prepared.transaction,
			privateKey,
		);
		return this.session.request(
			() =>
				this.client.POST('/transactions/withdraw/submit', {
					body: {
						to_address: args.toAddress,
						amount: args.amount,
						signed_transaction,
						proof: prepared.proof,
					},
				}),
			'Failed to submit the withdraw transaction',
		);
	}
}
