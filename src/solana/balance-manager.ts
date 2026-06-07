import { type Address } from '@solana/addresses';
import type { Signature } from '@solana/keys';
import { commitmentComparator } from '@solana/rpc-types';
import {
	type Instruction,
	type KeyPairSigner,
	appendTransactionMessageInstructions,
	assertIsTransactionWithBlockhashLifetime,
	assertIsTransactionWithinSizeLimit,
	createKeyPairSignerFromBytes,
	createTransactionMessage,
	getBase58Encoder,
	pipe,
	setTransactionMessageFeePayerSigner,
	setTransactionMessageLifetimeUsingBlockhash,
	signTransactionMessageWithSigners,
} from '@solana/kit';
import { createSolanaRpcSubscriptions } from '@solana/rpc-subscriptions';
import { getTransferSolInstruction } from '@solana-program/system';
import {
	TOKEN_PROGRAM_ADDRESS,
	findAssociatedTokenPda,
	getCreateAssociatedTokenIdempotentInstructionAsync,
	getTransferCheckedInstruction,
} from '@solana-program/token';

import { fetchFunderBalancesBatch } from './balance-batch';
import type { BalanceManagerConfig } from './balance-manager-config';
import { sharedSolanaRpc } from './rpc-pool';
import { resolveStakeTokenFromTrepa } from './stake-token-cache';
import { startMasterWalletHudMirror } from './wallet-hud';
import type { WalletHudWalletSeed } from './wallet-hud-batch';
import type { BotCredentials } from '../bots/types';
import { ensureTrepaEnvLoaded } from '../config/env-load';
import {
	TrepaError,
	describeChainedError,
	formatTrepaError,
} from '../core/errors';
import type { Trepa } from '../http/trepa';
import {
	trepaLog,
	trepaStdoutIsInteractive,
	writeEvent,
	writeSwarmMetaLine,
} from '../logging/format';
import {
	sendAndConfirmTransactionFactory,
	type SolanaTransactionKit,
} from './vendor/send-and-confirm-transaction';

type LatestBlockhashLifetime = Parameters<
	typeof setTransactionMessageLifetimeUsingBlockhash
>[0];

export type {
	BalanceManagerConfig,
	BotBalanceManagerConfig,
} from './balance-manager-config';

const BALANCE_MANAGER_MASTER_SOL_RESERVE_SOL = 0.05;
const BALANCE_MANAGER_MAX_BOTS_PER_TX = 1;
const BALANCE_MANAGER_FUND_INTERVAL_MS = 60_000;
const BALANCE_MANAGER_SHUTDOWN_WAIT_MS = 15_000;
const BALANCE_MANAGER_FUND_TX_MAX_ATTEMPTS = 3;
const BALANCE_MANAGER_FUND_TX_POLL_MS = 250;
const BALANCE_MANAGER_FUND_TX_WAIT_MS = 12_000;
const BALANCE_MANAGER_FUND_TX_POST_EXPIRY_GRACE_MS = 20_000;

interface BotWallet {
	address: Address;
	label: string;
	signer: KeyPairSigner<string>;
	slotIndex: number;
	swarmCount: number;
}

interface FunderCtx {
	rpc: ReturnType<typeof sharedSolanaRpc>;
	txKit: SolanaTransactionKit;
	master: KeyPairSigner<string>;
	masterAta: Address;
	mint: Address;
	decimals: number;
	targetUnits: bigint;
	thresholdUnits: bigint;
	solTargetLamports: bigint;
	solThresholdLamports: bigint;
	rentExemptLamports: bigint;
	masterSolReserveLamports: bigint;
	masterTokenWarned: boolean;
}

interface BotSyncSnapshot {
	bot: BotWallet;
	botAta: Address;
	needsAta: boolean;
	usdcDelta: bigint;
	solDelta: bigint;
}

interface BotSyncPlan {
	bot: BotWallet;
	instructions: Instruction[];
	movements: string[];
}

interface ResolvedBalancePolicy {
	usdcTarget: number;
	usdcThreshold: number;
	solTarget: number;
	solThreshold: number;
	masterSolReserve: number;
	maxBotsPerTransaction: number;
	fundIntervalMs: number;
	shutdownWaitMs: number;
}

