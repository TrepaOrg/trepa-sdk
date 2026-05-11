import { address, type Address } from '@solana/addresses';
import { createSolanaRpc } from '@solana/rpc';
import { createSolanaRpcSubscriptions } from '@solana/rpc-subscriptions';
import type {
	Lamports,
	TokenAmount,
	AccountInfoBase,
	AccountInfoWithJsonData,
} from '@solana/rpc-types';
import {
	fetchMaybeToken,
	findAssociatedTokenPda,
	TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';

import type { components } from '../api/schema';
import type { TrepaClient } from '../http/client';
import { formatNumber } from '../logging/format';
import {
	initMasterWalletHud,
	patchMasterWalletHud,
	patchSlotWalletHud,
} from '../logging/log-ink';
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

function stakeUiFromJsonParsedAccountInfo(
	account: JsonParsedSplAccount | null,
): string {
	if (!account) return '0';
	const { data } = account;
	if (typeof data !== 'object' || data === null || !('parsed' in data)) {
		return '0';
	}
	const root = data as {
		parsed?: { type?: string; info?: { tokenAmount?: TokenAmount } };
	};
	const parsed = root.parsed;
	if (
		typeof parsed !== 'object' ||
		parsed === null ||
		parsed.type !== 'account' ||
		!parsed.info?.tokenAmount
	) {
		return '0';
	}
	return tokenAmountToUiString(parsed.info.tokenAmount);
}

function formatStakeBaseUnits(amount: bigint, decimals: number): string {
	const n = Number(amount) / 10 ** decimals;
	return formatNumber(n, Math.min(decimals, 6));
}

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
	patchSlotWalletHud(opts.slotIndex, {
		username: (opts.me.username ?? '').trim(),
	});

	const wallet = address(opts.me.wallet_address);
	const rpc = createSolanaRpc(opts.rpcUrl);
	const subs = createSolanaRpcSubscriptions(opts.wsUrl);

	let stakeMint: string | undefined;
	let stakeDecimals = 6;
	try {
		const pools = await opts.client.pools.list({ limit: 1 });
		const p0 = pools[0];
		stakeMint = p0?.stake_token_mint;
		if (typeof p0?.decimals === 'number') stakeDecimals = p0.decimals;
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

	try {
		const token = await fetchMaybeToken(rpc, ata, {
			commitment: 'confirmed',
		});
		const ui = token.exists
			? formatStakeBaseUnits(token.data.amount, stakeDecimals)
			: '0';
		patchSlotWalletHud(opts.slotIndex, { usdc: `${ui} USDC` });
	} catch {}

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
			stakeUiFromJsonParsedAccountInfo(info),
		rpcSubscriptionRequest: subs.accountNotifications(ata, {
			encoding: 'jsonParsed',
			commitment: 'confirmed',
		}),
		rpcSubscriptionValueMapper: (info: JsonParsedSplAccount | null) =>
			stakeUiFromJsonParsedAccountInfo(info),
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

export function startMasterWalletHudMirror(opts: {
	shortAddr: string;
	wallet: Address;
	stakeDecimals: number;
	masterAta: Address;
	rpcUrl: string;
	wsUrl: string;
	signal: AbortSignal;
}): void {
	initMasterWalletHud(opts.shortAddr);
	void runMasterWalletHudMirror({
		wallet: opts.wallet,
		stakeDecimals: opts.stakeDecimals,
		masterAta: opts.masterAta,
		rpcUrl: opts.rpcUrl,
		wsUrl: opts.wsUrl,
		signal: opts.signal,
	}).catch(() => undefined);
}

async function runMasterWalletHudMirror(opts: {
	wallet: Address;
	stakeDecimals: number;
	masterAta: Address;
	rpcUrl: string;
	wsUrl: string;
	signal: AbortSignal;
}): Promise<void> {
	const rpc = createSolanaRpc(opts.rpcUrl);
	const subs = createSolanaRpcSubscriptions(opts.wsUrl);
	const wallet = opts.wallet;
	const ata = opts.masterAta;

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
				patchMasterWalletHud({
					sol: formatSolLamports(st.value),
				});
			}
		} catch {}
	})();

	try {
		const token = await fetchMaybeToken(rpc, ata, {
			commitment: 'confirmed',
		});
		const ui = token.exists
			? formatStakeBaseUnits(token.data.amount, opts.stakeDecimals)
			: '0';
		patchMasterWalletHud({ usdc: `${ui} USDC` });
	} catch {}

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
			stakeUiFromJsonParsedAccountInfo(info),
		rpcSubscriptionRequest: subs.accountNotifications(ata, {
			encoding: 'jsonParsed',
			commitment: 'confirmed',
		}),
		rpcSubscriptionValueMapper: (info: JsonParsedSplAccount | null) =>
			stakeUiFromJsonParsedAccountInfo(info),
	});
	void (async () => {
		try {
			for await (const st of usdcPipe) {
				patchMasterWalletHud({
					usdc: `${st.value} USDC`,
				});
			}
		} catch {}
	})();
}
