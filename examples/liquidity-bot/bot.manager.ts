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
import { type BotCredentials, Trepa } from '@trepa/sdk';

const USDC_TARGET = 30;
const USDC_THRESHOLD = 25;
const FUND_INTERVAL_MS = 60_000;
const FUNDER_SHUTDOWN_WAIT_MS = 15_000;

const ANSI_GREEN = '\x1b[92m';
const ANSI_RESET = '\x1b[0m';
const useColor =
	typeof process !== 'undefined' &&
	process.stdout?.isTTY === true &&
	process.env.NO_COLOR === undefined;
const logTag = useColor ? `${ANSI_GREEN}[FUND]${ANSI_RESET}` : '[FUND]';

const log = (msg: string): void => {
	console.log(`${logTag}: ${msg}`);
};

interface BotWallet {
	address: Address;
	label: string;
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
}

/**
 * Run `main()` (usually `trepa.bots.run(...)`) alongside a master-wallet
 * USDC top-up loop when `TREPA_MASTER_PRIVATE_KEY` is set. Pass the same
 * `credentials` array you gave `new Trepa({ credentials })`.
 *
 * ```ts
 * const credentials = credentialsFromEnv()
 * const trepa = new Trepa({ credentials })
 * await withManager(trepa, credentials, () => trepa.bots.run(strategy))
 * ```
 */
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
		log(`bootstrap failed — ${describeError(err)}`);
		return;
	}

	const { ctx, bots } = bootstrap;

	log(
		`master ${shortAddr(ctx.master.address)} watching ${bots.length} ` +
			`bot${bots.length === 1 ? '' : 's'} ` +
			`(USDC target ${USDC_TARGET}, threshold ${USDC_THRESHOLD})`,
	);

	while (!signal.aborted) {
		for (const bot of bots) {
			if (signal.aborted) return;
			try {
				await topUpBotIfNeeded(ctx, bot);
			} catch (err) {
				log(`${bot.label}: top-up failed — ${describeError(err)}`);
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

	const [masterAta] = await findAssociatedTokenPda({
		mint,
		owner: master.address,
		tokenProgram: TOKEN_PROGRAM_ADDRESS,
	});

	const masterToken = await fetchMaybeToken(rpc, masterAta);
	if (!masterToken.exists) {
		log(
			`master has no USDC token account for mint ${shortAddr(mint)} on ` +
				`${trepa.solanaRpcUrl} — fund the master wallet on this cluster or ` +
				`set TrepaConfig.solanaRpcUrl to match where the mint lives.`,
		);
	}

	const bots: BotWallet[] = botSigners.map((s, i) => ({
		address: s.address,
		label:
			credentials.length > 1 ? `bot ${i + 1}/${credentials.length}` : 'bot',
	}));

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

	log(`${bot.label}: ${movements.join(', ')}`);
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
