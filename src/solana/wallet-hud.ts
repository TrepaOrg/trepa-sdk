import { address, type Address } from '@solana/addresses';
import type {
	Lamports,
	TokenAmount,
	AccountInfoBase,
	AccountInfoWithJsonData,
} from '@solana/rpc-types';
import {
	findAssociatedTokenPda,
	TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';

import { sharedSolanaRpc, sharedSolanaRpcSubscriptions } from './rpc-pool';
import {
	resolveStakeTokenFromClient,
	type StakeTokenInfo,
} from './stake-token-cache';
import type { WalletHudWalletSeed } from './wallet-hud-batch';
import type { components } from '../api/schema';
import type { TrepaClient } from '../http/client';
import { formatNumber } from '../logging/format';
import {
	initMasterWalletHud,
	patchMasterWalletHud,
	patchSlotWalletHud,
} from '../logging/log-ink';
import { createAsyncGeneratorWithInitialValueAndSlotTracking } from './vendor/create-async-generator-with-initial-value-and-slot-tracking';

export type { WalletHudWalletSeed } from './wallet-hud-batch';

type UserDto = components['schemas']['UserDto'];

type JsonParsedSplAccount = Readonly<AccountInfoBase & AccountInfoWithJsonData>;

export interface WalletHudRpcOpts {
	rpcUrl: string;
	wsUrl: string;
	signal: AbortSignal;
	/** When set (e.g. from swarm), skips per-bot `pools.list`. */
	stakeToken?: StakeTokenInfo;
	/** Batched startup snapshot; skips initial HTTP for this wallet. */
	seed?: WalletHudWalletSeed;
}

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

async function resolveHudStakeToken(
	client: TrepaClient | undefined,
	stakeToken: StakeTokenInfo | undefined,
): Promise<StakeTokenInfo | undefined> {
	if (stakeToken) {
		return stakeToken;
	}
	if (!client) {
		return undefined;
	}
	try {
		return await resolveStakeTokenFromClient(client);
	} catch {
		return undefined;
	}
}

function startSolHudWsOnly(opts: {
	abortSignal: AbortSignal;
	wsUrl: string;
	wallet: Address;
	onUpdate: (sol: string) => void;
}): void {
	const subs = sharedSolanaRpcSubscriptions(opts.wsUrl);
	void (async () => {
		try {
			const notifications = await subs
				.accountNotifications(opts.wallet, { commitment: 'confirmed' })
				.subscribe({ abortSignal: opts.abortSignal });
			for await (const { value: account } of notifications) {
				opts.onUpdate(formatSolLamports(account.lamports));
			}
		} catch {}
	})();
}

function startStakeHudWsOnly(opts: {
	abortSignal: AbortSignal;
	wsUrl: string;
	ata: Address;
	onUpdate: (usdc: string) => void;
}): void {
	const subs = sharedSolanaRpcSubscriptions(opts.wsUrl);
	void (async () => {
		try {
			const notifications = await subs
				.accountNotifications(opts.ata, {
					encoding: 'jsonParsed',
					commitment: 'confirmed',
				})
				.subscribe({ abortSignal: opts.abortSignal });
			for await (const { value: info } of notifications) {
				opts.onUpdate(`${stakeUiFromJsonParsedAccountInfo(info)} USDC`);
			}
		} catch {}
	})();
}

function startSolHudPipe(opts: {
	abortSignal: AbortSignal;
	rpcUrl: string;
	wsUrl: string;
	wallet: Address;
	seed?: WalletHudWalletSeed;
	onUpdate: (sol: string) => void;
}): void {
	if (opts.seed) {
		opts.onUpdate(formatSolLamports(opts.seed.solLamports as Lamports));
		startSolHudWsOnly({
			abortSignal: opts.abortSignal,
			wsUrl: opts.wsUrl,
			wallet: opts.wallet,
			onUpdate: opts.onUpdate,
		});
		return;
	}

	const rpc = sharedSolanaRpc(opts.rpcUrl);
	const subs = sharedSolanaRpcSubscriptions(opts.wsUrl);
	const solPipe = createAsyncGeneratorWithInitialValueAndSlotTracking<
		Lamports,
		{ lamports: Lamports },
		Lamports
	>({
		abortSignal: opts.abortSignal,
		rpcRequest: rpc.getBalance(opts.wallet, { commitment: 'confirmed' }),
		rpcValueMapper: (v: Lamports) => v,
		rpcSubscriptionRequest: subs.accountNotifications(opts.wallet, {
			commitment: 'confirmed',
		}),
		rpcSubscriptionValueMapper: (a: { lamports: Lamports }) => a.lamports,
	});
	void (async () => {
		try {
			for await (const st of solPipe) {
				opts.onUpdate(formatSolLamports(st.value));
			}
		} catch {}
	})();
}

function startStakeHudPipe(opts: {
	abortSignal: AbortSignal;
	rpcUrl: string;
	wsUrl: string;
	ata: Address;
	seed?: WalletHudWalletSeed;
	onUpdate: (usdc: string) => void;
}): void {
	if (opts.seed) {
		opts.onUpdate(`${opts.seed.stakeUi} USDC`);
		startStakeHudWsOnly({
			abortSignal: opts.abortSignal,
			wsUrl: opts.wsUrl,
			ata: opts.ata,
			onUpdate: opts.onUpdate,
		});
		return;
	}

	const rpc = sharedSolanaRpc(opts.rpcUrl);
	const subs = sharedSolanaRpcSubscriptions(opts.wsUrl);
	const usdcPipe = createAsyncGeneratorWithInitialValueAndSlotTracking<
		JsonParsedSplAccount | null,
		JsonParsedSplAccount | null,
		string
	>({
		abortSignal: opts.abortSignal,
		rpcRequest: rpc.getAccountInfo(opts.ata, {
			encoding: 'jsonParsed',
			commitment: 'confirmed',
		}),
		rpcValueMapper: (info: JsonParsedSplAccount | null) =>
			stakeUiFromJsonParsedAccountInfo(info),
		rpcSubscriptionRequest: subs.accountNotifications(opts.ata, {
			encoding: 'jsonParsed',
			commitment: 'confirmed',
		}),
		rpcSubscriptionValueMapper: (info: JsonParsedSplAccount | null) =>
			stakeUiFromJsonParsedAccountInfo(info),
	});
	void (async () => {
		try {
			for await (const st of usdcPipe) {
				opts.onUpdate(`${st.value} USDC`);
			}
		} catch {}
	})();
}

export function startBotWalletHudMirror(
	opts: WalletHudRpcOpts & {
		client?: TrepaClient;
		me: UserDto;
		slotIndex: number;
	},
): void {
	void runBotWalletHudMirror(opts).catch(() => undefined);
}

async function runBotWalletHudMirror(
	opts: WalletHudRpcOpts & {
		client?: TrepaClient;
		me: UserDto;
		slotIndex: number;
	},
): Promise<void> {
	patchSlotWalletHud(opts.slotIndex, {
		username: (opts.me.username ?? '').trim(),
	});

	const wallet = address(opts.me.wallet_address);
	const stake = await resolveHudStakeToken(opts.client, opts.stakeToken);

	startSolHudPipe({
		abortSignal: opts.signal,
		rpcUrl: opts.rpcUrl,
		wsUrl: opts.wsUrl,
		wallet,
		seed: opts.seed,
		onUpdate: (sol) => {
			patchSlotWalletHud(opts.slotIndex, { sol });
		},
	});

	if (!stake) {
		patchSlotWalletHud(opts.slotIndex, { usdc: '—' });
		return;
	}

	const [ata] = await findAssociatedTokenPda({
		mint: stake.mint,
		owner: wallet,
		tokenProgram: TOKEN_PROGRAM_ADDRESS,
	});

	startStakeHudPipe({
		abortSignal: opts.signal,
		rpcUrl: opts.rpcUrl,
		wsUrl: opts.wsUrl,
		ata,
		seed: opts.seed,
		onUpdate: (usdc) => {
			patchSlotWalletHud(opts.slotIndex, { usdc });
		},
	});
}

export function startMasterWalletHudMirror(
	opts: WalletHudRpcOpts & {
		shortAddr: string;
		wallet: Address;
		stakeDecimals: number;
		masterAta: Address;
	},
): void {
	initMasterWalletHud(opts.shortAddr);
	void runMasterWalletHudMirror(opts).catch(() => undefined);
}

async function runMasterWalletHudMirror(
	opts: WalletHudRpcOpts & {
		wallet: Address;
		stakeDecimals: number;
		masterAta: Address;
	},
): Promise<void> {
	startSolHudPipe({
		abortSignal: opts.signal,
		rpcUrl: opts.rpcUrl,
		wsUrl: opts.wsUrl,
		wallet: opts.wallet,
		seed: opts.seed,
		onUpdate: (sol) => {
			patchMasterWalletHud({ sol });
		},
	});

	startStakeHudPipe({
		abortSignal: opts.signal,
		rpcUrl: opts.rpcUrl,
		wsUrl: opts.wsUrl,
		ata: opts.masterAta,
		seed: opts.seed,
		onUpdate: (usdc) => {
			patchMasterWalletHud({ usdc });
		},
	});
}
