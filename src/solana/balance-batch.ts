import { type Address } from '@solana/addresses';
import { createSolanaRpc } from '@solana/rpc';
import type {
	AccountInfoBase,
	AccountInfoWithJsonData,
} from '@solana/rpc-types';
import {
	findAssociatedTokenPda,
	TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';

const GET_MULTIPLE_ACCOUNTS_ADDRESS_LIMIT = 100;
const ACCOUNTS_PER_BOT = 2;

type JsonParsedAccount = Readonly<AccountInfoBase & AccountInfoWithJsonData>;

interface BotAtaPair {
	botAddress: Address;
	botAta: Address;
}

export interface BotBalanceRow {
	botAddress: Address;
	botAta: Address;
	solLamports: bigint;
	tokenAmount: bigint;
	tokenAccountExists: boolean;
}

export interface FunderBalancesBatch {
	masterLamports: bigint;
	masterTokenAmount: bigint;
	masterTokenAccountExists: boolean;
	bots: BotBalanceRow[];
}

/**
 * How many bots fit in the next `getMultipleAccounts` call after reserving
 * `extraAccounts` (e.g. 1 slot for the master wallet on the first chunk only).
 */
function botsPerGetMultipleAccountsChunk(
	botsRemaining: number,
	extraAccounts: number,
): number {
	const slots = GET_MULTIPLE_ACCOUNTS_ADDRESS_LIMIT - extraAccounts;
	if (slots < ACCOUNTS_PER_BOT) {
		return 0;
	}
	return Math.min(botsRemaining, Math.floor(slots / ACCOUNTS_PER_BOT));
}

function parseTokenAmount(account: JsonParsedAccount | null): {
	exists: boolean;
	amount: bigint;
} {
	if (!account) {
		return { exists: false, amount: 0n };
	}
	const { data } = account;
	if (typeof data !== 'object' || data === null || !('parsed' in data)) {
		return { exists: false, amount: 0n };
	}
	const root = data as {
		parsed?: {
			type?: string;
			info?: { tokenAmount?: { amount: string } };
		};
	};
	const parsed = root.parsed;
	if (parsed?.type !== 'account' || !parsed.info?.tokenAmount?.amount) {
		return { exists: false, amount: 0n };
	}
	return { exists: true, amount: BigInt(parsed.info.tokenAmount.amount) };
}

function parseLamports(account: JsonParsedAccount | null): bigint {
	if (!account || account.lamports === undefined || account.lamports === null) {
		return 0n;
	}
	return BigInt(account.lamports);
}

async function fetchAccountsJsonParsed(
	rpc: ReturnType<typeof createSolanaRpc>,
	addresses: readonly Address[],
): Promise<(JsonParsedAccount | null)[]> {
	const { value } = await rpc
		.getMultipleAccounts(addresses, {
			encoding: 'jsonParsed',
			commitment: 'confirmed',
		})
		.send();
	return value as (JsonParsedAccount | null)[];
}

function parseChunkAccounts(
	chunk: readonly BotAtaPair[],
	accounts: readonly (JsonParsedAccount | null)[],
	masterInChunk: Readonly<{ wallet: boolean; ata: boolean }>,
): {
	masterLamports?: bigint;
	masterTokenAmount?: bigint;
	masterTokenAccountExists?: boolean;
	bots: BotBalanceRow[];
} {
	let index = 0;
	let masterLamports: bigint | undefined;
	let masterTokenAmount: bigint | undefined;
	let masterTokenAccountExists: boolean | undefined;
	if (masterInChunk.wallet) {
		const masterAccount = accounts[index++] ?? null;
		masterLamports = parseLamports(masterAccount);
	}
	if (masterInChunk.ata) {
		const token = parseTokenAmount(accounts[index++] ?? null);
		masterTokenAmount = token.amount;
		masterTokenAccountExists = token.exists;
	}

	const bots: BotBalanceRow[] = [];
	for (const row of chunk) {
		const walletAccount = accounts[index++] ?? null;
		const tokenAccount = accounts[index++] ?? null;
		const token = parseTokenAmount(tokenAccount);
		bots.push({
			botAddress: row.botAddress,
			botAta: row.botAta,
			solLamports: parseLamports(walletAccount),
			tokenAmount: token.amount,
			tokenAccountExists: token.exists,
		});
	}
	return {
		masterLamports,
		masterTokenAmount,
		masterTokenAccountExists,
		bots,
	};
}

/**
 * Fetches master SOL + every bot wallet and stake ATA via `getMultipleAccounts`.
 * Splits into as few RPC calls as the 100-address limit allows (1 + 2×bots per call).
 */
export async function fetchFunderBalancesBatch(args: {
	rpc: ReturnType<typeof createSolanaRpc>;
	mint: Address;
	masterAddress?: Address;
	masterAta?: Address;
	botAddresses: readonly Address[];
}): Promise<FunderBalancesBatch> {
	const { rpc, mint, masterAddress, masterAta, botAddresses } = args;

	if (botAddresses.length === 0) {
		if (!masterAddress) {
			return {
				masterLamports: 0n,
				masterTokenAmount: 0n,
				masterTokenAccountExists: false,
				bots: [],
			};
		}
		const addresses = masterAta ? [masterAddress, masterAta] : [masterAddress];
		const accounts = await fetchAccountsJsonParsed(rpc, addresses);
		const walletAccount = accounts[0] ?? null;
		const token = masterAta
			? parseTokenAmount(accounts[1] ?? null)
			: { exists: false, amount: 0n };
		return {
			masterLamports: parseLamports(walletAccount),
			masterTokenAmount: token.amount,
			masterTokenAccountExists: token.exists,
			bots: [],
		};
	}

	const botAtaPairs = await Promise.all(
		botAddresses.map(async (botAddress) => {
			const [botAta] = await findAssociatedTokenPda({
				mint,
				owner: botAddress,
				tokenProgram: TOKEN_PROGRAM_ADDRESS,
			});
			return { botAddress, botAta };
		}),
	);

	const allBots: BotBalanceRow[] = [];
	let masterLamports = 0n;
	let masterTokenAmount = 0n;
	let masterTokenAccountExists = false;
	let offset = 0;
	let includeMasterWallet = masterAddress !== undefined;
	let includeMasterAta = masterAddress !== undefined && masterAta !== undefined;

	while (offset < botAtaPairs.length) {
		const extraAccounts =
			(includeMasterWallet ? 1 : 0) + (includeMasterAta ? 1 : 0);
		const count = botsPerGetMultipleAccountsChunk(
			botAtaPairs.length - offset,
			extraAccounts,
		);
		if (count <= 0) {
			break;
		}

		const chunk = botAtaPairs.slice(offset, offset + count);
		const addresses: Address[] = [];
		if (includeMasterWallet && masterAddress) {
			addresses.push(masterAddress);
		}
		if (includeMasterAta && masterAta) {
			addresses.push(masterAta);
		}
		for (const row of chunk) {
			addresses.push(row.botAddress, row.botAta);
		}

		const accounts = await fetchAccountsJsonParsed(rpc, addresses);
		const parsed = parseChunkAccounts(chunk, accounts, {
			wallet: includeMasterWallet,
			ata: includeMasterAta,
		});

		if (parsed.masterLamports !== undefined) {
			masterLamports = parsed.masterLamports;
		}
		if (parsed.masterTokenAmount !== undefined) {
			masterTokenAmount = parsed.masterTokenAmount;
		}
		if (parsed.masterTokenAccountExists !== undefined) {
			masterTokenAccountExists = parsed.masterTokenAccountExists;
		}
		allBots.push(...parsed.bots);

		offset += count;
		includeMasterWallet = false;
		includeMasterAta = false;
	}

	return {
		masterLamports,
		masterTokenAmount,
		masterTokenAccountExists,
		bots: allBots,
	};
}