function resolvePolicy(config?: BalanceManagerConfig): ResolvedBalancePolicy {
	return {
		usdcTarget: config?.usdcTarget ?? 10,
		usdcThreshold: config?.usdcThreshold ?? 5,
		solTarget: config?.solTarget ?? 0.05,
		solThreshold: config?.solThreshold ?? 0.01,
		masterSolReserve: BALANCE_MANAGER_MASTER_SOL_RESERVE_SOL,
		maxBotsPerTransaction: BALANCE_MANAGER_MAX_BOTS_PER_TX,
		fundIntervalMs: BALANCE_MANAGER_FUND_INTERVAL_MS,
		shutdownWaitMs: BALANCE_MANAGER_SHUTDOWN_WAIT_MS,
	};
}

function resolveMasterPrivateKey(): string {
	if (typeof process !== 'undefined' && process.env) {
		const fromEnv = process.env.TREPA_MASTER_PRIVATE_KEY?.trim();
		if (fromEnv) return fromEnv;
	}
	return '';
}

/** Whether `TREPA_MASTER_PRIVATE_KEY` is set (balance manager sidecar). */
export function hasMasterFundingKey(): boolean {
	return resolveMasterPrivateKey() !== '';
}

export function balanceManagerShutdownWaitMs(): number {
	return BALANCE_MANAGER_SHUTDOWN_WAIT_MS;
}

export async function runBalanceManagerSidecar(
	trepa: Trepa,
	credentials: readonly BotCredentials[],
	signal: AbortSignal,
	config?: BalanceManagerConfig,
	masterHudSeed?: WalletHudWalletSeed,
): Promise<void> {
	ensureTrepaEnvLoaded();
	const masterPrivateKey = resolveMasterPrivateKey();
	if (!masterPrivateKey) return;

	const policy = resolvePolicy(config);
	await runFunderLoop(
		trepa,
		credentials,
		masterPrivateKey,
		policy,
		signal,
		masterHudSeed,
	);
}

async function runFunderLoop(
	trepa: Trepa,
	credentials: readonly BotCredentials[],
	masterPrivateKey: string,
	policy: ResolvedBalancePolicy,
	signal: AbortSignal,
	masterHudSeed?: WalletHudWalletSeed,
): Promise<void> {
	let bootstrap: Awaited<ReturnType<typeof bootstrapFunder>>;
	try {
		bootstrap = await bootstrapFunder(
			trepa,
			credentials,
			masterPrivateKey,
			policy,
		);
	} catch (err) {
		trepaLog.error(`bootstrap failed — ${describeBootstrapError(err)}`);
		trepaLog.error(
			`  API ${trepa.baseUrl} · RPC ${trepa.solanaRpcUrl} · ` +
				'check TREPA_API_KEY (first bot credential) and TREPA_MASTER_PRIVATE_KEY',
		);
		return;
	}

	const { ctx, bots } = bootstrap;
	const n = bots.length;
	if (trepaStdoutIsInteractive()) {
		startMasterWalletHudMirror({
			shortAddr: shortAddr(ctx.master.address),
			wallet: ctx.master.address,
			stakeDecimals: ctx.decimals,
			masterAta: ctx.masterAta,
			rpcUrl: trepa.solanaRpcUrl,
			wsUrl: trepa.solanaRpcSubscriptionsUrl,
			signal,
			seed: masterHudSeed,
		});
	}
	writeSwarmMetaLine(
		`Master ${shortAddr(ctx.master.address)} — keeps ${n} bot wallet` +
			`${n === 1 ? '' : 's'} topped up automatically.`,
	);
	writeSwarmMetaLine(
		`Each bot should hold about ${policy.usdcTarget} USDC and ` +
			`${policy.solTarget} SOL. We send more when it falls under ` +
			`${policy.usdcThreshold} USDC or ${policy.solThreshold} SOL.`,
	);
	writeSwarmMetaLine(
		`We never spend the last ${policy.masterSolReserve} SOL on the master ` +
			'(that stays for fees). Each bot is funded in its own transaction.',
	);
	writeSwarmMetaLine(
		`When a bot is above those targets, surplus USDC and SOL are swept back ` +
			`to the master — profits return to the funding wallet.`,
	);

	while (!signal.aborted) {
		if (signal.aborted) return;
		try {
			await syncAllBotsBundled(ctx, bots);
		} catch (err) {
			trepaLog.error(`bundled sync failed — ${describeChainedError(err)}`);
		}
		await sleep(policy.fundIntervalMs, signal);
	}
}

