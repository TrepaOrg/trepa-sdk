import { runSessionPresignedFlow } from './presigned-transaction';
import type { Session } from './session';
import type { components, operations } from '../api/schema';

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
	async me(): Promise<Schema<'UserDto'>> {
		return this.session.request(
			() => this.client.GET('/auth/me'),
			'Failed to load the current user',
		);
	}

	async refresh(): Promise<void> {
		return this.session.refresh();
	}

	async logout(): Promise<void> {
		return this.session.logout();
	}
}

export class UsersResource extends Resource {
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

	async portfolio(id: string): Promise<Schema<'PortfolioDto'>> {
		return this.session.request(() =>
			this.client.GET('/users/{id}/portfolio', {
				params: { path: { id } },
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

	async predictions(
		id: string,
		params: Query<'PoolsController_findPoolPredictions'> = {},
	): Promise<Schema<'PredictionWithRelationsDto'>[]> {
		return this.session.request(() =>
			this.client.GET('/pools/{id}/predictions', {
				params: { path: { id }, query: params },
			}),
		);
	}
}

export class StreaksResource extends Resource {
	async bitcoin(): Promise<Schema<'StreakBitcoinDto'>> {
		return this.session.request(() => this.client.GET('/streak/bitcoin'));
	}

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

	async claimReward(args: {
		streakRewardId: string;
	}): Promise<Schema<'SubmittedClaimStreakRewardTransactionDto'>> {
		return this.session.request(
			() =>
				this.client.POST('/transactions/claim-streak-reward', {
					body: { streak_reward_id: args.streakRewardId },
				}),
			'Failed to claim the streak reward',
		);
	}
}

export class PredictionsResource extends Resource {
	async create(args: {
		poolId: string;
		stake: number;
		value: number;
	}): Promise<Schema<'SubmittedPredictionTransactionDto'>> {
		return runSessionPresignedFlow(this.session, {
			operation: 'predictions.create',
			build: () =>
				this.client.POST('/transactions/prediction', {
					body: {
						pool_id: args.poolId,
						stake: args.stake,
						value: args.value,
					},
				}),
			buildError: 'Failed to build the prediction transaction',
			makeSubmit: (prepared, signed_transaction) => () =>
				this.client.POST('/transactions/prediction/submit', {
					body: {
						pool_id: args.poolId,
						signed_transaction,
						proof: prepared.proof,
					},
				}),
			submitError: 'Failed to submit the prediction transaction',
		});
	}

	async update(args: {
		predictionId: string;
		value: number;
	}): Promise<Schema<'SubmittedPredictionTransactionDto'>> {
		return runSessionPresignedFlow(this.session, {
			operation: 'predictions.update',
			build: () =>
				this.client.POST('/transactions/prediction/update', {
					body: { prediction_id: args.predictionId, value: args.value },
				}),
			buildError: 'Failed to build the update-prediction transaction',
			makeSubmit: (prepared, signed_transaction) => () =>
				this.client.POST('/transactions/prediction/update/submit', {
					body: {
						prediction_id: args.predictionId,
						signed_transaction,
						proof: prepared.proof,
					},
				}),
			submitError: 'Failed to submit the update-prediction transaction',
		});
	}

	async updateStake(args: {
		predictionId: string;
		stake: number;
	}): Promise<Schema<'SubmittedPredictionTransactionDto'>> {
		return runSessionPresignedFlow(this.session, {
			operation: 'predictions.updateStake',
			build: () =>
				this.client.POST('/transactions/stake/update', {
					body: { prediction_id: args.predictionId, stake: args.stake },
				}),
			buildError: 'Failed to build the update-stake transaction',
			makeSubmit: (prepared, signed_transaction) => () =>
				this.client.POST('/transactions/stake/update/submit', {
					body: {
						prediction_id: args.predictionId,
						signed_transaction,
						proof: prepared.proof,
					},
				}),
			submitError: 'Failed to submit the update-stake transaction',
		});
	}
}

export class RewardsResource extends Resource {
	async claim(args: {
		poolId: string;
		rewardId: string;
	}): Promise<Schema<'SubmittedClaimTransactionDto'>> {
		return runSessionPresignedFlow(this.session, {
			operation: 'rewards.claim',
			build: () =>
				this.client.POST('/transactions/claim-reward', {
					body: { pool_id: args.poolId },
				}),
			buildError: 'Failed to build the claim-reward transaction',
			makeSubmit: (prepared, signed_transaction) => () =>
				this.client.POST('/transactions/claim-reward/submit', {
					body: {
						reward_id: args.rewardId,
						signed_transaction,
						proof: prepared.proof,
					},
				}),
			submitError: 'Failed to submit the claim-reward transaction',
		});
	}
}

export class WithdrawalsResource extends Resource {
	async create(args: {
		toAddress: string;
		amount: number;
		mintAddress: string;
	}): Promise<Schema<'SubmittedWithdrawTransactionDto'>> {
		return runSessionPresignedFlow(this.session, {
			operation: 'withdrawals.create',
			build: () =>
				this.client.POST('/transactions/withdraw', {
					body: {
						to_address: args.toAddress,
						amount: args.amount,
						mint_address: args.mintAddress,
					},
				}),
			buildError: 'Failed to build the withdraw transaction',
			makeSubmit: (prepared, signed_transaction) => () =>
				this.client.POST('/transactions/withdraw/submit', {
					body: {
						to_address: args.toAddress,
						amount: args.amount,
						signed_transaction,
						proof: prepared.proof,
					},
				}),
			submitError: 'Failed to submit the withdraw transaction',
		});
	}
}
