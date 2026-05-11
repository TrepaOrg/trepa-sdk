import {
	DEFAULT_POLL_INTERVAL_MS,
	DEFAULT_POST_RESOLVE_BUFFER_MS,
	RESOLVE_PREDICTION_DELAY_MS,
	RESOLVE_PREDICTION_MAX_ATTEMPTS,
} from './constants';
import {
	emit,
	lineForError,
	lineForPredicted,
	lineForPredictionUpdated,
	lineForReady,
	lineForSkipped,
} from './log-lines';
import { snapOutcomeToPool } from './outcomes';
import type {
	BotContext,
	BotOptions,
	BotPredictDecision,
	BotSlot,
	BotSubmittedPredictionContext,
	BotUpdatePredictionDecision,
	OpenPool,
} from './types';
import { TrepaError } from '../core/errors';
import { TrepaClient } from '../http/client';
import { trepaStdoutIsInteractive } from '../logging/format';
import { startBotWalletHudMirror } from '../solana/wallet-hud';

type BotState =
	| { kind: 'polling' }
	| { kind: 'no_open_pool' }
	| { kind: 'skipping_in_flight_pool'; pool: OpenPool }
	| { kind: 'awaiting_start'; pool: OpenPool }
	| { kind: 'predicting'; pool: OpenPool }
	| { kind: 'awaiting_end'; pool: OpenPool }
	| { kind: 'recovering_from_error'; err: unknown }
	| { kind: 'stopped' };

interface MachineCtx {
	client: TrepaClient;
	options: BotOptions;
	signal: AbortSignal;
	publicCtx: BotContext;
	streakId: string;
	pollIntervalMs: number;
	postResolveBufferMs: number;
	seen: Set<string>;
	isColdStart: boolean;
}

export async function runPredictorLoop(
	slot: BotSlot,
	client: TrepaClient,
	options: BotOptions,
	signal: AbortSignal,
	walletHud: { rpcUrl: string; wsUrl: string },
): Promise<void> {
	if (signal.aborted) return;
	const authStarted = Date.now();
	const me = await client.auth.me();
	if (signal.aborted) return;
	if (trepaStdoutIsInteractive()) {
		startBotWalletHudMirror({
			client,
			me,
			slotIndex: slot.index,
			rpcUrl: walletHud.rpcUrl,
			wsUrl: walletHud.wsUrl,
			signal,
		});
	}
	const streakId = (await client.streaks.bitcoin()).id;
	const authMs = Date.now() - authStarted;
	const publicCtx: BotContext = { slot, me, trepa: client, signal };
	emit('ready', lineForReady(options, publicCtx, slot, authMs), slot);

	const ctx: MachineCtx = {
		client,
		options,
		signal,
		publicCtx,
		streakId,
		pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
		postResolveBufferMs:
			options.postResolveBufferMs ?? DEFAULT_POST_RESOLVE_BUFFER_MS,
		seen: new Set<string>(),
		isColdStart: true,
	};

	let state: BotState = { kind: 'polling' };
	while (state.kind !== 'stopped') {
		if (signal.aborted) {
			state = { kind: 'stopped' };
			break;
		}
		state = await advance(state, ctx);
	}
}

const advance = async (state: BotState, ctx: MachineCtx): Promise<BotState> => {
	switch (state.kind) {
		case 'polling':
			return classify(ctx);

		case 'no_open_pool':
			await sleep(ctx.pollIntervalMs, ctx.signal);
			return { kind: 'polling' };

		case 'skipping_in_flight_pool':
			ctx.seen.add(state.pool.id);
			emit(
				'skip',
				lineForSkipped(
					ctx.options,
					{ pool: state.pool, reason: 'started-mid-pool' },
					ctx.publicCtx.slot,
				),
				ctx.publicCtx.slot,
			);
			await sleepUntil(
				state.pool.prediction_end_date,
				ctx.postResolveBufferMs,
				ctx.pollIntervalMs,
				ctx.signal,
			);
			return { kind: 'polling' };

		case 'awaiting_start': {
			const wait =
				new Date(state.pool.prediction_start_date).getTime() - Date.now();
			if (wait > 0) await sleep(wait, ctx.signal);
			return { kind: 'predicting', pool: state.pool };
		}

		case 'predicting': {
			ctx.seen.add(state.pool.id);
			const deadlineMs = new Date(state.pool.prediction_end_date).getTime();
			await tryPredict(ctx, state.pool, deadlineMs);
			return { kind: 'awaiting_end', pool: state.pool };
		}

		case 'awaiting_end':
			await sleepUntil(
				state.pool.prediction_end_date,
				ctx.postResolveBufferMs,
				ctx.pollIntervalMs,
				ctx.signal,
			);
			return { kind: 'polling' };

		case 'recovering_from_error':
			emit(
				'error',
				lineForError(ctx.options, state.err, ctx.publicCtx.slot),
				ctx.publicCtx.slot,
			);
			await sleep(ctx.pollIntervalMs, ctx.signal);
			return { kind: 'polling' };

		case 'stopped':
			return state;
	}
};