async function bootstrapFunder(
	trepa: Trepa,
	credentials: readonly BotCredentials[],
	masterPrivateKey: string,
	policy: ResolvedBalancePolicy,
): Promise<{ ctx: FunderCtx; bots: BotWallet[] }> {
	let master: KeyPairSigner<string>;
	let botSigners: KeyPairSigner<string>[];
	try {
		[master, ...botSigners] = await Promise.all([
			createSignerFromBase58(masterPrivateKey),
			...credentials.map((c) => createSignerFromBase58(c.privateKey)),
		]);
	} catch (err) {
		throw bootstrapStepError('load master/bot keypairs', err);
	}

	try {
		await trepa.auth.me();
	} catch (err) {
		throw bootstrapStepError(
			`Trepa API session at ${trepa.baseUrl} (needs valid TREPA_API_KEY on the first bot credential)`,
			err,
		);
	}

	let mint: Address;
	let decimals: number;
	try {
		({ mint, decimals } = await resolveStakeTokenFromTrepa(trepa));
	} catch (err) {
		throw bootstrapStepError('GET /pools to resolve stake mint', err);
	}

	const rpc = sharedSolanaRpc(trepa.solanaRpcUrl);
	const rpcSubscriptions = createSolanaRpcSubscriptions(
		trepa.solanaRpcSubscriptionsUrl,
	);
	const txKit = sendAndConfirmTransactionFactory({
		rpc,
		rpcSubscriptions,
	} as Parameters<typeof sendAndConfirmTransactionFactory>[0]);

	const targetUnits = toBaseUnits(policy.usdcTarget, decimals);
	let thresholdUnits = toBaseUnits(policy.usdcThreshold, decimals);
	if (thresholdUnits > targetUnits) {
		thresholdUnits = targetUnits;
		trepaLog.info(
			'USDC threshold exceeds USDC target — using target as the fill threshold.',
		);
	}

	const solTargetLamports = solToLamports(policy.solTarget);
	const masterSolReserveLamports = solToLamports(policy.masterSolReserve);
	let rentExemptLamports: bigint;
	try {
		rentExemptLamports = await rpc.getMinimumBalanceForRentExemption(0n).send();
	} catch (err) {
		throw bootstrapStepError(
			`Solana RPC at ${trepa.solanaRpcUrl} (getMinimumBalanceForRentExemption)`,
			err,
		);
	}
	const solFloorLamports =
		solTargetLamports > rentExemptLamports
			? solTargetLamports
			: rentExemptLamports;
	let solThresholdLamports = solToLamports(policy.solThreshold);
	if (solThresholdLamports > solFloorLamports) {
		solThresholdLamports = solFloorLamports;
		trepaLog.info(
			'SOL threshold is above the enforced SOL floor — clamping threshold to that floor.',
		);
	}

	const [masterAta] = await findAssociatedTokenPda({
		mint,
		owner: master.address,
		tokenProgram: TOKEN_PROGRAM_ADDRESS,
	});

	const bots: BotWallet[] = botSigners.map((s, i) => ({
		address: s.address,
		label:
			credentials.length > 1 ? `bot ${i + 1}/${credentials.length}` : 'bot',
		signer: s,
		slotIndex: i,
		swarmCount: credentials.length,
	}));

	if (solTargetLamports < rentExemptLamports) {
		trepaLog.info(
			`SOL target is below rent-exempt minimum for an empty wallet ` +
				`(${formatSolFromLamports(rentExemptLamports)} SOL); bots use that floor.`,
		);
	}

	return {
		ctx: {
			rpc,
			txKit,
			master,
			masterAta,
			mint,
			decimals,
			targetUnits,
			thresholdUnits,
			solTargetLamports,
			solThresholdLamports,
			rentExemptLamports,
			masterSolReserveLamports,
			masterTokenWarned: false,
		},
		bots,
	};
}

