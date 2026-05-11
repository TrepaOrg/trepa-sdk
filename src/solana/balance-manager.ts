import { type Address, address } from '@solana/addresses';
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
import { createSolanaRpc } from '@solana/rpc';
import { createSolanaRpcSubscriptions } from '@solana/rpc-subscriptions';
import { getTransferSolInstruction } from '@solana-program/system';
import {
	TOKEN_PROGRAM_ADDRESS,
	fetchMaybeToken,
	findAssociatedTokenPda,
	getCreateAssociatedTokenIdempotentInstructionAsync,
	getTransferCheckedInstruction,
} from '@solana-program/token';

import type { BalanceManagerConfig } from './balance-manager-config';
import type { BotCredentials } from '../bots/types';
import { ensureTrepaEnvLoaded } from '../config/env-load';
import type { Trepa } from '../http/trepa';
import { trepaLog, writeEvent, writeSwarmMetaLine } from '../logging/format';
import { sendAndConfirmTransactionFactory } from './vendor/send-and-confirm-transaction';

type SendAndConfirmSigned = ReturnType<typeof sendAndConfirmTransactionFactory>;

export type {
	BalanceManagerConfig,
	BotBalanceManagerConfig,
} from './balance-manager-config';

const BALANCE_MANAGER_MASTER_SOL_RESERVE_SOL = 0.05;
const BALANCE_MANAGER_MAX_BOTS_PER_TX = 5;
const BALANCE_MANAGER_FUND_INTERVAL_MS = 60_000;
const BALANCE_MANAGER_SHUTDOWN_WAIT_MS = 15_000;

interface BotWallet {
	address: Address;
	label: string;
	signer: KeyPairSigner<string>;
	slotIndex: number;
	swarmCount: number;
}

interface FunderCtx {
	rpc: ReturnType<typeof createSolanaRpc>;
	sendAndConfirm: SendAndConfirmSigned;
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

export function balanceManagerShutdownWaitMs(): number {
	return BALANCE_MANAGER_SHUTDOWN_WAIT_MS;
}

export async function runBalanceManagerSidecar(
	trepa: Trepa,
	credentials: readonly BotCredentials[],
	signal: AbortSignal,
	config?: BalanceManagerConfig,
): Promise<void> {
	ensureTrepaEnvLoaded();
	const masterPrivateKey = resolveMasterPrivateKey();
	if (!masterPrivateKey) return;

	const policy = resolvePolicy(config);
	await runFunderLoop(trepa, credentials, masterPrivateKey, policy, signal);
}

async function runFunderLoop(
	trepa: Trepa,
	credentials: readonly BotCredentials[],
	masterPrivateKey: string,
	policy: ResolvedBalancePolicy,
	signal: AbortSignal,
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
		trepaLog.error(`bootstrap failed — ${describeChainedError(err)}`);
		return;
	}

	const { ctx, bots } = bootstrap;
	const n = bots.length;
	writeSwarmMetaLine(
		`master ${shortAddr(ctx.master.address)} syncing ${n} ` +
			`bot${n === 1 ? '' : 's'} to ` +
			`${policy.usdcTarget} USDC (fill below ${policy.usdcThreshold}) and ` +
			`${policy.solTarget} SOL (fill below ${policy.solThreshold}) ` +
			`(master SOL reserve ${policy.masterSolReserve}; up to ` +
			`${policy.maxBotsPerTransaction} bots per tx)`,
	);

	while (!signal.aborted) {
		if (signal.aborted) return;
		try {
			await syncAllBotsBundled(ctx, bots, policy.maxBotsPerTransaction);
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
	const [master, ...botSigners] = await Promise.all([
		createSignerFromBase58(masterPrivateKey),
		...credentials.map((c) => createSignerFromBase58(c.privateKey)),
	]);
	const { mint, decimals } = await fetchStakeMint(trepa);

	const rpc = createSolanaRpc(trepa.solanaRpcUrl);
	const rpcSubscriptions = createSolanaRpcSubscriptions(
		trepa.solanaRpcSubscriptionsUrl,
	);
	const sendAndConfirm = sendAndConfirmTransactionFactory({
		rpc,
		rpcSubscriptions,
	});

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
	const rentExemptLamports = await rpc
		.getMinimumBalanceForRentExemption(0n)
		.send();
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

	const masterToken = await fetchMaybeToken(rpc, masterAta);
	if (!masterToken.exists) {
		trepaLog.warn(
			`master has no USDC token account for mint ${shortAddr(mint)} on ` +
				`${trepa.solanaRpcUrl} — fund the master wallet on this cluster or ` +
				`set TrepaConfig.solanaRpcUrl to match where the mint lives.`,
		);
	}

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
			sendAndConfirm,
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
		},
		bots,
	};
}

