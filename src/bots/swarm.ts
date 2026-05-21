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
	trepaStdoutIsInteractive,
	writeSwarmSlotStaggerNotice,
} from '../logging/format';
import { setTrepaInkAbortOnExit } from '../logging/log-ink';
import {
	balanceManagerShutdownWaitMs,
	type BalanceManagerConfig,
	hasMasterFundingKey,
	runBalanceManagerSidecar,
} from '../solana/balance-manager';
import {
	resolveStakeTokenFromTrepa,
	type StakeTokenInfo,
} from '../solana/stake-token-cache';
import {
	prepareWalletHudBatch,
	type WalletHudBatchSnapshot,
} from '../solana/wallet-hud-batch';

const staggerFirstRequest = (
	ms: number,
	signal: AbortSignal,
): Promise<void> => {
	if (ms <= 0) return Promise.resolve();
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(abortErrorFromSignal(signal));
			return;
		}
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = (): void => {
			clearTimeout(timer);
			signal.removeEventListener('abort', onAbort);
			reject(abortErrorFromSignal(signal));
		};
		signal.addEventListener('abort', onAbort, { once: true });
	});
};

function abortErrorFromSignal(signal: AbortSignal): Error {
	const r = signal.reason;
	if (r instanceof Error) return r;
	if (r !== undefined) return new DOMException(String(r), 'AbortError');
	return new DOMException('Aborted', 'AbortError');
}

function isLikelyAbortError(err: unknown): boolean {
	if (err instanceof DOMException && err.name === 'AbortError') return true;
	return err instanceof Error && err.name === 'AbortError';
}

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

/** Runs one predictor loop per `Trepa` credential. */
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
		const factory: (slot: BotSlot) => BotOptions =
			typeof strategy === 'function' ? strategy : () => strategy;

		const mergedBalanceManager = mergeBalanceManagerConfig(
			this.balanceManagerConfig,
			factory({ index: 0, count }).balanceManager,
		);

		const swarmAc = new AbortController();
		const balanceManagerAc = new AbortController();
		const proc =
			typeof process !== 'undefined' && typeof process.on === 'function'
				? process
				: null;
		const interrupt = (): void => {
			if (swarmAc.signal.aborted) {
				if (
					typeof process !== 'undefined' &&
					typeof process.exit === 'function'
				) {
					process.exit(130);
				}
				return;
			}
			swarmAc.abort();
			balanceManagerAc.abort();
		};
		for (const sig of SHUTDOWN_SIGNALS) proc?.on(sig, interrupt);
		setTrepaInkAbortOnExit(interrupt);

		logBotSwarmStartup({
			credentialCount: count,
			apiBaseUrl: this.sessionDefaults.baseUrl,
		});
		if (trepaStdoutIsInteractive() && count > 1 && this.sessionStaggerMs > 0) {
			for (let i = 1; i < count; i++) {
				writeSwarmSlotStaggerNotice(
					{ index: i, count },
					this.sessionStaggerMs * i,
				);
			}
		}
		let swarmStakeToken: StakeTokenInfo | undefined;
		if (
			this.trepaForBalanceManager !== undefined &&
			(trepaStdoutIsInteractive() || hasMasterFundingKey())
		) {
			try {
				swarmStakeToken = await resolveStakeTokenFromTrepa(
					this.trepaForBalanceManager,
				);
			} catch {
				swarmStakeToken = undefined;
			}
		}

		let walletHudBatch: WalletHudBatchSnapshot | undefined;
		if (trepaStdoutIsInteractive() && swarmStakeToken) {
			try {
				walletHudBatch = await prepareWalletHudBatch({
					rpcUrl: this.walletHudRpcUrl,
					stakeToken: swarmStakeToken,
					botPrivateKeys: this.credentials.map((c) => c.privateKey),
				});
			} catch {
				walletHudBatch = undefined;
			}
		}

		const balanceManagerTask =
			this.trepaForBalanceManager !== undefined && hasMasterFundingKey()
				? runBalanceManagerSidecar(
						this.trepaForBalanceManager,
						this.credentials,
						balanceManagerAc.signal,
						mergedBalanceManager,
						walletHudBatch?.master,
					)
				: Promise.resolve();

		const walletHudStakeToken = swarmStakeToken;

		try {
			await Promise.all([
				balanceManagerTask,
				...this.credentials.map(async (creds, index) => {
					const slot: BotSlot = { index, count };
					if (this.sessionStaggerMs > 0 && index > 0) {
						await staggerFirstRequest(
							this.sessionStaggerMs * index,
							swarmAc.signal,
						);
					}
					const opts = withTag(slot, factory(slot));
					const signal = opts.signal
						? AbortSignal.any([swarmAc.signal, opts.signal])
						: swarmAc.signal;
					const session = new Session({
						...this.sessionDefaults,
						...creds,
						signal,
					});
					const client = new TrepaClient(session);
					try {
						await runPredictorLoop(slot, client, opts, signal, {
							rpcUrl: this.walletHudRpcUrl,
							wsUrl: this.walletHudWsUrl,
							stakeToken: walletHudStakeToken,
							seed: walletHudBatch?.slots[index],
						});
					} finally {
						if (!swarmAc.signal.aborted) {
							try {
								await client.logout();
							} catch (err) {
								emit('error', lineForError(opts, err, slot), slot);
							}
						}
					}
				}),
			]);
		} catch (err) {
			if (!swarmAc.signal.aborted && !isLikelyAbortError(err)) throw err;
		} finally {
			setTrepaInkAbortOnExit(undefined);
			balanceManagerAc.abort();
			if (this.trepaForBalanceManager !== undefined) {
				await Promise.race([
					balanceManagerTask.catch(() => undefined),
					sleepMs(balanceManagerShutdownWaitMs()),
				]);
			}
			for (const sig of SHUTDOWN_SIGNALS) proc?.off(sig, interrupt);
			logBotSwarmShutdown({ credentialCount: count });
		}
	}
}

const withTag = (slot: BotSlot, opts: BotOptions): BotOptions => {
	if (slot.count <= 1 || trepaStdoutIsInteractive()) return opts;
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
