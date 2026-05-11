import {
	DEFAULT_SESSION_STAGGER_MS,
	DEFAULT_SOLANA_RPC_URL,
	DEFAULT_SOLANA_WS_URL,
	SHUTDOWN_SIGNALS,
} from './constants';
import { envUrl } from './env-utils';
import { emit, lineForError } from './log-lines';
import { runPredictorLoop } from './predictor-loop';
import type {
	BotCredentials,
	BotOptions,
	BotSlot,
	BotSwarmDefaults,
} from './types';
import { ensureTrepaEnvLoaded } from '../config/env-load';
import { TrepaError } from '../core/errors';
import { TrepaClient } from '../http/client';
import { Session, type SessionConfig } from '../http/session';
import type { Trepa } from '../http/trepa';
import {
	logBotSwarmShutdown,
	logBotSwarmStartup,
	trepaLogSlotLanesEnabled,
} from '../logging/format';
import {
	balanceManagerShutdownWaitMs,
	type BalanceManagerConfig,
	runBalanceManagerSidecar,
} from '../solana/balance-manager';

const staggerFirstRequest = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

const sleepMs = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

function mergeBalanceManagerConfig(
	base?: BalanceManagerConfig,
	override?: BalanceManagerConfig,
): BalanceManagerConfig | undefined {
	if (base === undefined && override === undefined) return undefined;
	return { ...base, ...override };
}

/**
 * One predictor loop per credential on `new Trepa({ credentials })`.
 */
export class Bots {
	private readonly credentials: readonly BotCredentials[];
	private readonly sessionDefaults: Omit<
		SessionConfig,
		'apiKey' | 'privateKey'
	>;
	private readonly sessionStaggerMs: number;
	private readonly walletHudRpcUrl: string;
	private readonly walletHudWsUrl: string;
	private readonly trepaForBalanceManager?: Trepa;
	private readonly balanceManagerConfig?: BalanceManagerConfig;

	constructor(
		credentials: readonly BotCredentials[],
		sessionDefaults: BotSwarmDefaults = {},
	) {
		const {
			solanaRpcUrl,
			solanaRpcSubscriptionsUrl,
			trepa: trepaForBalanceManager,
			balanceManager,
			...sessionRest
		} = sessionDefaults;
		this.credentials = credentials;
		this.sessionDefaults = sessionRest;
		this.trepaForBalanceManager = trepaForBalanceManager;
		this.balanceManagerConfig = balanceManager;
		this.sessionStaggerMs = DEFAULT_SESSION_STAGGER_MS;
		const env: Record<string, string | undefined> =
			typeof process !== 'undefined' && process.env ? process.env : {};
		this.walletHudRpcUrl =
			solanaRpcUrl ??
			envUrl(env.TREPA_SOLANA_RPC_URL) ??
			DEFAULT_SOLANA_RPC_URL;
		this.walletHudWsUrl =
			solanaRpcSubscriptionsUrl ??
			envUrl(env.TREPA_SOLANA_RPC_SUBSCRIPTIONS_URL) ??
			DEFAULT_SOLANA_WS_URL;
	}

	get count(): number {
		return this.credentials.length;
	}

	/**
	 * Starts all bot loops in parallel. Pass shared {@link BotOptions} or `(slot) => BotOptions`.
	 */
	async run(
		strategy: BotOptions | ((slot: BotSlot) => BotOptions),
	): Promise<void> {
		const count = this.credentials.length;
		if (count === 0) {
			throw new TrepaError(
				'bots.run() requires at least one set of credentials. ' +
					'Pass `credentials: [{ apiKey, privateKey }, ...]` to `new Trepa(...)`.',
				{ status: 0, code: 'missing_credentials' },
			);
		}

		ensureTrepaEnvLoaded();
		logBotSwarmStartup({
			credentialCount: count,
			apiBaseUrl: this.sessionDefaults.baseUrl,
		});

		const factory: (slot: BotSlot) => BotOptions =
			typeof strategy === 'function' ? strategy : () => strategy;

		const mergedBalanceManager = mergeBalanceManagerConfig(
			this.balanceManagerConfig,
			factory({ index: 0, count }).balanceManager,
		);

		const swarmAc = new AbortController();
		const proc =
			typeof process !== 'undefined' && typeof process.on === 'function'
				? process
				: null;
		const handler = (): void => swarmAc.abort();
		for (const sig of SHUTDOWN_SIGNALS) proc?.on(sig, handler);

		const balanceManagerAc = new AbortController();
		const balanceManagerTask =
			this.trepaForBalanceManager !== undefined
				? runBalanceManagerSidecar(
						this.trepaForBalanceManager,
						this.credentials,
						balanceManagerAc.signal,
						mergedBalanceManager,
					)
				: Promise.resolve();

		try {
			await Promise.all(
				this.credentials.map(async (creds, index) => {
					const slot: BotSlot = { index, count };
					if (this.sessionStaggerMs > 0 && index > 0) {
						await staggerFirstRequest(this.sessionStaggerMs * index);
					}
					const session = new Session({ ...this.sessionDefaults, ...creds });
					const client = new TrepaClient(session);
					const opts = withTag(slot, factory(slot));
					const signal = opts.signal
						? AbortSignal.any([swarmAc.signal, opts.signal])
						: swarmAc.signal;
					try {
						await runPredictorLoop(slot, client, opts, signal, {
							rpcUrl: this.walletHudRpcUrl,
							wsUrl: this.walletHudWsUrl,
						});
					} finally {
						try {
							await client.logout();
						} catch (err) {
							emit('error', lineForError(opts, err, slot), slot);
						}
					}
				}),
			);
		} finally {
			balanceManagerAc.abort();
			if (this.trepaForBalanceManager !== undefined) {
				await Promise.race([
					balanceManagerTask.catch(() => undefined),
					sleepMs(balanceManagerShutdownWaitMs()),
				]);
			}
			for (const sig of SHUTDOWN_SIGNALS) proc?.off(sig, handler);
			logBotSwarmShutdown({ credentialCount: count });
		}
	}
}

const withTag = (slot: BotSlot, opts: BotOptions): BotOptions => {
	if (slot.count <= 1 || trepaLogSlotLanesEnabled()) return opts;
	const tag = `[${slot.index + 1}/${slot.count}]`;
	const wrap = <Arg>(
		fn: ((arg: Arg) => string | void) | undefined,
	): ((arg: Arg) => string | void) | undefined =>
		fn &&
		((arg) => {
			const result = fn(arg);
			return typeof result === 'string' ? `${tag} ${result}` : result;
		});
	return {
		...opts,
		onStart: wrap(opts.onStart),
		onPredicted: wrap(opts.onPredicted),
		onPredictionUpdated: wrap(opts.onPredictionUpdated),
		onPoolSkipped: wrap(opts.onPoolSkipped),
		onError: wrap(opts.onError),
	};
};