function snapshotFromBalances(
	ctx: FunderCtx,
	bot: BotWallet,
	botAta: Address,
	solLamports: bigint,
	tokenAmount: bigint,
	tokenAccountExists: boolean,
): BotSyncSnapshot | null {
	const currentUsdc = tokenAccountExists ? tokenAmount : 0n;
	const needsAta = !tokenAccountExists;
	const solFloorLamports =
		ctx.solTargetLamports > ctx.rentExemptLamports
			? ctx.solTargetLamports
			: ctx.rentExemptLamports;

	let usdcDelta = 0n;
	if (currentUsdc < ctx.thresholdUnits) {
		usdcDelta = ctx.targetUnits - currentUsdc;
	} else if (currentUsdc > ctx.targetUnits) {
		usdcDelta = ctx.targetUnits - currentUsdc;
	}

	let solDelta = 0n;
	if (solLamports < ctx.solThresholdLamports) {
		solDelta = solFloorLamports - solLamports;
	} else if (solLamports > solFloorLamports) {
		solDelta = solFloorLamports - solLamports;
	}

	if (usdcDelta === 0n && solDelta === 0n) return null;

	return {
		bot,
		botAta,
		needsAta,
		usdcDelta,
		solDelta,
	};
}

async function buildBotSyncPlan(
	ctx: FunderCtx,
	snap: BotSyncSnapshot,
	masterSolSpendBudget: { value: bigint },
): Promise<BotSyncPlan> {
	const instructions: Instruction[] = [];
	const movements: string[] = [];

	if (snap.needsAta && ctx.targetUnits > 0n && snap.usdcDelta > 0n) {
		instructions.push(
			await getCreateAssociatedTokenIdempotentInstructionAsync({
				payer: ctx.master,
				owner: snap.bot.address,
				mint: ctx.mint,
			}),
		);
		movements.push('created ATA');
	}

	if (snap.usdcDelta > 0n) {
		instructions.push(
			getTransferCheckedInstruction({
				source: ctx.masterAta,
				mint: ctx.mint,
				destination: snap.botAta,
				authority: ctx.master,
				amount: snap.usdcDelta,
				decimals: ctx.decimals,
			}),
		);
		movements.push(`+${formatBaseUnits(snap.usdcDelta, ctx.decimals)} USDC`);
	} else if (snap.usdcDelta < 0n) {
		const sweep = -snap.usdcDelta;
		instructions.push(
			getTransferCheckedInstruction({
				source: snap.botAta,
				mint: ctx.mint,
				destination: ctx.masterAta,
				authority: snap.bot.signer,
				amount: sweep,
				decimals: ctx.decimals,
			}),
		);
		movements.push(`-${formatBaseUnits(sweep, ctx.decimals)} USDC`);
	}

	if (snap.solDelta > 0n) {
		if (masterSolSpendBudget.value >= snap.solDelta) {
			masterSolSpendBudget.value -= snap.solDelta;
			instructions.push(
				getTransferSolInstruction({
					source: ctx.master,
					destination: snap.bot.address,
					amount: snap.solDelta,
				}),
			);
			movements.push(`+${formatSolFromLamports(snap.solDelta)} SOL`);
		} else {
			trepaLog.warn(
				`${snap.bot.label}: skip SOL from master (bundle budget ` +
					`${formatSolFromLamports(masterSolSpendBudget.value)} SOL; need ` +
					`${formatSolFromLamports(snap.solDelta)})`,
			);
		}
	} else if (snap.solDelta < 0n) {
		const sweep = -snap.solDelta;
		instructions.push(
			getTransferSolInstruction({
				source: snap.bot.signer,
				destination: ctx.master.address,
				amount: sweep,
			}),
		);
		movements.push(`-${formatSolFromLamports(sweep)} SOL`);
	}

	return { bot: snap.bot, instructions, movements };
}