const classify = async (ctx: MachineCtx): Promise<BotState> => {
	let pool: OpenPool | null;
	try {
		pool =
			(await ctx.client.streaks.poolDetails(ctx.streakId)).current_pool ?? null;
	} catch (err) {
		return { kind: 'recovering_from_error', err };
	}

	if (!pool || pool.is_closed) {
		emit(
			'skip',
			lineForSkipped(
				ctx.options,
				{ pool: pool ?? null, reason: 'no-open-pool' },
				ctx.publicCtx.slot,
			),
			ctx.publicCtx.slot,
		);
		return { kind: 'no_open_pool' };
	}

	const now = Date.now();
	const startMs = new Date(pool.prediction_start_date).getTime();
	const endMs = new Date(pool.prediction_end_date).getTime();

	if (ctx.isColdStart && now >= startMs) {
		ctx.isColdStart = false;
		return { kind: 'skipping_in_flight_pool', pool };
	}
	ctx.isColdStart = false;

	if (ctx.seen.has(pool.id)) {
		return { kind: 'awaiting_end', pool };
	}

	if (now >= endMs) {
		return { kind: 'no_open_pool' };
	}

	if (now < startMs) {
		return { kind: 'awaiting_start', pool };
	}

	return { kind: 'predicting', pool };
};

async function resolvePredictionIdForPool(
	client: TrepaClient,
	userId: string,
	poolId: string,
	signal: AbortSignal,
): Promise<string | null> {
	for (let attempt = 0; attempt < RESOLVE_PREDICTION_MAX_ATTEMPTS; attempt++) {
		if (signal.aborted) return null;
		try {
			const rows = await client.users.predictions(userId, {
				filter_by: ['ACTIVE'],
				includes: ['pool'],
				limit: 50,
			});
			const row = rows.find((p) => p.pool?.id === poolId);
			if (row) return row.id;
		} catch {}
		await sleep(RESOLVE_PREDICTION_DELAY_MS, signal);
	}
	return null;
}

