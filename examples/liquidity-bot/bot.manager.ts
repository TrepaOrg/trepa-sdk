import {
	type Address,
	type Instruction,
	type KeyPairSigner,
	address,
	appendTransactionMessageInstructions,
	assertIsTransactionWithBlockhashLifetime,
	assertIsTransactionWithinSizeLimit,
	createKeyPairSignerFromBytes,
	createSolanaRpc,
	createSolanaRpcSubscriptions,
	createTransactionMessage,
	getBase58Encoder,
	pipe,
	sendAndConfirmTransactionFactory,
	setTransactionMessageFeePayerSigner,
	setTransactionMessageLifetimeUsingBlockhash,
	signTransactionMessageWithSigners,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import {
	TOKEN_PROGRAM_ADDRESS,
	fetchMaybeToken,
	findAssociatedTokenPda,
	getCreateAssociatedTokenIdempotentInstructionAsync,
	getTransferCheckedInstruction,
} from '@solana-program/token';
import { type BotCredentials, trepaLog, Trepa } from '@trepa/sdk';

const USDC_TARGET = 10;
const USDC_THRESHOLD = 5;

const SOL_TARGET = 0.05;
const SOL_THRESHOLD = 0.01;

const MASTER_SOL_RESERVE = 0.1;
const MAX_BOTS_PER_TX = 5;

const FUND_INTERVAL_MS = 60_000;
const FUNDER_SHUTDOWN_WAIT_MS = 15_000;

interface BotWallet {
	address: Address;
	label: string;
	signer: KeyPairSigner<string>;
}

interface FunderCtx {
	rpc: ReturnType<typeof createSolanaRpc>;
	sendAndConfirm: ReturnType<typeof sendAndConfirmTransactionFactory>;
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

export const withManager = async (
	trepa: Trepa,
	credentials: readonly BotCredentials[],
	main: () => Promise<void>,
): Promise<void> => {
	const masterPrivateKey = process.env.TREPA_MASTER_PRIVATE_KEY;
	if (!masterPrivateKey) {
		await main();
		return;
	}

	const funderAbort = new AbortController();
	const funder = runFunderLoop(
		trepa,
		credentials,
		masterPrivateKey,
		funderAbort.signal,
	);

	try {
		await main();
	} finally {
		funderAbort.abort();
		await Promise.race([
			funder.catch(() => undefined),
			new Promise<void>((r) => setTimeout(r, FUNDER_SHUTDOWN_WAIT_MS)),
		]);
	}
};

async function runFunderLoop(
	trepa: Trepa,
	credentials: readonly BotCredentials[],
	masterPrivateKey: string,
	signal: AbortSignal,
): Promise<void> {
	let bootstrap: Awaited<ReturnType<typeof bootstrapFunder>>;
	try {
		bootstrap = await bootstrapFunder(trepa, credentials, masterPrivateKey);
	} catch (err) {
		trepaLog.error(`bootstrap failed — ${describeError(err)}`);
		return;
	}

	const { ctx, bots } = bootstrap;

	trepaLog.ready(
		`master ${shortAddr(ctx.master.address)} syncing ${bots.length} ` +
			`bot${bots.length === 1 ? '' : 's'} to ` +
			`${USDC_TARGET} USDC (fill below ${USDC_THRESHOLD}) and ` +
			`${SOL_TARGET} SOL (fill below ${SOL_THRESHOLD}) ` +
			`(master SOL reserve ${MASTER_SOL_RESERVE}; up to ` +
			`${MAX_BOTS_PER_TX} bots per tx)`,
	);

	while (!signal.aborted) {
		if (signal.aborted) return;
		try {
			await syncAllBotsBundled(ctx, bots);
		} catch (err) {
			trepaLog.error(`bundled sync failed — ${describeError(err)}`);
		}
		await sleep(FUND_INTERVAL_MS, signal);
	}
}

async function bootstrapFunder(
	trepa: Trepa,
	credentials: readonly BotCredentials[],
	masterPrivateKey: string,
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

	const targetUnits = toBaseUnits(USDC_TARGET, decimals);
	let thresholdUnits = toBaseUnits(USDC_THRESHOLD, decimals);
	if (thresholdUnits > targetUnits) {
		thresholdUnits = targetUnits;
		trepaLog.info(
			'USDC_THRESHOLD exceeds USDC_TARGET — using target as the fill threshold.',
		);
	}

	const solTargetLamports = solToLamports(SOL_TARGET);
	const masterSolReserveLamports = solToLamports(MASTER_SOL_RESERVE);
	const rentExemptLamports = await rpc
		.getMinimumBalanceForRentExemption(0n)
		.send();
	const solFloorLamports =
		solTargetLamports > rentExemptLamports
			? solTargetLamports
			: rentExemptLamports;
	let solThresholdLamports = solToLamports(SOL_THRESHOLD);
	if (solThresholdLamports > solFloorLamports) {
		solThresholdLamports = solFloorLamports;
		trepaLog.info(
			'SOL_THRESHOLD is above the enforced SOL floor — clamping threshold to that floor.',
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
	}));

	if (solTargetLamports < rentExemptLamports) {
		trepaLog.info(
			`SOL_TARGET is below rent-exempt minimum for an empty wallet ` +
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
			'no pools listed — cannot resolve stake mint. Unset ' +
				'TREPA_MASTER_PRIVATE_KEY or wait until a pool exists.',
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

	for (let i = 0; i < plansWithWork.length; i += MAX_BOTS_PER_TX) {
		const chunk = plansWithWork.slice(i, i + MAX_BOTS_PER_TX);
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
			trepaLog.success(`${p.bot.label}: ${p.movements.join(', ')}`);
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

function describeError(err: unknown): string {
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
