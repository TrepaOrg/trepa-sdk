import { address } from '@solana/addresses';
import { createSolanaRpc } from '@solana/rpc';
import type {
	JsonParsedTokenAccount,
	JsonParsedTokenProgramAccount,
	RpcParsedType,
} from '@solana/rpc-parsed-types';
import { createSolanaRpcSubscriptions } from '@solana/rpc-subscriptions';
import type {
	AccountInfoBase,
	AccountInfoWithJsonData,
	Lamports,
	TokenAmount,
} from '@solana/rpc-types';
import {
	findAssociatedTokenPda,
	TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';

import type { components } from '../api/schema';
import type { TrepaClient } from '../http/client';
import { formatNumber } from '../logging/format';
import { patchSlotWalletHud } from '../logging/log-ink';
import { createAsyncGeneratorWithInitialValueAndSlotTracking } from './vendor/create-async-generator-with-initial-value-and-slot-tracking';

type UserDto = components['schemas']['UserDto'];

type JsonParsedSplAccount = Readonly<AccountInfoBase & AccountInfoWithJsonData>;

function formatSolLamports(lamports: Lamports): string {
	const n = Number(lamports) / 1e9;
	return `${formatNumber(n, 4)} SOL`;
}

function tokenAmountToUiString(t: TokenAmount): string {
	const u = t.uiAmountString;
	if (typeof u === 'string' && u.length > 0) return u;
	const n = Number(BigInt(String(t.amount))) / 10 ** t.decimals;
	return formatNumber(n, Math.min(t.decimals, 6));
}

function isParsedSplTokenAccount(
	parsed: JsonParsedTokenProgramAccount,
): parsed is RpcParsedType<'account', JsonParsedTokenAccount> {
	return parsed.type === 'account';
}

function usdcAmountFromJsonParsedAccountInfo(
	account: JsonParsedSplAccount | null,
): string {
	if (!account) return '0';
	const { data } = account;
	if (typeof data !== 'object' || data === null || !('parsed' in data)) {
		return '0';
	}
	if (!('program' in data) || data.program !== TOKEN_PROGRAM_ADDRESS) {
		return '0';
	}
	const parsed = data.parsed as JsonParsedTokenProgramAccount;
	if (!isParsedSplTokenAccount(parsed)) return '0';
	return tokenAmountToUiString(parsed.info.tokenAmount);
}

/** Subscribes to live SOL and stake-token balances for one swarm slot (TTY / Ink only). */
export function startBotWalletHudMirror(opts: {
	client: TrepaClient;
	me: UserDto;
	slotIndex: number;
	rpcUrl: string;
	wsUrl: string;
	signal: AbortSignal;
}): void {
	void runBotWalletHudMirror(opts).catch(() => undefined);
}

async function runBotWalletHudMirror(opts: {
	client: TrepaClient;
	me: UserDto;
	slotIndex: number;
	rpcUrl: string;
	wsUrl: string;
	signal: AbortSignal;
}): Promise<void> {
	patchSlotWalletHud(opts.slotIndex, { username: opts.me.username });

	const wallet = address(opts.me.wallet_address);
	const rpc = createSolanaRpc(opts.rpcUrl);
	const subs = createSolanaRpcSubscriptions(opts.wsUrl);

	let stakeMint: string | undefined;
	try {
		const pools = await opts.client.pools.list({ limit: 1 });
		stakeMint = pools[0]?.stake_token_mint;
	} catch {}

	const solPipe = createAsyncGeneratorWithInitialValueAndSlotTracking<
		Lamports,
		{ lamports: Lamports },
		Lamports
	>({
		abortSignal: opts.signal,
		rpcRequest: rpc.getBalance(wallet, { commitment: 'confirmed' }),
		rpcValueMapper: (v: Lamports) => v,
		rpcSubscriptionRequest: subs.accountNotifications(wallet, {
			commitment: 'confirmed',
		}),
		rpcSubscriptionValueMapper: (a: { lamports: Lamports }) => a.lamports,
	});
	void (async () => {
		try {
			for await (const st of solPipe) {
				patchSlotWalletHud(opts.slotIndex, {
					sol: formatSolLamports(st.value),
				});
			}
		} catch {}
	})();

	if (!stakeMint) {
		patchSlotWalletHud(opts.slotIndex, { usdc: '—' });
		return;
	}

	const mintAddr = address(stakeMint);
	const [ata] = await findAssociatedTokenPda({
		mint: mintAddr,
		owner: wallet,
		tokenProgram: TOKEN_PROGRAM_ADDRESS,
	});

	const usdcPipe = createAsyncGeneratorWithInitialValueAndSlotTracking<
		JsonParsedSplAccount | null,
		JsonParsedSplAccount | null,
		string
	>({
		abortSignal: opts.signal,
		rpcRequest: rpc.getAccountInfo(ata, {
			encoding: 'jsonParsed',
			commitment: 'confirmed',
		}),
		rpcValueMapper: (info: JsonParsedSplAccount | null) =>
			usdcAmountFromJsonParsedAccountInfo(info),
		rpcSubscriptionRequest: subs.accountNotifications(ata, {
			encoding: 'jsonParsed',
			commitment: 'confirmed',
		}),
		rpcSubscriptionValueMapper: (info: JsonParsedSplAccount | null) =>
			usdcAmountFromJsonParsedAccountInfo(info),
	});
	void (async () => {
		try {
			for await (const st of usdcPipe) {
				patchSlotWalletHud(opts.slotIndex, {
					usdc: `${st.value} USDC`,
				});
			}
		} catch {}
	})();
}