const tryPredict = async (
	ctx: MachineCtx,
	pool: OpenPool,
	deadlineMs: number,
): Promise<void> => {
	const { options } = ctx;
	let decision: BotPredictDecision;

	try {
		decision = await Promise.race([
			options.predict(pool, ctx.publicCtx),
			untilAborted(ctx.signal).then((): BotPredictDecision => null),
		]);
	} catch (err) {
		emit(
			'error',
			lineForError(options, err, ctx.publicCtx.slot),
			ctx.publicCtx.slot,
		);
		emit(
			'skip',
			lineForSkipped(
				options,
				{ pool, reason: 'predict-threw' },
				ctx.publicCtx.slot,
			),
			ctx.publicCtx.slot,
		);
		return;
	}

	if (ctx.signal.aborted) {
		decision = null;
	}

	if (decision === null) {
		emit(
			'skip',
			lineForSkipped(
				options,
				{
					pool,
					reason: ctx.signal.aborted
						? 'predict-aborted'
						: 'predict-returned-null',
				},
				ctx.publicCtx.slot,
			),
			ctx.publicCtx.slot,
		);
		return;
	}

	if (!Number.isFinite(decision.value)) {
		emit(
			'skip',
			lineForSkipped(
				options,
				{ pool, reason: 'invalid-value' },
				ctx.publicCtx.slot,
			),
			ctx.publicCtx.slot,
		);
		return;
	}

	if (!Number.isFinite(decision.stake)) {
		emit(
			'skip',
			lineForSkipped(
				options,
				{ pool, reason: 'invalid-stake' },
				ctx.publicCtx.slot,
			),
			ctx.publicCtx.slot,
		);
		return;
	}

	if (Date.now() >= deadlineMs) {
		emit(
			'skip',
			lineForSkipped(
				options,
				{ pool, reason: 'predict-too-late' },
				ctx.publicCtx.slot,
			),
			ctx.publicCtx.slot,
		);
		return;
	}

	const value = snapOutcomeToPool(decision.value, pool);
	const stake = Math.min(
		Math.max(decision.stake, pool.min_stake),
		pool.max_stake,
	);

	try {
		await ctx.client.predictions.create({ poolId: pool.id, stake, value });
		emit(
			'pred',
			lineForPredicted(options, { pool, value, stake }, ctx.publicCtx.slot),
			ctx.publicCtx.slot,
		);
		if (options.updatePrediction) {
			const predictionId = await resolvePredictionIdForPool(
				ctx.client,
				ctx.publicCtx.me.id,
				pool.id,
				ctx.signal,
			);
			if (!predictionId) {
				emit(
					'error',
					lineForError(
						options,
						new TrepaError(
							'Could not resolve prediction id for updatePrediction ' +
								'(active prediction for this pool not found after submit).',
							{ status: 0, code: 'prediction_id_unresolved' },
						),
						ctx.publicCtx.slot,
					),
					ctx.publicCtx.slot,
				);
			} else {
				const submitted: BotSubmittedPredictionContext = {
					pool,
					value,
					stake,
					predictionId,
				};
				let updateDecision: BotUpdatePredictionDecision;
				try {
					updateDecision = await Promise.race([
						options.updatePrediction(submitted, ctx.publicCtx),
						untilAborted(ctx.signal).then(
							(): BotUpdatePredictionDecision => null,
						),
					]);
				} catch (err) {
					emit(
						'error',
						lineForError(options, err, ctx.publicCtx.slot),
						ctx.publicCtx.slot,
					);
					updateDecision = null;
				}

				if (ctx.signal.aborted) {
					updateDecision = null;
				}

				if (updateDecision !== null) {
					if (!Number.isFinite(updateDecision.value)) {
						emit(
							'error',
							lineForError(
								options,
								new TrepaError(
									'updatePrediction returned a non-finite value.',
									{
										status: 0,
										code: 'update_prediction_invalid_value',
									},
								),
								ctx.publicCtx.slot,
							),
							ctx.publicCtx.slot,
						);
					} else {
						const updateValue = snapOutcomeToPool(updateDecision.value, pool);
						try {
							await ctx.client.predictions.update({
								predictionId,
								value: updateValue,
							});
							emit(
								'pred_update',
								lineForPredictionUpdated(
									options,
									{
										pool,
										predictionId,
										previousValue: value,
										value: updateValue,
										stake,
									},
									ctx.publicCtx.slot,
								),
								ctx.publicCtx.slot,
							);
						} catch (err) {
							emit(
								'error',
								lineForError(options, err, ctx.publicCtx.slot),
								ctx.publicCtx.slot,
							);
						}
					}
				}
			}
		}
	} catch (err) {
		emit(
			'error',
			lineForError(options, err, ctx.publicCtx.slot),
			ctx.publicCtx.slot,
		);
	}
};

function untilAborted(signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.resolve();
	return new Promise<void>((resolve) => {
		signal.addEventListener('abort', () => resolve(), { once: true });
	});
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.resolve();
	return new Promise<void>((resolve) => {
		const done = (): void => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		};
		const onAbort = (): void => {
			clearTimeout(timer);
			done();
		};
		const timer = setTimeout(done, ms);
		signal.addEventListener('abort', onAbort, { once: true });
	});
}

function sleepUntil(
	isoDate: string,
	bufferMs: number,
	minMs: number,
	signal: AbortSignal,
): Promise<void> {
	const ms = new Date(isoDate).getTime() - Date.now() + bufferMs;
	return sleep(Math.max(ms, minMs), signal);
}