async function syncAllBotsBundled(
	ctx: FunderCtx,
	bots: readonly BotWallet[],
): Promise<void> {
	const botByAddress = new Map(bots.map((b) => [b.address, b]));
	const batch = await fetchFunderBalancesBatch({
		rpc: ctx.rpc,
		mint: ctx.mint,
		masterAddress: ctx.master.address,
		masterAta: ctx.masterAta,
		botAddresses: bots.map((b) => b.address),
	});

	if (!ctx.masterTokenWarned && !batch.masterTokenAccountExists) {
		ctx.masterTokenWarned = true;
		trepaLog.warn(
			`master has no USDC token account for mint ${shortAddr(ctx.mint)} — ` +
				'fund the master wallet on this cluster or set solanaRpcUrl to match ' +
				'where the mint lives.',
		);
	}

	const snapshots: BotSyncSnapshot[] = [];
	for (const row of batch.bots) {
		const bot = botByAddress.get(row.botAddress);
		if (!bot) continue;
		const snap = snapshotFromBalances(
			ctx,
			bot,
			row.botAta,
			row.solLamports,
			row.tokenAmount,
			row.tokenAccountExists,
		);
		if (snap !== null) snapshots.push(snap);
	}

	if (snapshots.length === 0) return;

	const masterSolSpendBudget = {
		value: batch.masterLamports - ctx.masterSolReserveLamports,
	};

	const plans: BotSyncPlan[] = [];
	for (const snap of snapshots) {
		plans.push(await buildBotSyncPlan(ctx, snap, masterSolSpendBudget));
	}

	const plansWithWork = plans.filter((p) => p.instructions.length > 0);
	if (plansWithWork.length === 0) return;

	for (const plan of plansWithWork) {
		await sendBotSyncPlan(ctx, plan, masterSolSpendBudget);
	}
}

async function refreshBotSyncPlan(
	ctx: FunderCtx,
	bot: BotWallet,
	masterSolSpendBudget: { value: bigint },
): Promise<BotSyncPlan | null> {
	const batch = await fetchFunderBalancesBatch({
		rpc: ctx.rpc,
		mint: ctx.mint,
		botAddresses: [bot.address],
	});
	const row = batch.bots[0];
	if (!row) return null;

	const snap = snapshotFromBalances(
		ctx,
		bot,
		row.botAta,
		row.solLamports,
		row.tokenAmount,
		row.tokenAccountExists,
	);
	if (snap === null) return null;

	const plan = await buildBotSyncPlan(ctx, snap, masterSolSpendBudget);
	return plan.instructions.length > 0 ? plan : null;
}

type FundingTxOutcome = 'confirmed' | 'pending' | 'failed';

function isOnChainFundFailure(err: unknown): boolean {
	const msg = describeChainedError(err).toLowerCase();
	return msg.includes('failed on-chain') || msg.includes('failed:');
}

async function getFundingTxOutcome(
	rpc: FunderCtx['rpc'],
	signature: Signature,
): Promise<FundingTxOutcome> {
	const { value: statuses } = await rpc.getSignatureStatuses([signature]).send();
	const status = statuses[0];
	if (!status) return 'pending';
	if (status.err) return 'failed';
	const confirmation = status.confirmationStatus;
	if (confirmation === null || confirmation === undefined) return 'pending';
	if (commitmentComparator(confirmation, 'processed') >= 0) return 'confirmed';
	return 'pending';
}

async function waitForFundingSignature(
	rpc: FunderCtx['rpc'],
	signature: Signature,
	lastValidBlockHeight: bigint,
): Promise<FundingTxOutcome> {
	const deadline = Date.now() + BALANCE_MANAGER_FUND_TX_WAIT_MS;
	let expirySeenAt: number | null = null;

	while (Date.now() < deadline) {
		const outcome = await getFundingTxOutcome(rpc, signature);
		if (outcome !== 'pending') return outcome;

		const epoch = await rpc.getEpochInfo({ commitment: 'processed' }).send();
		if (epoch.blockHeight > lastValidBlockHeight) {
			expirySeenAt ??= Date.now();
			if (
				Date.now() - expirySeenAt >=
				BALANCE_MANAGER_FUND_TX_POST_EXPIRY_GRACE_MS
			) {
				break;
			}
		} else {
			expirySeenAt = null;
		}

		await sleepMs(BALANCE_MANAGER_FUND_TX_POLL_MS);
	}

	const finalOutcome = await getFundingTxOutcome(rpc, signature);
	return finalOutcome === 'pending' ? 'pending' : finalOutcome;
}

async function sendFundingPlan(
	ctx: FunderCtx,
	plan: BotSyncPlan,
): Promise<{ outcome: FundingTxOutcome; signature: Signature }> {
	const { value: latestBlockhash } = await ctx.rpc.getLatestBlockhash().send();
	const signed = await signFundingTransaction(
		ctx,
		plan.instructions,
		latestBlockhash,
	);
	const signature = await ctx.txKit.sendTransaction(signed, {
		commitment: 'processed',
		skipPreflight: false,
	});
	const outcome = await waitForFundingSignature(
		ctx.rpc,
		signature,
		latestBlockhash.lastValidBlockHeight,
	);
	return { outcome, signature };
}