async function fetchStakeMint(
	trepa: Trepa,
): Promise<{ mint: Address; decimals: number }> {
	const firstPool = (await trepa.pools.list({ limit: 1 }))[0];
	if (!firstPool) {
		throw new Error(
			'no pools listed — cannot resolve stake mint. Omit master funding ' +
				'(no TREPA_MASTER_PRIVATE_KEY) ' +
				'or wait until a pool exists.',
		);
	}
	return {
		mint: address(firstPool.stake_token_mint),
		decimals: firstPool.decimals,
	};
}

async function loadBotSyncSnapshot(
	ctx: FunderCtx,
	bot: BotWallet,
): Promise<BotSyncSnapshot | null> {
	const [botAta] = await findAssociatedTokenPda({
		mint: ctx.mint,
		owner: bot.address,
		tokenProgram: TOKEN_PROGRAM_ADDRESS,
	});

	const [tokenAccount, botBalanceResponse] = await Promise.all([
		fetchMaybeToken(ctx.rpc, botAta),
		ctx.rpc.getBalance(bot.address).send(),
	]);
	const currentUsdc = tokenAccount.exists ? tokenAccount.data.amount : 0n;
	const needsAta = !tokenAccount.exists;
	const botLamports = BigInt(botBalanceResponse.value);
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
	if (botLamports < ctx.solThresholdLamports) {
		solDelta = solFloorLamports - botLamports;
	} else if (botLamports > solFloorLamports) {
		solDelta = solFloorLamports - botLamports;
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
	maxBotsPerTransaction: number,
): Promise<void> {
	const snapshots = (
		await Promise.all(bots.map((b) => loadBotSyncSnapshot(ctx, b)))
	).filter((s): s is BotSyncSnapshot => s !== null);

	if (snapshots.length === 0) return;

	const { value: masterLamports } = await ctx.rpc
		.getBalance(ctx.master.address)
		.send();
	const masterSolSpendBudget = {
		value: BigInt(masterLamports) - ctx.masterSolReserveLamports,
	};

	const plans: BotSyncPlan[] = [];
	for (const snap of snapshots) {
		plans.push(await buildBotSyncPlan(ctx, snap, masterSolSpendBudget));
	}

	const plansWithWork = plans.filter((p) => p.instructions.length > 0);
	if (plansWithWork.length === 0) return;

	for (let i = 0; i < plansWithWork.length; i += maxBotsPerTransaction) {
		const chunk = plansWithWork.slice(i, i + maxBotsPerTransaction);
		await sendAndConfirmInstructions(ctx, flattenPlanInstructions(chunk));
		logPlanBatchOutcomes(chunk);
	}
}

function flattenPlanInstructions(plans: readonly BotSyncPlan[]): Instruction[] {
	return plans.flatMap((p) => p.instructions);
}

function logPlanBatchOutcomes(plans: readonly BotSyncPlan[]): void {
	for (const p of plans) {
		if (p.movements.length > 0) {
			writeEvent('fund', `${p.bot.label}: ${p.movements.join(', ')}`, {
				index: p.bot.slotIndex,
				count: Math.max(1, p.bot.swarmCount),
			});
		}
	}
}

async function sendAndConfirmInstructions(
	ctx: FunderCtx,
	instructions: readonly Instruction[],
): Promise<void> {
	const { value: latestBlockhash } = await ctx.rpc.getLatestBlockhash().send();
	const message = pipe(
		createTransactionMessage({ version: 0 }),
		(tx) => setTransactionMessageFeePayerSigner(ctx.master, tx),
		(tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
		(tx) => appendTransactionMessageInstructions([...instructions], tx),
	);
	const signed = await signTransactionMessageWithSigners(message);
	assertIsTransactionWithinSizeLimit(signed);
	assertIsTransactionWithBlockhashLifetime(signed);
	await ctx.sendAndConfirm(signed, { commitment: 'confirmed' });
}

async function createSignerFromBase58(
	privateKeyBase58: string,
): Promise<KeyPairSigner<string>> {
	const bytes = getBase58Encoder().encode(privateKeyBase58);
	return createKeyPairSignerFromBytes(bytes as Uint8Array);
}

function describeChainedError(err: unknown): string {
	if (!(err instanceof Error)) return String(err);
	const parts: string[] = [];
	let e: unknown = err;
	for (let i = 0; i < 8 && e instanceof Error; i++) {
		if (e.message) parts.push(e.message.trim());
		e = e.cause;
	}
	return parts.length > 0 ? parts.join(' → ') : String(err);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise<void>((resolve) => {
		if (signal.aborted) return resolve();
		const timer = setTimeout(resolve, ms);
		signal.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
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
