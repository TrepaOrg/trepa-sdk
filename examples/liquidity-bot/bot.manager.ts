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
import {
	TOKEN_PROGRAM_ADDRESS,
	fetchMaybeToken,
	findAssociatedTokenPda,
	getCreateAssociatedTokenIdempotentInstructionAsync,
	getTransferCheckedInstruction,
} from '@solana-program/token';
import { type BotCredentials, trepaLog, Trepa } from '@trepa/sdk';

const USDC_TARGET = 5;
const USDC_THRESHOLD = 3;
const FUND_INTERVAL_MS = 60_000;
const FUNDER_SHUTDOWN_WAIT_MS = 15_000;
const REBALANCE_ENABLED = true;
const REBALANCE_INTERVAL_MS = 2 * FUND_INTERVAL_MS;
const REBALANCE_MAX_TRANSFER = 2;
const REBALANCE_DONOR_RESERVE = 2;
const REBALANCE_MIN_PNL_GAP = 0;

interface BotWallet {
	address: Address;
	label: string;
	signer: KeyPairSigner<string>;
	client: Trepa;
	userId: string;
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
	rebalanceCapUnits: bigint;
	rebalanceDonorReserveUnits: bigint;
	rebalanceMinPnlGap: number;
}

interface BotSnapshot {
	bot: BotWallet;
	ata: Address;
	hasAta: boolean;
	balance: bigint;
	pnl: number;
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
		`master ${shortAddr(ctx.master.address)} watching ${bots.length} ` +
			`bot${bots.length === 1 ? '' : 's'} ` +
			`(USDC target ${USDC_TARGET}, threshold ${USDC_THRESHOLD})`,
	);
	if (REBALANCE_ENABLED) {
		trepaLog.info(
			'rebalance enabled ' +
				`(every ${Math.round(REBALANCE_INTERVAL_MS / 1_000)}s, ` +
				`max transfer ${REBALANCE_MAX_TRANSFER} USDC, ` +
				`donor reserve ${REBALANCE_DONOR_RESERVE} USDC, ` +
				`min pnl gap ${REBALANCE_MIN_PNL_GAP})`,
		);
	}

	let nextRebalanceAt = 0;

	while (!signal.aborted) {
		if (REBALANCE_ENABLED && Date.now() >= nextRebalanceAt) {
			try {
				await rebalanceBotsIfNeeded(ctx, bots, signal);
			} catch (err) {
				trepaLog.error(`rebalance failed — ${describeError(err)}`);
			} finally {
				nextRebalanceAt = Date.now() + REBALANCE_INTERVAL_MS;
			}
		}

		for (const bot of bots) {
			if (signal.aborted) return;
			try {
				await topUpBotIfNeeded(ctx, bot);
			} catch (err) {
				trepaLog.error(`${bot.label}: top-up failed — ${describeError(err)}`);
			}
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
	const botClients = credentials.map(
		(c) =>
			new Trepa({
				credentials: [c],
				solanaRpcUrl: trepa.solanaRpcUrl,
				solanaRpcSubscriptionsUrl: trepa.solanaRpcSubscriptionsUrl,
			}),
	);
	const botUsers = await Promise.all(botClients.map((client) => client.me()));

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
	const thresholdUnits = toBaseUnits(USDC_THRESHOLD, decimals);
	const rebalanceCapUnits = toBaseUnits(REBALANCE_MAX_TRANSFER, decimals);
	const rebalanceDonorReserveUnits = toBaseUnits(
		REBALANCE_DONOR_RESERVE,
		decimals,
	);

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

	const bots: BotWallet[] = botSigners.map((s, i) => {
		const user = botUsers[i];
		return {
			address: s.address,
			label:
				credentials.length > 1 ? `bot ${i + 1}/${credentials.length}` : 'bot',
			signer: s,
			client: botClients[i],
			userId: user.id,
		};
	});

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
			rebalanceCapUnits,
			rebalanceDonorReserveUnits,
			rebalanceMinPnlGap: REBALANCE_MIN_PNL_GAP,
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

async function topUpBotIfNeeded(ctx: FunderCtx, bot: BotWallet): Promise<void> {
	const [botAta] = await findAssociatedTokenPda({
		mint: ctx.mint,
		owner: bot.address,
		tokenProgram: TOKEN_PROGRAM_ADDRESS,
	});

	const tokenAccount = await fetchMaybeToken(ctx.rpc, botAta);
	const current = tokenAccount.exists ? tokenAccount.data.amount : 0n;
	const needsAta = !tokenAccount.exists;

	if (!needsAta && current >= ctx.thresholdUnits) return;

	const instructions: Instruction[] = [];
	const movements: string[] = [];

	if (needsAta) {
		instructions.push(
			await getCreateAssociatedTokenIdempotentInstructionAsync({
				payer: ctx.master,
				owner: bot.address,
				mint: ctx.mint,
			}),
		);
	}

	const deficit = ctx.targetUnits - current;
	if (deficit > 0n) {
		instructions.push(
			getTransferCheckedInstruction({
				source: ctx.masterAta,
				mint: ctx.mint,
				destination: botAta,
				authority: ctx.master,
				amount: deficit,
				decimals: ctx.decimals,
			}),
		);
		movements.push(`+${formatBaseUnits(deficit, ctx.decimals)} USDC`);
	} else if (needsAta) {
		movements.push('created ATA');
	}

	if (instructions.length === 0) return;

	const { value: latestBlockhash } = await ctx.rpc.getLatestBlockhash().send();
	const message = pipe(
		createTransactionMessage({ version: 0 }),
		(tx) => setTransactionMessageFeePayerSigner(ctx.master, tx),
		(tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
		(tx) => appendTransactionMessageInstructions(instructions, tx),
	);
	const signed = await signTransactionMessageWithSigners(message);
	assertIsTransactionWithinSizeLimit(signed);
	assertIsTransactionWithBlockhashLifetime(signed);
	await ctx.sendAndConfirm(signed, { commitment: 'confirmed' });

	trepaLog.success(`${bot.label}: ${movements.join(', ')}`);
}

async function rebalanceBotsIfNeeded(
	ctx: FunderCtx,
	bots: readonly BotWallet[],
	signal: AbortSignal,
): Promise<void> {
	if (bots.length < 2) return;

	const snapshots = await Promise.all(
		bots.map((bot) => loadBotSnapshot(ctx, bot, signal)),
	);
	const donors = snapshots
		.filter((s) => s.balance > ctx.targetUnits + ctx.rebalanceDonorReserveUnits)
		.sort((a, b) => b.pnl - a.pnl);
	const receivers = snapshots
		.filter((s) => s.balance < ctx.thresholdUnits)
		.sort((a, b) => a.pnl - b.pnl);

	if (donors.length === 0 || receivers.length === 0) return;

	for (const receiver of receivers) {
		if (signal.aborted) return;
		let deficit = ctx.targetUnits - receiver.balance;
		if (deficit <= 0n) continue;

		for (const donor of donors) {
			if (signal.aborted || deficit <= 0n) break;
			if (donor.bot.address === receiver.bot.address) continue;
			if (donor.pnl - receiver.pnl < ctx.rebalanceMinPnlGap) continue;

			const minDonorBalance = ctx.targetUnits + ctx.rebalanceDonorReserveUnits;
			const donorSlack = donor.balance - minDonorBalance;
			if (donorSlack <= 0n) continue;

			const amount = minBigInt(deficit, donorSlack, ctx.rebalanceCapUnits);
			if (amount <= 0n) continue;

			await transferBetweenBots(ctx, donor.bot, receiver.bot, receiver, amount);
			donor.balance -= amount;
			receiver.balance += amount;
			deficit -= amount;
		}
	}
}

async function loadBotSnapshot(
	ctx: FunderCtx,
	bot: BotWallet,
	signal: AbortSignal,
): Promise<BotSnapshot> {
	const [ata] = await findAssociatedTokenPda({
		mint: ctx.mint,
		owner: bot.address,
		tokenProgram: TOKEN_PROGRAM_ADDRESS,
	});
	const [tokenAccount, stats] = await Promise.all([
		fetchMaybeToken(ctx.rpc, ata),
		bot.client.users.statistics(bot.userId),
	]);
	if (signal.aborted) {
		throw new Error('aborted while loading bot snapshot');
	}
	return {
		bot,
		ata,
		hasAta: tokenAccount.exists,
		balance: tokenAccount.exists ? tokenAccount.data.amount : 0n,
		pnl: Number.isFinite(stats.pnl) ? stats.pnl : 0,
	};
}

async function transferBetweenBots(
	ctx: FunderCtx,
	donor: BotWallet,
	receiver: BotWallet,
	receiverSnapshot: BotSnapshot,
	amount: bigint,
): Promise<void> {
	const [donorAta] = await findAssociatedTokenPda({
		mint: ctx.mint,
		owner: donor.address,
		tokenProgram: TOKEN_PROGRAM_ADDRESS,
	});
	const instructions: Instruction[] = [];

	if (!receiverSnapshot.hasAta) {
		instructions.push(
			await getCreateAssociatedTokenIdempotentInstructionAsync({
				payer: ctx.master,
				owner: receiver.address,
				mint: ctx.mint,
			}),
		);
		receiverSnapshot.hasAta = true;
	}

	instructions.push(
		getTransferCheckedInstruction({
			source: donorAta,
			mint: ctx.mint,
			destination: receiverSnapshot.ata,
			authority: donor.signer,
			amount,
			decimals: ctx.decimals,
		}),
	);

	const { value: latestBlockhash } = await ctx.rpc.getLatestBlockhash().send();
	const message = pipe(
		createTransactionMessage({ version: 0 }),
		(tx) => setTransactionMessageFeePayerSigner(ctx.master, tx),
		(tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
		(tx) => appendTransactionMessageInstructions(instructions, tx),
	);
	const signed = await signTransactionMessageWithSigners(message);
	assertIsTransactionWithinSizeLimit(signed);
	assertIsTransactionWithBlockhashLifetime(signed);
	await ctx.sendAndConfirm(signed, { commitment: 'confirmed' });

	trepaLog.success(
		`rebalance ${donor.label} -> ${receiver.label}: ` +
			`${formatBaseUnits(amount, ctx.decimals)} USDC`,
	);
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

function minBigInt(a: bigint, b: bigint, c: bigint): bigint {
	return a < b ? (a < c ? a : c) : b < c ? b : c;
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
