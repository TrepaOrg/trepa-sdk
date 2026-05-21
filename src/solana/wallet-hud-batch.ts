import { type Address } from '@solana/addresses';
import { createKeyPairSignerFromBytes, getBase58Encoder } from '@solana/kit';
import {
	findAssociatedTokenPda,
	TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';

import { fetchFunderBalancesBatch } from './balance-batch';
import { sharedSolanaRpc } from './rpc-pool';
import type { StakeTokenInfo } from './stake-token-cache';
import { formatNumber } from '../logging/format';

export interface WalletHudWalletSeed {
	solLamports: bigint;
	stakeUi: string;
}

export interface WalletHudBatchSnapshot {
	stakeDecimals: number;
	master?: WalletHudWalletSeed;
	/** Per bot slot index (same order as swarm credentials). */
	slots: readonly (WalletHudWalletSeed | undefined)[];
}

function resolveMasterPrivateKeyFromEnv(): string {
	if (typeof process !== 'undefined' && process.env) {
		return process.env.TREPA_MASTER_PRIVATE_KEY?.trim() ?? '';
	}
	return '';
}

async function addressFromPrivateKeyBase58(
	privateKeyBase58: string,
): Promise<Address> {
	const bytes = getBase58Encoder().encode(privateKeyBase58);
	const signer = await createKeyPairSignerFromBytes(bytes as Uint8Array);
	return signer.address;
}

function formatStakeUi(amount: bigint, decimals: number): string {
	const n = Number(amount) / 10 ** decimals;
	return formatNumber(n, Math.min(decimals, 6));
}

function rowToSeed(
	solLamports: bigint,
	tokenAmount: bigint,
	decimals: number,
): WalletHudWalletSeed {
	return {
		solLamports,
		stakeUi: formatStakeUi(tokenAmount, decimals),
	};
}

/**
 * One (or few) `getMultipleAccounts` calls for every HUD wallet + stake ATA,
 * used to paint the terminal before WebSocket subscriptions take over.
 */
export async function prepareWalletHudBatch(args: {
	rpcUrl: string;
	stakeToken: StakeTokenInfo;
	botPrivateKeys: readonly string[];
	masterPrivateKey?: string;
}): Promise<WalletHudBatchSnapshot> {
	const { stakeToken, botPrivateKeys } = args;
	const masterKey =
		args.masterPrivateKey?.trim() || resolveMasterPrivateKeyFromEnv();

	const botAddresses = await Promise.all(
		botPrivateKeys.map((key) => addressFromPrivateKeyBase58(key)),
	);

	let masterAddress: Address | undefined;
	let masterAta: Address | undefined;
	if (masterKey) {
		masterAddress = await addressFromPrivateKeyBase58(masterKey);
		[masterAta] = await findAssociatedTokenPda({
			mint: stakeToken.mint,
			owner: masterAddress,
			tokenProgram: TOKEN_PROGRAM_ADDRESS,
		});
	}

	const rpc = sharedSolanaRpc(args.rpcUrl);
	const batch = await fetchFunderBalancesBatch({
		rpc,
		mint: stakeToken.mint,
		masterAddress,
		masterAta,
		botAddresses,
	});

	const slots: (WalletHudWalletSeed | undefined)[] = botAddresses.map(
		(addr) => {
			const row = batch.bots.find((b) => b.botAddress === addr);
			if (!row) return undefined;
			return rowToSeed(row.solLamports, row.tokenAmount, stakeToken.decimals);
		},
	);

	return {
		stakeDecimals: stakeToken.decimals,
		master:
			masterAddress !== undefined
				? rowToSeed(
						batch.masterLamports,
						batch.masterTokenAmount,
						stakeToken.decimals,
					)
				: undefined,
		slots,
	};
}