function logFundPlanOutcome(plan: BotSyncPlan): void {
	if (plan.movements.length === 0) return;
	writeEvent('fund', `${plan.bot.label}: ${plan.movements.join(', ')}`, {
		index: plan.bot.slotIndex,
		count: Math.max(1, plan.bot.swarmCount),
	});
}

async function botFundingStillNeeded(
	ctx: FunderCtx,
	bot: BotWallet,
	masterSolSpendBudget: { value: bigint },
): Promise<boolean> {
	const fresh = await refreshBotSyncPlan(ctx, bot, masterSolSpendBudget);
	return fresh !== null;
}

async function sendBotSyncPlan(
	ctx: FunderCtx,
	plan: BotSyncPlan,
	masterSolSpendBudget: { value: bigint },
): Promise<void> {
	const label = plan.bot.label;

	for (
		let attempt = 1;
		attempt <= BALANCE_MANAGER_FUND_TX_MAX_ATTEMPTS;
		attempt++
	) {
		const fresh = await refreshBotSyncPlan(
			ctx,
			plan.bot,
			masterSolSpendBudget,
		);
		if (fresh === null) return;

		try {
			const { outcome, signature } = await sendFundingPlan(ctx, fresh);
			if (outcome === 'confirmed') {
				logFundPlanOutcome(fresh);
				return;
			}
			if (outcome === 'pending') {
				trepaLog.info(
					`${label}: fund tx ${signature} submitted — pending confirm`,
				);
				return;
			}
			throw new Error(`transaction ${signature} failed on-chain`);
		} catch (err) {
			if (!(await botFundingStillNeeded(ctx, plan.bot, masterSolSpendBudget))) {
				return;
			}

			const hasAttemptsLeft = attempt < BALANCE_MANAGER_FUND_TX_MAX_ATTEMPTS;
			if (isOnChainFundFailure(err) && hasAttemptsLeft) {
				trepaLog.warn(
					`fund tx for ${label} failed on-chain ` +
						`(attempt ${attempt}/${BALANCE_MANAGER_FUND_TX_MAX_ATTEMPTS}) — retrying`,
				);
				continue;
			}

			trepaLog.error(
				`fund tx failed for ${label} — ${describeChainedError(err)}`,
			);
			return;
		}
	}
}

function sleepMs(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function signFundingTransaction(
	ctx: FunderCtx,
	instructions: readonly Instruction[],
	latestBlockhash: LatestBlockhashLifetime,
) {
	const message = pipe(
		createTransactionMessage({ version: 0 }),
		(tx) => setTransactionMessageFeePayerSigner(ctx.master, tx),
		(tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
		(tx) => appendTransactionMessageInstructions([...instructions], tx),
	);
	const signed = await signTransactionMessageWithSigners(message);
	assertIsTransactionWithinSizeLimit(signed);
	assertIsTransactionWithBlockhashLifetime(signed);
	return signed;
}

async function createSignerFromBase58(
	privateKeyBase58: string,
): Promise<KeyPairSigner<string>> {
	const bytes = getBase58Encoder().encode(privateKeyBase58);
	return createKeyPairSignerFromBytes(bytes as Uint8Array);
}

function describeBootstrapError(err: unknown): string {
	if (err instanceof TrepaError) return formatTrepaError(err);
	return describeChainedError(err);
}

function bootstrapStepError(step: string, cause: unknown): Error {
	const detail = describeBootstrapError(cause);
	return new Error(`${step}: ${detail}`, {
		cause: cause instanceof Error ? cause : undefined,
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

function solToLamports(sol: number): bigint {
	return BigInt(Math.round(sol * 1_000_000_000));
}

function formatSolFromLamports(lamports: bigint): string {
	const n = Number(lamports) / 1_000_000_000;
	return n.toLocaleString('en-US', { maximumFractionDigits: 9 });
}

function toBaseUnits(amount: number, decimals: number): bigint {
	return BigInt(Math.round(amount * 10 ** decimals));
}

function formatBaseUnits(amount: bigint, decimals: number): string {
	return (Number(amount) / 10 ** decimals).toLocaleString('en-US', {
		minimumFractionDigits: 2,
		maximumFractionDigits: decimals,
	});
}

function shortAddr(addr: Address): string {
	return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}
